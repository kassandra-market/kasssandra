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
import { buildGrid, gridBars, gridStep } from "./priceGrid";

/** Selectable visible WINDOWS (seconds of history shown). The plotted step is
 *  derived from the window ({@link gridStep}) — 1s for short windows (per-second
 *  growth), coarser for wide ones. */
const WINDOWS = [
  { label: "1m", secs: 60 },
  { label: "15m", secs: 900 },
  { label: "1H", secs: 3600 },
  { label: "1D", secs: 86_400 },
] as const;

/** Poll the indexer for fresh candles on this cadence (ms). */
const POLL_MS = 15_000;

/** Wall-clock tick — extends the curve to the current second on this cadence (ms). */
const LIVE_TICK_MS = 15;

/** Fetch enough sparse sample anchors to cover the widest window (server-clamped). */
const CANDLE_LIMIT = 2_000;

const CHART_HEIGHT = 280;

/**
 * Both share curves are probabilities, so the price axis is PINNED to the full
 * 0..1 (0–100%) range rather than autoscaling to the data — the YES/NO split is
 * always read against the same fixed scale. Returned from each series'
 * `autoscaleInfoProvider`.
 */
const FULL_SCALE = { priceRange: { minValue: 0, maxValue: 1 } };

/** Percent price format shared by both curves. */
const PERCENT_FORMAT = {
  type: "custom" as const,
  minMove: 0.001,
  formatter: (v: number) => `${(v * 100).toFixed(1)}%`,
};

/** Resolve a theme CSS custom property off a live element (falls back to `dflt`). */
function cssVar(el: HTMLElement, name: string, dflt: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || dflt;
}

/**
 * A price-history chart of a market's two outcome shares — one curve per share
 * (YES + its complement NO), each an implied probability line — backed by the
 * indexer's series (`GET /api/markets/{pubkey}/candles`, recorded per-swap from a
 * websocket `accountSubscribe` on the pool). The vertical axis is fixed 0–100%
 * (probabilities span the full range and the two curves always sum to 100%). The
 * chart is themed from the live Auros CSS variables and polls for freshness.
 *
 * Samples are plotted on a UNIFORM time grid at the window's step ({@link gridStep}
 * — 1s for short windows, coarser for wide ones), empty steps carried forward as a
 * flat, interpolated line — so spacing is proportional and consistent. A wall-clock
 * tick (see {@link LIVE_TICK_MS}) grows the curve to the current second every
 * second, so the line's end tracks now and advances smoothly, not only on a trade.
 * The selector picks the visible WINDOW of history, not a candle bucket.
 *
 * Meaningful only for an Active market (the cYES/cNO pool exists); a market with
 * no points yet renders a quiet empty state rather than a blank frame.
 *
 * Beyond the background poll, `refreshKey` lets a parent force an immediate reload
 * on demand — the Trade panel derives it from the live reserves so a just-confirmed
 * trade (which moves the price) reloads the candles at once instead of waiting out
 * the poll, matching the instant update of the YES/NO readouts beside it.
 */
export function PriceChart({
  pubkey,
  refreshKey,
}: {
  pubkey: string;
  /** Change this to force an out-of-band candle reload (e.g. after a trade). */
  refreshKey?: string | number;
}) {
  const indexer = useIndexer();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const yesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const noRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [windowSecs, setWindowSecs] = useState<number>(3600);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState(false);
  // Cached raw candles (sparse), plus the plotted window's trailing step + its
  // carried value, so the wall-clock tick can extend the curve without a refetch.
  const candlesRef = useRef<CandleDto[]>([]);
  const plottedStepRef = useRef<number>(0);
  const carriedCloseRef = useRef<number | null>(null);

  // (Re)plot the window from the cached candles: a uniform grid at the window's step
  // (1s for short windows → true per-second resolution), gaps carried forward. `fit`
  // frames the whole window (mount / window change / trade); a plain poll skips it so
  // the live scroll isn't yanked back every 15s.
  const replot = useCallback(
    (fit: boolean) => {
      const step = gridStep(windowSecs);
      const grid = buildGrid(candlesRef.current, step, Math.floor(Date.now() / 1000), gridBars(windowSecs));
      yesRef.current?.setData(grid.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      noRef.current?.setData(grid.map((p) => ({ time: p.time as UTCTimestamp, value: 1 - p.value })));
      const last = grid[grid.length - 1];
      plottedStepRef.current = last ? last.time : 0;
      carriedCloseRef.current = last ? last.value : null;
      if (fit) chartRef.current?.timeScale().fitContent();
    },
    [windowSecs],
  );

  // Grow the curve to the present: append one carried-forward point per elapsed step
  // (1s on short windows), so the line's end tracks the current second and advances
  // smoothly by TIME — not only on trades. Appending at the right edge auto-scrolls
  // the view to follow. `Math.max` keeps the edge from stepping behind the last
  // plotted point (client/server clock skew), which would otherwise reject the update.
  const rollForward = useCallback(() => {
    const v = carriedCloseRef.current;
    if (v === null) return;
    const step = gridStep(windowSecs);
    const nowStep = Math.floor(Date.now() / 1000 / step) * step;
    let b = plottedStepRef.current;
    while (nowStep > b) {
      b += step;
      yesRef.current?.update({ time: b as UTCTimestamp, value: v });
      noRef.current?.update({ time: b as UTCTimestamp, value: 1 - v });
    }
    plottedStepRef.current = Math.max(plottedStepRef.current, b);
  }, [windowSecs]);

  // Create the chart once, themed from the resolved CSS variables.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const yesColor = cssVar(el, "--color-chestnut", "#8fe9dd");
    const noColor = cssVar(el, "--color-ember-orange", "#ff6f61");
    const text = cssVar(el, "--color-bronze", "#bbc7c6");
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
      // `shiftVisibleRangeOnNewBar` keeps the view following the live right edge as
      // per-second points are appended, so the growing "now" end stays in frame.
      timeScale: {
        borderColor: grid,
        timeVisible: true,
        secondsVisible: true,
        shiftVisibleRangeOnNewBar: true,
      },
      height: CHART_HEIGHT,
      width: Math.floor(el.clientWidth),
    });
    // One curve per share (YES + NO), both pinned to the 0–100% scale.
    const yes = chart.addSeries(LineSeries, {
      color: yesColor,
      lineWidth: 2,
      lineType: LineType.Curved,
      priceFormat: PERCENT_FORMAT,
      autoscaleInfoProvider: () => FULL_SCALE,
    });
    const no = chart.addSeries(LineSeries, {
      color: noColor,
      lineWidth: 2,
      lineType: LineType.Curved,
      priceFormat: PERCENT_FORMAT,
      autoscaleInfoProvider: () => FULL_SCALE,
    });
    chartRef.current = chart;
    yesRef.current = yes;
    noRef.current = no;

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) chart.applyOptions({ width: Math.floor(w) });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      yesRef.current = null;
      noRef.current = null;
    };
  }, []);

  // Load + poll sample anchors at the window's step; a changed `refreshKey` reloads
  // immediately (e.g. right after a trade). The first load (mount / window change /
  // trade) frames the window; the 15s poll refreshes values without re-framing.
  useEffect(() => {
    let active = true;
    const load = async (fit: boolean) => {
      try {
        const candles: CandleDto[] = await indexer.getCandles(pubkey, gridStep(windowSecs), CANDLE_LIMIT);
        if (!active) return;
        setError(false);
        setEmpty(candles.length === 0);
        candlesRef.current = candles;
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
  }, [indexer, pubkey, windowSecs, refreshKey, replot]);

  // Grow the curve to the current second, every second, so the line advances
  // smoothly by wall-clock — not only when a trade lands.
  useEffect(() => {
    const id = setInterval(rollForward, LIVE_TICK_MS);
    return () => clearInterval(id);
  }, [rollForward]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 font-inter text-[12px]">
          <span className="text-driftwood">Share price · history</span>
          <span className="inline-flex items-center gap-1.5 text-sepia">
            <span className="h-2 w-2 rounded-full bg-chestnut" aria-hidden="true" />
            YES
          </span>
          <span className="inline-flex items-center gap-1.5 text-sepia">
            <span className="h-2 w-2 rounded-full bg-ember-orange" aria-hidden="true" />
            NO
          </span>
        </div>
        <div
          role="group"
          aria-label="Window"
          className="inline-flex rounded-button border border-pebble p-0.5"
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
                  selected ? "bg-chestnut text-parchment" : "text-sepia hover:bg-pebble/50"
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
              className={`font-inter text-[13px] ${
                error ? "text-ember-orange" : "text-driftwood"
              }`}
            >
              {error
                ? "Couldn’t load price history."
                : "No price history yet — trades will populate the chart."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default PriceChart;
