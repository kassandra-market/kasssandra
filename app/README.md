# Kassandra UI

The web UI for **Kassandra** — prediction markets on Solana, resolved by MagicBlock GPT.
Vite + React 19 + TypeScript + Tailwind v4 SPA, styled in the **Auros** visual language
("abyssal terminal with bioluminescent data orbs" — see `docs/design/auros-style-guide.md`).

The app consumes **`@kassandra-market/markets` only**. `Market.oracle` is a markets-owned
GPT Subject PDA.

## Run / build

> **Build the SDK first.** The app links `@kassandra-market/markets` via the pnpm workspace and
> resolves its types from `sdks/markets/ts/dist/` (gitignored). On a fresh clone, run
> `pnpm --filter @kassandra-market/markets build` (or `pnpm -r build`) **before** the app's
> typecheck/build.

```bash
pnpm --filter @kassandra-market/markets build   # types → sdks/markets/ts/dist
pnpm --filter app dev        # dev server (HMR)
pnpm --filter app typecheck  # tsc -b
pnpm --filter app lint       # oxlint
pnpm --filter app build      # tsc -b && vite build && verify-css guard
pnpm --filter app preview    # serve the production build
```

`build` runs `scripts/verify-css.mjs` after `vite build`. Fonts are bundled locally via
`@fontsource`. The build is route-code-split + vendor-chunked (`solana`, `sdk` =
`@kassandra-market/markets`, `react-vendor`).

## Routes

- `/` — landing (`src/pages/Landing.tsx`).
- `/markets` — browse list (`src/pages/Markets.tsx`): funding / active / resolved / closed.
- `/markets/new` — create a market (`createSubject` then `createMarket`).
- `/markets/:pubkey` — market detail (trade / liquidity / manage / details). No `/oracles/` links.
- `/oracles`, `/oracles/*`, `/admin` — redirect to `/markets`.
- `/styleguide` — Auros primitives.

### RPC / cluster config

Market reads and writes go through the indexer (`/api/*`). The NavBar cluster selector
(`localnet` / `devnet` / `mainnet-beta`) still drives wallet RPC. Localnet resolves to
`VITE_RPC_URL` (default `http://127.0.0.1:8899`).

**Point at a seeded surfpool:** `make chain` / `make dev` seeds markets (fabricated Subject
PDAs owned by the market program) and writes `e2e/.wallet.json`. Then
`VITE_RPC_URL=http://127.0.0.1:8899 VITE_E2E=1 pnpm --filter app dev`.

### Write flows

Every action wraps a pure `build*Ixs` layer under `src/market/data/actions/` and sends via
wallet-adapter. Create market: unique nonce, dummy `llmContext` (fresh Keypair pubkey),
binary `optionsCount=2`; categorical = one Subject then N markets.

### Offline preview (mock mode)

Set **`VITE_MOCK=1`** or append **`?mock`** (DEV only). Fixtures live in
`src/market/data/mockMarkets/`. Under `?mock`, `&wallet=connected` +
`&tx=success|error|reject|failconfirm|slow` script write-form states
(`src/lib/mockWrite.ts`).

## The design system

Tokens live in `src/index.css` (`@theme`). Primitives in `src/components/ui/`. Market cards
and write forms in `src/components/markets/`. Landing sections in `src/components/landing/`.
