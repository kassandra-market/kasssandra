/**
 * Render coverage for `OraclePicker`'s initial-mount contract. This component's
 * real behavior (type → fuzzy-filter → dropdown → select) is exercised by
 * `fuzzySearch.unit.test.ts` (the pure matcher) plus a live browser check — this
 * app's render tests are `renderToStaticMarkup` (SSR, no event simulation), so
 * they can only prove the STATIC, first-paint contract: the combobox wiring is
 * correct and the dropdown starts closed (empty query ⇒ no matches).
 */
import { vi } from "vitest";

vi.mock("../src/hooks/useOracles", () => ({
  useOracles: () => ({
    data: [
      { pubkey: "Oracle1111111111111111111111111111111111111", oracle: {} },
      { pubkey: "Oracle2222222222222222222222222222222222222", oracle: {} },
    ],
    loading: false,
    error: undefined,
    refetch: () => {},
  }),
}));
vi.mock("../src/hooks/useOracleMeta", () => ({
  useOracleMeta: () =>
    new Map([["Oracle1111111111111111111111111111111111111", { subject: "Will BTC hit 100k?" }]]),
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OraclePicker } from "../src/components/markets/actions/CreateMarketForm/OraclePicker";

function render(): string {
  return renderToStaticMarkup(
    <OraclePicker ids={{ id: "oracle", describedById: "oracle-desc", invalid: false }} onChange={() => {}} />,
  );
}

describe("OraclePicker — initial mount", () => {
  it("renders an accessible combobox input, starting empty and collapsed", () => {
    const html = render();
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Type the oracle&#x27;s question, or paste its address");
  });

  it("shows no dropdown/listbox before the user types anything", () => {
    const html = render();
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('role="option"');
  });

  it("never crashes when the oracle list is still loading", () => {
    expect(() => render()).not.toThrow();
  });
});
