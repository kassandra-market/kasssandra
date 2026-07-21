/**
 * Render coverage for `OracleCardCta` — the oracle-list card's stage-appropriate
 * management CTA (see `lib/oracleCardAction.ts` for the phase→action model,
 * tested exhaustively there; this file only checks the CTA's rendering:
 * ready → a link into the right detail-page tab; not ready → a disabled,
 * greyed control with a countdown; no actionable phase → nothing at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Phase, type Oracle } from "@kassandra-market/oracles";

import { OracleCardCta } from "../src/components/oracles/OracleCardCta";

const PUB = "Oracle1111111111111111111111111111111111111";
const NOW = 1_767_225_600n; // 2026-01-01T00:00:00Z in unix seconds
const HOUR = 3_600n;

function oracle(over: Partial<Oracle>): Oracle {
  return {
    phase: Phase.Proposal,
    deadline: NOW,
    phaseEndsAt: NOW,
    proposerCount: 0,
    openChallengeCount: 0,
    ...over,
  } as unknown as Oracle;
}

function render(o: Oracle, search = ""): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <OracleCardCta oracle={o} pubkey={PUB} search={search} />
    </MemoryRouter>,
  );
}

describe("OracleCardCta — ready", () => {
  it("links into the Manage tab for a form-driven action", () => {
    const html = render(oracle({ phase: Phase.FactProposal, phaseEndsAt: NOW + HOUR }));
    expect(html).toContain(`href="/oracles/${PUB}?tab=manage"`);
    expect(html).toContain("Submit a fact");
    expect(html).not.toContain("aria-disabled");
  });

  it("links into the Facts tab for vote-on-facts", () => {
    const html = render(oracle({ phase: Phase.FactVoting, phaseEndsAt: NOW + HOUR }));
    expect(html).toContain(`href="/oracles/${PUB}?tab=facts"`);
    expect(html).toContain("Vote on facts");
  });

  it("preserves other existing query params (e.g. the mock-mode harness) when adding tab", () => {
    const html = render(oracle({ phase: Phase.FactProposal, phaseEndsAt: NOW + HOUR }), "?mock");
    expect(html).toContain(`href="/oracles/${PUB}?mock=&amp;tab=manage"`);
  });
});

describe("OracleCardCta — not ready", () => {
  it("renders a disabled control with a countdown, no link, when the window hasn't opened", () => {
    const html = render(oracle({ phase: Phase.Proposal, deadline: NOW + HOUR, phaseEndsAt: NOW + HOUR }));
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Propose an outcome");
    expect(html).toContain("1h");
    expect(html).not.toContain(`href="/oracles/${PUB}`);
  });

  it("gates Sweep on the 30-day grace, showing a countdown until it opens", () => {
    const html = render(oracle({ phase: Phase.Resolved, phaseEndsAt: NOW }));
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Sweep");
  });
});

describe("OracleCardCta — no actionable phase", () => {
  it("renders nothing for Phase.Created", () => {
    const html = render(oracle({ phase: Phase.Created }));
    expect(html).toBe("");
  });
});
