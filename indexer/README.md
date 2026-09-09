# Kassandra indexer

A Solana indexing backend for the **kassandra-markets** program, built on the
[**Carbon**](https://github.com/sevenlabs-hq/carbon) framework. It indexes
program accounts into Postgres and serves a JSON read + tx-gateway API.

## How it works

- The datasource is Carbon's `GpaDatasource` (startup snapshot) plus an optional
  `RpcProgramSubscribe` live tail of `MARKET_PROGRAM_ID`. Decoded accounts land
  in `market_accounts`, slot-gated so an older event never clobbers a newer one.
- A periodic getProgramAccounts reconcile keeps the table fresh and is the only
  path that **prunes** accounts closed on-chain (the subscribe tail cannot see a
  close). Set `INDEXER_RECONCILE_MS` > 0 to use polling as the freshness path
  (e.g. surfpool, which has no working `programSubscribe`).
- A websocket `accountSubscribe` on each Active market's cYES/cNO pool records
  the `market_price` candle series (implied YES probability, 0..1).
- Ctrl-C shuts the process down. The Carbon pipeline is non-fatal: if it exits,
  reconcile keeps `market_accounts` correct.

## API

| Route | Description |
|---|---|
| `GET /health` | liveness |
| `GET /api/config` | governed singleton Config |
| `GET /api/markets` | every indexed Market |
| `GET /api/markets/{pubkey}` | market detail (contributions, Subject enrichment, AMM reserves) |
| `GET /api/markets/{pubkey}/candles?interval=&limit=` | OHLC candles of implied YES probability |
| `GET /api/account/{pubkey}` | on-demand account read |
| `GET /api/blockhash` · `POST /api/transaction` · `GET /api/transaction/{sig}` | tx gateway |

`Market.oracle` is a markets-owned **Subject** PDA (88 bytes). Detail enrichment
reads `options_count` @ 2, `status`/`phase` @ 3, `resolved_option` @ 4. JSON
field names stay `oracle`, `optionsCount`, `phase`, `resolvedOption`.

## Configuration (env)

| Var | Required | Default | Notes |
|---|---|---|---|
| `RPC_URL` | ✅ | — | Solana RPC (mainnet/devnet or custom) |
| `DATABASE_URL` | ✅ | — | Postgres connection string |
| `PORT` | | `3000` | API port (Render sets this) |
| `SOLANA_WS_URL` | | derived | Price subscriber; else `http`→`ws`, RPC port+1 |
| `INDEXER_RECONCILE_MS` | | `0` | >0 → polling freshness path (no ws tail) |
| `MARKET_PROGRAM_ID` | | program crate `ID` | Override the on-chain program id |
| `RUST_LOG` | | `info` | |

## Run locally

```bash
# Postgres (any) + a Solana RPC:
export DATABASE_URL=postgres://localhost/kassandra_indexer
export RPC_URL=https://api.devnet.solana.com
cargo run --release -p kassandra-indexer
# then:
curl localhost:3000/health
curl localhost:3000/api/markets
```

`cargo test -p kassandra-indexer` covers the account decoder, Subject offset
decode, ws-url derivation, and (when `TEST_DATABASE_URL` is set) the candle
Postgres integration tests.

## Deploy (Render)

Provisioned by the repo's `render.yaml`: a managed Postgres
(`kassandra-indexer-db`) + this service as a **PRIVATE service** (`type: pserv`,
`runtime: rust`, `rootDir: indexer`) — it has **no public URL**. Only the
`kassandra-app` web service reaches it, over Render's private network, and
reverse-proxies `/indexer/*` to it (`app/server.mjs`); the browser calls the
app's own origin, never the indexer directly. `DATABASE_URL` is injected from the
database; set `RPC_URL` in the dashboard after the first deploy; it binds a fixed
internal `PORT` (10000) that the app's proxy resolves via `fromService`. `/health`
is the health check.

(The read API's CORS layer is only exercised in local dev/e2e, where the app dev
server points straight at the indexer cross-origin — in production the same-origin
proxy makes CORS moot.)
