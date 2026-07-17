import type { CandleDto } from "../../market/lib/indexer";

/** One plotted point: bucket-start unix seconds + the value held over that bucket. */
export interface GridPoint {
  time: number;
  value: number;
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
