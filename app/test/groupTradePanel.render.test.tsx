/**
 * Headless render coverage for the unified Trade-tab surface: a multi-series
 * price chart with a non-interactive legend, sitting above the order ticket
 * ({@link TradePanel}) which now owns belief SELECTION itself (via its own
 * dropdown, mocked here). `TradePanel` and `PriceChart` are both mocked to
 * stubs that print the props they were handed, so we can assert the FULL
 * `beliefs` list (and the computed default) without needing real chain data.
 */
import { vi } from "vitest";

vi.mock("../src/components/markets/actions/TradePanel", () => ({
  TradePanel: ({ beliefs, defaultBeliefKey, question }: { beliefs: { key: string; pubkey: string; label: string }[]; defaultBeliefKey: string | null; question?: string }) => (
    <div data-testid="trade-panel" data-default-belief={defaultBeliefKey ?? ""}>
      {question}
      {beliefs.map((b) => (
        <span key={b.key} data-testid="belief" data-key={b.key} data-pubkey={b.pubkey}>
          {b.label}
        </span>
      ))}
    </div>
  ),
}));
vi.mock("../src/components/markets/PriceChart", () => ({
  PriceChart: ({ series }: { series: { key: string; label: string }[] }) => (
    <div data-testid="price-chart">{series.map((s) => s.label).join(",")}</div>
  ),
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketStatus } from "@kassandra-market/markets";
import { describe, expect, it, vi as vitestVi } from "vitest";

import { GroupTradePanel } from "../src/components/markets/actions/GroupTradePanel";
import type { OracleGroupState } from "../src/market/hooks/useOracleGroup";
import type { MarketDetail as MarketDetailData } from "../src/market/data/markets";

const ORACLE = "Orac1e1111111111111111111111111111111111111";

function summary(outcomeIndex: number, status: MarketStatus, reserves: { base: bigint; quote: bigint } | null = null) {
  return {
    pubkey: `Market${outcomeIndex}1111111111111111111111111111111111`,
    market: { oracle: { toString: () => ORACLE }, outcomeIndex, status },
    reserves,
    oracleOptionsCount: 3,
  } as unknown as { pubkey: string; market: Record<string, unknown>; reserves: unknown; oracleOptionsCount: number };
}

function detail(pubkey: string, outcomeIndex: number, status: MarketStatus, reserves: { base: bigint; quote: bigint } | null): MarketDetailData {
  return {
    pubkey,
    market: { oracle: { toString: () => ORACLE }, outcomeIndex, status } as never,
    contributions: [],
    oracle: null,
    reserves: reserves as never,
  };
}

function group(active: ReturnType<typeof summary>[]): OracleGroupState {
  return {
    siblings: active as never,
    isGroup: active.length > 1,
    funding: [],
    active: active as never,
    claimable: [],
    depositable: [],
    loading: false,
    refetch: vitestVi.fn(),
  };
}

const R = { base: 6_000_000n, quote: 4_000_000n };
const R2 = { base: 3_000_000n, quote: 7_000_000n };

function render(props: Parameters<typeof GroupTradePanel>[0]): string {
  return renderToStaticMarkup(<GroupTradePanel {...props} />);
}

describe("GroupTradePanel", () => {
  it("a lone Active market: two beliefs (YES/NO of the same market), no clickable selector", () => {
    const d = detail("MarketA", 0, MarketStatus.Active, R);
    const html = render({ detail: d, group: group([]), options: [], refetch: () => {} });
    expect(html).not.toContain("<button");
    expect(html).toContain('data-testid="trade-panel"');
    const beliefCount = (html.match(/data-testid="belief"/g) ?? []).length;
    expect(beliefCount).toBe(2);
    expect(html).toContain('data-pubkey="MarketA"');
  });

  it("a real categorical group: one belief per Active outcome, defaults to the CURRENT market", () => {
    const d = detail("Market1111111111111111111111111111111111111", 1, MarketStatus.Active, R);
    const g = group([
      summary(0, MarketStatus.Active, R2),
      summary(1, MarketStatus.Active, R),
      summary(2, MarketStatus.Active, R),
    ]);
    const html = render({ detail: d, group: g, options: ["Zero", "One", "Two"], refetch: () => {} });
    expect(html).not.toContain("<button");
    const beliefCount = (html.match(/data-testid="belief"/g) ?? []).length;
    expect(beliefCount).toBe(3);
    expect(html).toContain("Zero");
    expect(html).toContain("One");
    expect(html).toContain("Two");
    expect(html).toContain('data-default-belief="Market1111111111111111111111111111111111111:yes"');
  });

  it("defaults to the first tradable sibling when the CURRENT market itself isn't Active", () => {
    const d = detail("Market0111111111111111111111111111111111111", 0, MarketStatus.Funding, null);
    const g = group([summary(2, MarketStatus.Active, R)]);
    const html = render({ detail: d, group: g, options: [], refetch: () => {} });
    expect(html).toContain('data-default-belief="Market21111111111111111111111111111');
  });

  it("passes the shared oracle subject as the trade question", () => {
    const d = detail("Market1111111111111111111111111111111111111", 1, MarketStatus.Active, R);
    const g = group([summary(1, MarketStatus.Active, R)]);
    const html = render({ detail: d, group: g, subject: "Who wins the tournament?", options: ["Zero", "One"], refetch: () => {} });
    expect(html).toContain("Who wins the tournament?");
  });

  it("renders nothing when no outcome in the group is tradable", () => {
    const d = detail("Market0111111111111111111111111111111111111", 0, MarketStatus.Funding, null);
    const g = group([]);
    expect(render({ detail: d, group: g, options: [], refetch: () => {} })).toBe("");
  });
});
