---
id: mem-program-sdk-naming
title: "Naming: programs, crates, packages, artifacts"
tags: [memory, naming, crates, packages]
updated: 2026-07-10
---

# Naming map (post-rename)

| Thing | Oracle side | Market side |
|---|---|---|
| Program dir | `programs/oracles` | `programs/markets` |
| Program crate | `kassandra-oracles-program` | `kassandra-markets-program` |
| `.so` artifact | `kassandra_oracles_program.so` | `kassandra_markets_program.so` |
| Rust SDK crate | `kassandra-oracles-sdk` (lib `kassandra_oracles_sdk`) | `kassandra-markets-sdk` (lib `kassandra_markets_sdk`) |
| npm package | `@kassandra-market/oracles` | `@kassandra-market/markets` |

## Facts

- The programs were renamed from the legacy `kassandra` / `kassandra-market`
  names. **Program IDs (deployed addresses) did NOT change** — only crate/artifact
  names.
- The **npm scope is `@kassandra-market/`** (unchanged, deliberately) — do not
  confuse it with the crate names when doing repo-wide renames. A blind
  `kassandra-market` replace would corrupt the npm scope; the rename patterns must
  be specific (`kassandra-market-program`, `programs/kassandra-market`,
  `kassandra_market_program`).
- The GitHub repo is `kassandra-market/kasssandra` (note the triple-s typo in the
  repo name).
