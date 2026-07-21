# Categorical probability normalization (chart + live displays)

## Context

A categorical oracle's N outcomes are still N genuinely independent on-chain
AMM pools — each its own cYES/cNO reserves. Every place in the app that shows
an option's probability (the price chart's curves, the non-interactive legend
pills, the order-ticket dropdown, and the `/markets` list's `CategoricalCard`
outcome rows) reads that option's own raw implied-YES probability, computed
purely from its own pool's reserves, with no reference to its siblings.

This means buying option 1 pushes option 1's own curve up but has zero effect
on option 2's or option 3's displayed probability — even though, conceptually,
these are mutually exclusive outcomes of one question, so becoming more
confident in option 1 should read as becoming *less* confident in the others.
As experienced today, every option's curve only ever goes up when it's
bought — there's no visible anti-correlation between sibling options, which
reads as "wrong" for a categorical market.

## Goal

Purely a **display-layer** change — no on-chain/protocol changes, no change
to actual trading mechanics. Each option's raw, independent AMM price stays
exactly what determines real trade pricing/settlement. What changes is what
number gets *shown*: every place a categorical option's probability is
displayed normalizes it against its current siblings' raw probabilities
(`value / sum of all siblings' raw values`), so the displayed numbers always
sum to ~100% and visibly move opposite each other as trades happen — on the
chart's historical curves, not just the current live number.

## Core: `normalizeAcrossGroup`

One pure function, in `app/src/market/lib/marketView.ts` next to
`impliedYesProbability`/`beliefProbability`:

```ts
export function normalizeAcrossGroup(values: (number | null)[]): (number | null)[]
```

- `null` stays `null` (an outcome with no data yet — hasn't activated, or
  genuinely never traded).
- Sum the non-null values. If the sum is `<= 0` (degenerate: every value is
  exactly 0), return the input unchanged rather than dividing by zero.
- Otherwise each non-null value becomes `value / sum`.

For a lone **binary** market (YES + NO of the same pool), this is
mathematically a no-op: `YES + NO ≡ 1` by construction (NO is literally
`1 - YES` of the same reserves), so the sum is always exactly 1 and every
value maps to itself. This means **one code path handles both shapes** —
nothing anywhere needs to branch on "is this categorical or binary."

**Trade math is untouched.** Every actual price preview, price-impact
calculation, slippage bound, and the buy/sell instructions themselves keep
reading each belief's own real reserves exactly as today — only the *shown*
percentage changes. A small tooltip on normalized numbers will read something
like "adjusted so all options sum to 100%; your trade price still depends on
this option's own pool," since a user could otherwise be surprised that the
legend's shown 45% and the order ticket's own price preview don't match once
they've actually selected that option.

## Live-value call sites

**Note:** the order-ticket dropdown (`TradePanel`'s `BeliefSelect`) no longer
shows a probability at all — a later commit (`f19138c`, "remove the confusing
probability from the trade belief dropdown") already dropped it since it
duplicated the legend pill's number right above it on the same panel. So
there's nothing to normalize there; it's out of scope by virtue of already
not displaying a number.

Two places currently compute each option's probability independently and
need to instead compute the group's full raw array once, normalize once,
then index in:

- **`GroupTradePanel`'s `BeliefPill`** (the legend): `GroupTradePanel` computes
  `const normalized = normalizeAcrossGroup(beliefs.map(beliefProbability))`
  once, and passes `normalized[i]` into each pill as a plain `probability`
  prop, instead of the pill deriving it from `belief` itself.
- **`CategoricalCard`'s outcome rows** (the `/markets` list): same pattern —
  `normalizeAcrossGroup` once over every row's raw `outcomeRow(...).probability`,
  then use the normalized value in each row's displayed percentage.

None of these need new data fetching — every one of these components already
holds every sibling's reserves at the point where the probability is
displayed today. This is a "compute the array once instead of per-item"
refactor plus one new pure function call at each site.

## The chart's historical curve

The substantive piece. `PriceChart`'s `replot()` currently builds each spec's
own grid independently (`buildWindowedGrid` → optionally `invertGrid`) and
calls `line.setData(...)` per spec as it goes. Normalizing the *history*
requires splitting this into two passes:

1. Build every spec's "raw plotted" grid first (exactly as today — carried
   forward, whitespace-padded, inverted for a binary NO belief) into a
   temporary array instead of calling `setData` immediately. All specs'
   grids are already the same length with matching bucket times (same
   `windowSecs`/`step`/`nowSec` inputs), so they're trivially aligned
   index-for-index — no re-bucketing/interpolation needed to align them.
2. For each time-bucket index, gather that bucket's value across every spec,
   run it through `normalizeAcrossGroup`, and write the normalized values
   into each spec's final grid — a bucket where a spec is still
   whitespace/`undefined` (hasn't activated yet, or this window predates its
   first trade) stays `undefined` and is simply excluded from that bucket's
   sum, exactly like the live case excludes an inactive outcome.
3. *Then* call `setData` per spec with the normalized grid.

`rollForward` (the wall-clock tick extending the curve every 15ms) needs the
identical treatment: instead of pushing each spec's raw carried value
straight to `line.update(...)`, it computes the normalized set across all
specs' current carried values first, then updates each line with its
normalized point.

The per-bucket cross-spec normalization is extracted as its own pure,
unit-testable function in `priceGrid.ts` (reusing `normalizeAcrossGroup`
under the hood, applied once per bucket across aligned grids) — the wiring
into `replot`/`rollForward` remains the untestable, manually-verified
imperative part, consistent with how the rest of this component has been
handled all session.

## Edge cases

- An outcome with no data yet (not activated, or zero trades): excluded from
  every bucket's sum until it actually has a real value; joins the sum from
  the point it starts trading forward.
- All-zero degenerate case (every option's raw probability is 0): sum ≤ 0 →
  `normalizeAcrossGroup` returns the input unchanged (no `NaN`, no divide by
  zero).
- Lone binary market: no-op everywhere, no special-casing in any call site.
- Shown-vs-actual-trade-price gap: called out explicitly via a tooltip, not
  hidden.

## Testing

- `normalizeAcrossGroup`: the ordinary multi-value case, a `null` entry
  (excluded, stays `null`), the zero-sum fallback, and the binary no-op case
  (`[p, 1-p]` → unchanged).
- The per-bucket grid-normalization helper in `priceGrid.ts`: small
  aligned-grid fixtures — some buckets where every series has data, some
  where one series is still whitespace, confirming the sum only includes
  series with real data at that bucket.
- `GroupTradePanel`/`TradePanel`/`CategoricalCard`: existing SSR render tests
  get updated assertions — e.g. a multi-option group's displayed
  probabilities now sum to ~100% instead of each being independent.
- `PriceChart` itself: no automated test either way (canvas/lightweight-charts,
  as established all session) — a manual browser pass, specifically
  confirming that buying option 1 visibly pulls option 2/3's curves down at
  the same moment, is the real verification here.
