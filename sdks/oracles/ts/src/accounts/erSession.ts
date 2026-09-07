/**
 * Decoder for the `ErSession` companion PDA (`state/er.rs`, 96 bytes) —
 * Kassandra's queryable MagicBlock delegation record for one oracle.
 */
import { Address } from "@solana/web3.js";

import { AccountType, ACCOUNT_SIZES } from "../constants.js";
import { assertAccount, readI64LE, readPubkey, readU32LE, readU64LE, readU8, view } from "./common.js";

/** Decoded `ErSession`. */
export interface ErSession {
  accountType: AccountType.ErSession;
  bump: number;
  /** `ER_STATUS_UNDELEGATED` (0) or `ER_STATUS_DELEGATED` (1). */
  status: number;
  oracle: Address;
  /** ER validator; all-zero = Magic Router default. */
  validator: Address;
  commitFrequencyMs: number;
  delegatedAt: bigint;
  lastCommitSlot: bigint;
}

/** Decode an `ErSession` account from its raw bytes. Throws on wrong size or tag. */
export function decodeErSession(data: Uint8Array): ErSession {
  assertAccount(data, AccountType.ErSession, ACCOUNT_SIZES.ErSession, "ErSession");
  const dv = view(data);
  return {
    accountType: AccountType.ErSession,
    bump: readU8(dv, 1),
    status: readU8(dv, 2),
    oracle: readPubkey(data, 8),
    validator: readPubkey(data, 40),
    commitFrequencyMs: readU32LE(dv, 72),
    delegatedAt: readI64LE(dv, 80),
    lastCommitSlot: readU64LE(dv, 88),
  };
}
