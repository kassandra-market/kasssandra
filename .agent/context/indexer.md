---
id: context-indexer
title: The indexer (indexer/)
tags: [context, indexer, postgres, carbon]
updated: 2026-09-09
---

# The indexer (`indexer/`)

`kassandra-indexer` — one binary running **one Carbon pipeline** into **one
Postgres** + one **axum** read API. Postgres-native (threaded `tokio-postgres`
`Client`). Indexes **only** the kassandra-markets program.

## One pipeline, one service

GPA snapshot + optional `programSubscribe` of `MARKET_PROGRAM_ID` into
`market_accounts`, plus a per-pool websocket price subscriber (`accountSubscribe`)
that records candle points. A short getProgramAccounts reconcile keeps accounts
fresh (and is the only path that prunes accounts closed on-chain). Also indexes
per-market `ErSession` (tag 4). Ctrl-C shuts the process down.

`Market.oracle` is a markets-owned **Subject** PDA (88 bytes). Detail enrichment
(`decode_oracle` in `market/api.rs`) reads `options_count` @ 2, `status`/`phase`
@ 3, `resolved_option` @ 4. JSON field names stay `oracle`, `optionsCount`,
`phase`, `resolvedOption`.

There is **no** oracle tx-crawler, events log, `oracle_accounts`, oracle
metadata, `/oracles/*`, or `/events`. The `/rpc` JSON-RPC gateway remains
(allowlisted methods + token bucket) so production gateway-mode Connections
never hold a Solana RPC URL.

## Dependency stance

Depends on `kassandra-markets-program` (zero-copy state layouts + `ID` — no
re-declaring the wire contract). Pinocchio/bytemuck-based decode, pulls **no
solana-sdk** → stays on the granular v3 client stack. `publish = false`. Does
**not** depend on `kassandra-oracles-sdk`.

## Config (env)

`RPC_URL`, `DATABASE_URL`, `PORT`, `SOLANA_WS_URL` (price subscriber — surfpool
RPC port + 1), `INDEXER_RECONCILE_MS`, `MARKET_PROGRAM_ID`.

## Read API (used by the app)

`GET /health`; Market: `GET /api/markets/{pubkey}/candles?interval=&limit=` →
OHLC of implied YES probability (0..1); `/api/config`; `/api/markets`; account
reads; tx gateway under `/api/transaction`.

## Structure

`db/` (thin `connect()` only — no oracle SCHEMA), `main.rs` (thin entry +
extracted `config`/`reconcile`), `market/` (`db.rs::create_schema` owns the
market tables).

## Testing

- Real-Postgres integration tests (self-skip without `TEST_DATABASE_URL`; a CI
  job spins an ephemeral PG and runs `cargo test -p kassandra-indexer`).
  Candle/e2e flows run under Playwright with an ephemeral Postgres
  (`app/e2e/indexer/pg.ts`).
- `bs58` for pubkey encode.
