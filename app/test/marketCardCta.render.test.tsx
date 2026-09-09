/**
 * Render coverage for MarketCard's status-driven footer CTA and header:
 *   - header: a status badge + a link to the linked oracle (independent of the
 *     "view market" link — no nested anchors)
 *   - no restated "Pays YES on <outcome>" line (covered more fully in
 *     marketQuestion.render.test.tsx; this file only checks the CTA area)
 *   - Funding, under the floor → an inline stake input + button, no launch button
 *   - Funding, at the floor (funded) → a one-click launch button, no stake input
 *   - any other status (Active, Resolved, Void, Cancelled) → no footer CTA at all
 */
import { vi } from "vitest";

vi.mock("../src/market/hooks/useWriteAction", () => ({
  useWriteAction: () => ({
    status: { kind: "idle" },
    address: "Trader111111111111111111111111111111111",
    connected: true,
    indexer: {},
    run: async () => {},
  }),
}));
vi.mock("../src/market/hooks/useActionSequence", () => ({
  useActionSequence: () => ({
    statuses: [],
    busy: false,
    connected: true,
    address: "Trader111111111111111111111111111111111",
    allDone: false,
    run: async () => {},
    reset: () => {},
  }),
}));
vi.mock("../src/components/markets/actions/ConnectGate", () => ({
  ConnectGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { MarketStatus } from "@kassandra-market/markets";
import { describe, expect, it } from "vitest";

import { MarketCard } from "../src/components/markets/MarketCard";
import type { MarketSummary } from "../src/market/data/markets";

const ORACLE = "Orac1e1111111111111111111111111111111111111";
const PUB = "Market11111111111111111111111111111111111111";

function summary(status: MarketStatus, totalContributed: bigint, minLiquidity = 500_000_000_000n): MarketSummary {
  return {
    pubkey: PUB,
    market: {
      status,
      outcomeIndex: 0,
      totalContributed,
      minLiquidity,
      baseMint: { toString: () => "Kass1111111111111111111111111111111111111111" },
      oracle: { toString: () => ORACLE },
    },
    reserves: status === MarketStatus.Active ? { base: 6n, quote: 4n } : null,
    oracleOptionsCount: 2,
  } as unknown as MarketSummary;
}

function render(s: MarketSummary): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <MarketCard summary={s} />
    </MemoryRouter>,
  );
}

describe("MarketCard — header", () => {
  it("shows a status badge and the GPT subject as text, not an /oracles/ link", () => {
    const html = render(summary(MarketStatus.Active, 500_000_000_000n));
    expect(html).toMatch(/aria-label="Status: Active"/);
    expect(html).not.toContain(`href="/oracles/${ORACLE}"`);
    expect(html).toContain("Subject");
  });

  it("never shows the old restated \"Pays YES on <outcome>\" line", () => {
    const html = render(summary(MarketStatus.Funding, 100_000_000_000n));
    expect(html).not.toContain("Pays");
  });
});

describe("MarketCard — footer CTA", () => {
  it("Funding, under the floor → an inline stake input + button, no launch button", () => {
    const html = render(summary(MarketStatus.Funding, 100_000_000_000n)); // 100 < 500 floor
    expect(html).toContain('aria-label="Amount to stake, in SOL"');
    expect(html).toContain(">Stake<");
    expect(html).not.toContain("Launch market");
  });

  it("Funding, at the floor (funded) → a launch button, no stake input", () => {
    const html = render(summary(MarketStatus.Funding, 500_000_000_000n)); // 500 == 500 floor
    expect(html).toContain("Launch market");
    expect(html).not.toContain('aria-label="Amount to stake, in SOL"');
  });

  it("Funding, past the floor → still a launch button (funded is a >= compare)", () => {
    const html = render(summary(MarketStatus.Funding, 900_000_000_000n)); // 900 > 500 floor
    expect(html).toContain("Launch market");
  });

  it("Active → no footer CTA", () => {
    const html = render(summary(MarketStatus.Active, 500_000_000_000n));
    expect(html).not.toContain("Launch market");
    expect(html).not.toContain('aria-label="Amount to stake, in SOL"');
  });

  it("Resolved → no footer CTA", () => {
    const html = render(summary(MarketStatus.Resolved, 500_000_000_000n));
    expect(html).not.toContain("Launch market");
    expect(html).not.toContain('aria-label="Amount to stake, in SOL"');
  });

  it("Cancelled → no footer CTA", () => {
    const html = render(summary(MarketStatus.Cancelled, 100_000_000_000n));
    expect(html).not.toContain("Launch market");
    expect(html).not.toContain('aria-label="Amount to stake, in SOL"');
  });
});
