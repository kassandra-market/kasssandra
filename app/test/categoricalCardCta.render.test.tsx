/**
 * Render coverage for CategoricalCard's status-driven footer CTA
 * (FundGroupCta) — the group analogue of MarketCard's Stake/Launch CTA:
 *   - no Funding outcome in the group → no footer CTA at all
 *   - some Funding outcomes under their own floor → an inline "total SOL"
 *     stake input + button, no launch button
 *   - every Funding outcome already at/over its own floor → a one-click bulk
 *     launch button, no stake input
 */
import { vi } from "vitest";

vi.mock("../src/market/hooks/useActionSequence", () => ({
  useActionSequence: () => ({
    statuses: [],
    busy: false,
    connected: true,
    address: "Trader111111111111111111111111111111111",
    allDone: false,
    run: async () => {},
  }),
}));
vi.mock("../src/market/hooks/useSolBalance", () => ({
  useSolBalance: () => ({ balance: null, loading: false, refetch: () => {} }),
}));
vi.mock("../src/market/lib/indexer", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useIndexer: () => ({}),
}));
vi.mock("../src/components/markets/actions/ConnectGate", () => ({
  ConnectGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { MarketStatus } from "@kassandra-market/markets";
import { describe, expect, it } from "vitest";

import { CategoricalCard } from "../src/components/markets/CategoricalCard";
import type { OracleGroup } from "../src/market/data/markets";

const ORACLE = "Orac1e1111111111111111111111111111111111111";
const BASE_MINT = { toString: () => "Kass1111111111111111111111111111111111111111" };

function market(
  outcomeIndex: number,
  status: MarketStatus,
  totalContributed: bigint,
  minLiquidity = 500_000_000_000n,
) {
  return {
    pubkey: `Market${outcomeIndex}111111111111111111111111111111111`,
    market: {
      status,
      outcomeIndex,
      totalContributed,
      minLiquidity,
      baseMint: BASE_MINT,
      oracle: { toString: () => ORACLE },
    },
    reserves: status === MarketStatus.Active ? { base: 6n, quote: 4n } : null,
  } as unknown as OracleGroup["markets"][number];
}

function render(markets: OracleGroup["markets"]): string {
  const group: OracleGroup = { oracle: ORACLE, optionsCount: markets.length, markets };
  return renderToStaticMarkup(
    <MemoryRouter>
      <CategoricalCard group={group} />
    </MemoryRouter>,
  );
}

describe("CategoricalCard — footer CTA (FundGroupCta)", () => {
  it("no Funding outcome in the group → no footer CTA", () => {
    const html = render([
      market(0, MarketStatus.Active, 500_000_000_000n),
      market(1, MarketStatus.Active, 500_000_000_000n),
    ]);
    expect(html).not.toContain("Launch market");
    expect(html).not.toContain('aria-label="Total amount to deposit');
  });

  it("some Funding outcomes under their own floor → an inline deposit input, no launch button", () => {
    const html = render([
      market(0, MarketStatus.Funding, 100_000_000_000n), // 100 < 500 floor
      market(1, MarketStatus.Funding, 200_000_000_000n), // 200 < 500 floor
      market(2, MarketStatus.Active, 500_000_000_000n),
    ]);
    expect(html).toContain('aria-label="Total amount to deposit across all Funding outcomes, in SOL"');
    expect(html).toContain(">Stake<");
    expect(html).not.toContain("Launch market");
  });

  it("every Funding outcome already at/over its own floor → a bulk launch button, no deposit input", () => {
    const html = render([
      market(0, MarketStatus.Funding, 500_000_000_000n), // == floor
      market(1, MarketStatus.Funding, 900_000_000_000n), // > floor
    ]);
    expect(html).toContain("Launch market");
    expect(html).not.toContain('aria-label="Total amount to deposit');
  });

  it("mixed — one outcome still under its floor while another is already over → deposit input, not launch", () => {
    const html = render([
      market(0, MarketStatus.Funding, 100_000_000_000n), // under floor
      market(1, MarketStatus.Funding, 900_000_000_000n), // over floor
    ]);
    expect(html).toContain('aria-label="Total amount to deposit across all Funding outcomes, in SOL"');
    expect(html).not.toContain("Launch market");
  });
});

describe("CategoricalCard — outcome probability rows (odds-normalized)", () => {
  it("buying one outcome heavily drives its row toward 100%, not a sub-50% plateau", () => {
    const html = render([
      market(0, MarketStatus.Active, 500_000_000_000n),
      market(1, MarketStatus.Active, 500_000_000_000n),
      market(2, MarketStatus.Active, 500_000_000_000n),
    ].map((m, i) => ({
      ...m,
      reserves: i === 0 ? { base: 1n, quote: 99n } : { base: 6n, quote: 4n },
    })) as unknown as OracleGroup["markets"]);
    // Old linear normalizeAcrossGroup would cap outcome 0 well below 100%
    // (siblings' raw 0.4 never shrinks). Odds-space must push it near 100%.
    expect(html).toContain(">99%<");
  });
});
