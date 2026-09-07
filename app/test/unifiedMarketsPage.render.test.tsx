/**
 * Render coverage for the unified `/markets` list (`src/pages/Markets.tsx`):
 * an oracle with a bound market renders ONLY as its market card (never also as
 * a bare oracle card), an oracle with none yet renders as an oracle card with
 * its phase-gated management CTA, the combined stats strip + stage filter
 * chips render, and the "nothing loaded yet" empty state is distinct from the
 * "search matched nothing" state. Data hooks + write-path hooks are stubbed
 * (this is a structural render test, not a write-flow test — those are
 * covered by `marketCardCta`/`categoricalCardCta`/`oracleCardCta` render tests).
 */
import { vi } from "vitest";
import { MarketStatus } from "@kassandra-market/markets";
import { Phase } from "@kassandra-market/oracles";

const HAS_MARKET_ORACLE = "HasMarket11111111111111111111111111111111";
const ORPHAN_ORACLE = "Orphan111111111111111111111111111111111111";
const MARKET_PUB = "Market11111111111111111111111111111111111";

function makeOracle(over: Record<string, unknown>) {
  return {
    accountType: 1,
    deadline: 0n,
    phaseEndsAt: 0n,
    twapWindow: 0n,
    optionsCount: 2,
    phase: Phase.Proposal,
    proposerCount: 0,
    factCount: 0,
    totalOracleStake: 0n,
    bondPool: 0n,
    disputeBondTotal: 0n,
    resolvedOption: 0xff,
    ...over,
  };
}

let oraclesData: { pubkey: string; oracle: unknown }[] = [
  { pubkey: HAS_MARKET_ORACLE, oracle: makeOracle({ phase: Phase.Proposal }) },
  { pubkey: ORPHAN_ORACLE, oracle: makeOracle({ phase: Phase.Challenge, deadline: 10_000_000_000n }) },
];
let marketsData: unknown[] = [
  {
    pubkey: MARKET_PUB,
    market: {
      status: MarketStatus.Active,
      outcomeIndex: 0,
      totalContributed: 500_000_000_000n,
      minLiquidity: 100_000_000_000n,
      baseMint: { toString: () => "Kass1111111111111111111111111111111111111111" },
      oracle: { toString: () => HAS_MARKET_ORACLE },
    },
    reserves: { base: 6n, quote: 4n },
    oracleOptionsCount: 2,
  },
];

vi.mock("../src/hooks/useOracles", () => ({
  useOracles: () => ({ data: oraclesData, loading: false, error: undefined, refetch: () => {} }),
}));
vi.mock("../src/market/hooks/useMarkets", () => ({
  useMarkets: () => ({
    data: marketsData,
    loading: false,
    error: undefined,
    refetch: () => {},
    refetchAfterWrite: () => {},
  }),
}));
vi.mock("../src/market/hooks/useMarketDetail", () => ({
  useConfig: () => ({ data: {}, loading: false, error: undefined, refetch: () => {} }),
}));
vi.mock("../src/market/hooks/useWriteAction", () => ({
  useWriteAction: () => ({ status: { kind: "idle" }, address: null, connected: false, indexer: {}, run: async () => {} }),
}));
vi.mock("../src/market/hooks/useActionSequence", () => ({
  useActionSequence: () => ({ statuses: [], busy: false, connected: false, address: null, allDone: false, run: async () => {}, reset: () => {} }),
}));
vi.mock("../src/market/hooks/useSolBalance", () => ({
  useSolBalance: () => ({ balance: null, loading: false, refetch: () => {} }),
}));
vi.mock("../src/market/lib/indexer", () => ({
  useIndexer: () => ({}),
}));
vi.mock("../src/components/markets/actions/ConnectGate", () => ({
  ConnectGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Markets from "../src/pages/Markets";

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <Markets />
    </MemoryRouter>,
  );
}

describe("unified /markets list", () => {
  it("renders an oracle with a bound market ONLY as its market card, not also as a bare oracle card", () => {
    const html = render();
    expect(html).toContain(`href="/markets/${MARKET_PUB}"`);
    // The orphan oracle's own detail link is present…
    expect(html).toContain(`href="/oracles/${ORPHAN_ORACLE}`);
    // …but exactly ONE oracle-card renders (the orphan) — the has-market
    // oracle never ALSO gets a bare oracle card (only its market card, whose
    // header byline links to the same oracle address).
    const oracleCardLinks = (html.match(/<a[^>]*class="oracle-card-link/g) ?? []).length;
    expect(oracleCardLinks).toBe(1);
  });

  it("renders the combined stats strip", () => {
    const html = render();
    expect(html).toContain('aria-label="Capital at stake"');
    expect(html).toContain("Market TVL");
  });

  it("renders the stage filter chips, including the market-only stages", () => {
    const html = render();
    expect(html).toContain(">Funding<");
    expect(html).toContain(">Active<");
    expect(html).toContain(">Challenged<");
  });

  it("shows the orphan oracle's management CTA (phase-gated, not an inline form)", () => {
    const html = render();
    // Challenge phase's card action routes to the Manage tab per oracleCardAction.
    expect(html).toContain(`href="/oracles/${ORPHAN_ORACLE}?tab=`);
  });
});

describe("unified /markets list — empty states", () => {
  it("shows the truly-empty message when neither oracles nor markets exist", () => {
    oraclesData = [];
    marketsData = [];
    const html = render();
    expect(html).toContain("no oracles or markets");
    oraclesData = [
      { pubkey: HAS_MARKET_ORACLE, oracle: makeOracle({ phase: Phase.Proposal }) },
      { pubkey: ORPHAN_ORACLE, oracle: makeOracle({ phase: Phase.Challenge, deadline: 10_000_000_000n }) },
    ];
    marketsData = [
      {
        pubkey: MARKET_PUB,
        market: {
          status: MarketStatus.Active,
          outcomeIndex: 0,
          totalContributed: 500_000_000_000n,
          minLiquidity: 100_000_000_000n,
          baseMint: { toString: () => "Kass1111111111111111111111111111111111111111" },
          oracle: { toString: () => HAS_MARKET_ORACLE },
        },
        reserves: { base: 6n, quote: 4n },
        oracleOptionsCount: 2,
      },
    ];
  });
});
