---
id: context-overview
title: System overview
tags: [context, architecture]
updated: 2026-09-09
---

# System overview

Kassandra is a **Solana prediction-market** protocol. A question is a
markets-owned **Subject** PDA; MagicBlock's GPT oracle resolves it; binary
sub-markets (`Market.oracle` = Subject pubkey) trade cYES/cNO until
`ResolveMarket` reads the Subject.

## Resolution flow

1. **CreateSubject** — nonce + `options_count` + GPT `llm_context` pubkey.
2. **CreateMarket** — one binary sub-market per outcome, keyed
   `[b"market", subject, [outcome_index]]`.
3. **Fund → compose MetaDAO → Activate** — live cYES/cNO AMM.
4. **RequestAi** — CPI `interact_with_llm` into MagicBlock solana-gpt-oracle.
5. **Callback** — GPT identity PDA signs the 8-byte callback; markets write
   `Subject.resolved_option`.
6. **ResolveMarket** — winning outcome from the Subject.

See [`../specs/market-program.md`](../specs/market-program.md) and
[`../specs/ephemeral-rollups-and-ai-oracle.md`](../specs/ephemeral-rollups-and-ai-oracle.md).

## Components & data flow

```
                 creates/trades (writes)
   app (react) ───────────────────────────────────────────▶ markets program (on-chain)
      │  ▲                                                        │
      │  │ reads                                                  │ accounts
      │  │                                                        ▼
      │  └──────────────── indexer (Carbon GPA → Postgres, axum `/api/*`)
      │
      └── TS SDK (@kassandra-market/markets) builds the instructions

   MagicBlock llm_oracle ── callback_from_llm ──▶ Subject.resolved_option
```

- **Program** is pinocchio, bytemuck-`Pod` layouts, no Anchor. → [`programs.md`](programs.md)
- **SDKs** hand-build instructions/PDAs/decoders. → [`sdks.md`](sdks.md)
- **App** is Vite/React on `@solana/web3.js@3.0.0-rc.2` (class-`Address`). → [`app.md`](app.md)
- **Indexer** indexes market accounts + websocket price into Postgres. → [`indexer.md`](indexer.md)

The in-house Kassandra oracles program and `kassandra-runner` were **removed**.
GPT is the attested AI source.

## Tokens & economics

- **SOL** (9 decimals) — contributions, market seeding, fees.
- Conditional tokens (cYES/cNO) via MetaDAO conditional-vault CPI.
  **Scale by the right decimals in the UI** — see
  [`../memories/scaled-amounts-ui.md`](../memories/scaled-amounts-ui.md).

## History worth knowing

- A dispute-oracle program (`programs/oracles`) used to sit in front of markets;
  markets now own Subject PDAs and CPI GPT directly. `docs/plans/` is append-only
  history of that design.
- SDKs live at `sdks/markets/{rust,ts}` with single-source versioning.
- The programs were **renamed** to oracles/markets (crate + artifact names only);
  the markets program ID did not change.
