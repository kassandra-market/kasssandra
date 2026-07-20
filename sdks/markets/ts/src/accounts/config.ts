/**
 * Decoder for the `Config` singleton account (`state.rs::Config`, 160 bytes) — the
 * program's global record: the futarchy authority gating `update_config`, the
 * canonical KASS mint every market escrows, the funding-target floor, and the
 * activity-scaled min-liquidity curve (mirrors the Kassandra oracle's
 * activity-scaled stake floor — see `liquidityFloor`).
 * Field offsets pinned in `programs/markets/tests/state_layout.rs`.
 */
import { Address } from "@solana/web3.js";

import { AccountType, ACCOUNT_SIZES } from "../constants.js";
import { assertAccount, readI64LE, readPubkey, readU16LE, readU64LE, readU8, view } from "./common.js";

/** Decoded `Config`. `u64`/`i64` fields are `bigint`; keys are `Address`. */
export interface Config {
  accountType: AccountType.Config;
  /** Futarchy authority permitted to run `update_config`. */
  authority: Address;
  /** Canonical KASS mint every market escrows and splits. */
  kassMint: Address;
  /** Minimum KASS a market must raise before it can be activated — the BASE
   *  (low-demand) floor; see `minLiquidityMax` for the activity-scaled ceiling. */
  minLiquidity: bigint;
  /** Config PDA bump. */
  bump: number;
  /** Governance-set protocol fee in basis points (<= MAX_FEE_BPS). */
  feeBps: number;
  /** KASS token account protocol fees are routed to. */
  feeDestination: Address;
  /** Fixed-point EMA of recent market-creation activity (see `liquidityFloor`). */
  marketCreationEma: bigint;
  /** Unix timestamp of the last `create_market`, for the EMA decay. */
  lastMarketCreationUnix: bigint;
  /** EMA at/below which the floor stays at `minLiquidity` (the base). */
  minLiquidityEmaThreshold: bigint;
  /** EMA at/above which the floor reaches `minLiquidityMax`. */
  minLiquidityEmaCap: bigint;
  /** Ceiling of the activity-scaled ramp; `<= minLiquidity` means disabled (flat). */
  minLiquidityMax: bigint;
}

/** Decode a `Config` account from its raw bytes. Throws on wrong size or tag. */
export function decodeConfig(data: Uint8Array): Config {
  assertAccount(data, AccountType.Config, ACCOUNT_SIZES.Config, "Config");
  const dv = view(data);
  return {
    accountType: AccountType.Config,
    authority: readPubkey(data, 8),
    kassMint: readPubkey(data, 40),
    minLiquidity: readU64LE(dv, 72),
    bump: readU8(dv, 80),
    feeBps: readU16LE(dv, 82),
    feeDestination: readPubkey(data, 84),
    marketCreationEma: readU64LE(dv, 120),
    lastMarketCreationUnix: readI64LE(dv, 128),
    minLiquidityEmaThreshold: readU64LE(dv, 136),
    minLiquidityEmaCap: readU64LE(dv, 144),
    minLiquidityMax: readU64LE(dv, 152),
  };
}
