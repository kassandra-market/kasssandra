/**
 * Markets-owned GPT `Subject` account decoder.
 *
 * A Subject is the resolution source a binary sub-market binds to (`Market.oracle`
 * stores this pubkey). GPT's callback stamps `resolved_option`.
 *
 * Layout (`programs/markets/src/state.rs::Subject`, 88 bytes):
 *   account_type u8 @0, bump @1, options_count @2, status @3, resolved_option @4,
 *   pad[3] @5, creator @8, llm_context @40, nonce u64 @72, resolved_slot u64 @80.
 */
import { Address } from "@solana/web3.js";

import { readPubkey, readU64LE, readU8, view } from "./common.js";

export const SUBJECT_LEN = 88;
export const SUBJECT_OPTIONS_COUNT_OFFSET = 2;
export const SUBJECT_STATUS_OFFSET = 3;
export const SUBJECT_RESOLVED_OPTION_OFFSET = 4;

/** Resolution status (`SubjectStatus`). Aliases keep older `Phase.*` call sites. */
export enum Phase {
  Open = 0,
  /** @deprecated use {@link Phase.Open} */
  Proposal = 0,
  Resolved = 1,
  Void = 2,
  /** @deprecated use {@link Phase.Void} */
  InvalidDeadend = 2,
}

export enum SubjectStatus {
  Open = 0,
  Resolved = 1,
  Void = 2,
}

export interface MarketOracle {
  optionsCount: number;
  phase: Phase;
  resolvedOption: number;
  creator?: Address;
  llmContext?: Address;
  nonce?: bigint;
  resolvedSlot?: bigint;
}

export function decodeMarketOracle(data: Uint8Array): MarketOracle {
  if (data.length < SUBJECT_LEN) {
    throw new Error(`Subject: too short — need ${SUBJECT_LEN} bytes, got ${data.length}.`);
  }
  const dv = view(data);
  return {
    optionsCount: readU8(dv, SUBJECT_OPTIONS_COUNT_OFFSET),
    phase: readU8(dv, SUBJECT_STATUS_OFFSET) as Phase,
    resolvedOption: readU8(dv, SUBJECT_RESOLVED_OPTION_OFFSET),
    creator: readPubkey(data, 8),
    llmContext: readPubkey(data, 40),
    nonce: readU64LE(dv, 72),
    resolvedSlot: readU64LE(dv, 80),
  };
}

export function isTerminal(phase: Phase): boolean {
  return phase === Phase.Resolved || phase === Phase.Void;
}

export function resolvedOptionOrNull(oracle: MarketOracle): number | null {
  return oracle.phase === Phase.Resolved ? oracle.resolvedOption : null;
}
