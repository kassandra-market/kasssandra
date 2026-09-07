/**
 * Decoder for the per-oracle `AiOracleFeed` (`state/ai_oracle.rs`, 248 bytes).
 */
import { Address } from "@solana/web3.js";

import { AccountType, ACCOUNT_SIZES } from "../constants.js";
import { assertAccount, readBytes, readI64LE, readPubkey, readU64LE, readU8, view } from "./common.js";

/** Decoded `AiOracleFeed`. */
export interface AiOracleFeed {
  accountType: AccountType.AiOracleFeed;
  bump: number;
  option: number;
  oracle: Address;
  /** Slot at which the program accepted the push (`Clock.slot`). */
  slot: bigint;
  timestamp: bigint;
  modelId: Uint8Array;
  paramsHash: Uint8Array;
  ioHash: Uint8Array;
  attestation: Uint8Array;
  updatedBy: Address;
}

/** Decode an `AiOracleFeed` account from its raw bytes. Throws on wrong size or tag. */
export function decodeAiOracleFeed(data: Uint8Array): AiOracleFeed {
  assertAccount(data, AccountType.AiOracleFeed, ACCOUNT_SIZES.AiOracleFeed, "AiOracleFeed");
  const dv = view(data);
  return {
    accountType: AccountType.AiOracleFeed,
    bump: readU8(dv, 1),
    option: readU8(dv, 2),
    oracle: readPubkey(data, 8),
    slot: readU64LE(dv, 40),
    timestamp: readI64LE(dv, 48),
    modelId: readBytes(data, 56, 32),
    paramsHash: readBytes(data, 88, 32),
    ioHash: readBytes(data, 120, 32),
    attestation: readBytes(data, 152, 64),
    updatedBy: readPubkey(data, 216),
  };
}
