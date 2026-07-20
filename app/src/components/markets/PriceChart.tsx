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

/**
 * Fetch enough sparse sample anchors to cover the widest window (server-clamped).
 * Every WINDOWS entry's {@link gridBars} is bounded by {@link MAX_POINTS} by
 * construction, so this covers all of them — pinned to that constant (not a
 * separate magic number) so the fetch limit can never fall below a window's
 * bar count again and silently truncate a busy market's history.
 */
const CANDLE_LIMIT = MAX_POINTS;

const CHART_HEIGHT = 280;

/**
 * Every plotted curve is a probability, so the price axis is PINNED to the full
 * 0..1 (0–100%) range rather than autoscaling to the data. Returned from each
 * series' `autoscaleInfoProvider`.
 */
const FULL_SCALE = { priceRange: { minValue: 0, maxValue: 1 } };

/** Percent price format shared by every curve. */
const PERCENT_FORMAT = {
  type: "custom" as const,
  minMove: 0.001,
  formatter: (v: number) => `${(v * 100).toFixed(1)}%`,
};

/** Resolve a theme CSS custom property off a live element (falls back to `dflt`). */
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
 * Samples are plotted on a UNIFORM time grid at the window's step ({@link gridStep}
 * — 1s for short windows, coarser for wide ones), empty steps carried forward as a
 * flat, interpolated line — so spacing is proportional and consistent. A wall-clock
 * tick (see {@link LIVE_TICK_MS}) grows the curve to the current second every
 * second, so the line's end tracks now and advances smoothly, not only on a trade.
 * The selector picks the visible WINDOW of history, not a candle bucket — and the
 * x-axis always spans exactly that window, even for a market younger than it
 * (see {@link buildWindowedGrid}'s whitespace padding + the explicit
 * `setVisibleRange` in `replot`), rather than zooming in to whatever data exists.
 *
 * Renders a quiet empty state when every plotted market has no points yet.
 */
export function PriceChart({
  series,
  refreshKey,
}: {
  series: ChartSeriesSpec[];
  /** Change this to force an out-of-band candle reload (e.g. after a trade). */
  refreshKey?: string | number;
}) {
  const indexer = useIndexer();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const [windowSecs, setWindowSecs] = useState<number>(3600);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState(false);
  // Cached raw candles (sparse) per unique pubkey, plus the plotted window's
  // trailing step + its carried value, so the wall-clock tick can extend the
  // curve without a refetch. Keyed by pubkey (not spec key) so a binary
  // market's YES + NO specs share one fetch and one carry state.
  const pubkeyStateRef = useRef<Map<string, PubkeyState>>(new Map());
  // Latest `series` value, kept current on every render (not just effects) so
  // `replot`/`rollForward` can stay referentially stable across renders that
  // pass a new-but-equivalent `series` array (e.g. TradePanel rebuilds it
  // inline on every keystroke) while still reading fresh data when they fire.
  const seriesRef = useRef(series);
  seriesRef.current = series;

  // (Re)plot the window from the cached candles: a uniform grid at the window's step
  // (1s for short windows → true per-second resolution), gaps carried forward, the
  // FRONT padded with whitespace out to the full window when the market is younger
  // than the selected scale ({@link buildWindowedGrid}). `fit` frames the whole
  // SELECTED window (mount / window change / trade); a plain poll skips it so the
  // live scroll isn't yanked back every 15s.
  const replot = useCallback(
    (fit: boolean) => {
      const step = gridStep(windowSecs);
      const nowSec = Math.floor(Date.now() / 1000);
      for (const spec of seriesRef.current) {
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
    [windowSecs],
  );

  // Grow every curve to the present: append one carried-forward point per elapsed
  // step (1s on short windows), so each line's end tracks the current second and
  // advances smoothly by TIME — not only on trades. Computed once per unique
  // pubkey, then fanned out to every spec referencing it (inverted as needed).
  const rollForward = useCallback(() => {
    const step = gridStep(windowSecs);
    const nowStep = Math.floor(Date.now() / 1000 / step) * step;
    for (const [pubkey, st] of pubkeyStateRef.current) {
      if (st.carriedClose === null) continue;
      let b = st.plottedStep;
      const specsForPubkey = seriesRef.current.filter((s) => s.pubkey === pubkey);
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
  }, [windowSecs]);

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
      // `shiftVisibleRangeOnNewBar` keeps the view following the live right edge as
      // per-second points are appended, so the growing "now" end stays in frame.
      timeScale: {
        borderColor: grid,
        timeVisible: true,
        secondsVisible: true,
        shiftVisibleRangeOnNewBar: true,
        // lightweight-charts' default `minBarSpacing` (0.5px) silently CLAMPS
        // `setVisibleRange` to fewer bars than requested once a window's point
        // count (up to MAX_POINTS, see priceGrid.ts) needs sub-0.5px spacing at
        // the container's width — e.g. a 1D window's 3,600 bars need ~0.14px
        // each in a ~500px chart, so the axis silently narrowed to ~6h instead
        // of the requested 24h. A single smooth LINE (not discrete bars/candles)
        // reads identically whether points are 0.5px or 0.02px apart, so drop
        // the floor low enough that the selected window is never clamped.
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
  // changes — simplest correct option since belief lists change rarely (a
  // sibling activating), not on every render.
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
  // changed `refreshKey` reloads immediately (e.g. right after a trade). The
  // first load (mount / window change / trade) frames the window; the 15s
  // poll refreshes values without re-framing.
  useEffect(() => {
    let active = true;
    const pubkeys = [...new Set(series.map((s) => s.pubkey))];
    const load = async (fit: boolean) => {
      try {
        const results = await Promise.allSettled(
          pubkeys.map((pk) => indexer.getCandles(pk, gridStep(windowSecs), CANDLE_LIMIT)),
        );
        if (!active) return;
        let anyData = false;
        pubkeys.forEach((pk, i) => {
          const result = results[i];
          const st = pubkeyStateRef.current.get(pk) ?? { candles: [], plottedStep: 0, carriedClose: null };
          // A rejected fetch (e.g. a sibling the indexer hasn't backfilled yet)
          // leaves `st.candles` as whatever was already cached for this pubkey
          // rather than clobbering it with `[]` — a transient per-pubkey
          // failure shouldn't wipe an already-loaded curve.
          if (result.status === "fulfilled") {
            st.candles = result.value;
            pubkeyStateRef.current.set(pk, st);
          }
          if (st.candles.length > 0) anyData = true;
        });
        // `allSettled` never rejects, so a total backend outage (every pubkey
        // rejected, and none has ever had real data — cached or fresh) must be
        // detected here rather than relying on the outer catch. A genuinely
        // partial failure (some succeed, or a failing pubkey still has stale
        // cached data) must NOT set `error` — that's the case the switch to
        // `allSettled` exists to protect.
        const allRejected = results.every((r) => r.status === "rejected");
        setError(allRejected && !anyData);
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

  // Grow every curve to the current second, every second, so each line advances
  // smoothly by wall-clock — not only when a trade lands.
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
              className={`font-inter text-[13px] ${
                error ? "text-coral" : "text-silver"
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
