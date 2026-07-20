import { describe, expect, it } from "vitest";

import { fuzzyScore, fuzzySearch } from "../src/lib/fuzzySearch";

describe("fuzzyScore", () => {
  it("returns null when the query is not a subsequence of the text", () => {
    expect(fuzzyScore("xyz", "Will BTC hit 100k?")).toBeNull();
  });

  it("matches a case-insensitive exact substring", () => {
    expect(fuzzyScore("btc", "Will BTC hit 100k?")).not.toBeNull();
  });

  it("matches a scattered (non-contiguous) subsequence", () => {
    // "wbh" as letters scattered across "Will BTC Hit" — a real fuzzy match.
    expect(fuzzyScore("wbh", "Will BTC Hit")).not.toBeNull();
  });

  it("treats an empty query as a trivial match with score 0", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("   ", "anything")).toBe(0);
  });

  it("scores a contiguous run higher than the same characters scattered apart", () => {
    // Neither text has a word-boundary character (plain letters only), so this
    // isolates the consecutive-run bonus from the word-boundary bonus.
    const contiguous = fuzzyScore("btc", "zzzbtczzz");
    const scattered = fuzzyScore("btc", "zbzztzzzc");
    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous!).toBeGreaterThan(scattered!);
  });

  it("scores a word-boundary match higher than a mid-word match of the same length", () => {
    // "hit" starts right after a space in both, so compare a prefix match vs mid-word.
    const wordStart = fuzzyScore("hit", "Hit the target");
    const midWord = fuzzyScore("hit", "Whithered leaf"); // "hit" appears mid-word inside "Whithered"
    expect(wordStart).not.toBeNull();
    expect(midWord).not.toBeNull();
    expect(wordStart!).toBeGreaterThan(midWord!);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("BTC", "will btc hit 100k")).toEqual(fuzzyScore("btc", "will btc hit 100k"));
  });
});

describe("fuzzySearch", () => {
  interface Item {
    id: string;
    title: string;
  }
  const items: Item[] = [
    { id: "1", title: "Will BTC hit 100k by 2027?" },
    { id: "2", title: "Will ETH flip BTC?" },
    { id: "3", title: "US election winner" },
    { id: "4", title: "Will it rain in NYC tomorrow" },
  ];

  it("returns no matches for an empty query", () => {
    expect(fuzzySearch("", items, (i) => [i.title], 5)).toEqual([]);
  });

  it("ranks the best matches first and respects topK", () => {
    const results = fuzzySearch("btc", items, (i) => [i.title], 1);
    expect(results).toHaveLength(1);
    expect(results[0].item.id).toBe("1"); // "BTC" at a cleaner word-boundary position
  });

  it("returns only items with at least one matching candidate", () => {
    const results = fuzzySearch("election", items, (i) => [i.title], 5);
    expect(results.map((r) => r.item.id)).toEqual(["3"]);
  });

  it("takes the BEST score across multiple candidate strings per item", () => {
    // Item "4" doesn't match "id4" via its title, but does via a second candidate.
    const withIds = fuzzySearch("id4", items, (i) => [i.title, `id${i.id}`], 5);
    expect(withIds.map((r) => r.item.id)).toContain("4");
  });

  it("returns an empty array when nothing matches", () => {
    expect(fuzzySearch("zzzzz", items, (i) => [i.title], 5)).toEqual([]);
  });
});
