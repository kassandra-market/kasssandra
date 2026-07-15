---
id: mem-external-crates-over-handrolled
title: "Use bs58/hex crates; no thin wrappers"
tags: [memory, convention, rust, typescript]
updated: 2026-07-10
---

# Prefer real crates over hand-rolled codecs; no thin wrappers

- **Rust**: base58 → `bs58`, hashing → `sha2`, hex → `hex`, base64 → `base64`.
  These are workspace deps; do NOT hand-roll them (no `{b:02x}` loops, no manual
  base58 alphabet). `hex::encode`/`hex::decode` directly at call sites.
- **TS (app)**: base58 → `bs58` directly (`bs58.encode`/`bs58.decode`). The app's
  web3.js has no codecs and no `Buffer`
  ([web3js-address-variant.md](web3js-address-variant.md)).
- **Don't leave thin 1:1 wrappers** around a lib call (e.g. a `to_hex(b)` that just
  calls `hex::encode(b)`, or a `base58Encode` that just calls `bs58.encode`). Inline
  the library at call sites. A helper that *composes* multiple ops (e.g.
  `sha256_hex = hex::encode(Sha256::digest(x))`) is fine — that's not a thin wrapper.

## What genuinely can't use a lib here

- The TS SDK LE-integer/`concat` byte helpers (`bytes.ts`) have no fitting library
  given the class-`Address` web3.js — they're hand-rolled once per package and
  imported, not re-copied.
- `@solana/spl-token` does **not** fit: it peer-requires `@solana/web3.js@^1.95.5`
  (classic `PublicKey`), incompatible with this repo's web3.js 3.0 `Address`. The
  ATA builders are intentionally hand-rolled (see the app/SDK `flows`).
