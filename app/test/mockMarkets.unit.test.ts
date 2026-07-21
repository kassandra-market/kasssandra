import { describe, expect, it } from "vitest";
import { mockCandles, mockConfig, mockMarketDetail, mockMarkets, MOCK_MARKET_PUBKEYS } from "../src/market/data/mockMarkets";
import { groupByOracle, mapConfigDto, mapMarketDto, type MarketSummary } from "../src/market/data/markets";
import { MarketStatus } from "@kassandra-market/markets";

/** Every fixture mapped into a `MarketSummary`, grouped by oracle — the same
 *  shape `useOracleGroup`/`groupByOracle` work over in the real app. */
async function allGroups() {
  const dtos = await mockMarkets();
  const summaries: MarketSummary[] = dtos.map((d) => ({
    pubkey: d.address,
    market: mapMarketDto(d),
    reserves: null,
    oracleOptionsCount: null,
  }));
  return groupByOracle(summaries);
}

describe("mockMarkets fixtures", () => {
  it("has at least 5 fixture pubkeys", () => {
    expect(MOCK_MARKET_PUBKEYS.length).toBeGreaterThanOrEqual(5);
  });

  it("every DTO round-trips through mapMarketDto (real Address + BigInt parsing)", async () => {
    const dtos = await mockMarkets();
    expect(dtos.length).toBeGreaterThanOrEqual(5);
    for (const dto of dtos) {
      // Throws if any pubkey isn't a genuinely valid base58 32-byte address, or
      // any u64 string isn't BigInt-parseable — exactly what the live fetch path does.
      expect(() => mapMarketDto(dto)).not.toThrow();
    }
  });

  it("covers every MarketStatus value (Funding, Active, Resolved, Void, Cancelled)", async () => {
    const dtos = await mockMarkets();
    const mapped = dtos.map((d) => mapMarketDto(d));
    const statuses = new Set(mapped.map((m) => m.status));
    for (const s of [
      MarketStatus.Funding,
      MarketStatus.Active,
      MarketStatus.Resolved,
      MarketStatus.Void,
      MarketStatus.Cancelled,
    ]) {
      expect(statuses.has(s)).toBe(true);
    }
  });

  it("includes one categorical group (>2 sub-markets sharing an oracle)", async () => {
    const groups = await allGroups();
    expect(groups.some((g) => g.markets.length > 2)).toBe(true);
  });

  it("covers both binary Resolved directions (YES won and NO won)", async () => {
    // The oracle's resolvedOption determines the winner; a binary market's own
    // outcomeIndex is always 0, so "YES won" <=> resolvedOption === 0.
    const resolved = (await allGroups())
      .filter((g) => g.markets.length === 1)
      .map((g) => g.markets[0])
      .filter((m) => m.market.status === MarketStatus.Resolved);
    const details = await Promise.all(resolved.map((m) => mockMarketDetail(m.pubkey)));
    const resolvedOptions = new Set(details.map((d) => d?.oracle?.resolvedOption));
    expect(resolvedOptions.has(0)).toBe(true); // YES won somewhere
    expect(resolvedOptions.has(1)).toBe(true); // NO won somewhere
  });

  it("covers every MarketStatus within a 3-outcome categorical GROUP, not just individually", async () => {
    // `oracleOptionsCount` isn't wired up in this helper's summaries (it's a
    // best-effort field sourced from the indexer detail read, not the fixtures
    // themselves), so group by the real sub-market COUNT instead — 3 legs.
    const groups = (await allGroups()).filter((g) => g.markets.length === 3);
    expect(groups.length).toBeGreaterThanOrEqual(4); // resolved-mix, funding, funded, active, void, cancelled
    const statusesByGroup = groups.map((g) => new Set(g.markets.map((m) => m.market.status)));
    // Every-leg-Funding, every-leg-Funded(still Funding, past floor), every-leg-Active,
    // every-leg-Void, and every-leg-Cancelled groups each have exactly ONE status
    // across all their legs.
    for (const status of [MarketStatus.Active, MarketStatus.Void, MarketStatus.Cancelled]) {
      expect(statusesByGroup.some((s) => s.size === 1 && s.has(status))).toBe(true);
    }
    // Two distinct all-Funding groups exist: one under floor, one past floor.
    const fundingGroups = groups.filter((g) => g.markets.every((m) => m.market.status === MarketStatus.Funding));
    expect(fundingGroups.length).toBeGreaterThanOrEqual(2);
    const underFloor = fundingGroups.some((g) => g.markets.every((m) => m.market.totalContributed < m.market.minLiquidity));
    const pastFloor = fundingGroups.some((g) => g.markets.every((m) => m.market.totalContributed >= m.market.minLiquidity));
    expect(underFloor).toBe(true);
    expect(pastFloor).toBe(true);
  });

  it("includes a 9-outcome categorical group (9 sub-markets sharing one oracle)", async () => {
    const groups = (await allGroups()).filter((g) => g.markets.length === 9);
    expect(groups.length).toBeGreaterThanOrEqual(2); // one Funding, one resolved-with-a-pending-leg
    // At least one 9-outcome group is entirely Funding.
    expect(groups.some((g) => g.markets.every((m) => m.market.status === MarketStatus.Funding))).toBe(true);
    // At least one 9-outcome group is mostly Resolved with exactly one Active
    // straggler (the "resolution pending" realism, at scale).
    expect(
      groups.some((g) => {
        const byStatus = g.markets.reduce<Record<number, number>>((acc, m) => {
          acc[m.market.status] = (acc[m.market.status] ?? 0) + 1;
          return acc;
        }, {});
        return (byStatus[MarketStatus.Resolved] ?? 0) === 8 && (byStatus[MarketStatus.Active] ?? 0) === 1;
      }),
    ).toBe(true);
  });

  it("includes at least one Active market with populated (non-zero) reserves", async () => {
    const dtos = await mockMarkets();
    let found = false;
    for (const dto of dtos) {
      const mapped = mapMarketDto(dto);
      if (mapped.status !== 1 /* Active */) continue;
      const detail = await mockMarketDetail(dto.address);
      if (detail?.reserves && (BigInt(detail.reserves.base) > 0n || BigInt(detail.reserves.quote) > 0n)) {
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("mockMarketDetail returns non-empty contributions for every fixture pubkey, mapping cleanly", async () => {
    for (const pubkey of MOCK_MARKET_PUBKEYS) {
      const detail = await mockMarketDetail(pubkey);
      expect(detail).not.toBeNull();
      expect(detail!.contributions.length).toBeGreaterThan(0);
      // Every contribution DTO must also round-trip.
      for (const c of detail!.contributions) {
        expect(() => BigInt(c.amount)).not.toThrow();
        expect(() => BigInt(c.lateLp)).not.toThrow();
      }
    }
  });

  it("mockMarketDetail returns null for an unknown pubkey", async () => {
    const detail = await mockMarketDetail("not-a-real-pubkey");
    expect(detail).toBeNull();
  });

  it("mockCandles is deterministic for identical inputs", async () => {
    const a = await mockCandles(MOCK_MARKET_PUBKEYS[0], 3600, 50);
    const b = await mockCandles(MOCK_MARKET_PUBKEYS[0], 3600, 50);
    expect(a).toEqual(b);
    expect(a.length).toBe(50);
    // Anchored to a fixed epoch, spaced by intervalSecs — never wall-clock time.
    expect(a[1].time - a[0].time).toBe(3600);
    for (const candle of a) {
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
    }
  });

  it("mockCandles anchors the last candle near a supplied nowSecs, keeping values deterministic", async () => {
    const intervalSecs = 3600;
    const nowSecs = Math.floor(Date.now() / 1000);
    const a = await mockCandles(MOCK_MARKET_PUBKEYS[0], intervalSecs, 50, nowSecs);
    const b = await mockCandles(MOCK_MARKET_PUBKEYS[0], intervalSecs, 50, nowSecs);
    // Same nowSecs -> same series (values still come from the seeded random walk).
    expect(a).toEqual(b);
    const last = a[a.length - 1];
    expect(last.time).toBeLessThanOrEqual(nowSecs);
    expect(nowSecs - last.time).toBeLessThan(intervalSecs);
    // The OHLC *values* match the fixed-epoch call (same seed, same walk) — only
    // the time axis moved.
    const fixed = await mockCandles(MOCK_MARKET_PUBKEYS[0], intervalSecs, 50);
    expect(a.map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close }))).toEqual(
      fixed.map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close })),
    );
  });

  it("mockConfig round-trips through mapConfigDto", async () => {
    const dto = await mockConfig();
    expect(() => mapConfigDto(dto)).not.toThrow();
  });
});
