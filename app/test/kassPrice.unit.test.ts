/**
 * Unit coverage for the KASS→USD price read: the futarchy-spot-TWAP decoder
 * (fixed Dao offsets, mirrored from cpi/metadao_v06/layout.rs) and the
 * PRICE_SCALE→human USDC/KASS conversion, including the not-yet-observable /
 * too-short guards that make the caller disable the USD unit.
 */
import { describe, expect, it } from "vitest";

import { decodeFutarchySpotTwap, usdcPerKass } from "../src/data/kassPrice";

const AGG_OFF = 9; // u128
const LAST_OFF = 25; // i64
const CREATED_OFF = 33; // i64
const DELAY_OFF = 105; // u32
const LEN = DELAY_OFF + 4; // 109

/** Build a Dao-shaped buffer carrying just the spot-TWAP fields we read. */
function daoBuf({
  aggregator,
  lastUpdated,
  createdAt,
  startDelay,
  len = LEN,
}: {
  aggregator: bigint;
  lastUpdated: bigint;
  createdAt: bigint;
  startDelay: number;
  len?: number;
}): Uint8Array {
  const data = new Uint8Array(len);
  const dv = new DataView(data.buffer);
  dv.setBigUint64(AGG_OFF, aggregator & 0xffffffffffffffffn, true);
  dv.setBigUint64(AGG_OFF + 8, aggregator >> 64n, true);
  dv.setBigInt64(LAST_OFF, lastUpdated, true);
  dv.setBigInt64(CREATED_OFF, createdAt, true);
  dv.setUint32(DELAY_OFF, startDelay, true);
  return data;
}

const SCALE = 1_000_000_000_000n; // PRICE_SCALE (1e12)

describe("decodeFutarchySpotTwap", () => {
  it("computes aggregator / (last − (created + delay))", () => {
    // 100 seconds elapsed, aggregator = 0.5 USDC/KASS (raw) × SCALE × 100 slots.
    const perSlot = SCALE / 2n; // 0.5 scaled
    const twap = decodeFutarchySpotTwap(
      daoBuf({ aggregator: perSlot * 100n, lastUpdated: 1_150n, createdAt: 1_000n, startDelay: 50 }),
    );
    expect(twap).toBe(perSlot); // aggregator / 100 elapsed
  });

  it("returns null when the aggregator is zero (no observation yet)", () => {
    expect(
      decodeFutarchySpotTwap(daoBuf({ aggregator: 0n, lastUpdated: 200n, createdAt: 100n, startDelay: 0 })),
    ).toBeNull();
  });

  it("returns null for a non-positive elapsed window (pre start-delay)", () => {
    expect(
      decodeFutarchySpotTwap(daoBuf({ aggregator: SCALE, lastUpdated: 120n, createdAt: 100n, startDelay: 50 })),
    ).toBeNull();
  });

  it("returns null for a too-short buffer", () => {
    expect(decodeFutarchySpotTwap(new Uint8Array(LEN - 1))).toBeNull();
  });
});

describe("usdcPerKass", () => {
  it("divides out PRICE_SCALE and applies the KASS(9)/USDC(6) decimal scale", () => {
    // raw twap 0.5·SCALE → 0.5 quote/base raw → ×10^(9−6)=1000 → 500 USDC/KASS.
    expect(usdcPerKass(SCALE / 2n)).toBeCloseTo(500, 6);
    // A realistic ~$0.05 KASS: 0.05 / 1000 = 5e-5 raw ratio → 5e-5·SCALE.
    expect(usdcPerKass((SCALE * 5n) / 100_000n)).toBeCloseTo(0.05, 6);
  });
});
