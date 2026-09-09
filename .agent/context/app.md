---
id: context-app
title: The dApp (app/)
tags: [context, app, react, vite]
updated: 2026-09-09
---

# The dApp (`app/`)

Vite + React + Tailwind ("Auros" theme), Solana wallet-adapter, consuming
**`@kassandra-market/markets` only**. Package name is `app` (private). Reads
chain via the indexer's `/api/*` surface; writes via the markets SDK
instruction builders. `Market.oracle` is a markets-owned GPT Subject PDA
(MagicBlock GPT settles the subject). There is no oracles-program UI.

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

- `app/src/pages` — routes: Landing, Markets, CreateMarket, MarketDetail, StyleGuide.
  `/oracles`, `/oracles/*`, and `/admin` redirect to `/markets`.
- `app/src/components/markets` — market cards + `actions/` (create / fund / trade / lifecycle).
- `app/src/market/` — market-side data/hooks/lib (indexer client, ix builders, view helpers).
- `app/src/lib` — shared utils (`mode.ts`, `heroFeed.ts`, cluster, formatters on the market side).
  Direct mode uses `VITE_MAGIC_ROUTER_URL` (when set) as the RPC for non-localnet
  clusters so MagicBlock ER txs route through Magic Router. Gateway mode still
  never ships RPC URLs.
- `app/test` — vitest unit tests (run in CI).
- `app/e2e` — Playwright browser specs + `seed*.ts` helpers + `dev-full.ts` (`make dev` entry).
  Seed fabricates Subject accounts owned by `MARKET_PROGRAM_ID` (no oracles SDK, no runner).

## Amount display rule

Token amounts are shown **scaled by decimals** (SOL 9). Use the market-side
`formatSol`; input forms parse scaled amounts (`parseSolAmount`/`parseAmount`).
The AMM carries `baseDecimals`/`quoteDecimals` — use them.
([`../memories/scaled-amounts-ui.md`](../memories/scaled-amounts-ui.md))

## Prediction-market UI specifics

- Browse list is **markets only** (funding / active / resolved / closed).
- Create market: `createSubject` then `createMarket` (`oracle` = Subject PDA).
  Unique nonce; dummy `llmContext` = a fresh Keypair pubkey. Binary
  `optionsCount=2`. Categorical: one Subject then N markets.
- Trade panel: **buy** gates on SOL balance, **sell** gates on the held outcome
  **shares** (the gate message names the asset — don't hardcode "SOL").
- The price chart draws **one line curve per share** (YES + complementary NO =
  1−YES) with the axis pinned 0–100% (`autoscaleInfoProvider` returns a fixed
  `0..1`). It uses lightweight-charts v5 (`addSeries(LineSeries, …)`).
- ATA / `TOKEN_PROGRAM_ID` come from `@kassandra-market/markets` (`pda.associatedTokenAccount`).

## Verifying app changes

`pnpm --filter ./app typecheck && pnpm --filter ./app lint && pnpm --filter ./app exec vitest run && pnpm --filter ./app build`

The e2e/dev files need a temp tsconfig that includes `e2e`+`test` to typecheck
(see [`../skills/running-and-verifying.md`](../skills/running-and-verifying.md)).
