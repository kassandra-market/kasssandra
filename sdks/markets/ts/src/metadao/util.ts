/**
 * Shared meta + borsh helpers for the MetaDAO `amm` / `conditional_vault` wire
 * builders. Both builders emit the same account-meta shapes (writable /
 * read-only) and little-endian borsh scalars, so the encodings live here once.
 * The address coercion is the canonical {@link addr} from the instruction
 * builders (a single implementation across the SDK).
 */
import type { AccountMeta } from "@solana/web3.js";

import {
  concatBytes as concat,
  u128LE as u128le,
  u32LE as u32le,
  u64LE as u64le,
  u8 as u8b,
} from "../bytes.js";
import { addr } from "../instructions/payload.js";
import type { AddressInput } from "../pda.js";

// Re-exported under the borsh-builder names the amm/vault modules import.
export { addr, u8b, u32le, u64le, u128le, concat };

/** Writable account meta (coerces `pubkey` to an `Address`). */
export function w(pubkey: AddressInput, isSigner = false): AccountMeta {
  return { pubkey: addr(pubkey), isSigner, isWritable: true };
}

/** Read-only account meta (coerces `pubkey` to an `Address`). */
export function ro(pubkey: AddressInput, isSigner = false): AccountMeta {
  return { pubkey: addr(pubkey), isSigner, isWritable: false };
}

