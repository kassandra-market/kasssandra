/**
 * Low-level little-endian byte helpers, shared by every instruction/PDA builder
 * in this SDK.
 *
 * `@solana/web3.js` (the `Address`-class variant this SDK targets) ships no
 * codec/number-encoding helpers, so these are hand-rolled — but defined ONCE
 * here and imported everywhere, rather than re-copied per module. Each returns a
 * fresh `Uint8Array`; the encodings mirror the `*_at` / `to_le_bytes` reads in
 * the Rust processors and the borsh layouts of the external programs the SDK
 * CPIs into.
 */

/** A single unsigned byte (`u8`). */
export function u8(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

/** A little-endian `u16` (2 bytes). */
export function u16LE(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

/** A little-endian signed `i16` (2 bytes). */
export function i16LE(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setInt16(0, value, true);
  return out;
}

/** A little-endian `u32` (4 bytes). */
export function u32LE(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

/** A little-endian `u64` (8 bytes) from a bigint/number. */
export function u64LE(value: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

/** A little-endian signed `i64` (8 bytes) from a bigint/number. */
export function i64LE(value: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, BigInt(value), true);
  return out;
}

/** A little-endian `u128` (16 bytes) from a bigint/number. */
export function u128LE(value: bigint | number): Uint8Array {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  const x = BigInt(value);
  dv.setBigUint64(0, x & 0xffffffffffffffffn, true);
  dv.setBigUint64(8, x >> 64n, true);
  return out;
}

/** Concatenate byte chunks into one buffer. */
export function concatBytes(parts: Array<Uint8Array>): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
