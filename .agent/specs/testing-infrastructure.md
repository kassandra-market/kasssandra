---
id: spec-testing-infrastructure
title: Testing infrastructure
tags: [spec, testing, litesvm, surfpool, playwright, postgres]
updated: 2026-07-10
---

# Testing infrastructure

Four test surfaces, each with a specific harness.

## 1. LiteSVM (Rust + TS unit/integration)

- Rust program tests (`programs/*/tests/`) and SDK tests load the program `.so`
  via `include_bytes!` / `addProgramFromFile`. **Rebuild the `.so` first**
  (`just build`) or you test stale bytecode.
- LiteSVM `withSigverify(false)` is how you drive an instruction with a hardcoded
  signer you don't hold (surfpool has no sig-verify-bypass cheat).
- MetaDAO CPI fixtures: `programs/oracles/tests/fixtures/*.so`.
- Run Rust tests with **`cargo test --workspace`** (never `-p`).

## 2. surfpool (local simnet, TS e2e)

- `sdks/*/ts/test/surfpool/` and `app/e2e` fork/simnet suites boot surfpool with
  cheatcodes (`setAccount`, `airdrop`, program deploy, `timeTravel`).
- Gotchas ([`../memories/surfpool-gotchas.md`](../memories/surfpool-gotchas.md)):
  - `timeTravel` moves `getSlot`/`unix_timestamp` but NOT the execution
    `Clock.slot`; slot-based cranks (AMM TWAP) need `clock` block-production mode +
    fast slot-time.
  - No sig-verify-bypass cheat — use LiteSVM `withSigverify(false)` instead.
  - The price subscriber uses surfpool's websocket at **RPC port + 1**.

## 3. Ephemeral Postgres (indexer)

- `app/e2e/indexer/pg.ts` / the indexer's db tests spin a throwaway Postgres
  (fresh OS-assigned port; `initdb`/`pg_ctl` or `PG_BIN`). Real-Postgres db tests
  self-skip without `TEST_DATABASE_URL`.

## 4. Playwright (browser e2e)

- `app/e2e/*.spec.ts` drive the real app UI against surfpool. Configs:
  `playwright.config.ts` (default), `playwright.indexer.config.ts`,
  `playwright.candles.config.ts`.
- The candle test asserts one interval toggle; flaky duplicates are handled by
  scoping to the `Candle interval` group + `toHaveCount(1)` before clicking.
- Amount inputs are **scaled** (type `5`, not `5000000000`).

## `make dev`

The full production-like local stack: surfpool + ephemeral Postgres + real
indexer + mock-Anthropic runner + the app (real wallet). `app/e2e/dev-full.ts`
orchestrates it and **narrates each seeding step** (fund wallet, create oracles,
deploy market program, create/activate markets, swaps). Ctrl-C tears everything
down.

## Current green baseline

Rust `cargo test --workspace` all pass; TS: oracles 136 (+1 skipped), markets 80,
app 215. Clippy: only the known pre-existing warning set — add no new warnings.
