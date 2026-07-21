import { useMemo } from "react";
import { MarketStatus } from "@kassandra-market/markets";
import type { MarketDetail as MarketDetailData, MarketSummary } from "../../../market/data/markets";
import type { OracleGroupState } from "../../../market/hooks/useOracleGroup";
import { formatProbability, normalizeAcrossGroup, normalizeOddsAcrossGroup } from "../../../market/lib/marketView";
import { beliefProbability, computeBeliefs, defaultBeliefKey, type Belief } from "../../../market/lib/beliefs";
import { PriceChart, type ChartSeriesSpec } from "../PriceChart";
import { TradePanel } from "./TradePanel";

/**
 * Fixed categorical palette for belief curves/pills, cycling past its length.
 * LITERAL hex only — `PriceChart`'s curves are drawn on an HTML canvas via
 * lightweight-charts, and a raw `var(--color-x)` string passed as a canvas
 * `strokeStyle` is an invalid CSS <color> value there (canvas doesn't resolve
 * custom properties — only the CSS cascade does, e.g. an inline SVG `stroke`),
 * so the browser silently ignores the assignment and the line renders solid
 * black instead. The first two entries mirror `--color-aqua`/`--color-coral`
 * (`app/src/index.css`) as literals for that reason; the legend pills below
 * still take the same value via a plain inline `style`, which resolves it
 * fine since that's real CSS, not a canvas call.
 */
const BELIEF_COLORS = [
  "#8fe9dd",
  "#ff6f61",
  "#c9a5ff",
  "#ffd166",
  "#7fd1ae",
  "#6fb7ff",
];

function colorFor(index: number): string {
  return BELIEF_COLORS[index % BELIEF_COLORS.length];
}

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
    const others = group.active.filter((m) => m.market.outcomeIndex !== market.outcomeIndex);
    return [...current, ...others].sort((a, b) => a.market.outcomeIndex - b.market.outcomeIndex);
  }, [group.active, pubkey, market, reserves, isActive]);

  const beliefs = useMemo(
    () => computeBeliefs({ isGroup: group.isGroup, tradable, options }),
    [group.isGroup, tradable, options],
  );

  if (beliefs.length === 0) return null;

  const normalizedProbabilities = group.isGroup
    ? normalizeOddsAcrossGroup(beliefs.map((b) => beliefProbability(b)))
    : normalizeAcrossGroup(beliefs.map((b) => beliefProbability(b)));

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
            <BeliefPill key={b.key} belief={b} color={colorFor(i)} probability={normalizedProbabilities[i]} />
          ))}
        </div>
        <PriceChart series={series} isGroup={group.isGroup} refreshKey={chartRefreshKey} />
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
