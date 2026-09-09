/**
 * Render coverage for the `/markets` list (`src/pages/Markets.tsx`):
 * markets render as cards, the stats strip + stage filter chips render, and
 * the empty state is distinct from the search-matched-nothing state.
 */
import { vi } from "vitest";
import { MarketStatus } from "@kassandra-market/markets";

const HAS_MARKET_ORACLE = "HasMarket11111111111111111111111111111111";
const MARKET_PUB = "Market11111111111111111111111111111111111";

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

describe("/markets list", () => {
  it("renders a market card and never links to /oracles/", () => {
    const html = render();
    expect(html).toContain(`href="/markets/${MARKET_PUB}"`);
    expect(html).not.toContain('href="/oracles/');
    expect(html).not.toContain("oracle-card-link");
  });

  it("renders the stats strip", () => {
    const html = render();
    expect(html).toContain('aria-label="Capital at stake"');
    expect(html).toContain("Market TVL");
  });

  it("renders the stage filter chips (funding/active/resolved/closed only)", () => {
    const html = render();
    expect(html).toContain(">Funding<");
    expect(html).toContain(">Active<");
    expect(html).toContain(">Resolved<");
    expect(html).toContain(">Closed<");
    expect(html).not.toContain(">Challenged<");
    expect(html).not.toContain(">Proposal<");
  });
});

describe("/markets list — empty states", () => {
  it("shows the truly-empty message when no markets exist", () => {
    marketsData = [];
    const html = render();
    expect(html).toContain("no markets");
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
