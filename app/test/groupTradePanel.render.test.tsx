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
  PriceChart: ({ series }: { series: { key: string; label: string; color: string }[] }) => (
    <div data-testid="price-chart">
      {series.map((s) => (
        <span key={s.key} data-testid="chart-series" data-color={s.color}>
          {s.label}
        </span>
      ))}
    </div>
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

  it("dedupes the current market against its OWN (possibly differently-keyed) entry in group.active by outcomeIndex, not by pubkey literal", () => {
    // The current page's own market and its corresponding entry in
    // group.active/siblings are always the SAME on-chain market, but they can
    // be fetched independently (useMarketDetail vs the group's siblings
    // query) and so may not share object identity or even an identical
    // pubkey string in a test fixture. GroupTradePanel's `tradable` dedup
    // must key on `outcomeIndex`, not on the pubkey literal matching, or this
    // outcome would be double-counted. This test deliberately gives the two
    // entries for outcome 1 DIFFERENT pubkeys to prove the dedup doesn't
    // depend on the pubkeys happening to coincide.
    const d = detail("CurrentMarketPubkeyA", 1, MarketStatus.Active, R);
    const g = group([
      summary(0, MarketStatus.Active, R2),
      { ...summary(1, MarketStatus.Active, R), pubkey: "DifferentPubkeyForOutcome1" } as unknown as ReturnType<typeof summary>,
      summary(2, MarketStatus.Active, R),
    ]);
    const html = render({ detail: d, group: g, options: ["Zero", "One", "Two"], refetch: () => {} });
    const beliefCount = (html.match(/data-testid="belief"/g) ?? []).length;
    expect(beliefCount).toBe(3); // NOT 4 — outcome 1 must appear exactly once
  });

  it("every chart series color is a literal hex, never a CSS var() reference", () => {
    // PriceChart's curves are drawn on an HTML canvas via lightweight-charts —
    // a raw `var(--color-x)` string is an invalid canvas strokeStyle (canvas
    // doesn't resolve custom properties, only the CSS cascade does), so it's
    // silently ignored and the line renders solid black instead of its
    // intended color. Regression guard for that: cycle enough beliefs to
    // exercise the whole palette and assert every one is a real hex color.
    const d = detail("Market0111111111111111111111111111111111111", 0, MarketStatus.Active, R);
    const g = group([
      summary(0, MarketStatus.Active, R),
      summary(1, MarketStatus.Active, R),
      summary(2, MarketStatus.Active, R),
      summary(3, MarketStatus.Active, R),
      summary(4, MarketStatus.Active, R),
      summary(5, MarketStatus.Active, R),
    ]);
    const html = render({ detail: d, group: g, options: [], refetch: () => {} });
    const colors = [...html.matchAll(/data-color="([^"]+)"/g)].map((m) => m[1]);
    expect(colors.length).toBe(6);
    for (const color of colors) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("legend pill probabilities are normalized across the group, not each outcome's raw independent price", () => {
    // Two outcomes whose RAW implied-YES probabilities are 70% (R2) and 40%
    // (R) — deliberately NOT already summing to 100%, so a real rescale must
    // happen for this test to distinguish "normalized" from "raw". `group()`
    // must list BOTH outcomes (0 and 1) here, not just the sibling — its
    // `isGroup` flag is `active.length > 1`, and the categorical (one-belief-
    // per-outcome) code path only engages when `isGroup` is true. Listing
    // outcome 0 again alongside the `detail()` for outcome 0 is intentional:
    // GroupTradePanel's own dedup (by outcomeIndex, proven in the test above)
    // collapses it against the current market, exactly as the "real
    // categorical group" test above already does.
    const d = detail("Market0111111111111111111111111111111111111", 0, MarketStatus.Active, R2); // R2 = 3M/7M → 70%
    const g = group([
      summary(0, MarketStatus.Active, R2),
      summary(1, MarketStatus.Active, R), // R = 6M/4M → 40%
    ]);
    const html = render({ detail: d, group: g, options: ["Zero", "One"], refetch: () => {} });
    // R2 alone would show 70%, R alone 40% — together they must be rescaled:
    // 0.7/(0.7+0.4) = 0.636363... → rounds to 64%; 0.4/1.1 = 0.363636... → 36%.
    expect(html).toContain("64%");
    expect(html).toContain("36%");
    expect(html).not.toContain("70%");
    expect(html).not.toContain("40%");
  });
});
