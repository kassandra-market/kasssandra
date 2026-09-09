---
id: memory-e2e-unified-list-selectors
title: Playwright e2e copy must match the /markets list
tags: [memory, e2e, playwright, app]
updated: 2026-09-09
---

# Playwright selectors vs markets list

`/oracles` **redirects** to `/markets`. The list shell is
`app/src/pages/Markets.tsx` + `UnifiedStats` / `UnifiedFilters`.

Pinned strings the browser e2e must use:

| Spec | Assert | Actual UI |
|---|---|---|
| `e2e/markets.spec.ts` | heading `/every market/i` | `SectionHeader` line1 |
| `e2e/markets.spec.ts` | `getByLabel('Search markets')` | `UnifiedFilters` search |
| `e2e/markets.spec.ts` | `getByLabel('Capital at stake')` | `UnifiedStats` aria-label |
| `e2e/candles/candles.spec.ts` | `getByText('Share price · history')` | `PriceChart` caption (a `<span>`, not a heading) |
