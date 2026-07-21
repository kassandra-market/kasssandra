# Categorical Odds-Space Normalization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the categorical trading view so a heavily-bought option's displayed probability actually approaches 100%, instead of plateauing at `1 / (1 + 0.5*(N-1))` as today's linear `normalizeAcrossGroup` does.

**Architecture:** Add a new `normalizeOddsAcrossGroup` function that normalizes in odds-space (`p/(1-p)`) instead of raw-probability-space, so one option's odds going to infinity correctly dominates the sum. Wire it into the three categorical display call sites (`CategoricalCard`, `GroupTradePanel`'s legend, `PriceChart`'s chart curves), while every true binary YES/NO pair keeps using the existing (correct, no-op) linear `normalizeAcrossGroup`.

**Tech Stack:** TypeScript, React, Vitest (`renderToStaticMarkup` for headless render tests), the existing `app/` workspace inside `.worktrees/fix-categorical-odds-normalization`.

**Design doc:** `docs/plans/2026-07-21-categorical-odds-normalization-design.md`

---

All commands below assume `cd app` inside the worktree at
`/Users/dode/Documents/solana/kassandra/.worktrees/fix-categorical-odds-normalization`.

### Task 1: `normalizeOddsAcrossGroup` core function

**Files:**
- Modify: `app/src/market/lib/marketView.ts` (add the new function right after `normalizeAcrossGroup`, currently ending around line 346)
- Test: `app/test/marketView.unit.test.ts`

**Step 1: Write the failing tests**

Add this import to the existing `import { ... } from "../src/market/lib/marketView"` block (find the line with `normalizeAcrossGroup,` around line 21) — add `normalizeOddsAcrossGroup,` next to it.

Add this new `describe` block right after the existing `normalizeAcrossGroup` describe block (after line 293):

```ts
describe('normalizeOddsAcrossGroup — odds-space rescale so a heavily-bought option approaches 100%', () => {
  it('the regression case: one option pushed to near-certainty dominates regardless of untouched siblings', () => {
    // 3 pools at a fresh 50/50 baseline; option 0 gets bought all the way to
    // 0.99 raw. The OLD linear normalizeAcrossGroup caps this at ~50% (limit
    // is 1/(1+0.5*(N-1))) no matter how much more is bought — this is the bug.
    const result = normalizeOddsAcrossGroup([0.99, 0.5, 0.5])
    expect(result[0]!).toBeGreaterThan(0.9)
    expect(result[1]!).toBeLessThan(0.1)
    expect(result[2]!).toBeLessThan(0.1)
    expect(result[0]! + result[1]! + result[2]!).toBeCloseTo(1)
  })

  it('uniform baseline (all pools at 0.5) → each option gets exactly 1/N', () => {
    const result = normalizeOddsAcrossGroup([0.5, 0.5, 0.5])
    expect(result[0]!).toBeCloseTo(1 / 3)
    expect(result[1]!).toBeCloseTo(1 / 3)
    expect(result[2]!).toBeCloseTo(1 / 3)
  })

  it('a null entry (no data yet) stays null and is excluded from the odds sum', () => {
    const result = normalizeOddsAcrossGroup([0.9, null, 0.5])
    expect(result[1]).toBeNull()
    expect(result[0]!).toBeGreaterThan(result[2]!)
  })

  it('zero-sum fallback: every value is 0 → returned unchanged, no divide-by-zero/NaN', () => {
    const result = normalizeOddsAcrossGroup([0, 0, 0])
    expect(result).toEqual([0, 0, 0])
  })

  it('exact p=1 (fully drained pool): the winner gets 1, everyone else gets 0', () => {
    const result = normalizeOddsAcrossGroup([1, 0.5, 0.3])
    expect(result).toEqual([1, 0, 0])
  })

  it('two simultaneous p=1 winners split certainty evenly, rest get 0', () => {
    const result = normalizeOddsAcrossGroup([1, 1, 0.5])
    expect(result).toEqual([0.5, 0.5, 0])
  })

  it('a single non-null value among otherwise-null siblings passes through unchanged', () => {
    expect(normalizeOddsAcrossGroup([0.55, null, null])).toEqual([0.55, null, null])
  })

  it('a lone value with no nulls at all (singleton array) is also a no-op', () => {
    expect(normalizeOddsAcrossGroup([0.42])).toEqual([0.42])
  })

  it('all null → all null', () => {
    expect(normalizeOddsAcrossGroup([null, null])).toEqual([null, null])
  })

  it('empty input → empty output', () => {
    expect(normalizeOddsAcrossGroup([])).toEqual([])
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test marketView.unit -- -t "normalizeOddsAcrossGroup"`
Expected: FAIL — `normalizeOddsAcrossGroup is not a function` (or import error), since it doesn't exist yet.

**Step 3: Write the minimal implementation**

In `app/src/market/lib/marketView.ts`, right after the closing brace of `normalizeAcrossGroup` (after line 346), add:

```ts
/**
 * Rescale a set of independently-priced probabilities in ODDS space
 * (`p/(1-p)`) rather than raw-probability space, so one option's odds going
 * to infinity (heavy buying pushing its own pool toward p=1) correctly
 * drives its normalized share toward 1 regardless of untouched siblings'
 * finite odds — unlike {@link normalizeAcrossGroup}'s linear
 * `value / sum`, which caps well below 100% because untouched siblings'
 * raw values never shrink on their own.
 *
 * Since `p = quote/(base+quote)`, `p/(1-p)` simplifies to `quote/base` — each
 * pool's own reserve ratio — so this needs no new data, only a different
 * combination of the same raw probabilities `normalizeAcrossGroup` takes.
 *
 * ONLY for genuinely independent categorical pools (N ≥ 2 separate AMM
 * pools). A true binary YES/NO pair (same pool, NO ≡ 1-YES by construction)
 * must keep using the linear {@link normalizeAcrossGroup}, which is a
 * correct no-op there — this odds-space version is NOT a no-op for an
 * already-complementary pair and would wrongly distort it.
 *
 * `null` stays `null`, degenerate all-zero input returns unchanged, and
 * fewer than two non-null values is a no-op — all identical to
 * {@link normalizeAcrossGroup}'s edge-case handling.
 *
 * A pool fully drained to exactly `p=1` has infinite odds; rather than
 * `Infinity/Infinity → NaN`, certainty is split evenly among however many
 * options are simultaneously at `p=1`, and every other option gets `0` —
 * the correct limiting behavior.
 */
export function normalizeOddsAcrossGroup(values: (number | null)[]): (number | null)[] {
  const nonNullCount = values.reduce<number>((count, v) => count + (v === null ? 0 : 1), 0);
  if (nonNullCount < 2) return values;

  const odds = values.map((v) => (v === null ? null : v >= 1 ? Infinity : v / (1 - v)));
  const infiniteCount = odds.reduce<number>((count, o) => count + (o === Infinity ? 1 : 0), 0);
  if (infiniteCount > 0) {
    return odds.map((o) => (o === null ? null : o === Infinity ? 1 / infiniteCount : 0));
  }

  const sum = odds.reduce<number>((acc, o) => acc + (o ?? 0), 0);
  if (sum <= 0) return values;
  return odds.map((o) => (o === null ? null : o / sum));
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test marketView.unit`
Expected: PASS — all tests in the file, including the new describe block.

**Step 5: Commit**

```bash
git add src/market/lib/marketView.ts test/marketView.unit.test.ts
git commit -m "feat(app): add normalizeOddsAcrossGroup for asymptotically-correct categorical display"
```

---

### Task 2: Wire `CategoricalCard` to odds-space normalization

**Files:**
- Modify: `app/src/components/markets/CategoricalCard.tsx:27` (import) and `:78` (call)
- Test: `app/test/categoricalCardCta.render.test.tsx`

**Step 1: Write the failing test**

Add a new `describe` block to the end of `test/categoricalCardCta.render.test.tsx` (this file already has the `market()`/`render()` fixture helpers you need — reuse them as-is):

```ts
describe("CategoricalCard — outcome probability rows (odds-normalized)", () => {
  it("buying one outcome heavily drives its row toward 100%, not a sub-50% plateau", () => {
    const html = render([
      market(0, MarketStatus.Active, 500_000_000_000n), // reserves set below
      market(1, MarketStatus.Active, 500_000_000_000n),
      market(2, MarketStatus.Active, 500_000_000_000n),
    ].map((m, i) => ({
      ...m,
      reserves: i === 0 ? { base: 1n, quote: 99n } : { base: 6n, quote: 4n },
    })) as unknown as OracleGroup["markets"]);
    // Old linear normalizeAcrossGroup would cap outcome 0 well below 100%
    // (siblings' raw 0.4 never shrinks). Odds-space must push it near 100%.
    expect(html).toContain(">99%<");
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm test categoricalCardCta.render -- -t "odds-normalized"`
Expected: FAIL — the rendered percentage is capped well below 99% (still using `normalizeAcrossGroup`).

**Step 3: Write the minimal implementation**

In `app/src/components/markets/CategoricalCard.tsx`:
- Line 27: change `normalizeAcrossGroup,` to `normalizeOddsAcrossGroup,` in the import block.
- Line 78: change the call to:
  ```ts
  const normalizedProbabilities = normalizeOddsAcrossGroup(outcomes.map((o) => o.probability));
  ```

**Step 4: Run the test to verify it passes**

Run: `pnpm test categoricalCardCta.render`
Expected: PASS — all tests in the file, including the new one.

**Step 5: Commit**

```bash
git add src/components/markets/CategoricalCard.tsx test/categoricalCardCta.render.test.tsx
git commit -m "fix(app): CategoricalCard outcome rows use odds-space normalization"
```

---

### Task 3: `normalizeGridsAcrossGroup` gets an `oddsSpace` option

**Files:**
- Modify: `app/src/components/markets/priceGrid.ts:132-148`
- Test: `app/test/priceGrid.unit.test.ts`

**Step 1: Write the failing test**

Find the existing `describe("normalizeGridsAcrossGroup", ...)` block (around line 160) in `test/priceGrid.unit.test.ts` and add this test inside it (reuse whatever grid-fixture helper the existing tests in that block already use — check the file for a `gp`/`point`-style helper before writing raw `GridPoint` objects by hand):

```ts
it("oddsSpace: true normalizes in odds-space so a heavily-bought bucket approaches 1, not a linear-capped plateau", () => {
  const gridA = [{ time: 0, value: 0.99 }, { time: 1, value: 0.99 }];
  const gridB = [{ time: 0, value: 0.5 }, { time: 1, value: 0.5 }];
  const gridC = [{ time: 0, value: 0.5 }, { time: 1, value: 0.5 }];
  const [normA] = normalizeGridsAcrossGroup([gridA, gridB, gridC], true);
  expect(normA[0].value!).toBeGreaterThan(0.9);
  expect(normA[1].value!).toBeGreaterThan(0.9);
});

it("oddsSpace: false (default) keeps today's linear behavior — unchanged from existing tests above", () => {
  const gridA = [{ time: 0, value: 0.99 }];
  const gridB = [{ time: 0, value: 0.5 }];
  const [normA] = normalizeGridsAcrossGroup([gridA, gridB]);
  expect(normA[0].value!).toBeLessThan(0.7); // linear cap, not near 1
});
```

Adjust the literal `{ time, value }` shape to match whatever `GridPoint` fixture style the rest of that test file already uses (check the top of the `describe` block for existing grid literals before assuming this exact shape).

**Step 2: Run the test to verify it fails**

Run: `pnpm test priceGrid.unit -- -t "oddsSpace"`
Expected: FAIL — `normalizeGridsAcrossGroup` doesn't accept a second argument yet, so the `true` case behaves identically to (and fails the assertions of) the linear case.

**Step 3: Write the minimal implementation**

In `app/src/components/markets/priceGrid.ts`, update the import (near the top, wherever `normalizeAcrossGroup` is imported from `../../market/lib/marketView`) to also import `normalizeOddsAcrossGroup`. Then change the function signature and body:

```ts
export function normalizeGridsAcrossGroup(grids: GridPoint[][], oddsSpace = false): GridPoint[][] {
  const axisLength = grids.reduce((max, g) => Math.max(max, g.length), 0);
  if (axisLength === 0) return grids;
  const axisGrid = grids.find((g) => g.length === axisLength)!;
  const out: GridPoint[][] = grids.map(() => []);
  const normalizeFn = oddsSpace ? normalizeOddsAcrossGroup : normalizeAcrossGroup;
  for (let i = 0; i < axisLength; i++) {
    const time = axisGrid[i].time;
    const raw = grids.map((g) => (g.length === axisLength ? (g[i].value ?? null) : null));
    const realCount = raw.filter((v) => v !== null).length;
    const normalized = realCount >= 2 ? normalizeFn(raw) : raw;
    grids.forEach((g, j) => {
      if (g.length !== axisLength) return;
      out[j].push({ time, value: normalized[j] ?? undefined });
    });
  }
  return out;
}
```

**Step 4: Run the test to verify it passes**

Run: `pnpm test priceGrid.unit`
Expected: PASS — all tests in the file.

**Step 5: Commit**

```bash
git add src/components/markets/priceGrid.ts test/priceGrid.unit.test.ts
git commit -m "feat(app): normalizeGridsAcrossGroup takes an oddsSpace option"
```

---

### Task 4: Wire `GroupTradePanel`'s legend + `PriceChart` prop threading

**Files:**
- Modify: `app/src/components/markets/actions/GroupTradePanel.tsx:5,108,134`
- Modify: `app/src/components/markets/PriceChart.tsx:13,111-118,171,230`
- Test: `app/test/groupTradePanel.render.test.tsx`

**Step 1: Write the failing test**

`PriceChart` is mocked in `test/groupTradePanel.render.test.tsx` (see the `vi.mock("../src/components/markets/PriceChart", ...)` block near the top). Update that mock to also surface the new `isGroup` prop, then assert on it. Change the mock to:

```ts
vi.mock("../src/components/markets/PriceChart", () => ({
  PriceChart: ({ series, isGroup }: { series: { key: string; label: string; color: string }[]; isGroup: boolean }) => (
    <div data-testid="price-chart" data-is-group={isGroup ? "true" : "false"}>
      {series.map((s) => (
        <span key={s.key} data-testid="chart-series" data-color={s.color}>
          {s.label}
        </span>
      ))}
    </div>
  ),
}));
```

Then add these two tests to the `describe("GroupTradePanel", ...)` block:

```ts
it("a lone Active market (isGroup: false) passes isGroup=false through to PriceChart", () => {
  const d = detail("MarketA", 0, MarketStatus.Active, R);
  const html = render({ detail: d, group: group([]), options: [], refetch: () => {} });
  expect(html).toContain('data-is-group="false"');
});

it("a real categorical group (isGroup: true) passes isGroup=true through to PriceChart", () => {
  const d = detail("MarketA", 0, MarketStatus.Active, R);
  const siblings = [summary(1, MarketStatus.Active, R2)];
  const html = render({ detail: d, group: group(siblings), options: [], refetch: () => {} });
  expect(html).toContain('data-is-group="true"');
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm test groupTradePanel.render -- -t "isGroup"`
Expected: FAIL — `isGroup` is `undefined` in the mock (renders `data-is-group="false"` for both, since `GroupTradePanel` never passes the prop yet), so the second new test fails.

**Step 3: Write the minimal implementation**

In `app/src/components/markets/PriceChart.tsx`:
- Line 13: add `normalizeOddsAcrossGroup` to the import from `../../market/lib/marketView`.
- Lines 111-118: add `isGroup` to the props type:
  ```ts
  export function PriceChart({
    series,
    isGroup,
    refreshKey,
  }: {
    series: ChartSeriesSpec[];
    isGroup: boolean;
    refreshKey?: string | number;
  }) {
  ```
- Line 171 (inside `replot`): change to branch on `isGroup`:
  ```ts
  const normalizedGrids = normalizeGridsAcrossGroup(invertedGrids, isGroup);
  ```
- Line 230 (inside `rollForward`): change to branch on `isGroup`:
  ```ts
  const normalizedBySpec = isGroup ? normalizeOddsAcrossGroup(rawBySpec) : normalizeAcrossGroup(rawBySpec);
  ```
  Note `isGroup` is a prop, not a ref — `rollForward`'s `useCallback` dependency array (currently `[windowSecs]`) must add `isGroup` too, so a group-status change doesn't get stale-closed-over. Same check for `replot`'s dependency array.

In `app/src/components/markets/actions/GroupTradePanel.tsx`:
- Line 5: change `normalizeAcrossGroup` to also keep as-is (still used for the binary branch) but add `normalizeOddsAcrossGroup` to the same import.
- Line 108: branch on `group.isGroup`:
  ```ts
  const normalizedProbabilities = group.isGroup
    ? normalizeOddsAcrossGroup(beliefs.map((b) => beliefProbability(b)))
    : normalizeAcrossGroup(beliefs.map((b) => beliefProbability(b)));
  ```
- Line 134: pass the new prop:
  ```tsx
  <PriceChart series={series} isGroup={group.isGroup} refreshKey={chartRefreshKey} />
  ```

**Step 4: Run the test to verify it passes**

Run: `pnpm test groupTradePanel.render`
Expected: PASS — all tests in the file.

**Step 5: Run the FULL test suite** (this task touches the most shared code — confirm nothing else regressed)

Run: `pnpm test`
Expected: PASS — same 61 test files / 506+ tests as the clean baseline (plus the new tests added in Tasks 1-4), 0 failures.

**Step 6: Commit**

```bash
git add src/components/markets/PriceChart.tsx src/components/markets/actions/GroupTradePanel.tsx test/groupTradePanel.render.test.tsx
git commit -m "fix(app): GroupTradePanel legend and PriceChart curves use odds-space normalization for real categorical groups"
```

---

### Task 5: Typecheck + manual browser verification

**Files:** none (verification only)

**Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (confirms the new `isGroup: boolean` required prop is passed everywhere `PriceChart` is used — there is exactly one call site, in `GroupTradePanel.tsx`).

**Step 2: Manual browser pass**

Per the design doc, `PriceChart` has no automated coverage for its canvas rendering. Start the dev server (`pnpm dev` from `app/`), open a categorical market with 3+ outcomes, and:
1. Buy heavily into one outcome.
2. Confirm its legend pill / card row percentage climbs toward (not plateaus below) 100%.
3. Confirm the chart curve for that outcome visibly approaches the top of the 0–100% axis, and siblings' curves sink toward the bottom, rather than the whole group's curves plateauing mid-chart.
4. Confirm a plain binary (non-categorical) market's YES/NO pill/chart is visually unchanged from before this fix (still sums to 100%, moves as expected).

This step has no commit — it's a verification checkpoint before considering the branch done. If it reveals a problem, return to the relevant task above rather than patching ad hoc.
