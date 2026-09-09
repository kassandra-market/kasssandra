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

/** Encode an `AiOracleFeed` account (248 bytes). */
export function encodeAiOracleFeed(feed: {
  bump: number;
  option: number;
  oracle: Address;
  slot: bigint;
  timestamp: bigint;
  modelId?: Uint8Array;
  paramsHash?: Uint8Array;
  ioHash?: Uint8Array;
  attestation?: Uint8Array;
  updatedBy?: Address;
}): Uint8Array {
  const data = new Uint8Array(ACCOUNT_SIZES.AiOracleFeed);
  const dv = new DataView(data.buffer);
  data[0] = AccountType.AiOracleFeed;
  data[1] = feed.bump;
  data[2] = feed.option;
  data.set(feed.oracle.toBytes(), 8);
  dv.setBigUint64(40, feed.slot, true);
  dv.setBigInt64(48, feed.timestamp, true);
  data.set(feed.modelId ?? new Uint8Array(32).fill(0xaa), 56);
  data.set(feed.paramsHash ?? new Uint8Array(32).fill(0xbb), 88);
  data.set(feed.ioHash ?? new Uint8Array(32).fill(0xcc), 120);
  data.set(feed.attestation ?? new Uint8Array(64), 152);
  if (feed.updatedBy) data.set(feed.updatedBy.toBytes(), 216);
  return data;
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
