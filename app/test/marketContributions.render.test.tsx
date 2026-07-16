/**
 * Regression coverage for the contributions ledger: a post-activation liquidity
 * provider records its position in `lateLp` (LP tokens) with `amount == 0` (no
 * Funding stake), so the row must show the LP it ADDED — not a misleading "0 KASS".
 * A pure funder still shows KASS; a contributor who did both shows both.
 */
import { vi } from "vitest";
import { MarketStatus } from "@kassandra-market/markets";
import { Phase } from "@kassandra-market/oracles";

const PUB = "Market11111111111111111111111111111111111111";
const ORACLE = "Orac1e1111111111111111111111111111111111111";

// A Resolved market (isActive === false → default tab is Liquidity, which holds
// the ledger) with three contributions: a funder, a pure late LP, and both.
const detail = {
  pubkey: PUB,
  market: {
    status: MarketStatus.Resolved,
    outcomeIndex: 0,
    settled: true,
    openContributions: 3,
    totalContributed: 1_000_000_000n,
    minLiquidity: 1_000_000_000n,
    feeBps: 0,
    feeCollected: true,
    oracle: { toString: () => ORACLE },
  },
  oracle: { optionsCount: 2, phase: Phase.Resolved, resolvedOption: 0 },
  reserves: null,
  contributions: [
    { pubkey: "C1", contribution: { contributor: { toString: () => "Fund1111" }, amount: 1_000_000_000n, lateLp: 0n, claimed: false } },
    { pubkey: "C2", contribution: { contributor: { toString: () => "Late1111" }, amount: 0n, lateLp: 500_000_000n, claimed: false } },
    { pubkey: "C3", contribution: { contributor: { toString: () => "Both1111" }, amount: 2_000_000_000n, lateLp: 3_000_000_000n, claimed: false } },
  ],
};

vi.mock("../src/market/hooks/useMarketDetail", () => ({
  useMarketDetail: () => ({ data: detail, loading: false, error: undefined, refetch: () => {}, refetchAfterWrite: () => {} }),
  useConfig: () => ({ data: undefined, loading: false, error: undefined, refetch: () => {} }),
}));
vi.mock("../src/hooks/useOracleMeta", () => ({ useOracleMeta: () => new Map() }));
// Stub the context-heavy action surfaces so only the ledger + presentational
// panels render.
vi.mock("../src/components/markets/actions/MarketActions", () => ({
  MarketLiquidityActions: () => null,
  MarketLifecycleActions: () => null,
}));
vi.mock("../src/components/markets/actions/GroupLiquidityPanel", () => ({
  GroupLiquidityPanel: () => null,
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import MarketDetail from "../src/pages/MarketDetail";

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/markets/${PUB}`]}>
      <Routes>
        <Route path="/markets/:pubkey" element={<MarketDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("contributions ledger — liquidity vs funding", () => {
  it("shows added LP for a pure late-LP contribution (not 0 KASS)", () => {
    const html = render();
    // The late LP added 0.5 LP with no funding stake — the row surfaces the LP.
    expect(html).toMatch(/0\.5\s*LP/);
    // A funder's KASS stake still shows.
    expect(html).toMatch(/1\s*KASS/);
    // The both-cohort contributor shows KASS · LP together.
    expect(html).toMatch(/2\s*KASS\s*·\s*3\s*LP/);
  });
});
