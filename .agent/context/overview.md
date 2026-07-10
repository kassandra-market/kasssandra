---
id: context-overview
title: System overview
tags: [context, architecture]
updated: 2026-07-10
---

# System overview

Kassandra is an **optimistic oracle** on Solana with a dispute path backed by AI
and decision markets. Truth is enforced economically (KASS staking/slashing) and
by markets (the final arbiter). Interpretation is fixed at oracle creation, so
disputes are about *which evidence is real*, not *what it means*.

## Resolution flow (happy path is cheap)

1. **Create** — prompt + immutable interpretation + categorical options + deadline; pay a dynamic KASS creation fee (burned).
2. **Propose** — after the deadline, proposers submit a value + KASS bond. All agree → **Resolved** immediately (no AI, no markets).
3. **Dispute** (on conflict) — proposers lock in; a **fact proposal** window then a disjoint **fact voting** window freeze the agreed evidence set.
4. **AI claim** — the off-chain [runner](runner.md) applies the fixed interpretation to the agreed facts and stamps a categorical claim (opaque commitments on chain).
5. **Challenge market** — a MetaDAO-style decision market can override a faulty AI claim; TWAP over a window decides.
6. **Settle / finalize** — the oracle resolves (or hits an invalid dead-end); winners claim, losers are slashed.

See [`../specs/oracle-program.md`](../specs/oracle-program.md) for the phase
machine and per-instruction detail.

## Components & data flow

```
                 creates/proposes/challenges (writes)
   app (react) ───────────────────────────────────────────▶ oracle + market programs (on-chain)
      │  ▲                                                        │
      │  │ reads (chain + activity feed)                          │ tx logs / accounts
      │  │                                                        ▼
      │  └──────────────── indexer (Carbon → Postgres, axum read API)
      │                          ▲
      └── TS SDKs (oracles, markets) build the instructions
                                 │
   runner (off-chain AI) ── submits AiClaim ──▶ oracle program
```

- **Programs** are pinocchio-based, bytemuck-`Pod` account layouts, no Anchor. → [`programs.md`](programs.md)
- **SDKs** hand-build instructions/PDAs/decoders; single source of truth is the program crates' wire contract. → [`sdks.md`](sdks.md)
- **App** is Vite/React on `@solana/web3.js@3.0.0-rc.2` (class-`Address`) + wallet-adapter, consuming the two TS SDK `dist/`s. → [`app.md`](app.md)
- **Runner** is a reproducible AI pipeline (deterministic hashing of model/params/io) → the 97-byte `submit_ai_claim` payload. → [`runner.md`](runner.md)
- **Indexer** crawls the oracle (transactions) + market (accounts + websocket price) sides into one Postgres + one read API. → [`indexer.md`](indexer.md)

## Tokens & economics

- **KASS** (9 decimals) — bonds, stakes, contributions, market seeding, fees.
- **USDC** (6 decimals) — the challenge-market quote side + challenger escrow.
- Conditional tokens (cYES/cNO) are minted from KASS (9 dp) / USDC (6 dp) via the
  MetaDAO conditional-vault CPI. **Scale by the right decimals in the UI** — see
  [`../memories/scaled-amounts-ui.md`](../memories/scaled-amounts-ui.md).

## History worth knowing

- The market program + its SDK were **merged in** from a separate repo; one app +
  one indexer now serve both sides.
- SDKs were **restructured** to `sdks/{oracles,markets}/{rust,ts}` with
  single-source versioning + a publish workflow.
- The programs were **renamed** to oracles/markets (crate + artifact names only).
- All large files (>400 lines) were split into folder modules.
