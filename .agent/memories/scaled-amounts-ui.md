---
id: mem-scaled-amounts-ui
title: "UI amounts are scaled by decimals (KASS 9, USDC 6)"
tags: [memory, convention, app, ui, decimals]
updated: 2026-07-10
---

# Token amounts in the UI are scaled by decimals

Never show raw base units. Decimals: **KASS = 9**, **USDC = 6**; conditional
tokens inherit their vault (conditional-KASS 9, conditional-USDC 6). The AMM
struct carries `baseDecimals`/`quoteDecimals` — use them, don't assume 9.

## Helpers (oracle side, `app/src/lib/oracleView.ts`)

- `formatUnits(amount, decimals)` — the generic scaled formatter.
- `formatKass(a)` = `formatUnits(a, 9)`; `formatUsdc(a)` = `formatUnits(a, 6)`.
- `groupDigits(n)` only inserts thousands separators — it does **NOT** scale. Never
  render a token amount through `groupDigits` alone (that was the bug class).

The market side has its own `formatKass`/`formatProbability` in
`app/src/market/lib/marketView.ts`.

## Input forms

Parse **scaled** entry (type `1.5`, not `1500000000`): oracle side
`parseAmount(raw, decimals=9)`, market side `parseKassAmount`. `balanceGateError`
takes the asset it checks — **selling gates on the held shares**, so the message
must name "YES shares", not "KASS".

## Non-amounts (do NOT scale)

Ratios/thresholds (num/den), basis points, nonces, option indices, slot counts.
