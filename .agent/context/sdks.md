---
id: context-sdks
title: Client SDKs
tags: [context, sdk]
updated: 2026-09-09
---

# Client SDKs

One pair (Rust + TypeScript) wrapping the **markets** program. Hand-written
instruction builders, PDA helpers, account decoders — no IDL. The program crate
is the wire-contract source of truth.

| Package | Lang | Notes |
|---|---|---|
| `kassandra-markets-sdk` (`sdks/markets/rust`) | Rust | solana-sdk **v2 island** |
| `@kassandra-market/markets` (`sdks/markets/ts`) | TS | `@solana/web3.js@3.0.0-rc.2`, `@solana/kit` (interop/tests only) |

GPT helpers: `pda.subject`, `pda.gptOracleIdentity/Interaction/Counter/Context`,
`createSubject`, `requestAi`. Subject decoder: `decodeMarketOracle` in
`accounts/oracle.ts` (88-byte Subject; `Phase` aliases keep older call sites).

The Kassandra oracles SDK (`@kassandra-market/oracles` / `kassandra-oracles-sdk`)
was removed.
