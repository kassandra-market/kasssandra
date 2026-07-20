import { describe, expect, it } from "vitest";
import { MarketStatus } from "@kassandra-market/markets";
import {
  beliefKey,
  beliefProbability,
  computeBeliefs,
  defaultBeliefKey,
} from "../src/market/lib/beliefs";
import type { MarketSummary } from "../src/market/data/markets";

function summary(outcomeIndex: number, reserves: { base: bigint; quote: bigint } | null): MarketSummary {
  return {
    pubkey: `Market${outcomeIndex}`,
    market: { outcomeIndex, status: MarketStatus.Active } as never,
    reserves: reserves as never,
    oracleOptionsCount: null,
  };
}

const R = { base: 4_000_000n, quote: 6_000_000n }; // YES = 60%

describe("computeBeliefs", () => {
  it("a real categorical group: one belief per tradable outcome, always YES, labelled from options", () => {
    const tradable = [summary(0, R), summary(1, R), summary(2, R)];
    const beliefs = computeBeliefs({ isGroup: true, tradable, options: ["Zero", "One", "Two"] });
    expect(beliefs).toHaveLength(3);
    expect(beliefs.map((b) => b.outcome)).toEqual(["yes", "yes", "yes"]);
    expect(beliefs.map((b) => b.label)).toEqual(["Zero", "One", "Two"]);
    expect(beliefs.map((b) => b.key)).toEqual(["Market0:yes", "Market1:yes", "Market2:yes"]);
  });

  it("a categorical group with an unlabelled outcome falls back to 'Outcome N'", () => {
    const beliefs = computeBeliefs({ isGroup: true, tradable: [summary(0, R)], options: [] });
    expect(beliefs[0].label).toBe("Outcome 0");
  });

  it("a lone binary market: two beliefs on the SAME market, YES and NO, labelled from the pair of options", () => {
    const beliefs = computeBeliefs({ isGroup: false, tradable: [summary(0, R)], options: ["Yes team", "No team"] });
    expect(beliefs).toHaveLength(2);
    expect(beliefs[0]).toMatchObject({ pubkey: "Market0", outcome: "yes", label: "Yes team" });
    expect(beliefs[1]).toMatchObject({ pubkey: "Market0", outcome: "no", label: "No team" });
    expect(beliefs[0].key).not.toBe(beliefs[1].key);
  });

  it("a lone binary market with no option labels falls back to 'Yes'/'No'", () => {
    const beliefs = computeBeliefs({ isGroup: false, tradable: [summary(0, R)], options: [] });
    expect(beliefs.map((b) => b.label)).toEqual(["Yes", "No"]);
  });

  it("no tradable market at all → no beliefs", () => {
    expect(computeBeliefs({ isGroup: false, tradable: [], options: [] })).toEqual([]);
    expect(computeBeliefs({ isGroup: true, tradable: [], options: [] })).toEqual([]);
  });
});

describe("beliefProbability", () => {
  it("YES belief reads the reserves' implied YES probability directly", () => {
    expect(beliefProbability({ reserves: R, outcome: "yes" })).toBeCloseTo(0.6);
  });

  it("NO belief is the complement", () => {
    expect(beliefProbability({ reserves: R, outcome: "no" })).toBeCloseTo(0.4);
  });

  it("no reserves → null", () => {
    expect(beliefProbability({ reserves: null, outcome: "yes" })).toBeNull();
  });
});

describe("defaultBeliefKey", () => {
  const beliefs = computeBeliefs({ isGroup: true, tradable: [summary(0, R), summary(1, R)], options: ["Zero", "One"] });

  it("prefers the current market's YES belief when it's itself tradable", () => {
    expect(defaultBeliefKey(beliefs, "Market1", true)).toBe(beliefKey("Market1", "yes"));
  });

  it("falls back to the first belief when the current market isn't tradable", () => {
    expect(defaultBeliefKey(beliefs, "Market1", false)).toBe(beliefKey("Market0", "yes"));
  });

  it("null when there are no beliefs at all", () => {
    expect(defaultBeliefKey([], "Market1", true)).toBeNull();
  });
});
