---
id: memory-e2e-unified-list-selectors
title: Playwright e2e copy must match the unified /markets list
tags: [memory, e2e, playwright, app]
updated: 2026-09-07
---

# Playwright selectors vs unified list

`/oracles` **redirects** to `/markets`. The list shell is
`app/src/pages/Markets.tsx` + `UnifiedStats` / `UnifiedFilters`, not the old
oracles-only `DashboardStats`.

Pinned strings the browser e2e must use:

| Spec | Assert | Actual UI |
|---|---|---|
| `e2e/oracles.spec.ts` | `getByLabel('Capital at stake')` | `UnifiedStats` aria-label |
| `e2e/markets.spec.ts` | heading `/every dispute/i` | `SectionHeader` line1 |
| `e2e/candles/candles.spec.ts` | `getByText('Share price · history')` | `PriceChart` caption (a `<span>`, not a heading) |

Master CI was already red on the old `'Open markets'` / `'Oracle capital at stake'`
/ `'Price history'` locators after the unified-list merge.
