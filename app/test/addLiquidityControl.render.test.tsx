/**
 * Render coverage for the redesigned Add-liquidity deposit ticket: a token-amount
 * row (KASS mark + symbol), a balance line with percentage quick-sets, a risk
 * acknowledgment, and a full-width Deposit CTA that stays disabled until the risk
 * box is checked (it renders here unchecked → the button is disabled).
 */
import { vi } from "vitest";

const state = vi.hoisted(() => ({ balance: 12_000_000_000n as bigint | null }));

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
  useKassBalance: () => ({ balance: state.balance, loading: false, refetch: () => {} }),
}));
// ConnectGate reaches for the wallet-modal context (absent in a static render) —
// stub it to a pass-through so the connected form body renders.
vi.mock("../src/components/markets/actions/ConnectGate", () => ({
  ConnectGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AddLiquidityControl } from "../src/components/markets/actions/AddLiquidityControl";

const market = { kassMint: { toString: () => "Kass1111" } } as never;
const reserves = { base: 1_000_000_000n, quote: 1_000_000_000n } as never;

function render(): string {
  return renderToStaticMarkup(
    <AddLiquidityControl pubkey="Market1111" market={market} reserves={reserves} onSuccess={() => {}} />,
  );
}

describe("AddLiquidityControl — deposit ticket", () => {
  it("renders the token-amount row, balance, and percentage quick-sets", () => {
    const html = render();
    expect(html).toContain("Enter deposit amount");
    expect(html).toContain("KASS");
    // Balance line surfaces the wallet balance (12 KASS).
    expect(html).toMatch(/Balance:\s*<[^>]*>12</);
    for (const chip of ["25%", "50%", "75%", "Max"]) expect(html).toContain(chip);
  });

  it("gates the Deposit CTA behind the risk acknowledgment (disabled until accepted)", () => {
    const html = render();
    expect(html).toContain("risks involved in providing liquidity");
    expect(html).toContain("Deposit");
    // Unchecked risk box → the CTA is the sole disabled control.
    expect(html).toMatch(/disabled=""/);
  });
});
