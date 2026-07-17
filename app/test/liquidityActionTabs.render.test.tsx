/**
 * The Active-market liquidity surface exposes Deposit + Claim as two tabs of one
 * panel (not stacked cards). Deposit is the default tab, so its ticket renders and
 * the Claim panel stays dormant; both tab controls are present in the tablist.
 */
import { vi } from "vitest";
import { MarketStatus } from "@kassandra-market/markets";

vi.mock("../src/market/hooks/useWriteAction", () => ({
  useWriteAction: () => ({
    status: { kind: "idle" },
    address: "Lp111111",
    connected: true,
    indexer: {},
    run: async () => {},
  }),
}));
vi.mock("../src/market/hooks/useKassBalance", () => ({
  useKassBalance: () => ({ balance: 5_000_000_000n, loading: false, refetch: () => {} }),
}));
vi.mock("../src/components/markets/actions/ConnectGate", () => ({
  ConnectGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarketLiquidityActions } from "../src/components/markets/actions/MarketActions";

const detail = {
  pubkey: "Market1111",
  market: { status: MarketStatus.Active, kassMint: { toString: () => "Kass1111" }, lpMint: { toString: () => "Lp1111" } },
  contributions: [],
  reserves: { base: 1_000_000_000n, quote: 1_000_000_000n },
} as never;

function render(): string {
  return renderToStaticMarkup(<MarketLiquidityActions detail={detail} refetch={() => {}} />);
}

describe("Active liquidity — Deposit / Claim tabs", () => {
  it("renders a tablist with both Deposit and Claim tabs", () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Deposit");
    expect(html).toContain("Claim");
  });

  it("defaults to the Deposit tab (its ticket renders, selected)", () => {
    const html = render();
    // Deposit is selected; Claim is not.
    expect(html).toMatch(/aria-selected="true"[^>]*>\s*Deposit/);
    expect(html).toMatch(/aria-selected="false"[^>]*>\s*Claim/);
    // The Deposit ticket body renders under it.
    expect(html).toContain("Enter deposit amount");
  });
});
