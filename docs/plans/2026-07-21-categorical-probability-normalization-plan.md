# Categorical Probability Normalization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every place a categorical option's probability is displayed
(chart curves, legend pills, `/markets` list rows) normalizes it against its
current siblings' raw probabilities, so they visibly sum to ~100% and move
opposite each other as trades happen — purely a display change, no on-chain
or trade-math changes.

**Architecture:** One new pure function (`normalizeAcrossGroup`) does the
core math, reused directly for every "live" display (legend, list card) and
wrapped by a second pure function (`normalizeGridsAcrossGroup`) that applies
it per-time-bucket across aligned candle grids for the chart's historical
curves. `PriceChart`'s imperative `replot`/`rollForward` get restructured to
build every spec's raw grid/value first, normalize across specs, then push
to the chart — the riskiest, least-testable part of this plan (canvas/
lightweight-charts, as established all session), so it gets a careful manual
verification pass at the end.

**Tech Stack:** React 19, TypeScript, vitest (SSR-only render tests, no
canvas/DOM for chart internals), lightweight-charts.

**Design doc:** `docs/plans/2026-07-21-categorical-probability-normalization-design.md`

---

## Before you start

This plan was written against `feat/categorical-probability-normalization`,
branched from `master` at commit `ad31a42`. Work in
`/Users/dode/Documents/solana/kassandra/.worktrees/categorical-probability-normalization`
(a git worktree — already has its own `node_modules`, and the workspace SDK
packages `@kassandra-market/{oracles,markets}` already built). All commands
below assume `cd app` first unless stated otherwise.

Baseline check before Task 1:

```bash
cd /Users/dode/Documents/solana/kassandra/.worktrees/categorical-probability-normalization/app
pnpm test 2>&1 | tail -5
```

Expected: `Test Files  57 passed (57)` / `Tests  449 passed (449)`.

---

### Task 1: `normalizeAcrossGroup` — the core pure function

**Files:**
- Modify: `app/src/market/lib/marketView.ts`
- Modify: `app/test/marketView.unit.test.ts`

**Step 1: Write the failing test**

Append to `app/test/marketView.unit.test.ts` (add `normalizeAcrossGroup` to
the existing import block from `'../src/market/lib/marketView'`):

```ts
describe('normalizeAcrossGroup — rescale so a group\'s shown probabilities sum to ~100%', () => {
  it('divides each value by the sum of all values', () => {
    // Three independent pools reading 60%/55%/40% raw — sums to 155%, not
    // a coherent set of mutually-exclusive-outcome probabilities.
    const result = normalizeAcrossGroup([0.6, 0.55, 0.4])
    expect(result[0]).toBeCloseTo(0.6 / 1.55)
    expect(result[1]).toBeCloseTo(0.55 / 1.55)
    expect(result[2]).toBeCloseTo(0.4 / 1.55)
    expect((result[0]! + result[1]! + result[2]!)).toBeCloseTo(1)
  })

  it('a null entry (no data yet) stays null and is excluded from the sum', () => {
    const result = normalizeAcrossGroup([0.6, null, 0.4])
    expect(result[1]).toBeNull()
    expect(result[0]).toBeCloseTo(0.6)
    expect(result[2]).toBeCloseTo(0.4)
  })

  it('a binary pair (YES + its complement NO) is a no-op — already sums to 1', () => {
    const result = normalizeAcrossGroup([0.37, 0.63])
    expect(result[0]).toBeCloseTo(0.37)
    expect(result[1]).toBeCloseTo(0.63)
  })

  it('zero-sum fallback: every value is 0 → returned unchanged, no divide-by-zero/NaN', () => {
    const result = normalizeAcrossGroup([0, 0, 0])
    expect(result).toEqual([0, 0, 0])
  })

  it('all null → all null', () => {
    expect(normalizeAcrossGroup([null, null])).toEqual([null, null])
  })

  it('empty input → empty output', () => {
    expect(normalizeAcrossGroup([])).toEqual([])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/marketView.unit.test.ts`
Expected: FAIL — `normalizeAcrossGroup is not exported`

**Step 3: Write the implementation**

Add to `app/src/market/lib/marketView.ts`, near `impliedYesProbability`/
`beliefProbability`-adjacent helpers (e.g. right after `groupStatus`, since
both are "collapse per-outcome numbers into one coherent group view"):

```ts
/**
 * Rescale a set of independently-priced probabilities so they sum to ~100% —
 * `value / sum of all non-null values`. Each option in a categorical group is
 * a genuinely separate AMM pool, so their raw implied-YES probabilities have
 * no natural relationship to each other (all three could independently read
 * 60%/55%/40%, summing to 155%). This is the purely-DISPLAY fix: shown
 * probabilities move opposite each other as trades happen, while every
 * actual trade computation (price preview, price impact, slippage, the
 * buy/sell instructions themselves) keeps reading each option's own real,
 * un-normalized reserves.
 *
 * `null` (no data yet — an outcome that hasn't activated) stays `null` and
 * is excluded from the sum, so an inactive sibling never drags the active
 * ones down. A lone binary market's YES/NO pair is a no-op here — they
 * already sum to exactly 1 by construction (NO ≡ 1 − YES of the same pool)
 * — so this same function is safe to apply uniformly with no
 * categorical-vs-binary branch anywhere it's called.
 *
 * Degenerate zero-sum case (every value is exactly 0): returned unchanged
 * rather than dividing by zero.
 */
export function normalizeAcrossGroup(values: (number | null)[]): (number | null)[] {
  const sum = values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  if (sum <= 0) return values;
  return values.map((v) => (v === null ? null : v / sum));
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/marketView.unit.test.ts`
Expected: PASS (35 tests — 29 existing + 6 new)

**Step 5: Commit**

```bash
git add app/src/market/lib/marketView.ts app/test/marketView.unit.test.ts
git commit -m "feat(app): add normalizeAcrossGroup, the core cross-option probability rescale"
```

---

### Task 2: `normalizeGridsAcrossGroup` — per-bucket normalization for the chart

**Files:**
- Modify: `app/src/components/markets/priceGrid.ts`
- Modify: `app/test/priceGrid.unit.test.ts`

This applies `normalizeAcrossGroup` once per time bucket across several
specs' already-built grids. **Precondition** (documented in the function,
not re-validated at runtime): every non-empty input grid shares the identical
time axis (same length, same `time` at each index) — guaranteed by
`PriceChart`'s `replot()` calling `buildWindowedGrid` for every spec with the
same `nowSec`/`step`/`maxBars` inputs in one pass. A grid may also be
entirely **empty** (`[]`) — `buildWindowedGrid` returns exactly that when a
pubkey has zero candles ever (never padded to `maxBars`, unlike a market
that's merely younger than the window) — and is treated as "no data at every
bucket" for that spec.

**Step 1: Write the failing test**

Read the existing `app/test/priceGrid.unit.test.ts` first to match its
import/style conventions (it already imports `invertGrid`; add
`normalizeGridsAcrossGroup` to that same import line), then append:

```ts
describe("normalizeGridsAcrossGroup", () => {
  it("normalizes each bucket across all grids independently", () => {
    const gridA = [
      { time: 100, value: 0.6 },
      { time: 101, value: 0.8 },
    ];
    const gridB = [
      { time: 100, value: 0.4 },
      { time: 101, value: 0.4 },
    ];
    const [normA, normB] = normalizeGridsAcrossGroup([gridA, gridB]);
    // Bucket 100: 0.6/(0.6+0.4)=0.6, 0.4/(0.6+0.4)=0.4 (no-op, already summed to 1).
    expect(normA[0]).toEqual({ time: 100, value: 0.6 });
    expect(normB[0]).toEqual({ time: 100, value: 0.4 });
    // Bucket 101: 0.8/(0.8+0.4) ≈ 0.667, 0.4/(0.8+0.4) ≈ 0.333.
    expect(normA[1].value).toBeCloseTo(0.8 / 1.2);
    expect(normB[1].value).toBeCloseTo(0.4 / 1.2);
    // Times are preserved unchanged.
    expect(normA[1].time).toBe(101);
    expect(normB[1].time).toBe(101);
  });

  it("a whitespace point (undefined value) in one grid is excluded from that bucket's sum, not treated as 0", () => {
    const gridA = [{ time: 100, value: 0.6 }];
    const gridB: typeof gridA extends never ? never : { time: number; value?: number }[] = [
      { time: 100, value: undefined },
    ];
    const [normA, normB] = normalizeGridsAcrossGroup([gridA, gridB]);
    // Only gridA has real data at bucket 100 → normalizes to itself (sum = 0.6).
    expect(normA[0].value).toBeCloseTo(0.6);
    expect(normB[0].value).toBeUndefined();
  });

  it("an entirely empty grid (a pubkey with zero candles ever) is excluded at every bucket, others normalize among themselves", () => {
    const gridA = [
      { time: 100, value: 0.6 },
      { time: 101, value: 0.5 },
    ];
    const gridEmpty: { time: number; value?: number }[] = [];
    const [normA, normEmpty] = normalizeGridsAcrossGroup([gridA, gridEmpty]);
    // Only one real grid → normalizing against itself is a no-op.
    expect(normA[0].value).toBeCloseTo(0.6);
    expect(normA[1].value).toBeCloseTo(0.5);
    expect(normEmpty).toEqual([]);
  });

  it("all grids empty → all returned empty, unchanged", () => {
    expect(normalizeGridsAcrossGroup([[], []])).toEqual([[], []]);
  });

  it("a single grid is always a no-op (nothing to normalize against)", () => {
    const grid = [{ time: 100, value: 0.42 }];
    const [result] = normalizeGridsAcrossGroup([grid]);
    expect(result[0].value).toBeCloseTo(0.42);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/priceGrid.unit.test.ts`
Expected: FAIL — `normalizeGridsAcrossGroup is not exported`

**Step 3: Write the implementation**

Add to `app/src/components/markets/priceGrid.ts`. It needs
`normalizeAcrossGroup` from `marketView.ts` — add the import at the top of
the file:

```ts
import { normalizeAcrossGroup } from "../../market/lib/marketView";
```

Then append the function:

```ts
/**
 * Apply {@link normalizeAcrossGroup} once PER TIME BUCKET across several
 * already-built grids, so a categorical group's chart curves visibly move
 * opposite each other as trades happen, instead of each option's raw
 * (independent-pool) curve only ever moving on its own trades.
 *
 * PRECONDITION: every non-empty input grid shares the identical time axis
 * (same length, same `time` at each index) — guaranteed by `PriceChart`
 * calling {@link buildWindowedGrid} for every spec with the same
 * `nowSec`/`step`/`maxBars` in one `replot()` pass. A grid may also be
 * entirely empty (a pubkey with zero candles ever — `buildWindowedGrid`
 * returns `[]` for that case, never padded), treated as "no data at every
 * bucket" for that spec — excluded from every bucket's sum, same as a
 * single whitespace point within an otherwise-real grid.
 */
export function normalizeGridsAcrossGroup(grids: GridPoint[][]): GridPoint[][] {
  const axisLength = grids.reduce((max, g) => Math.max(max, g.length), 0);
  if (axisLength === 0) return grids;
  const axisGrid = grids.find((g) => g.length === axisLength)!;
  const out: GridPoint[][] = grids.map(() => []);
  for (let i = 0; i < axisLength; i++) {
    const time = axisGrid[i].time;
    const raw = grids.map((g) => (g.length === axisLength ? (g[i].value ?? null) : null));
    const normalized = normalizeAcrossGroup(raw);
    grids.forEach((_, j) => out[j].push({ time, value: normalized[j] ?? undefined }));
  }
  return out;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/priceGrid.unit.test.ts`
Expected: PASS (existing tests + 5 new)

**Step 5: Typecheck** (this file is imported by `PriceChart.tsx`, so confirm
no circular-import issue between `priceGrid.ts` → `marketView.ts`):

Run: `pnpm exec tsc -b`
Expected: no errors.

**Step 6: Commit**

```bash
git add app/src/components/markets/priceGrid.ts app/test/priceGrid.unit.test.ts
git commit -m "feat(app): add normalizeGridsAcrossGroup for per-bucket chart normalization"
```

---

### Task 3: `GroupTradePanel`'s legend pills use normalized probabilities

**Files:**
- Modify: `app/src/components/markets/actions/GroupTradePanel.tsx`
- Modify: `app/test/groupTradePanel.render.test.tsx`

**Step 1: Update the render test first**

`app/test/groupTradePanel.render.test.tsx` doesn't currently assert on pill
probability text at all (check the existing file — it asserts belief count,
labels, default-belief key, dedup, and chart-series colors, but not the
percentage shown in a pill). Add one new test after the existing "every
chart series color is a literal hex" test:

```tsx
it("legend pill probabilities are normalized across the group, not each outcome's raw independent price", () => {
  // Two outcomes whose RAW implied-YES probabilities are 60% and 40% —
  // already coincidentally summing to 100%, so this is a no-op case chosen
  // deliberately to keep the fixture simple; Task 1's own unit tests cover
  // the genuinely-rescaled case. This test's job is just to prove
  // GroupTradePanel actually ROUTES through normalizeAcrossGroup at all
  // (i.e., computes the array once and indexes in) rather than each pill
  // still calling `beliefProbability` on its own belief in isolation.
  const d = detail("Market0111111111111111111111111111111111111", 0, MarketStatus.Active, R2); // R2 = 3M/7M → 70%
  const g = group([summary(1, MarketStatus.Active, R)]); // R = 6M/4M → 40%
  const html = render({ detail: d, group: g, options: ["Zero", "One"], refetch: () => {} });
  // R2 alone would show 70%, R alone 40% — together they must be rescaled.
  expect(html).toContain("64%"); // 0.7 / (0.7+0.4) ≈ 0.636 → rounds to 64%
  expect(html).toContain("36%"); // 0.4 / (0.7+0.4) ≈ 0.364 → rounds to 36%
  expect(html).not.toContain("70%");
  expect(html).not.toContain("40%");
});
```

Verify the expected rounded percentages against `formatProbability`
yourself before relying on them (it rounds to the nearest whole percent —
check `app/src/market/lib/marketView.ts`'s `formatProbability`) — adjust the
exact `"64%"`/`"36%"` strings above if your hand computation differs.

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/groupTradePanel.render.test.tsx`
Expected: FAIL (current code shows each pill's own raw 70%/40%, not the
rescaled values)

**Step 3: Update `GroupTradePanel.tsx`**

Import `normalizeAcrossGroup` and change `BeliefPill` to take a plain
`probability` prop instead of deriving it from `belief` itself:

```tsx
import { normalizeAcrossGroup } from "../../../market/lib/marketView";
```

Replace the `BeliefPill` component:

```tsx
/** One non-interactive legend pill: color dot, belief label, live NORMALIZED
 *  probability (see {@link normalizeAcrossGroup} — rescaled so the group's
 *  pills always sum to ~100%, since each option is a genuinely independent
 *  AMM pool with no natural relationship to its siblings' raw price). Purely
 *  a readout — clicking it does nothing; the order ticket's dropdown (below)
 *  is the only selector. */
function BeliefPill({
  belief,
  color,
  probability,
}: {
  belief: Belief;
  color: string;
  probability: number | null;
}) {
  return (
    <span
      className="flex shrink-0 items-center gap-2 rounded-tag border border-hairline bg-liquid-deep px-3 py-1.5 font-inter text-[13px]"
      title="Adjusted so all options sum to 100% — this option's own trade price still depends on its own pool."
    >
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-platinum">{belief.label}</span>
      <span className="tabular-nums text-coral">{formatProbability(probability)}</span>
    </span>
  );
}
```

Remove the now-unused `beliefProbability` import if nothing else in the file
calls it (check first — it's currently only used inside the old
`BeliefPill`).

In the component body, compute the normalized array once and pass indexed
values down:

```tsx
  if (beliefs.length === 0) return null;

  const normalizedProbabilities = normalizeAcrossGroup(beliefs.map((b) => beliefProbability(b)));
```

Wait — if you removed the `beliefProbability` import above, re-add it here
(it's needed for this one line, just no longer needed inside `BeliefPill`
itself). Then update the legend's render:

```tsx
        <div className="flex flex-wrap gap-2" aria-label="Options" role="list">
          {beliefs.map((b, i) => (
            <BeliefPill key={b.key} belief={b} color={colorFor(i)} probability={normalizedProbabilities[i]} />
          ))}
        </div>
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/groupTradePanel.render.test.tsx`
Expected: PASS (all tests including the new one)

**Step 5: Run the full suite + typecheck**

Run: `pnpm exec tsc -b && pnpm test`
Expected: all green.

**Step 6: Commit**

```bash
git add app/src/components/markets/actions/GroupTradePanel.tsx app/test/groupTradePanel.render.test.tsx
git commit -m "feat(app): GroupTradePanel's legend pills show cross-option normalized probability"
```

---

### Task 4: `CategoricalCard`'s outcome rows use normalized probabilities

**Files:**
- Modify: `app/src/components/markets/CategoricalCard.tsx`
- Modify: `app/test/marketQuestion.render.test.tsx` (has an existing
  `CategoricalCard question/labels` describe block)

**Step 1: Update the render test first**

In `app/test/marketQuestion.render.test.tsx`, add a new test in the
`describe('CategoricalCard question/labels', ...)` block (after the existing
"shows exactly ONE status" test):

```tsx
it('outcome-row probabilities are normalized across the group, not each raw independent price', () => {
  // summary(outcomeIndex, pubkey) always uses reserves { base: 6n, quote: 4n }
  // (60% raw) per the existing helper — override two entries' reserves so
  // there's something genuine to rescale.
  const rich = (outcomeIndex: number, pubkey: string, reserves: { base: bigint; quote: bigint }) => ({
    ...summary(outcomeIndex, pubkey),
    reserves,
  })
  const group = {
    oracle: ORACLE,
    optionsCount: 2,
    markets: [
      rich(0, 'Ma0', { base: 3_000_000n, quote: 7_000_000n }), // 70%
      rich(1, 'Ma1', { base: 6_000_000n, quote: 4_000_000n }), // 40%
    ],
  } as never
  const html = inRouter(<CategoricalCard group={group} meta={META} />)
  expect(html).toContain('64%') // 0.7 / 1.1 ≈ 0.636 → 64%
  expect(html).toContain('36%') // 0.4 / 1.1 ≈ 0.364 → 36%
  expect(html).not.toContain('70%')
  expect(html).not.toContain('40%')
})
```

Verify the exact rounded percentages against `formatProbability` yourself
before relying on them, same caveat as Task 3.

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/marketQuestion.render.test.tsx`
Expected: FAIL (shows each row's own raw 70%/40%)

**Step 3: Update `CategoricalCard.tsx`**

Add `normalizeAcrossGroup` to the existing import from
`../../market/lib/marketView`, then in the component body, right after
`const outcomes = group.markets.map(...)`, compute the normalized array:

```tsx
  const outcomes = group.markets.map((summary) =>
    outcomeRow(summary, meta?.options?.[summary.market.outcomeIndex]),
  );
  const normalizedProbabilities = normalizeAcrossGroup(outcomes.map((o) => o.probability));
```

Update the row render to index into it instead of reading `row.probability`
directly — since `outcomes.map((row) => ...)` doesn't currently carry an
index, switch to `outcomes.map((row, i) => ...)`:

```tsx
      <ul className="mt-1 flex max-h-64 flex-col divide-y divide-hairline/60 overflow-y-auto">
        {outcomes.map((row, i) => (
          <li key={row.pubkey}>
            <Link
              to={`/markets/${row.pubkey}`}
              className={`group flex items-center justify-between gap-3 rounded-sm py-2 ${focusRing}`}
            >
              <span className="flex items-center gap-2">
                <span className="font-inter text-[13px] text-platinum group-hover:text-coral">
                  {row.label}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="font-inter text-[13px] font-medium text-coral"
                  title="Adjusted so all options sum to 100% — this option's own trade price still depends on its own pool."
                >
                  {formatProbability(normalizedProbabilities[i])}
                </span>
                {overallStatus === MarketStatus.Active ? (
                  <span
                    aria-hidden="true"
                    className="font-inter text-[13px] text-coral transition-transform group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
```

(Everything else in the file — the funding CTA, status chip, TVL — is
unrelated and stays exactly as-is; only the row-probability line and the
`outcomes.map` callback signature change.)

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/marketQuestion.render.test.tsx`
Expected: PASS (all tests including the new one)

**Step 5: Run the full suite + typecheck + lint**

Run: `pnpm exec tsc -b && pnpm lint && pnpm test`
Expected: all green, no new lint warnings.

**Step 6: Commit**

```bash
git add app/src/components/markets/CategoricalCard.tsx app/test/marketQuestion.render.test.tsx
git commit -m "feat(app): CategoricalCard's outcome rows show cross-option normalized probability"
```

---

### Task 5: `PriceChart` — normalize the historical curves + live tick

**Files:**
- Modify: `app/src/components/markets/PriceChart.tsx`

This is the highest-risk task — imperative lightweight-charts wiring with no
canvas/DOM test environment (as established all session; the underlying
math is already fully unit-tested in Task 2, this task is purely about
correctly WIRING that tested function into `replot`/`rollForward` without
disturbing their existing, already-hardened behavior — the mount-crash fix,
the per-pubkey `Promise.allSettled` isolation, the "latest ref" stability
pattern). No new automated test; work carefully, verify with `tsc`/the full
suite staying green, then a manual browser pass (Task 6).

**Step 1: Read the current file in full first**

Read `app/src/components/markets/PriceChart.tsx` completely before editing —
it's gone through several review rounds this session and you need the exact
current structure, not a remembered version.

**Step 2: Import the new helper**

```tsx
import {
  buildWindowedGrid,
  gridBars,
  gridStep,
  invertGrid,
  MAX_POINTS,
  normalizeGridsAcrossGroup,
} from "./priceGrid";
```

Also import `normalizeAcrossGroup` from marketView for `rollForward`:

```tsx
import { normalizeAcrossGroup } from "../../market/lib/marketView";
```

**Step 3: Rewrite `replot`**

Replace the current `replot` callback body. The key change: build every
spec's PRE-invert grid (needed unchanged for the existing per-pubkey
`plottedStep`/`carriedClose` bookkeeping — this must keep reflecting the RAW
YES value per pubkey regardless of whether a given spec inverts it, exactly
as today) separately from its POST-invert "plotted" grid (what actually gets
normalized and pushed to the chart):

```tsx
  const replot = useCallback(
    (fit: boolean) => {
      const step = gridStep(windowSecs);
      const nowSec = Math.floor(Date.now() / 1000);
      const specs = seriesRef.current;

      // Each spec's grid BEFORE inversion (bookkeeping: plottedStep/carriedClose
      // are keyed per-PUBKEY and must always reflect the raw YES value,
      // regardless of whether THIS particular spec inverts it) and AFTER
      // inversion (what actually gets normalized across specs and plotted).
      const preInvertGrids: ReturnType<typeof buildWindowedGrid>[] = [];
      const plottedGrids = specs.map((spec) => {
        let st = pubkeyStateRef.current.get(spec.pubkey);
        if (!st) {
          st = { candles: [], plottedStep: 0, carriedClose: null };
          pubkeyStateRef.current.set(spec.pubkey, st);
        }
        const grid = buildWindowedGrid(st.candles, step, nowSec, gridBars(windowSecs));
        preInvertGrids.push(grid);
        return spec.invert ? invertGrid(grid) : grid;
      });

      // Normalize across specs PER TIME BUCKET — this is what makes buying
      // option 1 visibly pull option 2/3's curves down at the same moment,
      // instead of each option's raw (independent-pool) curve only ever
      // moving on its own trades.
      const normalizedGrids = normalizeGridsAcrossGroup(plottedGrids);

      let sawRealData = false;
      specs.forEach((spec, i) => {
        const grid = preInvertGrids[i];
        if (grid.some((p) => p.value !== undefined)) sawRealData = true;
        const st = pubkeyStateRef.current.get(spec.pubkey)!;
        const last = grid[grid.length - 1];
        st.plottedStep = last ? last.time : 0;
        st.carriedClose = last && last.value !== undefined ? last.value : null;

        const line = seriesRefs.current.get(spec.key);
        if (!line) return;
        line.setData(
          normalizedGrids[i].map((p) => ({ time: p.time as UTCTimestamp, value: p.value })) as Parameters<
            ISeriesApi<"Line">["setData"]
          >[0],
        );
      });

      if (fit && sawRealData) {
        chartRef.current?.timeScale().setVisibleRange({
          from: (nowSec - windowSecs) as UTCTimestamp,
          to: nowSec as UTCTimestamp,
        });
      }
    },
    [windowSecs],
  );
```

Note: `sawRealData`/the `setVisibleRange` P0-crash guard is computed from
`preInvertGrids` (the RAW grid), exactly as before normalization existed —
this is unaffected by this change, since normalizing a real value keeps it
real (never turns a real point into `undefined`, and vice versa only when
the raw was already `undefined`).

**Step 4: Rewrite `rollForward`**

The wall-clock tick pushes one new carried-forward point per elapsed step.
Since `carriedClose` doesn't change between actual data refreshes (it's a
flat carry-forward), the normalized value to push is constant across
however many buckets a tick catches up on — so normalize ONCE per
`rollForward()` call, from a snapshot of every spec's current (pre-tick)
value, then use that same normalized snapshot for every bucket the loop
advances through:

```tsx
  const rollForward = useCallback(() => {
    const step = gridStep(windowSecs);
    const nowStep = Math.floor(Date.now() / 1000 / step) * step;
    const specs = seriesRef.current;

    // Snapshot every spec's current plotted (post-invert) value, then
    // normalize ONCE across the whole group — this is what gets pushed for
    // every new bucket this tick catches up on, since carriedClose itself
    // doesn't change until the next real data refresh (replot).
    const rawBySpec = specs.map((spec) => {
      const st = pubkeyStateRef.current.get(spec.pubkey);
      if (!st || st.carriedClose === null) return null;
      return spec.invert ? 1 - st.carriedClose : st.carriedClose;
    });
    const normalizedBySpec = normalizeAcrossGroup(rawBySpec);

    for (const [pubkey, st] of pubkeyStateRef.current) {
      if (st.carriedClose === null) continue;
      let b = st.plottedStep;
      while (nowStep > b) {
        b += step;
        specs.forEach((spec, i) => {
          if (spec.pubkey !== pubkey) return;
          const value = normalizedBySpec[i];
          if (value === null) return;
          seriesRefs.current.get(spec.key)?.update({ time: b as UTCTimestamp, value });
        });
      }
      st.plottedStep = Math.max(st.plottedStep, b);
    }
  }, [windowSecs]);
```

**Step 5: Typecheck**

Run: `pnpm exec tsc -b`
Expected: no errors. Pay attention to the `preInvertGrids: ReturnType<typeof buildWindowedGrid>[]`
type annotation — `buildWindowedGrid` returns `GridPoint[]`, so this should
resolve cleanly, but if `tsc` complains, just use `GridPoint[][]` directly
(import `GridPoint` as a type from `./priceGrid`) instead of the
`ReturnType<...>` indirection.

**Step 6: Run the full suite**

Run: `pnpm test`
Expected: `Test Files 57 passed` (no new test files from this task — none
possible for the canvas-facing wiring itself, per this task's own framing) /
all existing tests still passing (in particular, no test directly imports
`replot`/`rollForward`, but confirm nothing that mocks `PriceChart` broke).

**Step 7: Commit**

```bash
git add app/src/components/markets/PriceChart.tsx
git commit -m "feat(app): PriceChart normalizes curves across siblings, per time bucket"
```

---

### Task 6: Manual browser verification

**No automated test possible** for the actual rendered chart behavior
(canvas/lightweight-charts, as established all session). Verify by eye:

```bash
cd /Users/dode/Documents/solana/kassandra/.worktrees/categorical-probability-normalization/app
pnpm dev
```

Or, for a fuller pass with real seeded on-chain data and a signing wallet
(the more thorough option, matching how prior chart-related bugs in this
plan's lineage — the P0 mount crash, the black-curve bug — were actually
caught): boot the local dev stack per `Makefile`'s `dev` target /
`app/e2e/README.md` (`WALLET=funded make dev`-equivalent), using distinct
`SURFPOOL_PORT`/`INDEXER_PORT`/`APP_PORT` env vars if another worktree's
stack is already running on this host (check `lsof -i :8899` first).

Check, on the already-seeded 3-way categorical group (the "proposal" oracle,
per `app/e2e/seed-market.ts`, per [[one-market-per-oracle-grouped-liquidity]]):

1. **Before any trade**: legend pills, chart curve endpoints, and the
   `/markets` list card's outcome rows all show the SAME normalized
   percentage for the same option at the same moment (cross-check all
   three surfaces side by side).
2. **Buy option 1's YES**: confirm option 1's curve/pill/list-row number
   goes UP, and — this is the actual point of the whole feature — option
   2's and option 3's curves/pills/list-row numbers visibly go DOWN at the
   SAME moment, even though their own underlying AMM pools received zero
   trade activity. Confirm the three all sum to ~100% (allowing normal
   rounding) both before and after the trade.
3. **Historical curve shape**: switch to a wider window (e.g. 1H or 1D) if
   there's enough history, and confirm the PAST portion of the curves also
   reflects normalization (not just the live edge) — i.e. the whole
   trajectory is anti-correlated, not just the newest point.
4. **A binary (non-categorical) market**: confirm nothing changed —
   YES/NO still sum to exactly 100% as before (this is the built-in no-op
   case; verify it's still visually indistinguishable from before this
   plan).
5. **Tooltip**: hover a normalized percentage (legend pill or list-card row)
   and confirm the explanatory `title` text appears.
6. **Console**: no new errors at any step (`console --errors`-equivalent).

If anything looks wrong, fix it in this worktree and re-run
`pnpm exec tsc -b && pnpm test` before moving on — do not commit broken
visual state.

---

### Task 7: Final full-suite pass + wrap-up

**Step 1: Full verification**

```bash
cd /Users/dode/Documents/solana/kassandra/.worktrees/categorical-probability-normalization/app
pnpm exec tsc -b && pnpm lint && pnpm test
```

Expected: all green.

**Step 2: Review the diff against the design doc**

```bash
cd /Users/dode/Documents/solana/kassandra/.worktrees/categorical-probability-normalization
git log --oneline master..feat/categorical-probability-normalization
git diff master...feat/categorical-probability-normalization --stat
```

Confirm every bullet in
`docs/plans/2026-07-21-categorical-probability-normalization-design.md` is
reflected: the core helper + its grid-level wrapper, both live call sites
(legend pills, list card rows), the chart's historical + live-tick
normalization, and that trade math (buy/sell instruction building, price
preview, slippage) was NOT touched anywhere in the diff — `git diff` should
show zero changes to `app/src/market/data/actions/**` or `TradePanel.tsx`'s
own buy/sell math.

**Step 3: Hand off**

Use superpowers:finishing-a-development-branch to decide how to integrate
this branch once Task 6's manual check is clean.
