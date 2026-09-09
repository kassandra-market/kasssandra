/**
 * External AI-oracle builders (Ix 27–29): set config, request MagicBlock GPT
 * oracle, apply claim.
 */
import { Address, TransactionInstruction } from "@solana/web3.js";

import {
  GPT_ORACLE_CALLBACK_DISCRIMINATOR,
  GPT_ORACLE_PROGRAM_ID,
  Ix,
  KASSANDRA_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
} from "../constants.js";
import * as pda from "../pda.js";
import type { AddressInput } from "../pda.js";
import { addr, pubkeyBytes, ro, u32LE, u64LE, u8, w, withDisc } from "./payload.js";

// ---------------------------------------------------------------------------
// SetAiOracleConfig (Ix=27) — processor/set_ai_oracle_config.rs
// Accounts: 0 protocol(ro) 1 config(w) 2 authority(signer,w) 3 system(ro).
// Payload (42): llm_context[32] ++ max_staleness_slots u64 LE ++ source u8 ++ enabled u8.
// Admin until Protocol.governance_set, then dao_authority.
// ---------------------------------------------------------------------------
export interface SetAiOracleConfigArgs {
  /** Signer: Protocol.admin pre-handoff, dao_authority after. */
  authority: AddressInput;
  /** MagicBlock `ContextAccount` created via `create_llm_context`. */
  llmContext: AddressInput;
  /** `Clock.slot - feed.slot` must be <= this. Must be > 0. */
  maxStalenessSlots: bigint | number;
  /** `AI_ORACLE_SOURCE_*` (0 reserved / 1 magicblock / 2 switchboard). */
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
    pubkeyBytes(args.llmContext),
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
// RequestAiOracle (Ix=28) — processor/request_ai_oracle.rs
// Accounts: 0 config(ro) 1 oracle(ro) 2 feed(w) 3 payer(signer,w) 4 system(ro)
//           [5 gpt program 6 interaction(w) 7 llm_context] when CPI-ing.
// Payload: text_len u32 LE ++ text.
// ---------------------------------------------------------------------------
export interface RequestAiOracleArgs {
  oracle: AddressInput;
  payer: AddressInput;
  /** User text forwarded to MagicBlock `interact_with_llm` (max 700 bytes). */
  text: string | Uint8Array;
  /** When set, remaining accounts for the GPT-oracle CPI are appended. */
  llmContext?: AddressInput;
  programId?: Address;
}

export async function requestAiOracle(args: RequestAiOracleArgs): Promise<TransactionInstruction> {
  const programId = args.programId ?? KASSANDRA_PROGRAM_ID;
  const oracle = addr(args.oracle);
  const payer = addr(args.payer);
  const config = await pda.aiOracleConfig(programId);
  const feed = await pda.aiOracleFeed(oracle, programId);
  const text = typeof args.text === "string" ? new TextEncoder().encode(args.text) : args.text;
  const data = withDisc(Ix.RequestAiOracle, u32LE(text.length), text);
  const keys = [
    ro(config.address),
    ro(oracle),
    w(feed.address),
    w(payer, true),
    ro(SYSTEM_PROGRAM_ID),
  ];
  if (args.llmContext !== undefined) {
    const llmContext = addr(args.llmContext);
    const interaction = await pda.gptOracleInteraction(payer, llmContext);
    keys.push(ro(GPT_ORACLE_PROGRAM_ID));
    keys.push(w(interaction.address));
    keys.push(ro(llmContext));
  }
  return new TransactionInstruction({ programId, keys, data });
}

/** 8-byte GPT-oracle callback (not a Kassandra `Ix` byte). */
export interface CallbackFromGptOracleArgs {
  oracle: AddressInput;
  response: string;
  programId?: Address;
}

export async function callbackFromGptOracle(
  args: CallbackFromGptOracleArgs,
): Promise<TransactionInstruction> {
  const programId = args.programId ?? KASSANDRA_PROGRAM_ID;
  const oracle = addr(args.oracle);
  const identity = await pda.gptOracleIdentity();
  const config = await pda.aiOracleConfig(programId);
  const feed = await pda.aiOracleFeed(oracle, programId);
  const enc = new TextEncoder();
  const response = enc.encode(args.response);
  const data = new Uint8Array(8 + 4 + response.length);
  data.set(GPT_ORACLE_CALLBACK_DISCRIMINATOR, 0);
  data.set(u32LE(response.length), 8);
  data.set(response, 12);
  return new TransactionInstruction({
    programId,
    keys: [ro(identity.address, true), ro(config.address), ro(oracle), w(feed.address)],
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
