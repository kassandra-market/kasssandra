import type { CandleDto } from "../../market/lib/indexer";
import { normalizeAcrossGroup } from "../../market/lib/marketView";

/** One plotted point: bucket-start unix seconds + the value held over that bucket.
 *  `value` is `undefined` for a WHITESPACE point ({@link buildWindowedGrid}) — a
 *  bucket before any real data exists, which extends the plotted time range
 *  without drawing anything. */
export interface GridPoint {
  time: number;
  value?: number;
}

/**
 * Point budget per plotted window. lightweight-charts spaces points by index, so a
 * uniform time step keeps the axis proportional and the trailing edge second-precise
 * — but a step of 1s over a long window would be too many points, so the step grows
 * with the window to stay under this cap.
 */
export const MAX_POINTS = 3600;

/**
 * The uniform time step (seconds) for a visible `windowSecs`: 1s (true per-second
 * growth) until the window would exceed {@link MAX_POINTS} points, then just coarse
 * enough to fit. So short windows tick every second; a day-wide window steps coarser.
 */
export function gridStep(windowSecs: number): number {
  return Math.max(1, Math.ceil(windowSecs / MAX_POINTS));
}

/** Number of bars shown for `windowSecs` at its {@link gridStep} (≤ {@link MAX_POINTS}). */
export function gridBars(windowSecs: number): number {
  return Math.ceil(windowSecs / gridStep(windowSecs));
}

/**
 * Build a uniform, one-point-per-interval line grid from the indexer's sparse
 * candles (only buckets that had a sample). Walk every bucket from the window start
 * to the later of (now, last candle), carrying the last close forward over empty
 * buckets — a flat, interpolated hold. This makes each bar exactly one interval
 * wide (no sub-interval points, no compressed gaps) and bounds the series to the
 * most-recent `maxBars` buckets. Candles must be ascending by `time` (the API
 * returns them so). Empty in → empty out (the chart renders its empty state).
 */
export function buildGrid(
  candles: CandleDto[],
  interval: number,
  nowSec: number,
  maxBars: number,
): GridPoint[] {
  if (candles.length === 0) return [];
  const firstBucket = candles[0].time;
  const lastBucket = candles[candles.length - 1].time;
  const currentBucket = Math.floor(nowSec / interval) * interval;
  const endBucket = Math.max(currentBucket, lastBucket);
  const start = Math.max(firstBucket, endBucket - (maxBars - 1) * interval);
  const out: GridPoint[] = [];
  let ci = 0;
  let carried: number | null = null;
  // Seed the carry with the last candle at/before the window start.
  while (ci < candles.length && candles[ci].time <= start) {
    carried = candles[ci].close;
    ci++;
  }
  for (let b = start; b <= endBucket; b += interval) {
    while (ci < candles.length && candles[ci].time <= b) {
      carried = candles[ci].close;
      ci++;
    }
    if (carried !== null) out.push({ time: b, value: carried });
  }
  return out;
}

/**
 * Like {@link buildGrid}, but the plotted range is always exactly `maxBars` wide
 * — the FULL selected window — never narrower. `buildGrid` clamps its start to
 * the earliest real candle, so a market younger than the window (or one whose
 * history got clamped to a most-recent slice) returns fewer than `maxBars`
 * points; the chart component then has real data for only part of its x-axis.
 * This pads the missing FRONT of the window with WHITESPACE points (`{time}`,
 * no `value`) so the series' own time range spans the whole window — letting
 * `setVisibleRange({from: now - windowSecs, to: now})` actually show the full
 * requested scale, with blank space before the first real point instead of a
 * zoomed-in sliver of just the available data.
 */
export function buildWindowedGrid(
  candles: CandleDto[],
  interval: number,
  nowSec: number,
  maxBars: number,
): GridPoint[] {
  const core = buildGrid(candles, interval, nowSec, maxBars);
  if (core.length === 0 || core.length >= maxBars) return core;
  const padding: GridPoint[] = [];
  for (let i = maxBars - core.length; i >= 1; i--) {
    padding.push({ time: core[0].time - i * interval });
  }
  return [...padding, ...core];
}

/** Complement every real value in a grid (`v → 1 - v`), leaving whitespace
 *  points (`value === undefined`) and `time` untouched. Used to derive a
 *  binary market's NO curve from its YES candles client-side, with no second
 *  indexer fetch. */
export function invertGrid(grid: GridPoint[]): GridPoint[] {
  return grid.map((p) => ({ time: p.time, value: p.value === undefined ? undefined : 1 - p.value }));
}

/**
 * Apply {@link normalizeAcrossGroup} once PER TIME BUCKET across several
 * already-built grids, so a categorical group's chart curves visibly move
 * opposite each other as trades happen, instead of each option's raw
 * (independent-pool) curve only ever moving on its own trades.
 *
 * PRECONDITION: every non-empty input grid shares the identical time axis
 * (same length, same `time` at each index) — guaranteed by `PriceChart`
 * calling {@link buildWindowedGrid} for every spec with the same
 * `nowSec`/`step`/`maxBars` inputs in one `replot()` pass. A grid may also
 * be entirely empty (a pubkey with zero candles ever — {@link buildWindowedGrid}
 * returns `[]` for that case, never padded like a market merely younger
 * than the window) — it stays empty in the output and, like a whitespace
 * point, contributes nothing to any bucket's sum.
 *
 * At a bucket with fewer than two real (non-`null`) values, there is
 * nothing to normalize AGAINST — dividing a lone value by itself would
 * wrongly inflate it to 1 (100%) instead of leaving it as-is — so that
 * bucket's real value(s) pass through unchanged rather than through
 * {@link normalizeAcrossGroup}. This is what makes a single spec (or a
 * spec that's currently the only one with real data at a given bucket) a
 * no-op, matching {@link normalizeAcrossGroup}'s own binary-pair no-op.
 */
export function normalizeGridsAcrossGroup(grids: GridPoint[][]): GridPoint[][] {
  const axisLength = grids.reduce((max, g) => Math.max(max, g.length), 0);
  if (axisLength === 0) return grids;
  const axisGrid = grids.find((g) => g.length === axisLength)!;
  const out: GridPoint[][] = grids.map(() => []);
  for (let i = 0; i < axisLength; i++) {
    const time = axisGrid[i].time;
    const raw = grids.map((g) => (g.length === axisLength ? (g[i].value ?? null) : null));
    const realCount = raw.filter((v) => v !== null).length;
    const normalized = realCount >= 2 ? normalizeAcrossGroup(raw) : raw;
    grids.forEach((g, j) => {
      if (g.length !== axisLength) return; // empty grid: stays empty, no bucket entries
      out[j].push({ time, value: normalized[j] ?? undefined });
    });
  }
  return out;
}
