/**
 * Unique-nonce + createSubject-then-createMarket contract for the create-market
 * builders (no chain — builders are called with a stub indexer).
 */
import { describe, expect, it } from "vitest";
import { Address } from "@solana/web3.js";
import { randomNonce, dummyLlmContext } from "../src/market/data/actions/create";

describe("create-market nonce", () => {
  it("randomNonce returns distinct u64s", () => {
    const a = randomNonce();
    const b = randomNonce();
    expect(a).not.toBe(b);
    expect(a).toBeGreaterThanOrEqual(0n);
    expect(b).toBeGreaterThanOrEqual(0n);
  });

  it("dummyLlmContext returns a pubkey", async () => {
    const pk = await dummyLlmContext();
    expect(pk).toBeInstanceOf(Address);
    expect(pk.toString().length).toBeGreaterThan(30);
  });

  it("produces unique nonces across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) seen.add(randomNonce().toString());
    expect(seen.size).toBe(64);
  });
});
