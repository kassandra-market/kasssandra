/**
 * External AI-oracle builders (Ix 27–29): set config, push feed, apply claim.
 */
import { Address, TransactionInstruction } from "@solana/web3.js";

import { Ix, KASSANDRA_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "../constants.js";
import * as pda from "../pda.js";
import type { AddressInput } from "../pda.js";
import { addr, fixedBytes, pubkeyBytes, ro, u64LE, u8, w, withDisc } from "./payload.js";

// ---------------------------------------------------------------------------
// SetAiOracleConfig (Ix=27) — processor/set_ai_oracle_config.rs
// Accounts: 0 protocol(ro) 1 config(w) 2 authority(signer,w) 3 system(ro).
// Payload (42): authority[32] ++ max_staleness_slots u64 LE ++ source u8 ++ enabled u8.
// Admin until Protocol.governance_set, then dao_authority.
// ---------------------------------------------------------------------------
export interface SetAiOracleConfigArgs {
  /** Signer: Protocol.admin pre-handoff, dao_authority after. */
  authority: AddressInput;
  /** Pusher allowed to `pushAiOracleFeed`. */
  pusher: AddressInput;
  /** `Clock.slot - feed.slot` must be <= this. Must be > 0. */
  maxStalenessSlots: bigint | number;
  /** `AI_ORACLE_SOURCE_*` (0 external / 1 magicblock / 2 switchboard). */
  source: number;
  enabled: boolean;
  programId?: Address;
}

export async function setAiOracleConfig(args: SetAiOracleConfigArgs): Promise<TransactionInstruction> {
  const programId = args.programId ?? KASSANDRA_PROGRAM_ID;
  const protocol = await pda.protocol(programId);
  const config = await pda.aiOracleConfig(programId);
  const data = withDisc(
    Ix.SetAiOracleConfig,
    pubkeyBytes(args.pusher),
    u64LE(args.maxStalenessSlots),
    u8(args.source),
    u8(args.enabled ? 1 : 0),
  );
  return new TransactionInstruction({
    programId,
    keys: [
      w(protocol.address),
      w(config.address),
      w(addr(args.authority), true),
      ro(SYSTEM_PROGRAM_ID),
    ],
    data,
  });
}

// ---------------------------------------------------------------------------
// PushAiOracleFeed (Ix=28) — processor/push_ai_oracle_feed.rs
// Accounts: 0 config(ro) 1 oracle(ro) 2 feed(w) 3 authority(signer,w) 4 system(ro).
// Payload (161): option u8 ++ model_id[32] ++ params_hash[32] ++ io_hash[32] ++ attestation[64].
// ---------------------------------------------------------------------------
export interface PushAiOracleFeedArgs {
  oracle: AddressInput;
  /** Must equal `AiOracleConfig.authority`. */
  authority: AddressInput;
  option: number;
  modelId: Uint8Array;
  paramsHash: Uint8Array;
  ioHash: Uint8Array;
  /** Opaque 64-byte attestation (ed25519 signature, TEE quote hash, …). */
  attestation: Uint8Array;
  programId?: Address;
}

export async function pushAiOracleFeed(args: PushAiOracleFeedArgs): Promise<TransactionInstruction> {
  const programId = args.programId ?? KASSANDRA_PROGRAM_ID;
  const oracle = addr(args.oracle);
  const config = await pda.aiOracleConfig(programId);
  const feed = await pda.aiOracleFeed(oracle, programId);
  const data = withDisc(
    Ix.PushAiOracleFeed,
    u8(args.option),
    fixedBytes(args.modelId, 32),
    fixedBytes(args.paramsHash, 32),
    fixedBytes(args.ioHash, 32),
    fixedBytes(args.attestation, 64),
  );
  return new TransactionInstruction({
    programId,
    keys: [
      ro(config.address),
      ro(oracle),
      w(feed.address),
      w(addr(args.authority), true),
      ro(SYSTEM_PROGRAM_ID),
    ],
    data,
  });
}

// ---------------------------------------------------------------------------
// ApplyExternalAiClaim (Ix=29) — processor/apply_external_ai_claim.rs
// Accounts: 0 oracle(ro) 1 proposer(w) 2 claim(w) 3 config(ro) 4 feed(ro)
//           5 payer(signer,w) 6 system(ro). Payload: empty.
// ---------------------------------------------------------------------------
export interface ApplyExternalAiClaimArgs {
  oracle: AddressInput;
  /** Proposer authority whose `Proposer` PDA receives the feed's option. */
  proposerAuthority: AddressInput;
  payer: AddressInput;
  programId?: Address;
}

export async function applyExternalAiClaim(
  args: ApplyExternalAiClaimArgs,
): Promise<TransactionInstruction> {
  const programId = args.programId ?? KASSANDRA_PROGRAM_ID;
  const oracle = addr(args.oracle);
  const proposer = await pda.proposer(oracle, args.proposerAuthority, programId);
  const claim = await pda.aiClaim(oracle, proposer.address, programId);
  const config = await pda.aiOracleConfig(programId);
  const feed = await pda.aiOracleFeed(oracle, programId);
  return new TransactionInstruction({
    programId,
    keys: [
      ro(oracle),
      w(proposer.address),
      w(claim.address),
      ro(config.address),
      ro(feed.address),
      w(addr(args.payer), true),
      ro(SYSTEM_PROGRAM_ID),
    ],
    data: withDisc(Ix.ApplyExternalAiClaim),
  });
}
