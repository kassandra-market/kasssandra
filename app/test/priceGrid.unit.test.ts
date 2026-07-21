/**
 * Offline unit tests for the price-chart grid builder. The chart plots one point
 * per selected interval (lightweight-charts spaces by index, so uniform spacing =
 * one bar per interval), carrying the last close forward over empty buckets and
 * extending to the current bucket — so a minute is always one unit wide and the
 * curve advances with wall-clock, not only on trades.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_POINTS,
  buildGrid,
  buildWindowedGrid,
  gridBars,
  gridStep,
  invertGrid,
  normalizeGridsAcrossGroup,
} from "../src/components/markets/priceGrid";
import type { CandleDto } from "../src/market/lib/indexer";

const candle = (time: number, close: number): CandleDto => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
});

const MIN = 60;

describe("buildGrid — uniform, gap-filled, wall-clock-extended", () => {
  it("is empty for no candles", () => {
    expect(buildGrid([], MIN, 1_000, 500)).toEqual([]);
  });

  it("emits exactly one point per interval, carrying gaps forward", () => {
    // Samples at minute 0 and minute 3; now inside minute 3.
    const candles = [candle(0, 0.4), candle(3 * MIN, 0.7)];
    const grid = buildGrid(candles, MIN, 3 * MIN + 15, 500);
    // One point for each of minutes 0..3 — no sub-minute points, no skipped gaps.
    expect(grid.map((p) => p.time)).toEqual([0, 60, 120, 180]);
    // Minutes 1 and 2 carry minute 0's close forward (flat hold); minute 3 jumps.
    expect(grid.map((p) => p.value)).toEqual([0.4, 0.4, 0.4, 0.7]);
  });

  it("extends to the current bucket even with no new samples (wall-clock advance)", () => {
    // One sample at minute 0; now is well into minute 5 → bars roll forward flat.
    const grid = buildGrid([candle(0, 0.5)], MIN, 5 * MIN + 1, 500);
    expect(grid.map((p) => p.time)).toEqual([0, 60, 120, 180, 240, 300]);
    expect(grid.every((p) => p.value === 0.5)).toBe(true);
  });

  it("uses a uniform step regardless of interval (15m buckets stay 15m apart)", () => {
    const q = 15 * MIN;
    const grid = buildGrid([candle(0, 0.5), candle(2 * q, 0.6)], q, 2 * q + 5, 500);
    expect(grid.map((p) => p.time)).toEqual([0, q, 2 * q]);
  });

  it("caps the window to the most-recent maxBars buckets", () => {
    // Sample far in the past; now 100 minutes later, capped to 10 bars.
    const grid = buildGrid([candle(0, 0.5)], MIN, 100 * MIN, 10);
    expect(grid.length).toBe(10);
    // The window ends at the current bucket (minute 100) and spans back 10 bars.
    expect(grid[grid.length - 1].time).toBe(100 * MIN);
    expect(grid[0].time).toBe((100 - 9) * MIN);
  });

  it("never plots behind the last candle when the client clock lags the server", () => {
    // now (minute 1) is behind the last sample (minute 4) → still covers the data.
    const grid = buildGrid([candle(0, 0.4), candle(4 * MIN, 0.8)], MIN, 1 * MIN, 500);
    expect(grid[grid.length - 1].time).toBe(4 * MIN);
    expect(grid[grid.length - 1].value).toBe(0.8);
  });

  it("under-supply: a market younger than the window emits fewer than maxBars points", () => {
    // Window budget is 60 bars, but the market's first (only) trade was 5 minutes
    // ago — buildGrid must not backfill bars before the data exists; padding out
    // to the full window is buildWindowedGrid's job (see below), not buildGrid's.
    const grid = buildGrid([candle(0, 0.5)], MIN, 5 * MIN, 60);
    expect(grid.length).toBe(6); // minutes 0..5 inclusive, not 60
    expect(grid[0].time).toBe(0);
    expect(grid[grid.length - 1].time).toBe(5 * MIN);
  });
});

describe("buildWindowedGrid — pads the FRONT of an under-supplied window with whitespace", () => {
  it("is empty for no candles (same as buildGrid — nothing to pad against)", () => {
    expect(buildWindowedGrid([], MIN, 1_000, 500)).toEqual([]);
  });

  it("pads a young market's grid out to the full maxBars window with value-less points", () => {
    // Same fixture as the under-supply buildGrid test: one candle 5 minutes ago,
    // 60-bar (1h) window. buildWindowedGrid must still emit exactly 60 points —
    // the first 54 as WHITESPACE (time only, no value) — so the series' own time
    // range spans the whole hour and `setVisibleRange` isn't clamped to the 6
    // minutes of real data.
    const grid = buildWindowedGrid([candle(0, 0.5)], MIN, 5 * MIN, 60);
    expect(grid.length).toBe(60);
    expect(grid[0].time).toBe((5 - 59) * MIN);
    expect(grid[grid.length - 1].time).toBe(5 * MIN);
    // The padding buckets are whitespace (no `value`); real data starts at minute 0.
    const paddingCount = grid.findIndex((p) => p.time === 0);
    expect(paddingCount).toBe(54); // 60 total - 6 real (minutes 0..5) = 54 padding
    expect(grid.slice(0, paddingCount).every((p) => p.value === undefined)).toBe(true);
    expect(grid.slice(paddingCount).every((p) => p.value !== undefined)).toBe(true);
  });

  it("does not pad when the real data already fills the window", () => {
    // Same fixture as buildGrid's "caps the window" test: already exactly 10 bars.
    const grid = buildWindowedGrid([candle(0, 0.5)], MIN, 100 * MIN, 10);
    expect(grid.length).toBe(10);
    expect(grid.every((p) => p.value !== undefined)).toBe(true);
  });
});

describe("gridStep / gridBars — window → step + bar budget", () => {
  it("ticks every second for windows within the point budget", () => {
    expect(gridStep(60)).toBe(1); // 1m window → per-second
    expect(gridStep(900)).toBe(1); // 15m
    expect(gridStep(MAX_POINTS)).toBe(1); // exactly at the budget
    expect(gridBars(60)).toBe(60);
    expect(gridBars(MAX_POINTS)).toBe(MAX_POINTS);
  });

  it("coarsens the step just enough to stay under the budget for wide windows", () => {
    // A day is far past the budget → step grows, bars stay capped.
    expect(gridStep(86_400)).toBe(Math.ceil(86_400 / MAX_POINTS));
    expect(gridBars(86_400)).toBeLessThanOrEqual(MAX_POINTS);
  });

  it("a per-second window ends at the current second (second precision)", () => {
    // With step 1, buildGrid's last point is the current second.
    const now = 1_000_123;
    const grid = buildGrid([candle(1_000_000, 0.5)], gridStep(60), now, gridBars(60));
    expect(grid[grid.length - 1].time).toBe(now); // exact current second
  });
});

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

  it("oddsSpace: true normalizes in odds-space so a heavily-bought bucket approaches 1, not a linear-capped plateau", () => {
    const gridA = [
      { time: 0, value: 0.99 },
      { time: 1, value: 0.99 },
    ];
    const gridB = [
      { time: 0, value: 0.5 },
      { time: 1, value: 0.5 },
    ];
    const gridC = [
      { time: 0, value: 0.5 },
      { time: 1, value: 0.5 },
    ];
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
});
