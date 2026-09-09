/**
 * Cross-navigation: the market detail must NOT link to `/oracles/` (the
 * oracles program is gone). The GPT Subject address is shown as an address
 * row on Details, not as a route.
 */
import { vi } from "vitest";
import { MarketStatus, Phase } from "@kassandra-market/markets";

const PUB = "Market11111111111111111111111111111111111111";
const ORACLE = "Orac1e1111111111111111111111111111111111111";

const detail = {
  pubkey: PUB,
  market: {
    status: MarketStatus.Active,
    outcomeIndex: 0,
    settled: false,
    openContributions: 0,
    totalContributed: 1_000_000_000n,
    minLiquidity: 1_000_000_000n,
    feeBps: 0,
    feeCollected: false,
    oracle: { toString: () => ORACLE },
    creator: { toString: () => "Creator1" },
    baseMint: { toString: () => "Kass1" },
    escrowVault: { toString: () => "Escrow1" },
    question: { toString: () => "Q1" },
    vault: { toString: () => "Vault1" },
    yesMint: { toString: () => "Yes1" },
    noMint: { toString: () => "No1" },
    amm: { toString: () => "Amm1" },
    lpMint: { toString: () => "Lp1" },
    lpVault: { toString: () => "LpV1" },
    grossLpTotal: 0n,
    activationLp: 0n,
    activationContributed: 0n,
  },
  oracle: { optionsCount: 2, phase: Phase.Open, resolvedOption: 0 },
  reserves: null,
  contributions: [],
};

vi.mock("../src/market/hooks/useMarketDetail", () => ({
  useMarketDetail: () => ({ data: detail, loading: false, error: undefined, refetch: () => {}, refetchAfterWrite: () => {} }),
  useConfig: () => ({ data: undefined, loading: false, error: undefined, refetch: () => {} }),
}));
vi.mock("../src/market/hooks/useOracleGroup", () => ({
  useOracleGroup: () => ({
    siblings: [],
    isGroup: false,
    funding: [],
    active: [],
    claimable: [],
    depositable: [],
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("@solana/wallet-adapter-react", () => ({ useWallet: () => ({ publicKey: null }) }));
vi.mock("../src/components/markets/actions/MarketActions", () => ({
  MarketLiquidityActions: () => null,
  MarketLifecycleActions: () => null,
}));
vi.mock("../src/components/markets/actions/GroupLiquidityPanel", () => ({
  GroupLiquidityPanel: () => null,
}));
vi.mock("../src/components/markets/actions/TradePanel", () => ({ TradePanel: () => null }));
vi.mock("../src/components/markets/PriceChart", () => ({ PriceChart: () => null }));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import MarketDetail from "../src/pages/MarketDetail";

function render(query = ""): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/markets/${PUB}${query}`]}>
      <Routes>
        <Route path="/markets/:pubkey" element={<MarketDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("market detail — no oracle routes", () => {
  it("does not link the header to /oracles/", () => {
    const html = render();
    expect(html).not.toContain(`href="/oracles/${ORACLE}"`);
    expect(html).not.toContain("View oracle");
  });

  it("does not link the Details tab to /oracles/", () => {
    const html = render("?tab=details");
    expect(html).not.toContain("Open oracle page");
    expect(html).not.toContain(`href="/oracles/`);
    expect(html).toContain("GPT subject");
  });
});
