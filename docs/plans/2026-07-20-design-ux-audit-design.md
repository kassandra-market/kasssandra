# Design/UX audit — findings and remediation design

**Date:** 2026-07-20
**Status:** approved, implementation pending

## Context

A fresh-eyes design/UX audit of the whole app (`app/`), driven by screenshotting every
route in `?mock` mode (landing, oracles list/detail, markets list/detail, both create
flows, `/styleguide`, `/admin`) and cross-checking a few suspicious observations against
source. Full findings, in priority order:

1. Design-token naming is out of sync with the actual "Auros" palette.
2. The Markets flow has no offline/mock preview (Oracles does).
3. A visibly half-finished "pay with any token" checkbox sits in the primary trade UI.
4. Minor copy duplication on the CreateMarket page.
5. The `/admin` page is unstyled relative to the rest of the app.

One initial observation — a large blank gap on the landing page in a full-page
screenshot — turned out to be a Playwright screenshot-capture artifact (scroll-reveal
IntersectionObservers not firing without real scroll events), not a real bug. Confirmed
by simulating real scroll: all content reveals correctly. No action needed.

This doc covers the design for items 1, 2, and the bundle of 3–5.

## Part 1 — Design-token rename

### Problem

`app/src/index.css` defines the canonical Auros tokens (`--color-liquid-abyss/-deep/
-kelp/-mist`, `--color-platinum`, `--color-silver-mist`, `--color-ash`,
`--color-slate-deep`, `--color-lavender-phosphor`, `--color-cyan-phosphor`), then a
second block of 15 legacy "Delphi" tokens that are pure aliases onto those same values
(e.g. `--color-sepia: #ffffff; /* headings -> platinum */`). Some legacy names are
duplicate aliases of the same canonical color (`cyan-phosphor` / `saffron-pulse` /
`cobalt` are all `#cbfffc`; `bronze` / `driftwood` are both `silver-mist`; `pure-card` /
`peach-glow` are both `kelp`; `soft-cream` / `ink-black` are both `deep`).

The legacy names are used directly as Tailwind utility classes throughout real
components (`text-sepia`, `border-pebble`, `bg-bronze/70`, etc. — ~40 files), so anyone
touching styling has to mentally translate "sepia" → "the heading color" before making a
change.

### Design

Rename + consolidate to 9 semantic names (dropping the duplicate aliases), each backed
by one existing canonical CSS var — no visual change, this is a pure rename:

| legacy name(s) | new name | canonical var |
|---|---|---|
| `parchment`, `soft-cream`, `ink-black` | `abyss` / `deep` (kept as two, see note) | `--color-liquid-abyss` / `--color-liquid-deep` |
| `pure-card`, `peach-glow` | `kelp` | `--color-liquid-kelp` |
| `charcoal-bark` | `mist` | `--color-liquid-mist` |
| `sepia` | `platinum` | `--color-platinum` |
| `bronze`, `driftwood` | `silver` | `--color-silver-mist` |
| `stone` | `silver-dim` | `--color-stone` (kept distinct — AA-tuned, not a true duplicate) |
| `pebble` | `hairline` | `--color-pebble` (unchanged, already descriptive) |
| `chestnut` | `aqua` | `--color-chestnut` |
| `ember-orange` | `coral` | `--color-ember-orange` |
| `saffron-pulse`, `cobalt` | `phosphor` | `--color-cyan-phosphor` |

Note: `parchment` (page bg) and `soft-cream`/`ink-black` (recessed bg) map to two
*different* canonical vars (`abyss` vs `deep`) despite the shared "cream" naming — verify
each usage site individually rather than blanket-merging, since `soft-cream` and
`ink-black` do share the same value (`deep`) but `parchment` does not.

### Execution

1. Edit `app/src/index.css`: replace the legacy alias block with the 9 new names,
   removing the duplicates (`ink-black`, `driftwood`, `peach-glow`, `saffron-pulse`,
   `cobalt` are deleted as tokens; their usages get repointed to the surviving name).
2. Scripted rename of Tailwind class usages (`text-`, `bg-`, `border-`, `ring-`, `/NN`
   opacity suffixes) across the ~40 affected files.
3. Visual regression check: re-run the screenshot sweep from the audit
   (`landing`, `oracles-list`, `oracle-detail-challenged`, `oracle-detail-resolved`,
   `create-oracle`, `markets-list`, `create-market`, `styleguide`, `admin`) before and
   after, diff pixel-by-pixel — expect zero change.

## Part 2 — Markets mock-mode fixtures

### Problem

`Oracles` has a full fixture set (`app/src/data/mockOracles/`) so every route is
reviewable offline via `?mock`. `Markets` has none — list and detail pages just show
"Could not load markets from the indexer" (502) in mock mode, including the price
chart. This blocked full visual review of the newest, most complex surface (PR #39/#40:
trade UI, liquidity, price chart) during the audit.

### Design

Single swap point: `app/src/market/lib/IndexerProvider.tsx` constructs the one
`IndexerClient` the whole markets subsystem depends on
(`useMarkets`/`useMarketDetail`/`PriceChart` all resolve reads through it). Add a
`MockIndexerClient` implementing the same read methods (`getConfig`, `getMarkets`,
`getMarket`, `getCandles`) against fixture DTOs instead of `fetch`, and branch the
provider on `isMockMode()`:

```
const client = useMemo(
  () => (isMockMode() ? new MockIndexerClient() : new IndexerClient()),
  [],
)
```

This is strictly additive and touches zero files in `useMarkets.ts`/
`useMarketDetail.ts`/`PriceChart.tsx` — they keep calling the same `IndexerClient`
interface. The write path (`sendTransaction`, `getAccount`, `getBlockhash`,
`getSignatureStatus`) stays unimplemented/throwing in mock mode, matching how mock
oracles never let you submit a real tx.

New directory `app/src/market/data/mockMarkets/` (mirrors `data/mockOracles/`):

- `fixtures.ts` — `MarketDto`/`MarketDetailDto`/`CandleDto`/`ConfigDto` fixture data
  covering: pre-activation (funding), Active (populated `reserves`, ~2-3 contributions),
  Resolved/settled, and one categorical oracle group (3+ sub-markets sharing an oracle)
  to exercise `groupByOracle`/`isCategorical` on the list page.
- `amm.ts` (or inline) — synthetic OHLC candle series: a seeded random-walk around 50%
  implied-YES so the price chart isn't a flat line. Must avoid `Date.now()`/`Math.random()`
  at module scope if any test tooling snapshots it — use a fixed seed / fixed
  timestamps anchored to candle `intervalSecs` offsets from a constant epoch.
- `client.ts` — the `MockIndexerClient` class.
- `index.ts` — re-exports, same shape as `mockOracles/index.ts`.

### Verification

Re-run the screenshot sweep against `/markets` and `/markets/:pubkey` (all three
lifecycle states + the categorical group) once fixtures exist, confirming the trade/
liquidity UI and price chart render — closing the exact gap the audit hit today.

## Part 3 — Small polish batch

1. **Jupiter stub** (`app/src/components/markets/actions/TradePanel.tsx:479-487`):
   replace the disabled checkbox + native `title="Coming soon"` tooltip with a small,
   non-interactive "Coming soon" badge next to the label — reuse the existing status-
   badge visual language (`CHALLENGED`, `DEAD END`, etc. on oracle cards) so it reads as
   a deliberate roadmap marker, not a broken control. The `buildJupiterEntryRequest`
   TODO and underlying logic are untouched — this is presentation only.

2. **CreateMarket copy dedup** (`app/src/pages/CreateMarket` or equivalent): the page
   header already states "CREATE · New market" + description; the card below currently
   repeats "Create market" + a near-identical description. Drop the card's restated
   heading/description, keep only the wallet-gate line — matching `CreateOracle`'s
   existing pattern (no repeated heading).

3. **Admin page** (`app/src/pages/Admin` or equivalent): light pass only — wrap the
   existing form fields in the app's `Card` primitive and apply the standard type scale
   to labels/headings. No new layout, no new features — it's operator-only and
   explicitly "deliberately minimal" per its own doc comment; this just brings it up to
   the baseline visual language instead of being bare HTML-form-styled.

## Out of scope

- Any change to the Jupiter integration's actual logic.
- Redesigning `/admin` beyond the light pass above.
- The oracle-detail economics bar-meters — investigated during the audit and confirmed
  correct (each meter is proportionally scaled to the largest of the three vault
  values); no change needed.
