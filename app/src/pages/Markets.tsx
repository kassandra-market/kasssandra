import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button, Card, SectionHeader } from "../components/ui";
import { MarketCard } from "../components/markets/MarketCard";
import { CategoricalCard } from "../components/markets/CategoricalCard";
import { OracleCard } from "../components/oracles/OracleCard";
import { UnifiedFilters, UnifiedStats } from "../components/unified/UnifiedDashboard";
import { useInitialReveal } from "../hooks/useInitialReveal";
import { useMarkets } from "../market/hooks/useMarkets";
import { useConfig } from "../market/hooks/useMarketDetail";
import { useOracles } from "../hooks/useOracles";
import { useOracleMeta } from "../hooks/useOracleMeta";
import type { OracleSummary } from "../data/oracles";
import { groupByOracle, isCategorical, type MarketSummary } from "../market/data/markets";
import {
  buildUnifiedEntries,
  deriveCombinedStats,
  deriveUnifiedCounts,
  entryOracleKey,
  filterByStage,
  matchesUnifiedQuery,
  sortUnified,
  type UnifiedFilter,
  type UnifiedSort,
} from "../lib/unifiedList";

function SkeletonCard() {
  return (
    <Card className="flex h-full animate-pulse flex-col gap-3" aria-hidden="true">
      <div className="flex items-center justify-between">
        <div className="h-6 w-20 rounded-tag bg-liquid-deep" />
        <div className="h-4 w-16 rounded-sm bg-liquid-deep" />
      </div>
      <div className="h-6 w-40 rounded-sm bg-liquid-deep" />
      <div className="h-4 w-24 rounded-sm bg-liquid-deep" />
      <div className="mt-2 h-4 w-full rounded-sm bg-liquid-deep" />
    </Card>
  );
}

const gridClass = "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3";

// Stable empty-array references so a not-yet-loaded source doesn't defeat the
// `useMemo`s below (a fresh `[]` literal every render would).
const NO_ORACLES: OracleSummary[] = [];
const NO_MARKETS: MarketSummary[] = [];

/**
 * The unified browse list at `/markets` (and `/oracles`, which redirects
 * here): every kassandra-market Market and every Kassandra oracle, merged one
 * entry per oracle. An oracle with ≥1 bound market renders as its market
 * card(s) (funding/trade CTA); an oracle with none yet renders as an oracle
 * card ({@link OracleCard}, the phase-gated management CTA). Every oracle
 * eventually resolves into a market once funded, so this is the single
 * "what's happening on the protocol" list rather than two disjoint pages.
 */
export default function Markets() {
  const { search } = useLocation();
  const oraclesState = useOracles();
  const marketsState = useMarkets();
  const config = useConfig();

  const oraclesReady = oraclesState.data !== undefined;
  const marketsReady = marketsState.data !== undefined;
  const stillLoading =
    (!oraclesReady && oraclesState.loading) || (!marketsReady && marketsState.loading);
  // Neither source ever produced data (and neither is still trying) — a hard
  // error, not a partial degrade.
  const bothFailed = !oraclesReady && !marketsReady && !stillLoading;

  const oracles = oraclesState.data ?? NO_ORACLES;
  const marketSummaries = marketsState.data ?? NO_MARKETS;
  const groups = useMemo(() => groupByOracle(marketSummaries), [marketSummaries]);

  // Stagger the grid in only on the first data render (not on filter/sort/poll).
  const stagger = useInitialReveal(!stillLoading && (oracles.length > 0 || groups.length > 0));

  const notInitialized = !config.loading && config.data === null;

  const allEntries = useMemo(() => buildUnifiedEntries(oracles, groups), [oracles, groups]);
  const counts = useMemo(() => deriveUnifiedCounts(allEntries), [allEntries]);
  const stats = useMemo(() => deriveCombinedStats(oracles, marketSummaries), [oracles, marketSummaries]);

  // On-chain oracle metadata (question + option labels) for EVERY entry's
  // oracle, fetched once for the whole loaded set so filtering/sorting/search
  // doesn't refetch.
  const metaKeys = useMemo(() => allEntries.map(entryOracleKey), [allEntries]);
  const meta = useOracleMeta(metaKeys);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<UnifiedFilter>("all");
  const [sort, setSort] = useState<UnifiedSort>("value");

  const visible = useMemo(() => {
    const searched = allEntries.filter((e) => matchesUnifiedQuery(e, query, meta.get(entryOracleKey(e))?.subject));
    return sortUnified(filterByStage(searched, filter), sort);
  }, [allEntries, query, filter, sort, meta]);

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-20">
      <SectionHeader
        as="h1"
        eyebrow="Markets"
        line1="Every dispute,"
        line2="funded or not"
        paragraph="Every prediction market on the program, and every oracle dispute behind it — funding, active, resolved, or still finding its answer."
      />

      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <Link to={{ pathname: "/oracles/new", search }}>
          <Button variant="GhostOutline">Create oracle</Button>
        </Link>
        <Link to="/markets/new">
          <Button variant="PrimaryChestnut">Create a market</Button>
        </Link>
      </div>

      {stillLoading ? (
        <>
          <div
            className="mt-10 animate-pulse rounded-card border border-hairline bg-liquid-kelp px-6 py-5"
            aria-hidden="true"
          >
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-2">
                <div className="h-3 w-32 rounded-sm bg-liquid-deep" />
                <div className="h-8 w-40 rounded-sm bg-liquid-deep" />
              </div>
              <div className="flex flex-wrap gap-6">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <div className="h-6 w-8 rounded-sm bg-liquid-deep" />
                    <div className="h-3 w-16 rounded-sm bg-liquid-deep" />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-8 text-center font-inter text-[15px] text-silver" role="status">
            Reading the chain…
          </p>
          <div className={`mt-8 ${gridClass}`} aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </>
      ) : bothFailed ? (
        <div className="mx-auto mt-12 max-w-[640px]">
          <Card className="flex flex-col items-center gap-4 text-center">
            <p className="font-inter text-body text-silver">Could not load the oracle or market lists.</p>
            <p className="font-mono text-[12px] text-silver">
              {oraclesState.error?.message ?? marketsState.error?.message}
            </p>
            <Button
              variant="PrimaryChestnut"
              onClick={() => {
                oraclesState.refetch();
                marketsState.refetch();
              }}
            >
              Retry
            </Button>
          </Card>
        </div>
      ) : (
        <>
          {oraclesState.error && marketsReady ? (
            <p className="mt-6 font-inter text-[13px] text-coral">
              Couldn’t load oracles: {oraclesState.error.message}
            </p>
          ) : null}
          {marketsState.error && oraclesReady ? (
            <p className="mt-6 font-inter text-[13px] text-coral">
              {notInitialized
                ? "The kassandra-market program is not set up — its on-chain Config account is missing."
                : `Couldn’t load markets: ${marketsState.error.message}`}
            </p>
          ) : null}

          <UnifiedStats stats={stats} />
          <UnifiedFilters
            search={query}
            onSearch={setQuery}
            filter={filter}
            onFilter={setFilter}
            sort={sort}
            onSort={setSort}
            counts={counts}
            shown={visible.length}
          />

          {allEntries.length === 0 ? (
            <div className="mx-auto mt-12 max-w-[640px] text-center">
              <Card>
                <p className="font-inter text-body text-silver">
                  Nothing found yet. The program is live but has no oracles or markets — create the
                  first one.
                </p>
              </Card>
            </div>
          ) : visible.length === 0 ? (
            <div className="mx-auto mt-12 max-w-[640px] text-center">
              <Card>
                <p className="font-inter text-[15px] text-silver">
                  No oracles or markets match the current search and filters.
                </p>
              </Card>
            </div>
          ) : (
            <div className={`mt-8 ${gridClass}`}>
              {(() => {
                // Running flat index across the (nested) output, so the
                // first-load stagger cascades in visual order.
                let i = 0;
                return visible.map((entry) => {
                  if (entry.kind === "oracle") {
                    return (
                      <OracleCard
                        key={entry.summary.pubkey}
                        summary={entry.summary}
                        search={search}
                        meta={meta.get(entry.summary.pubkey)}
                        enterIndex={stagger ? i++ : undefined}
                      />
                    );
                  }
                  const group = entry.group;
                  return isCategorical(group) ? (
                    <CategoricalCard
                      key={group.oracle}
                      group={group}
                      meta={meta.get(group.oracle)}
                      enterIndex={stagger ? i++ : undefined}
                      onSuccess={marketsState.refetchAfterWrite}
                    />
                  ) : (
                    group.markets.map((summary) => (
                      <MarketCard
                        key={summary.pubkey}
                        summary={summary}
                        meta={meta.get(summary.market.oracle.toString())}
                        enterIndex={stagger ? i++ : undefined}
                        onSuccess={marketsState.refetchAfterWrite}
                      />
                    ))
                  );
                });
              })()}
            </div>
          )}
        </>
      )}
    </main>
  );
}
