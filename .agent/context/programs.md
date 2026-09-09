---
id: context-programs
title: On-chain programs
tags: [context, programs, solana, pinocchio]
updated: 2026-09-09
---

# On-chain programs

One Solana program, **pinocchio** (no Anchor), with **bytemuck-`Pod`** account
layouts (zero-copy, fixed byte offsets), a single-byte instruction discriminant
(plus an 8-byte GPT callback intercept), and `overflow-checks = true` on release.

| Crate | Dir | Artifact | Role |
|---|---|---|---|
| `kassandra-markets-program` | `programs/markets` | `target/deploy/kassandra_markets_program.so` | Prediction markets + GPT Subject |

- Build with `cargo build-sbf` (via `just build`).
- MagicBlock ER CPIs are hand-rolled in `cpi/magicblock.rs`; solana-gpt-oracle
  CPIs in `cpi/gpt_oracle.rs` (do not depend on Anchor / `ephemeral-rollups-sdk`).
  The GPT ELF used in tests is a **test-identity rebuild** (see
  [`../memories/solana-gpt-oracle.md`](../memories/solana-gpt-oracle.md)), not a
  mainnet dump.
- Program ID `FEGNHWAB7kc7VC9CCwbvVPsv4Jykz2r2WQ758V4xCT9S` is independent of the
  crate name.

## Market program

- Instructions: `Ix` in `programs/markets/src/instruction.rs` (0–16): InitConfig,
  UpdateConfig, CreateMarket, Contribute, Cancel, Refund, Activate, ClaimLp,
  ResolveMarket, CollectFee, CloseMarket, AddLiquidity, DelegateMarket,
  CommitMarket, UndelegateMarket, **CreateSubject (15)**, **RequestAi (16)**.
- GPT callback (`sha256("global:callback_from_gpt_oracle")[..8]`) is intercepted
  in `lib.rs` **before** 1-byte dispatch and writes `Subject.resolved_option`.
- `Subject` (88 B, tag 5) is the resolution source. `Market.oracle` stores that
  pubkey so MetaDAO `question_id` wiring is unchanged.
- A market funds in SOL, then **composes** a MetaDAO question / conditional vault
  / AMM and **activates** into a live cYES/cNO pool; resolution pays winners.
- Full detail: [`../specs/market-program.md`](../specs/market-program.md).

## Gotchas

- **Rebuild the `.so` before running Rust tests** — LiteSVM `include_bytes!`s it.
  ([`../memories/rebuild-so-before-tests.md`](../memories/rebuild-so-before-tests.md))
- Prefer **`cargo test --workspace`**.
  ([`../memories/cargo-test-workspace-only.md`](../memories/cargo-test-workspace-only.md))
