# Fix: categorical probability display caps below 100% when heavily bought

## Context

`normalizeAcrossGroup` (`app/src/market/lib/marketView.ts:340`), added by the
same-day `audit/pricechart-data-pipeline` merge, rescales each categorical
option's raw, independent implied-YES probability by
`value / sum(all siblings' raw values)`, so the displayed percentages sum to
~100% and visibly move opposite each other as trades happen.

This linear rescale has a real mathematical flaw: since each option is a
genuinely independent AMM pool, buying heavily into option 1 pushes only its
own raw probability toward 1 — untouched siblings' raw values stay parked at
their own baseline (e.g. ~0.5 each on a fresh pool). The displayed value is
capped at the limit `1 / (1 + 0.5*(N-1))` as option 1's raw probability → 1,
which is well below 100% for any N > 2. This exactly matches the reported
symptom: buying a lot of one option in a categorical market visibly plateaus
below 100%, no matter how much more is bought.

Confirmed on a lone binary market this is a non-issue: YES and NO are the
same pool's `p` and `1-p` by construction, always summing to exactly 1, so
`normalizeAcrossGroup` is a correct no-op there — the bug is specific to
categorical groups of N ≥ 2 genuinely independent pools.

## Goal

Still purely a **display-layer** fix — no on-chain/protocol changes, no
change to actual trade pricing, preview, slippage, or settlement. Only the
*shown* percentage's formula changes for categorical groups.

## Core: `normalizeOddsAcrossGroup`

A new function, alongside `normalizeAcrossGroup`, in
`app/src/market/lib/marketView.ts`:

```ts
export function normalizeOddsAcrossGroup(values: (number | null)[]): (number | null)[] {
  const nonNullCount = values.reduce<number>((c, v) => c + (v === null ? 0 : 1), 0);
  if (nonNullCount < 2) return values;

  const odds = values.map((v) => (v === null ? null : v >= 1 ? Infinity : v / (1 - v)));
  const infiniteCount = odds.reduce<number>((c, o) => c + (o === Infinity ? 1 : 0), 0);
  if (infiniteCount > 0) {
    return odds.map((o) => (o === null ? null : o === Infinity ? 1 / infiniteCount : 0));
  }

  const sum = odds.reduce<number>((acc, o) => acc + (o ?? 0), 0);
  if (sum <= 0) return values;
  return odds.map((o) => (o === null ? null : o / sum));
}
```

`odds_i = p_i / (1-p_i)`, which (since `p_i = quote_i/(base_i+quote_i)`)
simplifies to `quote_i/base_i` — each pool's own reserve ratio, so no new
reads are needed anywhere this is called. Normalizing in odds-space rather
than probability-space means one option's `odds_i → ∞` (heavy buying)
correctly drives `normalized_i → 1` regardless of siblings' finite odds — the
asymptotic behavior the linear version lacks. At a uniform baseline (all
pools at `p=0.5`, `odds=1`), it reduces to `1/N` per option, identical to
today's baseline display.

`normalizeAcrossGroup` is unchanged and keeps handling the true binary YES/NO
case, where it is a provably correct no-op — odds-normalization would *not*
be a no-op there (it would distort an already-consistent complementary
pair), so binary must keep using the linear function.

### Edge case: exact `p = 1`

If a pool's base reserve is fully drained (`p === 1` exactly), `odds` is
`Infinity`. Rather than `Infinity/Infinity → NaN`, certainty is split evenly
among however many options are simultaneously at `p=1` (normally just one),
and every other option gets `0` — the correct limiting behavior, not a
divide-by-zero.

## Call site wiring

1. **`CategoricalCard.tsx:78`** — no branch needed. This component only ever
   mounts for categorical groups (gated by `isCategorical(group)` upstream);
   binary markets render `MarketCard` instead. Swap the call directly to
   `normalizeOddsAcrossGroup`.

2. **`GroupTradePanel.tsx:108`** — sees both shapes through the same
   `beliefs` array (`computeBeliefs` branches on `isGroup`: true → N
   independent per-outcome beliefs, false → 2 synthetic complementary
   YES/NO beliefs on one pool). `group.isGroup` is already in scope:
   ```ts
   const normalizedProbabilities = group.isGroup
     ? normalizeOddsAcrossGroup(beliefs.map(beliefProbability))
     : normalizeAcrossGroup(beliefs.map(beliefProbability));
   ```

3. **`PriceChart.tsx:171` and `:230`** — same duality, but `PriceChart`
   currently receives no categorical/binary signal. Thread a new required
   `isGroup: boolean` prop from `GroupTradePanel` (which already has
   `group.isGroup`) down into `PriceChart`. Both call sites branch on it:
   - `:230` (live rolling point): same ternary as `GroupTradePanel`.
   - `:171` (`normalizeGridsAcrossGroup` in
     `app/src/components/markets/priceGrid.ts`): add an `oddsSpace: boolean`
     parameter, passed through from the new prop, so the per-bucket loop
     calls `normalizeOddsAcrossGroup` instead of `normalizeAcrossGroup` when
     true. Bucket-alignment/whitespace-exclusion logic is unchanged — only
     which normalizer runs per bucket changes.

No changes to `computeBeliefs`, AMM reserve reads, trade preview, or
settlement.

## Testing

- `normalizeOddsAcrossGroup` unit tests:
  - **Regression case**: 3 siblings at baseline (0.5/0.5/0.5), push one to
    0.99 → normalized value is close to 1 (e.g. `> 0.9`), not capped near 0.5
    like the old linear formula. This is the test that would have caught the
    original bug.
  - Uniform baseline (all equal) → each `1/N`.
  - `null` entries excluded from the odds sum, stay `null`.
  - Zero-sum / all-zero degenerate → input returned unchanged.
  - Exact `p=1` tie-breaking (one winner → `1`, others → `0`; two
    simultaneous winners → `0.5`/`0.5`/rest `0`).
- `CategoricalCard`/`GroupTradePanel` SSR tests: categorical fixture updated
  to assert odds-space values; binary fixture asserts **unchanged** output
  (still exact linear passthrough), guarding the branch isn't flipped.
- `normalizeGridsAcrossGroup` (`priceGrid.ts`): extend existing bucket
  fixtures with an `oddsSpace: true` case alongside the existing linear case.
- `PriceChart`: no automated coverage (canvas-based, existing convention) —
  manual browser pass buying heavily into one categorical option, confirming
  its curve approaches the top of the chart while siblings sink toward the
  bottom, instead of plateauing mid-chart.

No tooltip/copy changes — the existing "adjusted so all options sum to 100%"
disclosure remains accurate; only the underlying math changes.
