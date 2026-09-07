/**
 * Offline unit tests for the active-market TRADE preview math — specifically
 * the price-impact helpers the trade UI's indicator reads
 * ({@link buyPriceImpact} / {@link sellPriceImpact}).
 */
import { describe, expect, it } from "vitest";

import {
  ammSwapOut,
  buyPriceImpact,
  constantProductOut,
  optimalUnwindSwap,
  previewSell,
  sellPriceImpact,
} from "../src/market/data/actions/trade.ts";
import type { AmmReserves } from "../src/market/data/markets.ts";

describe("buyPriceImpact", () => {
  it("is 0 for a null/empty pool or a non-positive amount", () => {
    expect(buyPriceImpact(null, "yes", 100n)).toBe(0);
    expect(buyPriceImpact({ base: 0n, quote: 1_000n }, "yes", 100n)).toBe(0);
    expect(buyPriceImpact({ base: 1_000n, quote: 1_000n }, "yes", 0n)).toBe(0);
  });

  it("grows with trade size and stays within [0, 1]", () => {
    const reserves: AmmReserves = { base: 10_000n, quote: 10_000n };
    const small = buyPriceImpact(reserves, "yes", 10n);
    const large = buyPriceImpact(reserves, "yes", 5_000n);
    expect(small).toBeGreaterThanOrEqual(0);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(1);
  });

  it("routes YES through (quote→base) and NO through (base→quote), matching constantProductOut", () => {
    const reserves: AmmReserves = { base: 2_000n, quote: 1_000n };
    const amountIn = 100n;
    // YES: in=quote, out=base. spot = base/quote pre-trade; effective = noFeeOut/amountIn.
    const yesOut = constantProductOut(amountIn, reserves.quote, reserves.base);
    const yesSpot = Number(reserves.base) / Number(reserves.quote);
    const yesEffective = Number(yesOut) / Number(amountIn);
    expect(buyPriceImpact(reserves, "yes", amountIn)).toBeCloseTo(
      Math.min(Math.max(1 - yesEffective / yesSpot, 0), 1),
      10,
    );
    // NO: in=base, out=quote.
    const noOut = constantProductOut(amountIn, reserves.base, reserves.quote);
    const noSpot = Number(reserves.quote) / Number(reserves.base);
    const noEffective = Number(noOut) / Number(amountIn);
    expect(buyPriceImpact(reserves, "no", amountIn)).toBeCloseTo(
      Math.min(Math.max(1 - noEffective / noSpot, 0), 1),
      10,
    );
  });
});

describe("sellPriceImpact", () => {
  it("is 0 for a null pool, an empty reserve, or a position too small to unwind", () => {
    expect(sellPriceImpact(null, "yes", 100n)).toBe(0);
    expect(sellPriceImpact({ base: 0n, quote: 1_000n }, "yes", 100n)).toBe(0);
    expect(sellPriceImpact({ base: 1_000n, quote: 1_000n }, "yes", 1n)).toBe(0);
  });

  it("grows with position size and stays within [0, 1]", () => {
    const reserves: AmmReserves = { base: 10_000n, quote: 10_000n };
    const small = sellPriceImpact(reserves, "yes", 20n);
    const large = sellPriceImpact(reserves, "yes", 5_000n);
    expect(small).toBeGreaterThanOrEqual(0);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(1);
  });

  it("evaluates the pool-optimal unwind swap, not the raw position amount", () => {
    const reserves: AmmReserves = { base: 5_000n, quote: 3_000n };
    const positionAmount = 400n;
    // Holding YES: unwind swaps cYES(base) → cNO(quote), i.e. in=base, out=quote.
    const swapAmount = optimalUnwindSwap(positionAmount, reserves.base, reserves.quote);
    const out = constantProductOut(swapAmount, reserves.base, reserves.quote);
    const spot = Number(reserves.quote) / Number(reserves.base);
    const effective = Number(out) / Number(swapAmount);
    expect(sellPriceImpact(reserves, "yes", positionAmount)).toBeCloseTo(
      Math.min(Math.max(1 - effective / spot, 0), 1),
      10,
    );
  });
});

describe("previewSell", () => {
  it("is zero for null reserves or a position too small to unwind", () => {
    expect(previewSell(null, "yes", 100n)).toEqual({
      received: 0n,
      outputAmountMin: 0n,
      residual: 0n,
    });
    expect(previewSell({ base: 10_000n, quote: 10_000n }, "yes", 1n).received).toBe(0n);
  });

  it("estimates SOL received as the balanced merge and reports the dust residual", () => {
    const reserves: AmmReserves = { base: 1_000_000n, quote: 1_000_000n };
    const positionAmount = 10_000n;
    const p = previewSell(reserves, "yes", positionAmount, 100);
    // Reconstruct the expected values from the same primitives buildSellIxs uses.
    const swapAmount = optimalUnwindSwap(positionAmount, reserves.base, reserves.quote);
    const swapOut = ammSwapOut(swapAmount, reserves.base, reserves.quote);
    const remainder = positionAmount - swapAmount;
    const expectedReceived = remainder < swapOut ? remainder : swapOut;
    expect(p.received).toBe(expectedReceived);
    expect(p.residual).toBe(remainder < swapOut ? swapOut - remainder : remainder - swapOut);
    // The floor is derived from the fee-adjusted output and never exceeds it.
    expect(p.outputAmountMin).toBeLessThanOrEqual(swapOut);
    // Received is bounded by the position being unwound.
    expect(p.received).toBeLessThan(positionAmount);
  });
});
