/**
 * Regression for the LP claim panel copy: a post-activation liquidity provider
 * holds their position in `lateLp` with `amount == 0`, so the panel must describe
 * the LP they added — not read as a "0 KASS contribution". A pure funder still
 * reads as their KASS stake.
 */
import { vi } from "vitest";

const state = vi.hoisted(() => ({ address: "Late1111" as string | null }));

vi.mock("../src/market/hooks/useWriteAction", () => ({
  useWriteAction: () => ({
    status: { kind: "idle" },
    address: state.address,
    connected: true,
    indexer: {},
    run: async () => {},
  }),
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ClaimLpControl } from "../src/components/markets/actions/ClaimLpControl";

function contribution(contributor: string, amount: bigint, lateLp: bigint) {
  return { pubkey: `c-${contributor}`, contribution: { contributor: { toString: () => contributor }, amount, lateLp, claimed: false } };
}

function market(feeCollected: boolean) {
  return { feeCollected, lpMint: { toString: () => "LpMint1111" } } as never;
}

function render(feeCollected: boolean, contributions: unknown[], initialPath = "/markets/Market1111"): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[initialPath]}>
      <ClaimLpControl
        pubkey="Market1111"
        market={market(feeCollected)}
        contributions={contributions as never}
        onSuccess={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("ClaimLpControl position copy", () => {
  it("describes the added LP for a pure late LP (not 0 KASS)", () => {
    state.address = "Late1111";
    const html = render(false, [contribution("Late1111", 0n, 500_000_000n)]);
    expect(html).toContain("0.5 LP you added to the pool");
    expect(html).not.toContain("0 KASS");
  });

  it("describes the KASS stake for a pure funder", () => {
    state.address = "Fund1111";
    const html = render(true, [contribution("Fund1111", 1_000_000_000n, 0n)]);
    expect(html).toContain("1 KASS funding contribution");
    expect(html).toContain("Claim LP");
  });

  it("describes both for a funder who also added liquidity", () => {
    state.address = "Both1111";
    const html = render(false, [contribution("Both1111", 2_000_000_000n, 3_000_000_000n)]);
    expect(html).toContain("2 KASS funding contribution and 3 LP you added to the pool");
  });
});

describe("ClaimLpControl — fee-not-collected state links to the Manage tab crank", () => {
  it("links to the Manage tab so a blocked claimant has a one-click path to unblock it", () => {
    state.address = "Late1111";
    const html = render(false, [contribution("Late1111", 0n, 500_000_000n)]);
    expect(html).toContain("Waiting for fee collection");
    expect(html).toContain('href="/markets/Market1111?tab=manage"');
    expect(html).toContain("Manage tab");
  });

  it("preserves other existing query params (e.g. the mock-mode harness) when swapping the tab", () => {
    state.address = "Late1111";
    const html = render(
      false,
      [contribution("Late1111", 0n, 500_000_000n)],
      "/markets/Market1111?mock&wallet=connected",
    );
    // URLSearchParams serializes in insertion order; `mock` (bare, empty value) then
    // `tab`; React Router resolves the link against the current pathname and the
    // rendered HTML entity-escapes `&`.
    expect(html).toContain('href="/markets/Market1111?mock=&amp;wallet=connected&amp;tab=manage"');
  });

  it("does not show the Manage-tab link once the fee IS collected", () => {
    state.address = "Fund1111";
    const html = render(true, [contribution("Fund1111", 1_000_000_000n, 0n)]);
    expect(html).not.toContain("Manage tab");
  });
});
