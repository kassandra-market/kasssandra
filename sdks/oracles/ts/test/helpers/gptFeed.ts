/**
 * Test helper: fabricate an enabled MagicBlock GPT config + resolved feed at
 * the real PDAs, then build `applyExternalAiClaim`.
 *
 * Live `submitAiClaim` (Ix 3) is retired; suites that previously stamped
 * proposers that way go through this helper (or the equivalent Rust
 * `TestCtx::stamp_gpt_claim`).
 */
import { Address, Keypair, type TransactionInstruction } from "@solana/web3.js";

import {
  encodeAiOracleConfig,
  encodeAiOracleFeed,
} from "../../src/accounts/index.js";
import {
  ACCOUNT_SIZES,
  AI_ORACLE_SOURCE_MAGICBLOCK,
  KASSANDRA_PROGRAM_ID,
} from "../../src/constants.js";
import { applyExternalAiClaim } from "../../src/instructions/aiOracle.js";
import * as pda from "../../src/pda.js";

const DUMMY_CONTEXT = new Address(new Uint8Array(32).fill(0x42));

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export interface SetAccountUpdate {
  data: string;
  owner: string;
  lamports: number;
  executable: boolean;
}

export type SetAccountFn = (pubkey: string, update: SetAccountUpdate) => Promise<void>;

/** Write an enabled GPT config + a resolved feed for `oracle`. */
export async function writeGptFeed(
  setAccount: SetAccountFn,
  oracle: Address,
  option: number,
  hashes?: { modelId?: Uint8Array; paramsHash?: Uint8Array; ioHash?: Uint8Array },
  programId: Address = KASSANDRA_PROGRAM_ID,
): Promise<void> {
  const config = await pda.aiOracleConfig(programId);
  const feed = await pda.aiOracleFeed(oracle, programId);
  const configBytes = encodeAiOracleConfig({
    bump: config.bump,
    enabled: true,
    source: AI_ORACLE_SOURCE_MAGICBLOCK,
    llmContext: DUMMY_CONTEXT,
    maxStalenessSlots: 0xffff_ffff_ffff_ffffn,
  });
  const feedBytes = encodeAiOracleFeed({
    bump: feed.bump,
    option,
    oracle,
    slot: 0n,
    timestamp: 0n,
    modelId: hashes?.modelId,
    paramsHash: hashes?.paramsHash,
    ioHash: hashes?.ioHash,
  });
  const owner = programId.toString();
  await setAccount(config.address.toString(), {
    data: toHex(configBytes),
    owner,
    lamports: 5_000_000,
    executable: false,
  });
  await setAccount(feed.address.toString(), {
    data: toHex(feedBytes),
    owner,
    lamports: 5_000_000,
    executable: false,
  });
  // Silence unused-size drift: keep ACCOUNT_SIZES in the helper's typecheck.
  if (configBytes.length !== ACCOUNT_SIZES.AiOracleConfig) {
    throw new Error(`AiOracleConfig size drift: ${configBytes.length}`);
  }
  if (feedBytes.length !== ACCOUNT_SIZES.AiOracleFeed) {
    throw new Error(`AiOracleFeed size drift: ${feedBytes.length}`);
  }
}

/** Build Ix 29 for the given proposer authority (permissionless payer). */
export async function applyGptClaimIx(
  oracle: Address,
  proposerAuthority: Address,
  payer: Address,
  programId?: Address,
): Promise<TransactionInstruction> {
  return applyExternalAiClaim({ oracle, proposerAuthority, payer, programId });
}

/**
 * Write the GPT feed then return the apply instruction. Callers send with
 * `payer` as a signer (any funded keypair — apply is permissionless).
 */
export async function stampGptClaimIx(
  setAccount: SetAccountFn,
  oracle: Address,
  proposerAuthority: Address,
  payer: Address,
  option: number,
  hashes?: { modelId?: Uint8Array; paramsHash?: Uint8Array; ioHash?: Uint8Array },
  programId?: Address,
): Promise<TransactionInstruction> {
  await writeGptFeed(setAccount, oracle, option, hashes, programId);
  return applyGptClaimIx(oracle, proposerAuthority, payer, programId);
}

/** Convenience: `Keypair.publicKey` as the proposer authority AND payer. */
export async function stampGptClaimForAuthority(
  setAccount: SetAccountFn,
  oracle: Address,
  authority: Keypair,
  option: number,
  hashes?: { modelId?: Uint8Array; paramsHash?: Uint8Array; ioHash?: Uint8Array },
  programId?: Address,
): Promise<TransactionInstruction> {
  return stampGptClaimIx(
    setAccount,
    oracle,
    authority.publicKey,
    authority.publicKey,
    option,
    hashes,
    programId,
  );
}
