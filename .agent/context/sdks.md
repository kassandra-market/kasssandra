---
id: context-sdks
title: Client SDKs
tags: [context, sdk, rust, typescript]
updated: 2026-07-10
---

# Client SDKs

Four SDKs under `sdks/{oracles,markets}/{rust,ts}`. Each is a **hand-written**
client: PDA derivations, instruction builders (byte-exact to the program's wire
contract), and account decoders. The programs are the single source of truth, so
there is no cross-crate drift.

| Package | Kind | Depends on |
|---|---|---|
| `kassandra-oracles-sdk` (`sdks/oracles/rust`) | Rust | `kassandra-oracles-program` (host lib, `no-entrypoint`), granular `solana-*` v3 |
| `@kassandra-market/oracles` (`sdks/oracles/ts`) | TS | `@solana/web3.js@3.0.0-rc.2`, `@solana/kit` (interop/tests only) |
| `kassandra-markets-sdk` (`sdks/markets/rust`) | Rust | **standalone — solana-sdk v2 island** (no internal deps) |
| `@kassandra-market/markets` (`sdks/markets/ts`) | TS | `@kassandra-market/oracles` (workspace), `@solana/kit`, web3.js |

## Rust SDKs

- `kassandra-oracles-sdk` pulls the on-chain program as a plain host library
  (`no-entrypoint`) so decoders return the canonical `Pod` structs and never
  re-declare the wire contract.
- `kassandra-markets-sdk` is a deliberate **solana-sdk v2 "island"** — it pins
  `solana-sdk = "2"` + `spl-token = "6"` directly, NOT via the workspace (which is
  on the granular v3 client stack). Both majors coexist. Don't "unify" it.
  ([`../memories/markets-rust-v2-island.md`](../memories/markets-rust-v2-island.md))
- Main modules: `pda`, `ix` (folder module split by instruction family),
  `accounts` (decoders), `metadao` (markets).

## TS SDKs

- Built with `tsc -p tsconfig.build.json` → `dist/` (the app imports the `dist`).
- Use explicit **`.js` extensions** in relative imports (NodeNext/bundler ESM).
  `.js` does NOT resolve to `dir/index.ts` under Bundler resolution, so when a file
  becomes a folder module, update direct importers to `.../foo/index.js`.
- `noUnusedLocals` + `verbatimModuleSyntax` are on — be precise with `import type`.
- The TS SDKs target the **class-`Address`** web3.js (no codecs) in their hot
  paths; `@solana/kit` (which has codecs) appears only in `litesvm-interop.ts` +
  tests. Numeric/LE byte helpers are hand-rolled in each package's `bytes.ts`.
  ([`../memories/web3js-address-variant.md`](../memories/web3js-address-variant.md))
- `@kassandra-market/markets` exports `flows.createAtaIdempotentInstruction` and
  the MetaDAO builders the app reuses (don't re-implement these in the app).

## Versioning

Every crate version is single-sourced from `[workspace.package].version`; the TS
`package.json`s are stamped by `scripts/sync-version.mjs`. See
[`../specs/versioning-and-publishing.md`](../specs/versioning-and-publishing.md).

## Byte-exactness discipline

Instruction builders and account-meta orders are asserted **byte-for-byte** by the
SDK test suites (parity / builders / account-metas). Any refactor of instruction
code must keep those tests green — that's the guard against wire drift.
