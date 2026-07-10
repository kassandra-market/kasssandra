---
id: context-programs
title: On-chain programs
tags: [context, programs, solana, pinocchio]
updated: 2026-07-10
---

# On-chain programs

Two Solana programs, both **pinocchio** (no Anchor), with **bytemuck-`Pod`**
account layouts (zero-copy, fixed byte offsets), a single-byte instruction
discriminant, and `overflow-checks = true` on release.

| Crate | Dir | Artifact | Role |
|---|---|---|---|
| `kassandra-oracles-program` | `programs/oracles` | `target/deploy/kassandra_oracles_program.so` | Oracle / dispute core |
| `kassandra-markets-program` | `programs/markets` | `target/deploy/kassandra_markets_program.so` | Prediction / decision markets |

- Build with `cargo build-sbf` (via `just build` / `just build-oracle` / `just build-market`).
- The oracle program CPIs into external **MetaDAO** programs (conditional vault,
  AMM v0.4, futarchy v0.6) — those `.so` fixtures live under
  `programs/oracles/tests/fixtures/` for LiteSVM and are excluded from the
  published crate (`exclude = ["tests/"]`).
- Program IDs are declared in-crate and are **independent of the crate name** —
  the oracles/markets rename did not change deployed addresses.

## Oracle program

- Instructions: `Ix` enum in `programs/oracles/src/instruction.rs` (discriminants 0–23).
- Accounts (`AccountType` tag @ byte 0): `Oracle`, `Proposer`, `Fact`, `FactVote`,
  `AiClaim`, `Market`, `Protocol`, `OracleMeta`. Layouts in `programs/oracles/src/state.rs`.
- Phase machine (`Phase`): Created → Proposal → FactProposal → FactVoting →
  AiClaim → Challenge → FinalRecompute → Resolved (or InvalidDeadend).
- Oracle subject + option labels live on-chain in a companion **`oracle_meta`**
  PDA (`WriteOracleMeta`, Ix 23); extended JSON is off-chain bound by `uri_hash`.
- Full detail: [`../specs/oracle-program.md`](../specs/oracle-program.md).

## Market program

- Instructions: `Ix` in `programs/markets/src/instruction.rs` (0–10): InitConfig,
  UpdateConfig, CreateMarket, Contribute, Cancel, Refund, Activate, ClaimLp,
  ResolveMarket, CollectFee, CloseMarket.
- A market funds in KASS, then **composes** a MetaDAO question / conditional vault
  / AMM and **activates** into a live cYES/cNO pool; resolution pays winners.
- Full detail: [`../specs/market-program.md`](../specs/market-program.md).

## Source layout (post large-file split)

Big source files are split into folder modules (`foo/mod.rs` + submodules) that
re-export the prior public surface — e.g. `state/`, `cpi/metadao/`,
`cpi/metadao_v06/`, `processor/{claims,settle_challenge,open_challenge}/`.
Integration tests keep `include_bytes!` `.so` consts at each test's root file with
`#[path]` submodules. See [`../skills/splitting-large-files.md`](../skills/splitting-large-files.md).

## Gotchas

- **Rebuild the `.so` before running Rust tests** — LiteSVM `include_bytes!`s it.
  ([`../memories/rebuild-so-before-tests.md`](../memories/rebuild-so-before-tests.md))
- **`cargo test -p kassandra-oracles-program` fails** in isolation (Pod
  feature-unification) — use `cargo test --workspace`.
  ([`../memories/cargo-test-workspace-only.md`](../memories/cargo-test-workspace-only.md))
