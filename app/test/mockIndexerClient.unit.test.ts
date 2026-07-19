import { describe, expect, it } from "vitest";
import { MockIndexerClient } from "../src/market/lib/mockIndexerClient";
import { MOCK_MARKET_PUBKEYS } from "../src/market/data/mockMarkets";

describe("MockIndexerClient", () => {
  it("getMarkets returns the fixture set", async () => {
    const client = new MockIndexerClient();
    const markets = await client.getMarkets();
    expect(markets.length).toBe(MOCK_MARKET_PUBKEYS.length);
  });

  it("getMarket returns null for an unknown pubkey", async () => {
    const client = new MockIndexerClient();
    const detail = await client.getMarket("not-a-real-pubkey");
    expect(detail).toBeNull();
  });

  it("getMarket returns a detail payload for a known fixture pubkey", async () => {
    const client = new MockIndexerClient();
    const detail = await client.getMarket(MOCK_MARKET_PUBKEYS[0]);
    expect(detail).not.toBeNull();
  });

  it("getConfig returns the fixture config singleton", async () => {
    const client = new MockIndexerClient();
    const config = await client.getConfig();
    expect(config).not.toBeNull();
  });

  it("getCandles returns a non-empty deterministic series", async () => {
    const client = new MockIndexerClient();
    const a = await client.getCandles(MOCK_MARKET_PUBKEYS[0], 3600, 50);
    const b = await client.getCandles(MOCK_MARKET_PUBKEYS[0], 3600, 50);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it("getAccount resolves to null (no raw account reads in mock mode)", async () => {
    const client = new MockIndexerClient();
    const account = await client.getAccount("not-a-real-pubkey");
    expect(account).toBeNull();
  });

  it("the write path throws (mock mode does not support real transactions)", async () => {
    const client = new MockIndexerClient();
    await expect(client.sendTransaction("anything")).rejects.toThrow();
    await expect(client.getBlockhash()).rejects.toThrow();
    await expect(client.getSignatureStatus("sig")).rejects.toThrow();
  });
});
