# Kassandra

**Solana prediction markets resolved by MagicBlock GPT oracle.**

A question is a markets-owned **Subject** PDA. MagicBlock's GPT oracle stamps
`resolved_option`; binary sub-markets (`Market.oracle` = that Subject) trade
cYES/cNO until `ResolveMarket`. Honesty is enforced economically (SOL liquidity
and fees) and by markets.

> **Full documentation** lives in [`docs-site/`](./docs-site). See
> [`docs/plans/`](./docs/plans) for historical design documents (append-only).

## How a market resolves

1. **CreateSubject** — nonce, option count, GPT `llm_context`.
2. **CreateMarket** — one binary sub-market per outcome, seeded in SOL.
3. **Fund → compose MetaDAO → Activate** — live cYES/cNO AMM.
4. **RequestAi** — CPI into solana-gpt-oracle; `llm_oracle` callbacks.
5. **ResolveMarket** — winning outcome from the Subject.

## One product, one repo

This monorepo hosts the **prediction-market** program and the surface around it.
The in-house Kassandra oracles (dispute) program was removed; markets talk to
GPT directly. Program ID `FEGNHWAB7kc7VC9CCwbvVPsv4Jykz2r2WQ758V4xCT9S`.

## Monorepo layout

| Path | What it is |
| --- | --- |
| [`programs/markets/`](./programs/markets) | The **prediction-market** program — Pinocchio, GPT Subject, MetaDAO v0.4 vault + AMM. |
| [`sdks/markets/ts/`](./sdks/markets/ts) | Hand-written TypeScript client (`@kassandra-market/markets`). |
| [`sdks/markets/rust/`](./sdks/markets/rust) | Rust SDK (`kassandra-markets-sdk`, solana-sdk v2 island). |
| [`indexer/`](./indexer) | Carbon indexer of market accounts → Postgres + axum `/api/*`. |
| [`app/`](./app) | Vite + React dApp (`/markets`). |
| [`docs-site/`](./docs-site) | Mintlify documentation site. |
| [`docs/`](./docs) | Historical design documents (`docs/plans/` is append-only). |
| [`scripts/`](./scripts) | Helper scripts — GPT oracle vendor, MetaDAO fixtures, e2e. |

MetaDAO's deployed **conditional-vault + AMM** programs are reused via CPI.

## Getting started

### Prerequisites

- **Rust** (stable — see [`rust-toolchain.toml`](./rust-toolchain.toml)) with the
  Solana toolchain (`cargo build-sbf`, from the Solana CLI / Agave).
- **Node.js** and **pnpm** (the `sdk`, `sdks/markets/ts`, `app`, and `docs-site` form a pnpm workspace).
- [`just`](https://github.com/casey/just) for the program build/test recipes.
- For the e2e / dev-stack targets: [`surfpool`](https://surfpool.run) and Postgres
  (`initdb`/`pg_ctl`).

### One entrypoint: `make`

Every useful task is a `make` target — `make help` lists them all. It delegates to
`cargo`, `just`, `pnpm`, and the `scripts/*.sh`, so there's a single surface:

```bash
make setup       # install JS deps + build both programs (.so) and both SDKs (first run)
make build       # build everything (both programs, both sdks, app, runner, indexer)
make test        # all unit tests (rust workspace + both sdks + app + indexer)
make lint        # oxlint (app) + clippy (rust)
make typecheck   # both sdks + app tsc
make dev         # boot a seeded local surfpool chain (both programs) AND the app dev server

make test-e2e            # browser E2E (surfpool + funded wallet + app)
make test-e2e-fork       # mainnet-forked challenge-market E2E
make test-e2e-indexer    # surfpool + Postgres + indexer + ActivityFeed E2E
make ci                  # exactly what CI runs
```

`make dev` boots surfpool, deploys **both** programs (+ the MetaDAO v0.4 fixtures the
market CPIs), seeds a spread of oracles across phases **and** demo prediction markets,
starts the single Postgres-backed indexer over both, and serves the app — then holds
the chain alive so you can browse `/oracles` and `/markets`. Ctrl-C tears it down.

### Build & test the program

```bash
just build            # cargo build-sbf for the markets program → target/deploy/*.so
just test             # rebuilds the .so first, then runs LiteSVM tests
```

The tests are **LiteSVM** unit + invariant + CPI-integration tests. `just test` depends on
`just build` so you never test a stale `.so`.

### Build the SDK and run the dApp

```bash
pnpm install
pnpm --filter @kassandra-market/markets build
pnpm --filter ./app dev           # serve the frontend locally
```

See each package's README for details:
[program](./programs/markets/README.md) ·
[sdk](./sdks/markets/ts/README.md) ·
[app](./app/README.md) ·
[docs-site](./docs-site/README.md) ·
[scripts](./scripts/README.md).

## Architecture notes

- **Pinocchio, not Anchor.** Manual account deserialization/validation and manual
  instruction dispatch (no macros/IDL). CPI into MetaDAO's Anchor programs and
  MagicBlock GPT oracle is constructed by hand.
- **On-chain:** market config, Subject resolution, SOL funding/LP, MetaDAO vault+AMM.
- **Off-chain:** MagicBlock `llm_oracle` inference. The GPT callback writes
  `Subject.resolved_option`.
- **Trust model:** economic + market-based (SOL liquidity/fees; MetaDAO cYES/cNO AMM).

## Tokens

- **SOL** (wrapped, 9 decimals) — market funding/LP and protocol fees.
- Conditional cYES/cNO via MetaDAO vault (inherit vault decimals).

## Status

Kassandra is under active development. The markets program, SDK, and dApp are
covered by LiteSVM and end-to-end (surfpool) tests. See `docs/plans/` for
historical design notes (append-only).
