---
id: mem-markets-rust-v2-island
title: "sdks/markets/rust is a solana-sdk v2 island"
tags: [memory, gotcha, rust, deps]
updated: 2026-07-10
---

# `kassandra-markets-sdk` (sdks/markets/rust) is a solana-sdk **v2 island**

The rest of the workspace uses the **granular v3** solana client crates
(`solana-pubkey = "3"`, `solana-instruction = "3"`, …). `kassandra-markets-sdk`
deliberately pins the **meta crate `solana-sdk = "2"`** + `spl-token = "6"`
**directly** (not via the workspace), because it was merged in from the
kassandra-market repo and its market dev-tests / builders live on v2.

- Both majors coexist in the lockfile without a cross-crate type split because the
  island doesn't share solana types with the v3 crates.
- The market **program's** own dev-tests are on the same v2/litesvm-0.6 island.
- `kassandra-markets-sdk` is **standalone** — no internal `kassandra-*` deps — so
  it publishes alone.

**Do not "unify" it onto the workspace v3 stack.** That would break the island and
create a pubkey-major clash (spl-token 9's pubkey v3 vs the v2 world).
