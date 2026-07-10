/**
 * Little-endian payload-byte helpers for the instruction builders.
 *
 * Every Kassandra instruction's `data` is `[disc_byte, ...payload]` where the
 * payload mirrors the processor's exact byte layout (all integers
 * little-endian, pubkeys as their 32 raw bytes). These helpers each return a
 * `Uint8Array` chunk; {@link concatBytes} joins them, and {@link withDisc}
 * prepends the 1-byte discriminant. The encodings match the `*_at` / `to_le_bytes`
 * reads in the Rust processors.
 */
import { Address } from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";

import { concatBytes, i64LE, u16LE, u64LE, u8 } from "../bytes.js";
import { Ix } from "../constants.js";
import type { AddressInput } from "../pda.js";

// Re-exported for the instruction builders that import them from here.
export { u8, u16LE, u64LE, i64LE, concatBytes };

/** Coerce an `AddressInput` into a web3.js `Address`. */
export function addr(a: AddressInput): Address {
  return a instanceof Address ? a : new Address(a);
}

/** Writable account meta. */
export function w(pubkey: Address, isSigner = false): AccountMeta {
  return { pubkey, isSigner, isWritable: true };
}

/** Read-only account meta. */
export function ro(pubkey: Address, isSigner = false): AccountMeta {
  return { pubkey, isSigner, isWritable: false };
}

/** The 32 raw bytes of a pubkey (the on-wire form of an `[u8; 32]` payload field). */
export function pubkeyBytes(value: AddressInput): Uint8Array {
  return (value instanceof Address ? value : new Address(value)).toBytes();
}

/** A fixed-length `[u8; len]` field; throws if `bytes` is the wrong length. */
export function fixedBytes(bytes: Uint8Array, len: number): Uint8Array {
  if (bytes.length !== len) {
    throw new Error(`expected exactly ${len} bytes, got ${bytes.length}`);
  }
  return bytes;
}

/** Build instruction `data` = `[disc, ...payload]`. */
export function withDisc(disc: Ix, ...payload: Array<Uint8Array>): Uint8Array {
  return concatBytes([u8(disc), ...payload]);
}
