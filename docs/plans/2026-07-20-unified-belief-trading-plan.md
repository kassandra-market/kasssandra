# Unified Belief Trading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the categorical group's clickable outcome-pill row + per-market
YES/NO chart with one "belief" concept — a chart that plots each belief's own
YES curve (never NO) behind a non-interactive legend, and a single dropdown in
the order ticket that picks which belief to buy or sell.

**Architecture:** A new pure-data layer (`src/market/lib/beliefs.ts`) turns a
market/group into a flat list of `Belief` — one per categorical option (always
its YES side), or two for a lone binary market (its YES and NO side, since
there's no sibling market to express the complementary bet). `GroupTradePanel`
computes that list once and owns the chart + legend (which no longer depend on
"what's selected to trade"); `TradePanel` owns belief *selection* via a native
`<select>` and no longer renders its own chart.

**Tech Stack:** React 19, TypeScript, Vite, vitest (SSR-only render tests via
`react-dom/server`, no jsdom — every render test asserts on static markup, not
simulated interaction), lightweight-charts.

**Design doc:** `docs/plans/2026-07-20-unified-belief-trading-design.md`

---

## Before you start

This plan was written against `feature/unified-belief-trading`, branched from
`master` at commit `bb29cdc`. Work in
`/Users/dode/Documents/solana/kassandra/.worktrees/unified-belief-trading` (a
git worktree — already has its own `node_modules`, and the workspace SDK
packages `@kassandra-market/{oracles,markets}` are already built). All
commands below assume `cd app` first unless stated otherwise.

Baseline check before Task 1:

```bash
cd /Users/dode/Documents/solana/kassandra/.worktrees/unified-belief-trading/app
pnpm test 2>&1 | tail -5
```

Expected: `Test Files  52 passed (52)` / `Tests  390 passed (390)`.

---

### Task 1: The `Belief` model

**Files:**
- Create: `app/src/market/lib/beliefs.ts`
- Test: `app/test/beliefs.unit.test.ts`

A belief is `{ key, pubkey, market, reserves, outcome, label }` — the distinct
thing a user can bet on. `computeBeliefs` derives the list from a categorical
group's tradable outcomes (real group → one belief per outcome, always YES) or
a lone binary market (not a group → two beliefs on the same market: YES and
NO). `defaultBeliefKey` picks the initial selection: the current page's own
market's YES belief when it's itself tradable, else the first belief in the
list — this mirrors the default logic `GroupTradePanel` already has today
(`app/src/components/markets/actions/GroupTradePanel.tsx:86-92`), just
reframed onto beliefs instead of markets.

**Step 1: Write the failing test**

```typescript
// app/test/beliefs.unit.test.ts
import { describe, expect, it } from "vitest";
import { MarketStatus } from "@kassandra-market/markets";
import {
  beliefKey,
  beliefProbability,
  computeBeliefs,
  defaultBeliefKey,
} from "../src/market/lib/beliefs";
import type { MarketSummary } from "../src/market/data/markets";

function summary(outcomeIndex: number, reserves: { base: bigint; quote: bigint } | null): MarketSummary {
  return {
    pubkey: `Market${outcomeIndex}`,
    market: { outcomeIndex, status: MarketStatus.Active } as never,
    reserves: reserves as never,
    oracleOptionsCount: null,
  };
}

const R = { base: 4_000_000n, quote: 6_000_000n }; // YES = 60%

describe("computeBeliefs", () => {
  it("a real categorical group: one belief per tradable outcome, always YES, labelled from options", () => {
    const tradable = [summary(0, R), summary(1, R), summary(2, R)];
    const beliefs = computeBeliefs({ isGroup: true, tradable, options: ["Zero", "One", "Two"] });
    expect(beliefs).toHaveLength(3);
    expect(beliefs.map((b) => b.outcome)).toEqual(["yes", "yes", "yes"]);
    expect(beliefs.map((b) => b.label)).toEqual(["Zero", "One", "Two"]);
    expect(beliefs.map((b) => b.key)).toEqual(["Market0:yes", "Market1:yes", "Market2:yes"]);
  });

  it("a categorical group with an unlabelled outcome falls back to 'Outcome N'", () => {
    const beliefs = computeBeliefs({ isGroup: true, tradable: [summary(0, R)], options: [] });
    expect(beliefs[0].label).toBe("Outcome 0");
  });

  it("a lone binary market: two beliefs on the SAME market, YES and NO, labelled from the pair of options", () => {
    const beliefs = computeBeliefs({ isGroup: false, tradable: [summary(0, R)], options: ["Yes team", "No team"] });
    expect(beliefs).toHaveLength(2);
    expect(beliefs[0]).toMatchObject({ pubkey: "Market0", outcome: "yes", label: "Yes team" });
    expect(beliefs[1]).toMatchObject({ pubkey: "Market0", outcome: "no", label: "No team" });
    expect(beliefs[0].key).not.toBe(beliefs[1].key);
  });

  it("a lone binary market with no option labels falls back to 'Yes'/'No'", () => {
    const beliefs = computeBeliefs({ isGroup: false, tradable: [summary(0, R)], options: [] });
    expect(beliefs.map((b) => b.label)).toEqual(["Yes", "No"]);
  });

  it("no tradable market at all → no beliefs", () => {
    expect(computeBeliefs({ isGroup: false, tradable: [], options: [] })).toEqual([]);
    expect(computeBeliefs({ isGroup: true, tradable: [], options: [] })).toEqual([]);
  });
});

describe("beliefProbability", () => {
  it("YES belief reads the reserves' implied YES probability directly", () => {
    expect(beliefProbability({ reserves: R, outcome: "yes" })).toBeCloseTo(0.6);
  });

  it("NO belief is the complement", () => {
    expect(beliefProbability({ reserves: R, outcome: "no" })).toBeCloseTo(0.4);
  });

  it("no reserves → null", () => {
    expect(beliefProbability({ reserves: null, outcome: "yes" })).toBeNull();
  });
});

describe("defaultBeliefKey", () => {
  const beliefs = computeBeliefs({ isGroup: true, tradable: [summary(0, R), summary(1, R)], options: ["Zero", "One"] });

  it("prefers the current market's YES belief when it's itself tradable", () => {
    expect(defaultBeliefKey(beliefs, "Market1", true)).toBe(beliefKey("Market1", "yes"));
  });

  it("falls back to the first belief when the current market isn't tradable", () => {
    expect(defaultBeliefKey(beliefs, "Market1", false)).toBe(beliefKey("Market0", "yes"));
  });

  it("null when there are no beliefs at all", () => {
    expect(defaultBeliefKey([], "Market1", true)).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/beliefs.unit.test.ts`
Expected: FAIL — `Cannot find module '../src/market/lib/beliefs'`

**Step 3: Write the implementation**

```typescript
// app/src/market/lib/beliefs.ts
/**
 * A "belief" is the distinct thing a user can bet on for an oracle — the unit
 * both the price chart and the order ticket's selector are built from. A real
 * categorical group has one belief per tradable outcome (always its YES side —
 * betting against option A means picking a different belief, not buying A's
 * NO, since "not A" isn't a single well-defined bet once there are 3+ options).
 * A lone binary market has exactly two beliefs on the SAME market (YES and
 * NO), since there's no sibling market to express the complementary bet.
 */
import type { Market } from "@kassandra-market/markets";
import type { AmmReserves, MarketSummary } from "../data/markets";
import type { Outcome } from "../data/actions";
import { impliedYesProbability, outcomeLabel } from "./marketView";

export interface Belief {
  /** Stable identity for selection state — `${pubkey}:${outcome}`. */
  key: string;
  pubkey: string;
  market: Market;
  reserves: AmmReserves | null;
  outcome: Outcome;
  /** Display label — an oracle-meta option name, or a generic fallback. */
  label: string;
}

export function beliefKey(pubkey: string, outcome: Outcome): string {
  return `${pubkey}:${outcome}`;
}

/** The belief's own implied probability — the reserves' YES probability, or
 *  its complement for a NO belief. */
export function beliefProbability(belief: Pick<Belief, "reserves" | "outcome">): number | null {
  const p = impliedYesProbability(belief.reserves);
  if (p === null) return null;
  return belief.outcome === "yes" ? p : 1 - p;
}

/**
 * The full set of beliefs for this market/group.
 *  - A real categorical group (`isGroup`) → one belief per entry in `tradable`,
 *    always YES, labelled from `options[outcomeIndex]`.
 *  - A lone binary market (`!isGroup`) → two beliefs on `tradable[0]`, YES and
 *    NO, labelled from `options[0]`/`options[1]` when the oracle names both
 *    sides, else the generic "Yes"/"No".
 *  - No tradable market → `[]`.
 */
export function computeBeliefs(args: {
  isGroup: boolean;
  tradable: MarketSummary[];
  options: string[];
}): Belief[] {
  const { isGroup, tradable, options } = args;
  if (isGroup) {
    return tradable.map((m) => ({
      key: beliefKey(m.pubkey, "yes"),
      pubkey: m.pubkey,
      market: m.market,
      reserves: m.reserves,
      outcome: "yes" as const,
      label: outcomeLabel(m.market.outcomeIndex, options[m.market.outcomeIndex]),
    }));
  }
  const lone = tradable[0];
  if (!lone) return [];
  const yesLabel = options[0]?.trim() || "Yes";
  const noLabel = options[1]?.trim() || "No";
  return [
    {
      key: beliefKey(lone.pubkey, "yes"),
      pubkey: lone.pubkey,
      market: lone.market,
      reserves: lone.reserves,
      outcome: "yes",
      label: yesLabel,
    },
    {
      key: beliefKey(lone.pubkey, "no"),
      pubkey: lone.pubkey,
      market: lone.market,
      reserves: lone.reserves,
      outcome: "no",
      label: noLabel,
    },
  ];
}

/** Default selection: the CURRENT market's YES belief when it's itself
 *  tradable, else the first belief in the list; `null` when there are none. */
export function defaultBeliefKey(
  beliefs: Belief[],
  currentPubkey: string,
  currentIsActive: boolean,
): string | null {
  if (currentIsActive) {
    const own = beliefs.find((b) => b.pubkey === currentPubkey && b.outcome === "yes");
    if (own) return own.key;
  }
  return beliefs[0]?.key ?? null;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/beliefs.unit.test.ts`
Expected: PASS (13 tests)

**Step 5: Commit**

```bash
git add app/src/market/lib/beliefs.ts app/test/beliefs.unit.test.ts
git commit -m "feat(app): add the belief data model for unified trading"
```

---

### Task 2: `invertGrid` chart-grid helper

**Files:**
- Modify: `app/src/components/markets/priceGrid.ts`
- Test: `app/test/priceGrid.unit.test.ts` (existing file — add a `describe` block)

A binary market's NO belief plots as `1 - YES` of the *same* candle series —
no second indexer fetch. `invertGrid` does that transform on an already-built
`GridPoint[]`, preserving `undefined` (whitespace) points untouched.

**Step 1: Write the failing test**

Read the existing file first to match its import/style conventions, then
append:

```typescript
// appended to app/test/priceGrid.unit.test.ts
import { invertGrid } from "../src/components/markets/priceGrid";

describe("invertGrid", () => {
  it("complements every real value, leaving time untouched", () => {
    const grid = [
      { time: 100, value: 0.3 },
      { time: 101, value: 0.75 },
    ];
    expect(invertGrid(grid)).toEqual([
      { time: 100, value: 0.7 },
      { time: 101, value: 0.25 },
    ]);
  });

  it("leaves whitespace points (no value) as whitespace", () => {
    expect(invertGrid([{ time: 100 }])).toEqual([{ time: 100, value: undefined }]);
  });

  it("empty in, empty out", () => {
    expect(invertGrid([])).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/priceGrid.unit.test.ts`
Expected: FAIL — `invertGrid is not exported`

**Step 3: Write the implementation**

Append to `app/src/components/markets/priceGrid.ts`:

```typescript
/** Complement every real value in a grid (`v → 1 - v`), leaving whitespace
 *  points (`value === undefined`) and `time` untouched. Used to derive a
 *  binary market's NO curve from its YES candles client-side, with no second
 *  indexer fetch. */
export function invertGrid(grid: GridPoint[]): GridPoint[] {
  return grid.map((p) => ({ time: p.time, value: p.value === undefined ? undefined : 1 - p.value }));
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/priceGrid.unit.test.ts`
Expected: PASS (existing tests + 3 new)

**Step 5: Commit**

```bash
git add app/src/components/markets/priceGrid.ts app/test/priceGrid.unit.test.ts
git commit -m "feat(app): add invertGrid for deriving a NO curve from YES candles"
```

---

### Task 3: `PriceChart` — one curve per belief

**Files:**
- Modify: `app/src/components/markets/PriceChart.tsx`
- Modify (temporary call-site, keeps everything green): `app/src/components/markets/actions/TradePanel.tsx`

This is the highest-risk task in the plan: `PriceChart` is imperative
lightweight-charts wiring with no existing test (rendering a real chart needs
a canvas the current vitest config doesn't provide — `pnpm test` has no
`PriceChart` coverage today either). There's no TDD step here; instead, work
in small verifiable increments and lean on `pnpm exec tsc -b` + the full
suite staying green, then verify by eye in the browser at the end of Task 4
once it's wired into a real page.

**Step 1: Replace the single-`pubkey` API with a `series` array**

Rewrite `app/src/components/markets/PriceChart.tsx`. Key changes from today's
version (`app/src/components/markets/PriceChart.tsx:88-341`):

- New exported type: `ChartSeriesSpec = { key: string; pubkey: string; label: string; color: string; invert?: boolean }`.
- Props become `{ series: ChartSeriesSpec[]; refreshKey?: string | number }` (drop the single `pubkey`).
- Internal refs move from one YES/NO pair to maps:
  - `seriesRefs: Map<string, ISeriesApi<"Line">>` keyed by `spec.key` (the line objects).
  - `candlesRef`, `plottedStepRef`, `carriedCloseRef`: `Map<string, ...>` keyed by **pubkey** (so a binary market's YES and NO specs, which share a pubkey, fetch candles exactly once and both derive from the same cached series).
- A new effect (re-)creates line series whenever the *set* of spec keys
  changes (dependency: `series.map(s => s.key).join(",")`), tearing down all
  existing line series and creating fresh ones from `series` — simplest
  correct option since belief lists change rarely (a sibling activating),
  not on every render.
- The load effect fetches candles once per **unique pubkey** among `series`
  (`Promise.all`), then calls `replot`.
- `replot` iterates `series`; for each spec, looks up its pubkey's cached
  candles, builds the grid via `buildWindowedGrid` (unchanged), applies
  `invertGrid` when `spec.invert`, and calls `.setData` on that spec's line
  series. `plottedStepRef`/`carriedCloseRef` are still tracked once per
  **pubkey** (from the non-inverted grid) — an inverted spec derives its
  carried value from the same pubkey entry at roll-forward time.
- `rollForward` iterates unique pubkeys, computes the carried-forward point
  once per pubkey, then updates every spec referencing that pubkey (inverting
  the value for `invert` specs).
- `empty` is true when every unique pubkey's candles came back empty.
- Drop the internal YES/NO color-dot legend row (today's
  `PriceChart.tsx:279-290`) — `GroupTradePanel` now renders a richer,
  live-price legend above the chart (Task 4), so keeping both would show two
  conflicting legends. Keep the "Share price · history" label and the window
  selector.

Full replacement file:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  LineType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useIndexer, type CandleDto } from "../../market/lib/indexer";
import { buildWindowedGrid, gridBars, gridStep, invertGrid, MAX_POINTS } from "./priceGrid";

/** One plotted curve: which market to fetch, how to label/color it, and
 *  whether it's a binary market's NO side (plotted as `1 - YES` of the same
 *  candles, client-side — no separate fetch). */
export interface ChartSeriesSpec {
  /** Stable identity — a belief's `key` (`${pubkey}:${outcome}`). */
  key: string;
  pubkey: string;
  label: string;
  color: string;
  invert?: boolean;
}

const WINDOWS = [
  { label: "1m", secs: 60 },
  { label: "15m", secs: 900 },
  { label: "1H", secs: 3600 },
  { label: "1D", secs: 86_400 },
] as const;

const POLL_MS = 15_000;
const LIVE_TICK_MS = 15;
const CANDLE_LIMIT = MAX_POINTS;
const CHART_HEIGHT = 280;

const FULL_SCALE = { priceRange: { minValue: 0, maxValue: 1 } };
const PERCENT_FORMAT = {
  type: "custom" as const,
  minMove: 0.001,
  formatter: (v: number) => `${(v * 100).toFixed(1)}%`,
};

function cssVar(el: HTMLElement, name: string, dflt: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || dflt;
}

/** Per-pubkey fetch/roll-forward state, independent of how many specs
 *  (YES + maybe an inverted NO) reference that pubkey. */
interface PubkeyState {
  candles: CandleDto[];
  plottedStep: number;
  carriedClose: number | null;
}

/**
 * A price-history chart plotting one curve per belief ({@link ChartSeriesSpec}) —
 * each its own implied-YES-probability line, never a NO curve fetched
 * separately (a binary market's NO belief is `1 - YES` of the same candles,
 * derived client-side via `invert`). Specs sharing a `pubkey` (a binary
 * market's YES + NO) fetch candles exactly once. The vertical axis is fixed
 * 0–100%. Themed from live Auros CSS variables; polls for freshness with an
 * out-of-band `refreshKey` bump after a trade.
 *
 * Renders a quiet empty state when every plotted market has no points yet.
 */
export function PriceChart({
  series,
  refreshKey,
}: {
  series: ChartSeriesSpec[];
  refreshKey?: string | number;
}) {
  const indexer = useIndexer();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const [windowSecs, setWindowSecs] = useState<number>(3600);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState(false);
  const pubkeyStateRef = useRef<Map<string, PubkeyState>>(new Map());

  const replot = useCallback(
    (fit: boolean) => {
      const step = gridStep(windowSecs);
      const nowSec = Math.floor(Date.now() / 1000);
      for (const spec of series) {
        const line = seriesRefs.current.get(spec.key);
        if (!line) continue;
        let st = pubkeyStateRef.current.get(spec.pubkey);
        if (!st) {
          st = { candles: [], plottedStep: 0, carriedClose: null };
          pubkeyStateRef.current.set(spec.pubkey, st);
        }
        const grid = buildWindowedGrid(st.candles, step, nowSec, gridBars(windowSecs));
        const plotted = spec.invert ? invertGrid(grid) : grid;
        line.setData(
          plotted.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })) as Parameters<
            ISeriesApi<"Line">["setData"]
          >[0],
        );
        const last = grid[grid.length - 1];
        st.plottedStep = last ? last.time : 0;
        st.carriedClose = last && last.value !== undefined ? last.value : null;
      }
      if (fit) {
        chartRef.current?.timeScale().setVisibleRange({
          from: (nowSec - windowSecs) as UTCTimestamp,
          to: nowSec as UTCTimestamp,
        });
      }
    },
    [series, windowSecs],
  );

  const rollForward = useCallback(() => {
    const step = gridStep(windowSecs);
    const nowStep = Math.floor(Date.now() / 1000 / step) * step;
    for (const [pubkey, st] of pubkeyStateRef.current) {
      if (st.carriedClose === null) continue;
      let b = st.plottedStep;
      const specsForPubkey = series.filter((s) => s.pubkey === pubkey);
      while (nowStep > b) {
        b += step;
        for (const spec of specsForPubkey) {
          const line = seriesRefs.current.get(spec.key);
          const value = spec.invert ? 1 - st.carriedClose : st.carriedClose;
          line?.update({ time: b as UTCTimestamp, value });
        }
      }
      st.plottedStep = Math.max(st.plottedStep, b);
    }
  }, [series, windowSecs]);

  // Create the chart shell once, themed from the resolved CSS variables.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const text = cssVar(el, "--color-silver", "#bbc7c6");
    const grid = "rgba(127, 143, 141, 0.16)";

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: text,
        fontFamily: "Inter, system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: grid },
      timeScale: {
        borderColor: grid,
        timeVisible: true,
        secondsVisible: true,
        shiftVisibleRangeOnNewBar: true,
        minBarSpacing: 0.02,
      },
      height: CHART_HEIGHT,
      width: Math.floor(el.clientWidth),
    });
    chartRef.current = chart;

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) chart.applyOptions({ width: Math.floor(w) });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRefs.current.clear();
    };
  }, []);

  // (Re)create one line series per spec whenever the SET of spec keys
  // changes — simplest correct option since belief lists change rarely.
  const specKeys = series.map((s) => s.key).join(",");
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const line of seriesRefs.current.values()) chart.removeSeries(line);
    seriesRefs.current.clear();
    for (const spec of series) {
      const line = chart.addSeries(LineSeries, {
        color: spec.color,
        lineWidth: 2,
        lineType: LineType.Curved,
        priceFormat: PERCENT_FORMAT,
        autoscaleInfoProvider: () => FULL_SCALE,
        title: spec.label,
      });
      seriesRefs.current.set(spec.key, line);
    }
    replot(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKeys]);

  // Load + poll candles at the window's step, once per unique pubkey; a
  // changed `refreshKey` reloads immediately (e.g. right after a trade).
  useEffect(() => {
    let active = true;
    const pubkeys = [...new Set(series.map((s) => s.pubkey))];
    const load = async (fit: boolean) => {
      try {
        const results = await Promise.all(
          pubkeys.map((pk) => indexer.getCandles(pk, gridStep(windowSecs), CANDLE_LIMIT)),
        );
        if (!active) return;
        setError(false);
        let anyData = false;
        pubkeys.forEach((pk, i) => {
          const candles = results[i];
          if (candles.length > 0) anyData = true;
          const st = pubkeyStateRef.current.get(pk) ?? { candles: [], plottedStep: 0, carriedClose: null };
          st.candles = candles;
          pubkeyStateRef.current.set(pk, st);
        });
        setEmpty(!anyData);
        replot(fit);
      } catch {
        if (active) setError(true);
      }
    };
    void load(true);
    const id = setInterval(() => void load(false), POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexer, specKeys, windowSecs, refreshKey]);

  useEffect(() => {
    const id = setInterval(rollForward, LIVE_TICK_MS);
    return () => clearInterval(id);
  }, [rollForward]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-inter text-[12px] text-silver">Share price · history</span>
        <div
          role="group"
          aria-label="Window"
          className="inline-flex rounded-button border border-hairline p-0.5"
        >
          {WINDOWS.map((w) => {
            const selected = w.secs === windowSecs;
            return (
              <button
                key={w.secs}
                type="button"
                aria-pressed={selected}
                onClick={() => setWindowSecs(w.secs)}
                className={`rounded-[10px] px-2.5 py-1 font-inter text-[12px] transition-colors ${
                  selected ? "bg-aqua text-liquid-abyss" : "text-platinum hover:bg-hairline/50"
                }`}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="relative">
        <div
          ref={containerRef}
          data-testid="price-chart"
          data-empty={empty ? "true" : "false"}
          className="w-full"
          style={{ height: CHART_HEIGHT }}
        />
        {(empty || error) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p
              data-testid="price-chart-empty"
              className={`font-inter text-[13px] ${error ? "text-coral" : "text-silver"}`}
            >
              {error ? "Couldn’t load price history." : "No price history yet — trades will populate the chart."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default PriceChart;
```

**Step 2: Keep the only current call-site compiling**

`TradePanel.tsx:368` currently calls `<PriceChart pubkey={pubkey} refreshKey={chartRefreshKey} />`.
Task 5 removes this call entirely (the chart moves to `GroupTradePanel`), but
to keep the tree compiling and green between commits, temporarily change it
to the new shape:

```tsx
<PriceChart
  series={[{ key: pubkey, pubkey, label: "YES", color: "var(--color-aqua)" }]}
  refreshKey={chartRefreshKey}
/>
```

**Step 3: Typecheck and run the full suite**

Run: `pnpm exec tsc -b`
Expected: no errors.

Run: `pnpm test`
Expected: `Test Files  54 passed (54)` (52 + the 2 new files from Tasks 1–2).
`tradePanelOwnedShares.render.test.tsx` mocks `PriceChart` entirely
(`vi.mock("../src/components/markets/PriceChart", () => ({ PriceChart: () => null }))`),
so it's unaffected by this signature change.

**Step 4: Commit**

```bash
git add app/src/components/markets/PriceChart.tsx app/src/components/markets/actions/TradePanel.tsx
git commit -m "feat(app): PriceChart plots one curve per belief instead of a fixed YES/NO pair"
```

---

### Task 4: `GroupTradePanel` — legend + chart, beliefs instead of a picked market

**Files:**
- Modify: `app/src/components/markets/actions/GroupTradePanel.tsx`
- Modify: `app/test/groupTradePanel.render.test.tsx`
- Modify: `app/test/marketDetailTabsGrouped.render.test.tsx`

`GroupTradePanel` stops picking a market to hand to `TradePanel` — it computes
the full `beliefs` list, renders the chart (now multi-series) behind a
non-interactive legend, and passes `beliefs` + a computed default straight
through. The `MarketDetail` call site
(`app/src/pages/MarketDetail.tsx:401-407`) is unaffected — `GroupTradePanel`'s
own external props (`detail`, `group`, `subject`, `options`, `refetch`) don't
change, only what it does internally and what it hands `TradePanel`.

**Step 1: Update the render tests first (TDD at the component-contract level)**

Replace `app/test/groupTradePanel.render.test.tsx`'s `TradePanel` mock and
assertions to match the new `beliefs` prop, and add legend assertions:

```tsx
// app/test/groupTradePanel.render.test.tsx
import { vi } from "vitest";

vi.mock("../src/components/markets/actions/TradePanel", () => ({
  TradePanel: ({ beliefs, defaultBeliefKey, question }: { beliefs: { key: string; pubkey: string; label: string }[]; defaultBeliefKey: string | null; question?: string }) => (
    <div data-testid="trade-panel" data-default-belief={defaultBeliefKey ?? ""}>
      {question}
      {beliefs.map((b) => (
        <span key={b.key} data-testid="belief" data-key={b.key} data-pubkey={b.pubkey}>
          {b.label}
        </span>
      ))}
    </div>
  ),
}));
vi.mock("../src/components/markets/PriceChart", () => ({
  PriceChart: ({ series }: { series: { key: string; label: string }[] }) => (
    <div data-testid="price-chart">{series.map((s) => s.label).join(",")}</div>
  ),
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketStatus } from "@kassandra-market/markets";
import { describe, expect, it, vi as vitestVi } from "vitest";

import { GroupTradePanel } from "../src/components/markets/actions/GroupTradePanel";
import type { OracleGroupState } from "../src/market/hooks/useOracleGroup";
import type { MarketDetail as MarketDetailData } from "../src/market/data/markets";

const ORACLE = "Orac1e1111111111111111111111111111111111111";

function summary(outcomeIndex: number, status: MarketStatus, reserves: { base: bigint; quote: bigint } | null = null) {
  return {
    pubkey: `Market${outcomeIndex}1111111111111111111111111111111111`,
    market: { oracle: { toString: () => ORACLE }, outcomeIndex, status },
    reserves,
    oracleOptionsCount: 3,
  } as unknown as { pubkey: string; market: Record<string, unknown>; reserves: unknown; oracleOptionsCount: number };
}

function detail(pubkey: string, outcomeIndex: number, status: MarketStatus, reserves: { base: bigint; quote: bigint } | null): MarketDetailData {
  return {
    pubkey,
    market: { oracle: { toString: () => ORACLE }, outcomeIndex, status } as never,
    contributions: [],
    oracle: null,
    reserves: reserves as never,
  };
}

function group(active: ReturnType<typeof summary>[]): OracleGroupState {
  return {
    siblings: active as never,
    isGroup: active.length > 1,
    funding: [],
    active: active as never,
    claimable: [],
    depositable: [],
    loading: false,
    refetch: vitestVi.fn(),
  };
}

const R = { base: 6_000_000n, quote: 4_000_000n };
const R2 = { base: 3_000_000n, quote: 7_000_000n };

function render(props: Parameters<typeof GroupTradePanel>[0]): string {
  return renderToStaticMarkup(<GroupTradePanel {...props} />);
}

describe("GroupTradePanel", () => {
  it("a lone Active market: two beliefs (YES/NO of the same market), no clickable selector", () => {
    const d = detail("MarketA", 0, MarketStatus.Active, R);
    const html = render({ detail: d, group: group([]), options: [], refetch: () => {} });
    expect(html).not.toContain("<button");
    expect(html).toContain('data-testid="trade-panel"');
    const beliefCount = (html.match(/data-testid="belief"/g) ?? []).length;
    expect(beliefCount).toBe(2);
    expect(html).toContain('data-pubkey="MarketA"');
  });

  it("a real categorical group: one belief per Active outcome, defaults to the CURRENT market", () => {
    const d = detail("Market1111111111111111111111111111111111111", 1, MarketStatus.Active, R);
    const g = group([
      summary(0, MarketStatus.Active, R2),
      summary(1, MarketStatus.Active, R),
      summary(2, MarketStatus.Active, R),
    ]);
    const html = render({ detail: d, group: g, options: ["Zero", "One", "Two"], refetch: () => {} });
    expect(html).not.toContain("<button");
    const beliefCount = (html.match(/data-testid="belief"/g) ?? []).length;
    expect(beliefCount).toBe(3);
    expect(html).toContain("Zero");
    expect(html).toContain("One");
    expect(html).toContain("Two");
    expect(html).toContain('data-default-belief="Market1111111111111111111111111111111111111:yes"');
  });

  it("defaults to the first tradable sibling when the CURRENT market itself isn't Active", () => {
    const d = detail("Market0111111111111111111111111111111111111", 0, MarketStatus.Funding, null);
    const g = group([summary(2, MarketStatus.Active, R)]);
    const html = render({ detail: d, group: g, options: [], refetch: () => {} });
    expect(html).toContain('data-default-belief="Market21111111111111111111111111111');
  });

  it("passes the shared oracle subject as the trade question", () => {
    const d = detail("Market1111111111111111111111111111111111111", 1, MarketStatus.Active, R);
    const g = group([summary(1, MarketStatus.Active, R)]);
    const html = render({ detail: d, group: g, subject: "Who wins the tournament?", options: ["Zero", "One"], refetch: () => {} });
    expect(html).toContain("Who wins the tournament?");
  });

  it("renders nothing when no outcome in the group is tradable", () => {
    const d = detail("Market0111111111111111111111111111111111111", 0, MarketStatus.Funding, null);
    const g = group([]);
    expect(render({ detail: d, group: g, options: [], refetch: () => {} })).toBe("");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/groupTradePanel.render.test.tsx`
Expected: FAIL (current `GroupTradePanel` still renders the old pill-tablist +
single-market `TradePanel` props).

**Step 3: Rewrite `GroupTradePanel`**

```tsx
// app/src/components/markets/actions/GroupTradePanel.tsx
import { useMemo } from "react";
import { MarketStatus } from "@kassandra-market/markets";
import type { MarketDetail as MarketDetailData, MarketSummary } from "../../../market/data/markets";
import type { OracleGroupState } from "../../../market/hooks/useOracleGroup";
import { formatProbability } from "../../../market/lib/marketView";
import { beliefProbability, computeBeliefs, defaultBeliefKey, type Belief } from "../../../market/lib/beliefs";
import { PriceChart, type ChartSeriesSpec } from "../PriceChart";
import { TradePanel } from "./TradePanel";

/** Fixed categorical palette for belief curves/pills, cycling past its length. */
const BELIEF_COLORS = [
  "var(--color-aqua)",
  "var(--color-coral)",
  "#c9a5ff",
  "#ffd166",
  "#7fd1ae",
  "#6fb7ff",
];

function colorFor(index: number): string {
  return BELIEF_COLORS[index % BELIEF_COLORS.length];
}

/** One non-interactive legend pill: color dot, belief label, live probability.
 *  Purely a readout — clicking it does nothing; the order ticket's dropdown
 *  (below) is the only selector. */
function BeliefPill({ belief, color }: { belief: Belief; color: string }) {
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-tag border border-hairline bg-liquid-deep px-3 py-1.5 font-inter text-[13px]">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-platinum">{belief.label}</span>
      <span className="tabular-nums text-coral">{formatProbability(beliefProbability(belief))}</span>
    </span>
  );
}

/**
 * The Trade tab's UNIFIED surface: a chart plotting every belief's own YES
 * curve behind a non-interactive legend, and the order ticket ({@link TradePanel})
 * which owns belief SELECTION via its own dropdown. Neither the chart nor the
 * legend depend on what's selected to trade — every tradable belief is always
 * visible.
 *
 * Renders nothing when no belief is tradable yet (mirrors `TradePanel`'s own
 * gating — the caller only mounts this once at least one outcome is Active).
 */
export function GroupTradePanel({
  detail,
  group,
  subject,
  options,
  refetch,
}: {
  /** The current page's own market detail (freshest data for its own outcome). */
  detail: MarketDetailData;
  /** The categorical group this market's oracle spans, from `useOracleGroup`. */
  group: OracleGroupState;
  /** The oracle question (header context; falls back to a generic label). */
  subject?: string;
  /** Per-outcome option labels, index-aligned to `outcomeIndex` (empty when unread). */
  options: string[];
  /** Called after a trade completes — refreshes both this page and the group's siblings. */
  refetch: () => void;
}) {
  const { pubkey, market, reserves } = detail;
  const isActive = market.status === MarketStatus.Active;

  const tradable = useMemo<MarketSummary[]>(() => {
    const current: MarketSummary[] = isActive
      ? [{ pubkey, market, reserves, oracleOptionsCount: null }]
      : [];
    const others = group.active.filter((m) => m.pubkey !== pubkey);
    return [...current, ...others].sort((a, b) => a.market.outcomeIndex - b.market.outcomeIndex);
  }, [group.active, pubkey, market, reserves, isActive]);

  const beliefs = useMemo(
    () => computeBeliefs({ isGroup: group.isGroup, tradable, options }),
    [group.isGroup, tradable, options],
  );

  if (beliefs.length === 0) return null;

  const series: ChartSeriesSpec[] = beliefs.map((b, i) => ({
    key: b.key,
    pubkey: b.pubkey,
    label: b.label,
    color: colorFor(i),
    invert: b.outcome === "no",
  }));
  const chartRefreshKey = beliefs
    .map((b) => `${b.pubkey}:${b.reserves ? `${b.reserves.base}-${b.reserves.quote}` : "empty"}`)
    .join("|");

  const onSuccess = () => {
    refetch();
    group.refetch();
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="flex flex-col gap-4 rounded-card border border-hairline bg-liquid-deep p-6 lg:col-span-3">
        <div className="flex flex-wrap gap-2" aria-label="Options" role="list">
          {beliefs.map((b, i) => (
            <BeliefPill key={b.key} belief={b} color={colorFor(i)} />
          ))}
        </div>
        <PriceChart series={series} refreshKey={chartRefreshKey} />
      </div>
      <TradePanel
        beliefs={beliefs}
        defaultBeliefKey={defaultBeliefKey(beliefs, pubkey, isActive)}
        onSuccess={onSuccess}
        question={subject}
      />
    </div>
  );
}

export default GroupTradePanel;
```

Note: `TradePanel` isn't in this shape yet — this will not compile/pass until
Task 5 lands. That's expected; Tasks 4 and 5 land together (see Step 4 below).

**Step 4: Update `marketDetailTabsGrouped.render.test.tsx`'s `TradePanel` mock**

It mocks `TradePanel` too (see `app/test/marketDetailTabsGrouped.render.test.tsx:1-12`
in the original file, referenced from `GroupTradePanel`). Update its mock to the
new `beliefs` shape, mirroring Step 1 above:

```tsx
vi.mock('../src/components/markets/actions/TradePanel', () => ({
  TradePanel: ({ beliefs }: { beliefs: { key: string }[] }) => (
    <div data-testid="trade-panel">{beliefs.length} beliefs</div>
  ),
}))
vi.mock('../src/components/markets/PriceChart', () => ({
  PriceChart: () => null,
}))
```

Run: `pnpm exec vitest run test/groupTradePanel.render.test.tsx test/marketDetailTabsGrouped.render.test.tsx`
Expected at this point: still FAIL (TradePanel itself hasn't been updated —
proceed directly to Task 5, then re-run).

---

### Task 5: `TradePanel` — belief dropdown replaces the outcome/YES-NO controls

**Files:**
- Modify: `app/src/components/markets/actions/TradePanel.tsx`
- Modify: `app/test/tradePanelOwnedShares.render.test.tsx`

`TradePanel` stops receiving a single `{ pubkey, market, reserves, boundLabel }`
and instead receives `{ beliefs, defaultBeliefKey, onSuccess, question }`. It
owns `selectedKey` state (defaulting from `defaultBeliefKey`), renders a
native `<select>` listing every belief (`"{label} · {probability}"`), and
resets the amount field + closes the slippage disclosure whenever the
selection changes (since switching the select no longer remounts the
component the way the old `key={picked.pubkey}` did). The chart, `UnitTabs`,
and the YES/NO `OutcomeButton` row are removed entirely — `GroupTradePanel`
now owns the chart, and probability display is plain percent (`formatProbability`)
everywhere in the order ticket, matching the legend.

**Step 1: Update the existing render test for the new prop shape**

Rewrite `app/test/tradePanelOwnedShares.render.test.tsx`:

```tsx
// app/test/tradePanelOwnedShares.render.test.tsx
/**
 * Render coverage for TradePanel's "You own" row: the connected wallet's YES/NO
 * share holdings must be visible regardless of buy/sell mode.
 */
import { vi } from "vitest";

const YES_MINT = "YesMint111111111111111111111111111111111";
const NO_MINT = "NoMint1111111111111111111111111111111111";
const KASS_MINT = "KassMint11111111111111111111111111111111";

vi.mock("../src/market/hooks/useWriteAction", () => ({
  useWriteAction: () => ({
    status: { kind: "idle" },
    address: "Trader111111111111111111111111111111111",
    connected: true,
    indexer: {},
    run: async () => {},
  }),
}));
vi.mock("../src/market/hooks/useKassBalance", () => ({
  useKassBalance: (mint: string) => {
    if (mint === YES_MINT) return { balance: 42_000_000_000n, loading: false, refetch: () => {} };
    if (mint === NO_MINT) return { balance: 7_000_000_000n, loading: false, refetch: () => {} };
    return { balance: 100_000_000_000n, loading: false, refetch: () => {} };
  },
}));
vi.mock("../src/hooks/useKassUsdcPrice", () => ({
  useKassUsdcPrice: () => null,
}));
vi.mock("../src/components/markets/actions/ConnectGate", () => ({
  ConnectGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TradePanel } from "../src/components/markets/actions/TradePanel";
import type { Belief } from "../src/market/lib/beliefs";

const market = {
  kassMint: { toString: () => KASS_MINT },
  yesMint: { toString: () => YES_MINT },
  noMint: { toString: () => NO_MINT },
} as never;
const reserves = { base: 1_000_000_000n, quote: 1_000_000_000n } as never;

const beliefs: Belief[] = [
  { key: "Market1111:yes", pubkey: "Market1111", market, reserves, outcome: "yes", label: "Yes" },
  { key: "Market1111:no", pubkey: "Market1111", market, reserves, outcome: "no", label: "No" },
];

function render(): string {
  return renderToStaticMarkup(
    <TradePanel beliefs={beliefs} defaultBeliefKey="Market1111:yes" onSuccess={() => {}} />,
  );
}

describe("TradePanel — owned-shares row", () => {
  it("shows both YES and NO holdings regardless of the selected belief", () => {
    const html = render();
    expect(html).toContain("You own");
    expect(html).toContain("42 YES");
    expect(html).toContain("7 NO");
  });

  it("renders one <option> per belief, each showing its label and live price", () => {
    const html = render();
    expect(html).toContain("<option");
    expect(html).toContain("Yes");
    expect(html).toContain("No");
    expect((html.match(/<option/g) ?? []).length).toBe(2);
  });

  it("selects the default belief", () => {
    const html = render();
    expect(html).toMatch(/<option[^>]*value="Market1111:yes"[^>]*selected/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/tradePanelOwnedShares.render.test.tsx`
Expected: FAIL — `TradePanel` still expects `pubkey`/`market`/`reserves` props.

**Step 3: Rewrite `TradePanel`**

Apply these changes to `app/src/components/markets/actions/TradePanel.tsx`:

1. Remove the `PriceChart` import (`TradePanel.tsx:24`) and the `Unit`/`UNITS`/
   `formatSharePrice`/`UnitTabs` machinery (`TradePanel.tsx:34-51`,
   `109-151`) — nothing else in the redesigned component needs a KASS/USD
   unit toggle now that the big YES/NO price tiles and chart header are gone.
2. Remove `OutcomeButton` (`TradePanel.tsx:158-196`) — replaced by a new
   `BeliefSelect`.
3. Add `import { beliefProbability, type Belief } from "../../../market/lib/beliefs";`
   and `import { formatProbability } from "../../../market/lib/marketView";`
   (drop the now-unused `impliedYesProbability` import if nothing else in the
   file still calls it — check before removing).
4. Add the new selector component, near where `OutcomeButton` used to be:

```tsx
/** The single selector for "what you're buying/selling" — one option per
 *  belief, each showing its live implied probability. A native <select> (not
 *  a custom popover): accessible by default, and every option is always
 *  present in the markup so it's testable via SSR without simulating a click. */
function BeliefSelect({
  beliefs,
  selectedKey,
  onChange,
}: {
  beliefs: Belief[];
  selectedKey: string;
  onChange: (key: string) => void;
}) {
  return (
    <select
      aria-label="What you believe"
      value={selectedKey}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-tag border border-hairline bg-liquid-kelp px-3 py-2.5 font-inter text-[14px] text-platinum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-platinum/40 focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss"
    >
      {beliefs.map((b) => (
        <option key={b.key} value={b.key}>
          {b.label} · {formatProbability(beliefProbability(b))}
        </option>
      ))}
    </select>
  );
}
```

5. Change the component signature and body. Replace:

```tsx
export function TradePanel({
  pubkey,
  market,
  reserves,
  onSuccess,
  question,
  boundLabel,
}: {
  pubkey: string;
  market: Market;
  reserves: AmmReserves | null;
  onSuccess: () => void;
  question?: string;
  boundLabel?: string | null;
}) {
```

with:

```tsx
export function TradePanel({
  beliefs,
  defaultBeliefKey,
  onSuccess,
  question,
}: {
  /** Every belief available to trade — a categorical group's options (always
   *  YES) or a lone binary market's YES/NO pair. Never empty when mounted. */
  beliefs: Belief[];
  /** The initially-selected belief's key, from {@link import("../../../market/lib/beliefs").defaultBeliefKey}. */
  defaultBeliefKey: string | null;
  onSuccess: () => void;
  /** The oracle question (header context; falls back to a generic label). */
  question?: string;
}) {
  const [selectedKey, setSelectedKey] = useState<string>(
    defaultBeliefKey ?? beliefs[0]?.key ?? "",
  );
  const selected = beliefs.find((b) => b.key === selectedKey) ?? beliefs[0];
  const { pubkey, market, reserves, outcome } = selected;
```

6. Delete the old `const [outcome, setOutcome] = useState<Outcome>("yes");`
   line — `outcome` now comes from `selected` above.
7. Delete the `impliedYesProbability`/`yesProb`/`noProb`/`displayUnit`/`unit`/
   `kassUsd`/`usdAvailable` block that fed the removed chart header and
   `OutcomeButton`s — keep only what's still used (the buy/sell math below
   reads `reserves` + `outcome` directly, unchanged).
8. Reset the amount + slippage-disclosure state when the belief changes —
   add right after the `selectedKey` state:

```tsx
  const handleBeliefChange = (key: string) => {
    setSelectedKey(key);
    setAmount("");
    setAmountError(undefined);
    setDetailsOpen(false);
  };
```

9. Replace the returned JSX's outer wrapper. Today it's a two-Card grid
   (`TradePanel.tsx:337-370` chart Card + `371-596` order Card). Delete the
   chart Card and the outer grid `<div>` entirely — return only the order
   ticket, now carrying its own column-span class so it still sits correctly
   inside `GroupTradePanel`'s grid:

```tsx
  return (
    <Card className="flex flex-col gap-4 lg:col-span-2">
      <div className="border-b border-hairline pb-3">
        <p className="font-inter text-[11px] uppercase tracking-[0.06em] text-silver">Order</p>
        <p className="mt-1 text-balance font-inter text-[14px] text-platinum" title={question}>
          {question ?? "Trade this market"}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <ModeTabs value={mode} onChange={setMode} />
        <span
          className="rounded-tag border border-hairline px-2.5 py-1 font-inter text-[12px] text-silver"
          title="Trades execute at the current AMM price"
        >
          Market order
        </span>
      </div>

      <ConnectGate connected={action.connected}>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <BeliefSelect beliefs={beliefs} selectedKey={selectedKey} onChange={handleBeliefChange} />

          {/* ...unchanged from here down: "You own" row, amount field, presets,
              "you receive" estimate, price impact + slippage disclosure,
              submit button, status region, Jupiter placeholder... */}
        </form>
      </ConnectGate>
    </Card>
  );
```

   Everything below `BeliefSelect` in that form (the "You own" row through the
   Jupiter placeholder, `TradePanel.tsx:423-593` in the original) is
   unchanged — it already reads `outcome`/`mode`/`amount`/`reserves` from
   local state/derived values, which still resolve the same way now that
   `outcome`/`market`/`reserves`/`pubkey` come from `selected` instead of
   props.

10. `pubkey`/`market`/`reserves`/`outcome` are now `const`s derived from
    `selected` inside the component body (Step 5 above) rather than props —
    every other line in the file that references them (balances, `marketRefs`,
    `buildBuyIxs`/`buildSellIxs`, preview calculations, the chart-refresh-key
    computation you're deleting) keeps working unchanged, since they're still
    in scope with the same names.

**Step 4: Run all four affected test files**

Run:
```bash
pnpm exec vitest run test/tradePanelOwnedShares.render.test.tsx test/groupTradePanel.render.test.tsx test/marketDetailTabsGrouped.render.test.tsx
```
Expected: PASS, all three files.

**Step 5: Typecheck and run the full suite**

Run: `pnpm exec tsc -b`
Expected: no errors — in particular, confirm no file still imports the old
`OutcomeButton`, `UnitTabs`, `formatSharePrice`, or references `boundLabel`/
single-`pubkey` `TradePanel` props anywhere (`grep -rn "boundLabel" app/src`
should return nothing outside `MarketDetail.tsx`'s own unrelated header usage
at `MarketDetail.tsx:320`, which is untouched by this plan).

Run: `pnpm test`
Expected: `Test Files  54 passed (54)` / all tests passing.

Run: `pnpm lint`
Expected: no new warnings (in particular, no unused-import warnings from the
removed `Unit`/`OutcomeButton`/`formatSharePrice` code).

**Step 6: Commit**

```bash
git add app/src/components/markets/actions/GroupTradePanel.tsx \
        app/src/components/markets/actions/TradePanel.tsx \
        app/test/groupTradePanel.render.test.tsx \
        app/test/marketDetailTabsGrouped.render.test.tsx \
        app/test/tradePanelOwnedShares.render.test.tsx
git commit -m "feat(app): unify trading behind one belief dropdown + a shared multi-curve chart"
```

---

### Task 6: Manual browser verification

**No new automated test** — `PriceChart`'s imperative chart wiring has no
canvas-backed test environment in this repo (true before this plan too).
Verify by eye:

```bash
cd /Users/dode/Documents/solana/kassandra/.worktrees/unified-belief-trading/app
pnpm dev
```

Check, using local dev seed data (a categorical group and a binary market —
see `app/e2e/seed-market.ts` for the 3-option `proposal` oracle mentioned in
[[one-market-per-oracle-grouped-liquidity]]):

1. **Categorical group market page → Trade tab:** legend shows one pill per
   Active option with live probability, none of them clickable (no pointer
   cursor, no `role="tab"`/button semantics). Chart shows one curve per
   option, color-matched to its pill. The order-ticket dropdown lists every
   option once (no YES/NO suffix). Switching the dropdown updates the "You
   own" row, price-impact preview, and resets any typed amount.
2. **Binary market page → Trade tab:** legend shows exactly one pill (its own
   label, or "Yes" if unlabeled) — confirm the chart's single curve is the
   YES curve, not YES+NO. The dropdown lists two entries (its bound label /
   "Yes", and its complement / "No"); selecting "No" and typing an amount
   still produces a correct buy/sell preview (compare against the reserves
   shown in the Liquidity tab's pool composition figures for a sanity check
   on the price).
3. **A trade lands:** after a successful buy/sell, confirm the chart reloads
   (the traded curve visibly steps) and the dropdown's live prices update.
4. **Resize / mobile width:** legend pills wrap onto multiple lines without
   overflow; chart + order ticket stack vertically below the `lg` breakpoint
   (unchanged grid behavior from before this plan).

If anything looks wrong, fix it in this worktree and re-run
`pnpm test && pnpm exec tsc -b` before moving on — do not commit broken visual
state.

---

### Task 7: Final full-suite pass + wrap-up

**Step 1: Full verification**

```bash
cd /Users/dode/Documents/solana/kassandra/.worktrees/unified-belief-trading/app
pnpm exec tsc -b && pnpm lint && pnpm test
```

Expected: all green.

**Step 2: Review the diff against the design doc**

```bash
cd /Users/dode/Documents/solana/kassandra/.worktrees/unified-belief-trading
git log --oneline master..feature/unified-belief-trading
git diff master...feature/unified-belief-trading --stat
```

Confirm every bullet in `docs/plans/2026-07-20-unified-belief-trading-design.md`
is reflected: non-interactive legend, single-YES-curve-per-belief chart,
combined dropdown everywhere (including binary), no `TradePanel` prop still
named `boundLabel`/`pubkey`/`market`/`reserves` at the top level.

**Step 3: Hand off**

Use superpowers:finishing-a-development-branch to decide how to integrate
this branch (PR vs merge vs further review) once Task 6's manual check is
clean.
