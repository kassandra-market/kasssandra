# Kassandra Rust SDK — Design + Execution

**Date:** 2026-07-03
**Status:** Implemented (branch `feature/rust-sdk`)

## Goal

Add a **Rust client SDK** for the Kassandra dispute-core program, and **minimize the
footprint of hand-rolled instruction/PDA construction in the tests and the app**. The Rust
program tests and the runner previously hand-built account metas + payload bytes; the TS
app had some UI components reaching into the SDK at runtime.

## Approach (chosen)

A **separate workspace crate**, `kassandra-sdk` (`sdk-rs/`), rather than a feature-gated
module inside the on-chain program. Rationale:

- Clean separation — no `solana-instruction` / `solana-pubkey` client deps leak into the
  on-chain (Pinocchio) crate's Cargo graph.
- Single source of truth — it depends on `kassandra-program` (with `no-entrypoint`) for the
  canonical `Ix` discriminants, config seeds/constants, and account layout structs, so the
  wire contract is never re-declared.
- Mirrors the existing hand-written TypeScript SDK (`sdk/`).

Type compatibility: the SDK returns `solana_instruction::Instruction` / `solana_pubkey::Pubkey`.
In solana v2 these are the exact types `solana-sdk` re-exports, so the LiteSVM test harness
(which uses `solana-sdk`) consumes SDK-built instructions with no conversion.

## SDK surface (`sdk-rs/src/`)

- `pda` — all program PDA derivations (`oracle`, `protocol`, `mint_authority`, `stake_vault`,
  `challenge_usdc_vault`, `proposer`, `fact`, `vote`, `ai_claim`, `kass_ata`). Seeds are the
  program contract.
- `ix` — a builder per `Ix` variant (0..=22) returning `Instruction`. The 25-account
  `open_challenge` and 21-account `settle_challenge` take `OpenChallengeAccounts` /
  `SettleChallengeAccounts` structs (the MetaDAO slots are composed by the caller).
  `submit_ai_claim` has a `submit_ai_claim_raw` variant taking a pre-computed 97-byte payload
  (for the runner, which passes the exact bytes it emitted as metadata).
- `accounts` — re-exports the shared on-chain structs + sentinels, plus decoders:
  `decode` (zero-copy, aligned) and `read` (owned copy, unaligned-safe — for RPC buffers).
- `ConfigParams` — the 176-byte `set_config` payload, packed in wire order.
- Constants: `PROGRAM_ID`, `TOKEN_PROGRAM_ID`, `SYSTEM_PROGRAM_ID`, `ATA_PROGRAM_ID`.

Wire specs were extracted authoritatively from the processors (see
`processor/*.rs`) and cross-checked against the existing test builders; notable pins:
`set_config` = 176 bytes (not the stale "144"), `create_oracle` payload field order differs
from the account order, and 9 oracle-PDA-signing instructions must thread `oracle_nonce`.

## Footprint reduction

- **Tests** (`programs/kassandra/tests/common/mod.rs`, was 2,376 lines): all 8 PDA helpers,
  16 instruction builders, and `ConfigParams` now delegate to `kassandra-sdk`. Harness
  method signatures are unchanged, so the 35 test files are untouched. Full suite green.
- **Runner**: the SDK is now the runner's **only** interface to the on-chain program.
  - `submit.rs`: `program_id`, the `ai_claim` / `proposer` PDA derivations, and the
    `submit_ai_claim` instruction (via `submit_ai_claim_raw`) delegate to the SDK; local
    seed/system-id/discriminant/account-meta boilerplate removed.
  - `rpc.rs`: account types (`Oracle`/`Fact`/`AccountType`), the program-ownership check
    (`kassandra_sdk::PROGRAM_ID`), and account decoding (`kassandra_sdk::accounts::read`,
    an unaligned/owned decoder added for RPC buffers) all go through the SDK.
  - `constants.rs` / `cli.rs`: the `AiClaim` layout pin and `CLAIM_OPTION_NONE` come from
    `kassandra_sdk::accounts`.
  - `runner/Cargo.toml` **no longer depends on `kassandra-program` directly** — it is pulled
    in transitively (with `no-entrypoint`) through the SDK. Runner + SDK tests green.
- **App** (TypeScript — cannot consume a Rust SDK): the app already routes writes through a
  `data/actions/*` layer, and the vast majority of component SDK imports are *type-only*
  (decoded-account shapes — legitimate). The two components that reached into the SDK at
  runtime were consolidated: `SweepControl` now calls a new `resolveDaoAuthority(conn)` data
  helper; `SubmitAiClaimForm` relies on `buildSubmitAiClaimIxs` deriving the proposer PDA.
  Components now import only types from the SDK. Typecheck + 160 unit tests + lint green.

## Verification

- `cargo test -p kassandra-program` — all test binaries pass, zero failures, zero warnings.
- `cargo test -p kassandra-runner` — 106 tests pass.
- `cargo test -p kassandra-sdk` — 9 wire-format regression tests (discriminants, payload
  lengths/field order, account counts incl. 25/21 for the mega-instructions, PDA seeds).
- App: `typecheck`, `test` (160), `lint` all green.

## Out of scope / deferred

- Migrating the inline `open_challenge` / `settle_challenge` builders in the challenge tests
  (e.g. `challenge_e2e.rs`) to the SDK. Those are high-account-count and built inline across
  many test files; the SDK provides spec-correct struct-based builders for them (unit-tested
  for shape), but the tests still build them inline to avoid a large, risky churn. The other
  scattered simple builders (submit_fact/vote_fact/submit_ai_claim/advance_phase/
  finalize_ai_claims) exist in the SDK and are available for future migration.
- No on-chain program behavior changed; the `.so` is byte-identical.
