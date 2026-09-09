/**
 * Account decoder unit tests (no chain).
 *
 * The decoder tests build zeroed Config/Market/Contribution buffers with the tag
 * + a couple of fields set at the pinned offsets and assert the decoder reads
 * them back, plus that `assertAccount` rejects a wrong size/tag. Sibling of the
 * builder suite in `builders.test.ts`; shared fixtures live in
 * `helpers/builders.ts`.
 */
import { Address } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  AccountType,
  ACCOUNT_SIZES,
  MarketStatus,
} from "../src/constants.js";
import { decodeConfig } from "../src/accounts/config.js";
import { decodeContribution } from "../src/accounts/contribution.js";
import { decodeMarket } from "../src/accounts/market.js";
import { decodeErSession } from "../src/accounts/erSession.js";
import { assertAccount } from "../src/accounts/common.js";
import {
  A,
  AUTHORITY,
  CONTRIBUTOR,
  CREATOR,
  FEE_DEST,
  BASE_MINT,
  ORACLE,
} from "./helpers/builders.js";

/** A small fixed-size buffer writer mirroring the on-chain Pod layout. */
class Buf {
  readonly bytes: Uint8Array;
  private readonly dv: DataView;
  constructor(size: number, accountType: AccountType) {
    this.bytes = new Uint8Array(size);
    this.dv = new DataView(this.bytes.buffer);
    this.bytes[0] = accountType; // account_type @0 (+ _pad_hdr[7])
  }
  u8(off: number, v: number): this {
    this.dv.setUint8(off, v);
    return this;
  }
  u16(off: number, v: number): this {
    this.dv.setUint16(off, v, true);
    return this;
  }
  u32(off: number, v: number): this {
    this.dv.setUint32(off, v, true);
    return this;
  }
  u64(off: number, v: bigint): this {
    this.dv.setBigUint64(off, v, true);
    return this;
  }
  i64(off: number, v: bigint): this {
    this.dv.setBigInt64(off, v, true);
    return this;
  }
  key(off: number, a: Address): this {
    this.bytes.set(a.toBytes(), off);
    return this;
  }
}

describe("decoders", () => {
  it("assertAccount rejects wrong size and wrong tag", () => {
    expect(() => assertAccount(new Uint8Array(87), AccountType.Config, ACCOUNT_SIZES.Config, "Config"))
      .toThrow(/wrong account size/);
    const wrongTag = new Uint8Array(ACCOUNT_SIZES.Config);
    wrongTag[0] = AccountType.Market;
    expect(() => assertAccount(wrongTag, AccountType.Config, ACCOUNT_SIZES.Config, "Config"))
      .toThrow(/wrong account_type/);
  });

  it("decodeConfig reads authority@8, baseMint@40, minLiquidity@72, bump@80, feeBps@82, feeDestination@84, + the activity-scaled curve fields @120..152", () => {
    const buf = new Buf(ACCOUNT_SIZES.Config, AccountType.Config)
      .key(8, AUTHORITY)
      .key(40, BASE_MINT)
      .u64(72, 123456789n)
      .u8(80, 254)
      .u16(82, 250)
      .key(84, FEE_DEST)
      .u64(120, 5_000_000_000n) // marketCreationEma
      .i64(128, 1_700_000_000n) // lastMarketCreationUnix
      .u64(136, 15_000_000_000n) // minLiquidityEmaThreshold
      .u64(144, 1_443_000_000_000n) // minLiquidityEmaCap
      .u64(152, 10_000_000_000n); // minLiquidityMax
    const c = decodeConfig(buf.bytes);
    expect(c.authority.toString()).toBe(AUTHORITY.toString());
    expect(c.baseMint.toString()).toBe(BASE_MINT.toString());
    expect(c.minLiquidity).toBe(123456789n);
    expect(c.bump).toBe(254);
    expect(c.feeBps).toBe(250);
    expect(c.feeDestination.toString()).toBe(FEE_DEST.toString());
    expect(c.marketCreationEma).toBe(5_000_000_000n);
    expect(c.lastMarketCreationUnix).toBe(1_700_000_000n);
    expect(c.minLiquidityEmaThreshold).toBe(15_000_000_000n);
    expect(c.minLiquidityEmaCap).toBe(1_443_000_000_000n);
    expect(c.minLiquidityMax).toBe(10_000_000_000n);
  });

  it("decodeMarket reads oracle@8, openContributions@152, status@154, lpTotal@384, settled@392, feeBps@394, feeCollected@396, outcomeIndex@397", () => {
    const buf = new Buf(ACCOUNT_SIZES.Market, AccountType.Market)
      .key(8, ORACLE)
      .key(40, CREATOR)
      .u64(144, 9000n) // totalContributed
      .u16(152, 3) // openContributions
      .u8(154, MarketStatus.Active)
      .u8(155, 200) // bump
      .key(224, A(77)) // yesMint
      .u64(384, 555n) // lpTotal
      .u8(392, 1) // settled
      .u16(394, 100) // feeBps
      .u8(396, 1) // feeCollected
      .u8(397, 3); // outcomeIndex
    const m = decodeMarket(buf.bytes);
    expect(m.oracle.toString()).toBe(ORACLE.toString());
    expect(m.creator.toString()).toBe(CREATOR.toString());
    expect(m.totalContributed).toBe(9000n);
    expect(m.openContributions).toBe(3);
    expect(m.status).toBe(MarketStatus.Active);
    expect(m.bump).toBe(200);
    expect(m.yesMint.toString()).toBe(A(77).toString());
    expect(m.lpTotal).toBe(555n);
    expect(m.settled).toBe(true);
    expect(m.feeBps).toBe(100);
    expect(m.feeCollected).toBe(true);
    expect(m.outcomeIndex).toBe(3);
  });

  it("decodeContribution reads market@8, contributor@40, amount@72, claimed@80, bump@81", () => {
    const buf = new Buf(ACCOUNT_SIZES.Contribution, AccountType.Contribution)
      .key(8, A(31))
      .key(40, CONTRIBUTOR)
      .u64(72, 424242n)
      .u8(80, 1)
      .u8(81, 251);
    const c = decodeContribution(buf.bytes);
    expect(c.market.toString()).toBe(A(31).toString());
    expect(c.contributor.toString()).toBe(CONTRIBUTOR.toString());
    expect(c.amount).toBe(424242n);
    expect(c.claimed).toBe(true);
    expect(c.bump).toBe(251);
  });

  it("decodeErSession reads market@8, validator@40, commitFrequencyMs@72", () => {
    const buf = new Buf(ACCOUNT_SIZES.ErSession, AccountType.ErSession)
      .u8(1, 255)
      .u8(2, 1)
      .key(8, A(40))
      .key(40, A(41))
      .u32(72, 30_000)
      .i64(80, 1_700_000_000n)
      .u64(88, 9n);
    const s = decodeErSession(buf.bytes);
    expect(s.market.toString()).toBe(A(40).toString());
    expect(s.validator.toString()).toBe(A(41).toString());
    expect(s.commitFrequencyMs).toBe(30_000);
    expect(s.status).toBe(1);
    expect(s.lastCommitSlot).toBe(9n);
  });
});
