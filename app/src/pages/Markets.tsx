import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, SectionHeader } from "../components/ui";
import { MarketCard } from "../components/markets/MarketCard";
import { CategoricalCard } from "../components/markets/CategoricalCard";
import { UnifiedFilters, UnifiedStats } from "../components/unified/UnifiedDashboard";
import { useInitialReveal } from "../hooks/useInitialReveal";
import { useMarkets } from "../market/hooks/useMarkets";
import { useConfig } from "../market/hooks/useMarketDetail";
import { groupByOracle, isCategorical, type MarketSummary } from "../market/data/markets";
import {
  deriveMarketCounts,
  deriveMarketStats,
  filterByStage,
  matchesMarketQuery,
  sortMarkets,
  type MarketFilter,
  type MarketSort,
} from "../market/lib/marketList";

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

const NO_MARKETS: MarketSummary[] = [];

/**
 * The browse list at `/markets`: every kassandra-market Market, grouped by its
 * GPT Subject (`Market.oracle`). Binary subjects render as a {@link MarketCard};
 * categorical subjects (N>2) render as one {@link CategoricalCard}.
 */
export default function Markets() {
  const marketsState = useMarkets();
  const config = useConfig();

  const marketsReady = marketsState.data !== undefined;
  const stillLoading = !marketsReady && marketsState.loading;
  const failed = !marketsReady && !stillLoading;

  const marketSummaries = marketsState.data ?? NO_MARKETS;
  const groups = useMemo(() => groupByOracle(marketSummaries), [marketSummaries]);

  const stagger = useInitialReveal(!stillLoading && groups.length > 0);

  const notInitialized = !config.loading && config.data === null;

  const counts = useMemo(() => deriveMarketCounts(groups), [groups]);
  const stats = useMemo(() => deriveMarketStats(marketSummaries), [marketSummaries]);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MarketFilter>("all");
  const [sort, setSort] = useState<MarketSort>("value");

  const visible = useMemo(() => {
    const searched = groups.filter((g) => matchesMarketQuery(g, query));
    return sortMarkets(filterByStage(searched, filter), sort);
  }, [groups, query, filter, sort]);

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-20">
      <SectionHeader
        as="h1"
        eyebrow="Markets"
        line1="Every market,"
        line2="open or settled"
        paragraph="Prediction markets on Kassandra, resolved by MagicBlock GPT — funding, active, resolved, or closed."
      />

      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
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
                {Array.from({ length: 1 }, (_, i) => (
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
      ) : failed ? (
        <div className="mx-auto mt-12 max-w-[640px]">
          <Card className="flex flex-col items-center gap-4 text-center">
            <p className="font-inter text-body text-silver">Could not load the market list.</p>
            <p className="font-mono text-[12px] text-silver">{marketsState.error?.message}</p>
            <Button variant="PrimaryChestnut" onClick={() => marketsState.refetch()}>
              Retry
            </Button>
          </Card>
        </div>
      ) : (
        <>
          {marketsState.error ? (
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

          {groups.length === 0 ? (
            <div className="mx-auto mt-12 max-w-[640px] text-center">
              <Card>
                <p className="font-inter text-body text-silver">
                  Nothing found yet. The program is live but has no markets — create the first one.
                </p>
              </Card>
            </div>
          ) : visible.length === 0 ? (
            <div className="mx-auto mt-12 max-w-[640px] text-center">
              <Card>
                <p className="font-inter text-[15px] text-silver">
                  No markets match the current search and filters.
                </p>
              </Card>
            </div>
          ) : (
            <div className={`mt-8 ${gridClass}`}>
              {(() => {
                let i = 0;
                return visible.map((group) =>
                  isCategorical(group) ? (
                    <CategoricalCard
                      key={group.oracle}
                      group={group}
                      enterIndex={stagger ? i++ : undefined}
                      onSuccess={marketsState.refetchAfterWrite}
                    />
                  ) : (
                    group.markets.map((summary) => (
                      <MarketCard
                        key={summary.pubkey}
                        summary={summary}
                        enterIndex={stagger ? i++ : undefined}
                        onSuccess={marketsState.refetchAfterWrite}
                      />
                    ))
                  ),
                );
              })()}
            </div>
          )}
        </>
      )}
    </main>
  );
}
