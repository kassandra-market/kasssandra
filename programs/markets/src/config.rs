//! Program-wide governable constants. Mirrors
//! `programs/oracles/src/config.rs`'s dynamic-fee / activity-scaled-floor model,
//! applied here to the market's funding floor instead of the oracle's stake
//! floor.
//!
//! ---------------------------------------------------------------------------
//! Activity-scaled min-liquidity floor (see `crate::liquidity_floor`)
//! ---------------------------------------------------------------------------
//!
//! The SOL a market must raise before it can `activate` starts at a BASE
//! (`Config.min_liquidity`, sane even at genesis — e.g. 1 SOL is fine with
//! almost no markets) and ramps UP with recent market-CREATION demand, so a
//! busy protocol requires proportionally more skin in the game before a market
//! goes live. Demand is an exponentially-decaying moving average ("EMA") of
//! recent `create_market` calls:
//!
//!   On every `create_market` we (1) decay the stored EMA toward 0 by the time
//!   elapsed since the last creation, (2) snapshot the new market's
//!   `min_liquidity` floor from that DECAYED value via the governable
//!   threshold/cap/max curve, then (3) bump the EMA by
//!   [`MARKET_EMA_INCREMENT`] and stamp `last_market_creation_unix`.
//!
//! Consequences (mirrors the oracle's fee-EMA monotonicity):
//!   * Genesis: `market_creation_ema == 0` → decayed 0 → floor stays at the base.
//!   * Demand: rapid creations stack [`MARKET_EMA_INCREMENT`] faster than decay
//!     can erase it → EMA grows → the floor for the NEXT market grows.
//!   * Idle: no creations → the EMA decays exponentially toward 0 → the floor
//!     shrinks back to the base.
//!
//! All EMA/floor math is done in `u128` intermediates and is overflow-safe.

/// Fixed-point scale for `Config.market_creation_ema`. A value of this
/// magnitude represents 1.0 "creation units" of recent activity.
pub const MARKET_EMA_SCALE: u128 = 1_000_000_000;

/// Half-life (seconds) of the market-creation activity EMA: after this much
/// idle time the EMA (and thus the floor's position on the ramp) halves. 1 day,
/// matching the oracle's creation-fee EMA cadence. Governance-tunable.
pub const MARKET_EMA_HALFLIFE_SECS: i64 = 86_400;

/// Scaled EMA bump added per market creation: exactly one "creation unit"
/// (`1.0 * MARKET_EMA_SCALE`). Each `create_market` adds this to the (decayed) EMA.
pub const MARKET_EMA_INCREMENT: u64 = MARKET_EMA_SCALE as u64;

// ── Activity-scaled min-liquidity curve (RECOMMENDED defaults) ───────────────
// These are the RECOMMENDED shape params an `init_config` caller may pass (or
// override); the curve itself tolerates any values, including a degenerate
// `cap <= threshold` (treated as disabled — see `crate::liquidity_floor`), so
// nothing here is hard-enforced by the program. At a steady rate of `n`
// markets/day the EMA settles at `E(n) = MARKET_EMA_INCREMENT / (1 −
// 2^(−1/n))`, so these map to creation rates: `E(10) ≈ 1.49e10`, `E(1000) ≈
// 1.44e12` — identical shape to the oracle's `STAKE_FLOOR_EMA_*` recommendation.

/// Recommended: EMA at/below which the floor stays at `min_liquidity` (the
/// base, low-demand band). ≈ 10 markets/day.
pub const MIN_LIQUIDITY_EMA_THRESHOLD: u64 = 15_000_000_000;

/// Recommended: EMA at/above which the floor reaches `min_liquidity_max`
/// (fully ramped). ≈ 1000 markets/day.
pub const MIN_LIQUIDITY_EMA_CAP: u64 = 1_443_000_000_000;

// Compile-time guards: every const used as a divisor on the `create_market`
// path MUST be positive, so a future governance retune can never introduce a
// divide-by-zero runtime panic (`decay_market_ema` divides by
// `MARKET_EMA_HALFLIFE_SECS` and `2 * MARKET_EMA_HALFLIFE_SECS`).
const _: () = assert!(MARKET_EMA_HALFLIFE_SECS > 0);
const _: () = assert!(MARKET_EMA_SCALE > 0);
