---
id: context-app
title: The dApp (app/)
tags: [context, app, react, vite]
updated: 2026-07-10
---

# The dApp (`app/`)

Vite + React + Tailwind ("Auros" theme), Solana wallet-adapter, consuming the two
TS SDKs' `dist/`. Package name is `app` (private). Reads chain directly + the
indexer's read API; writes via the SDK instruction builders.

## Stack notes

- **`@solana/web3.js@3.0.0-rc.2`** — the class-`Address` build (`new Address()`,
  `.toBytes()`, `Address.findProgramAddress` — async only, no sync). It exports
  **no codec helpers**; `@solana/kit`/`bs58`/`Buffer` are NOT app deps except
  `bs58` (added for base58). ([`../memories/web3js-address-variant.md`](../memories/web3js-address-variant.md))
- tsconfig: `tsc -b` (project refs; `src` + `vite.config.ts` only — **`app/e2e`
  and `app/test` are NOT typechecked by CI**), `noUnusedLocals`,
  `verbatimModuleSyntax`, `erasableSyntaxOnly` (no enums), `moduleResolution: bundler`.
- Relative imports **omit** extensions (unlike the SDKs).
- Lint: **oxlint** (`pnpm --filter ./app lint`). One pre-existing
  `standardWallet.tsx` react-refresh warning is expected.

## Layout

- `app/src/pages` — routes (OracleDetail, CreateOracle, Markets, MarketDetail…).
- `app/src/components/{oracles,markets}` — feature components + `actions/` (the write forms).
- `app/src/data` — oracle-side data/actions; `app/src/market/` — market-side data/hooks/lib.
- `app/src/lib` — shared utils (base58, base64, oracleView formatters, cluster).
- `app/test` — vitest unit + litesvm e2e tests (run in CI).
- `app/e2e` — Playwright browser specs + `seed*.ts` helpers + `dev-full.ts` (`make dev` entry). NOT run in the default unit lane.

## Amount display rule

Token amounts are shown **scaled by decimals** (KASS 9, USDC 6). Use
`formatKass`/`formatUsdc`/`formatUnits` (oracleView) and the market-side
`formatKass`; input forms parse scaled amounts (`parseKassAmount`/`parseAmount`).
The AMM carries `baseDecimals`/`quoteDecimals` — use them.
([`../memories/scaled-amounts-ui.md`](../memories/scaled-amounts-ui.md))

## Prediction-market UI specifics

- Trade panel: **buy** gates on KASS balance, **sell** gates on the held outcome
  **shares** (the gate message names the asset — don't hardcode "KASS").
- The price chart draws **one line curve per share** (YES + complementary NO =
  1−YES) with the axis pinned 0–100% (`autoscaleInfoProvider` returns a fixed
  `0..1`). It uses lightweight-charts v5 (`addSeries(LineSeries, …)`).

## Verifying app changes

`pnpm --filter ./app typecheck && pnpm --filter ./app lint && pnpm --filter ./app exec vitest run && pnpm --filter ./app build`
(current suite: **215 unit tests**). The e2e/dev files need a temp tsconfig that
includes `e2e`+`test` to typecheck (see [`../skills/running-and-verifying.md`](../skills/running-and-verifying.md)).
