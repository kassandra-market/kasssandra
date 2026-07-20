/**
 * Offline unit tests for the price-chart grid builder. The chart plots one point
 * per selected interval (lightweight-charts spaces by index, so uniform spacing =
 * one bar per interval), carrying the last close forward over empty buckets and
 * extending to the current bucket — so a minute is always one unit wide and the
 * curve advances with wall-clock, not only on trades.
 */
import { describe, expect, it } from "vitest";

import { MAX_POINTS, buildGrid, buildWindowedGrid, gridBars, gridStep } from "../src/components/markets/priceGrid";
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
