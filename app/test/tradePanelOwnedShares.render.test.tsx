/**
 * Render coverage for TradePanel's "You own" row: the connected wallet's YES/NO
 * share holdings must be visible regardless of buy/sell mode.
 */
import { vi } from "vitest";

const YES_MINT = "YesMint111111111111111111111111111111111";
const NO_MINT = "NoMint1111111111111111111111111111111111";
const KASS_MINT = "KassMint11111111111111111111111111111111";

vi.mock("../src/market/hooks/useWriteAction", () => ({
  useWriteAction: () => ({
    status: { kind: "idle" },
    address: "Trader111111111111111111111111111111111",
    connected: true,
    indexer: {},
    run: async () => {},
  }),
}));
vi.mock("../src/market/hooks/useKassBalance", () => ({
  useKassBalance: (mint: string) => {
    if (mint === YES_MINT) return { balance: 42_000_000_000n, loading: false, refetch: () => {} };
    if (mint === NO_MINT) return { balance: 7_000_000_000n, loading: false, refetch: () => {} };
    return { balance: 100_000_000_000n, loading: false, refetch: () => {} };
  },
}));
vi.mock("../src/hooks/useKassUsdcPrice", () => ({
  useKassUsdcPrice: () => null,
}));
vi.mock("../src/components/markets/actions/ConnectGate", () => ({
  ConnectGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TradePanel } from "../src/components/markets/actions/TradePanel";
import type { Belief } from "../src/market/lib/beliefs";

const market = {
  kassMint: { toString: () => KASS_MINT },
  yesMint: { toString: () => YES_MINT },
  noMint: { toString: () => NO_MINT },
} as never;
const reserves = { base: 1_000_000_000n, quote: 1_000_000_000n } as never;

const beliefs: Belief[] = [
  { key: "Market1111:yes", pubkey: "Market1111", market, reserves, outcome: "yes", label: "Yes" },
  { key: "Market1111:no", pubkey: "Market1111", market, reserves, outcome: "no", label: "No" },
];

function render(): string {
  return renderToStaticMarkup(
    <TradePanel beliefs={beliefs} defaultBeliefKey="Market1111:yes" onSuccess={() => {}} />,
  );
}

describe("TradePanel — owned-shares row", () => {
  it("shows both YES and NO holdings regardless of the selected belief", () => {
    const html = render();
    expect(html).toContain("You own");
    expect(html).toContain("42 YES");
    expect(html).toContain("7 NO");
  });

  it("renders one <option> per belief, showing only its label — no probability percentage", () => {
    const html = render();
    expect(html).toContain("<option");
    expect(html).toContain("Yes");
    expect(html).toContain("No");
    expect((html.match(/<option/g) ?? []).length).toBe(2);
    // Regression: the belief dropdown used to append "· NN%" to each option's
    // text, duplicating the chart legend's probability and reading as
    // confusing — the dropdown shows only the plain label now.
    expect(html).not.toMatch(/<option[^>]*>[^<]*%/);
  });

  it("selects the default belief", () => {
    const html = render();
    expect(html).toMatch(/<option[^>]*value="Market1111:yes"[^>]*selected/);
  });
});
