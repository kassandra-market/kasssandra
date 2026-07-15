---
id: context-indexer
title: The indexer (indexer/)
tags: [context, indexer, postgres, carbon]
updated: 2026-07-10
---

# The indexer (`indexer/`)

`kassandra-indexer` — one binary running **two Carbon pipelines** into **one
Postgres** + one **axum** read API. Postgres-native (JSONB, threaded
`tokio-postgres` `Client`).

## Two pipelines, one service

- **Oracle side** — crawls program **transactions** (instruction/event log) via
  the RPC transaction-crawler datasource; serves per-account activity history.
- **Market side** — indexes **accounts** (gpa snapshot + program-subscribe live
  tail) + a per-pool **websocket price subscriber** (`accountSubscribe`) that
  records candle points. A short getProgramAccounts reconcile keeps accounts fresh.

## Dependency stance

- Depends on `kassandra-oracles-sdk` (reuses the `Ix` enum + `PROGRAM_ID` +
  account decoders — no re-declaring the wire contract).
- Pinocchio/bytemuck-based decode, pulls **no solana-sdk** → stays on the granular
  v3 client stack. `publish = false`.

## Config (env)

`RPC_URL`, `DATABASE_URL`, `PORT`, `COMMITMENT`, `POLL_INTERVAL_MS`,
`PROMOTE_INTERVAL_MS`, `SOLANA_WS_URL` (price subscriber — surfpool RPC port + 1),
`INDEXER_RECONCILE_MS`, `MARKET_PROGRAM_ID`.

## Read API (used by the app)

- Oracle: per-account event history (the app's ActivityFeed).
- Market: `GET /api/markets/{pubkey}/candles?interval=&limit=` → OHLC of implied
  YES probability (0..1); `/status`; account reads. `POST` oracle-meta JSON.

## Structure (post-split)

`db/` (events/cursor/oracle_meta + integration tests), `main.rs` (thin entry +
extracted `config`/`reconcile`), `api.rs`, `processor.rs`, `decoder.rs`,
`meta_fetch.rs`, `market/`.

## Testing

- Real-Postgres integration tests (self-skip without `TEST_DATABASE_URL`; a CI job
  spins an ephemeral PG). Candle/e2e flows run under Playwright with an ephemeral
  Postgres (`app/e2e/indexer/pg.ts`).
- `sha256_hex` uses the `hex` crate; `bs58` for pubkey encode.
