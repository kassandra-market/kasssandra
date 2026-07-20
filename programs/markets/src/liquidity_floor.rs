//! Activity-scaled minimum-funding floor for a new market — mirrors
//! `programs/oracles/src/stake_floor.rs`'s activity-scaled stake floor, applied
//! here to `min_liquidity` instead: the KASS a market must raise before it can
//! `activate` starts at a BASE (governance's `Config.min_liquidity` — sane even
//! at genesis, e.g. "1 KASS is fine with almost no markets") and ramps UP with
//! recent market-CREATION demand, so a busy protocol requires proportionally
//! more skin in the game before a market goes live. See `crate::config` for the
//! EMA model and the tunable constants. Kept in its own module (pure, no
//! account access) so the math is unit-testable without an on-chain harness.
//!
//! * `ema <= threshold` → `base` (the low-demand band — governance's flat floor)
//! * `threshold < ema < cap` → linear ramp `base` → `max`
//! * `ema >= cap` → `max` (capped)
//!
//! Snapshotted onto each `Market.min_liquidity` at `create_market`, so an
//! in-flight market's floor is frozen (immune to later demand/governance
//! changes) — the same config-as-state discipline as `Market.fee_bps`.
//! `max <= base` (the genesis default) disables the ramp entirely: the floor is
//! always the flat base, exactly like the oracle's `stake_floor_max == 0`
//! bootstrap default.

use crate::config::{MARKET_EMA_HALFLIFE_SECS, MARKET_EMA_INCREMENT};

/// Exponentially decay the fixed-point market-creation-activity EMA toward 0 by
/// the time elapsed since the last creation.
///
/// Identical approximation to the oracle's `decay_fee_ema`: whole-half-life
/// halvings plus a LINEAR interpolation over the leftover fraction of the
/// current half-life — all in `u128`:
///
/// ```text
/// whole = elapsed / H      rem = elapsed % H
/// base  = ema >> whole                       (exact halving per whole H)
/// decayed = base * (2H - rem) / (2H)         (linear within the half-life)
/// ```
///
/// Edge cases: `ema == 0` or `elapsed <= 0` returns `ema` unchanged; `whole >=
/// 64` (well past any practical idle gap) collapses to 0.
pub fn decay_market_ema(ema: u64, last_unix: i64, now: i64) -> u64 {
    if ema == 0 {
        return 0;
    }
    let elapsed = now.saturating_sub(last_unix);
    if elapsed <= 0 {
        return ema;
    }
    let h = MARKET_EMA_HALFLIFE_SECS as u128; // compile-time positive
    let elapsed = elapsed as u128;
    let whole = elapsed / h;
    if whole >= 64 {
        // `ema` fits in u64; shifting right by >= 64 is always 0.
        return 0;
    }
    let rem = elapsed % h;
    let base = (ema as u128) >> whole;
    // Linear interpolation across the current half-life. `base <= u64::MAX` and
    // `2H - rem <= 2H`, so the product stays far inside u128.
    let decayed = base * (2 * h - rem) / (2 * h);
    decayed as u64 // decayed <= base <= ema, so it fits in u64
}

/// The EMA value to store after a creation: the decayed EMA plus one creation
/// unit. Saturates (the EMA is an unbounded-demand accumulator; saturation only
/// bites at absurd, unreachable activity levels).
pub fn bumped_market_ema(decayed_ema: u64) -> u64 {
    decayed_ema.saturating_add(MARKET_EMA_INCREMENT)
}

/// The min-liquidity floor (KASS base units) for a market created when the
/// (already-decayed) EMA was `ema`, given the governable curve params
/// (`threshold`, `cap`, `base`, `max`). Piecewise linear from `base` to `max`.
/// Returns `base` when disabled (`max <= base`), degenerate (`cap <=
/// threshold`), or still inside the low-demand band (`ema <= threshold`). All
/// arithmetic is done in `u128`, so it is overflow-safe for any `u64` inputs.
pub fn liquidity_floor(ema: u64, threshold: u64, cap: u64, base: u64, max: u64) -> u64 {
    // Disabled (max at/below base), degenerate curve, or inside the base band → base.
    if max <= base || cap <= threshold || ema <= threshold {
        return base;
    }
    if ema >= cap {
        return max;
    }
    // Linear ramp. `(max - base) as u128 * pos` cannot overflow u128 (both <
    // 2^64), and `span > 0` here (cap > threshold), so the division is safe.
    let span = (cap - threshold) as u128;
    let pos = (ema - threshold) as u128;
    let extra = (max - base) as u128 * pos / span;
    // `pos < span` here (ema < cap), so `extra < (max - base)`, which fits u64.
    base + extra as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- decay_market_ema (mirrors oracles/src/fee.rs's decay_fee_ema tests) --

    const H: i64 = MARKET_EMA_HALFLIFE_SECS;

    #[test]
    fn decay_no_elapsed_time_is_unchanged() {
        let ema = 5 * MARKET_EMA_INCREMENT;
        assert_eq!(decay_market_ema(ema, 1_000, 1_000), ema);
    }

    #[test]
    fn decay_negative_elapsed_is_unchanged() {
        let ema = 5 * MARKET_EMA_INCREMENT;
        assert_eq!(decay_market_ema(ema, 1_000, 500), ema);
    }

    #[test]
    fn decay_zero_ema_stays_zero() {
        assert_eq!(decay_market_ema(0, 0, 1_000_000), 0);
    }

    #[test]
    fn decay_one_halflife_halves() {
        let ema = 1_000 * MARKET_EMA_INCREMENT;
        let got = decay_market_ema(ema, 0, H);
        assert_eq!(got, ema / 2);
    }

    #[test]
    fn decay_two_halflives_quarters() {
        let ema = 1_000 * MARKET_EMA_INCREMENT;
        assert_eq!(decay_market_ema(ema, 0, 2 * H), ema / 4);
    }

    #[test]
    fn decay_half_halflife_is_between_full_and_none() {
        let ema = 1_000 * MARKET_EMA_INCREMENT;
        let got = decay_market_ema(ema, 0, H / 2);
        assert!(got < ema);
        assert!(got > ema / 2);
    }

    #[test]
    fn decay_far_past_collapses_to_zero() {
        let ema = 1_000 * MARKET_EMA_INCREMENT;
        assert_eq!(decay_market_ema(ema, 0, H * 1_000), 0);
    }

    #[test]
    fn decay_is_monotone_nonincreasing_over_time() {
        let ema = 777 * MARKET_EMA_INCREMENT;
        let mut prev = decay_market_ema(ema, 0, 0);
        for k in 1..200i64 {
            let now = k * 137;
            let cur = decay_market_ema(ema, 0, now);
            assert!(cur <= prev, "not monotone at now={now}: {cur} > {prev}");
            prev = cur;
        }
    }

    // ---- bumped_market_ema -----------------------------------------------

    #[test]
    fn bump_adds_one_creation_unit() {
        assert_eq!(bumped_market_ema(0), MARKET_EMA_INCREMENT);
        assert_eq!(bumped_market_ema(5 * MARKET_EMA_INCREMENT), 6 * MARKET_EMA_INCREMENT);
    }

    #[test]
    fn bump_saturates_at_u64_max() {
        assert_eq!(bumped_market_ema(u64::MAX), u64::MAX);
    }

    // ---- liquidity_floor (mirrors oracles/src/stake_floor.rs's tests) -----

    const THRESHOLD: u64 = 15_000_000_000; // ≈10 markets/day
    const CAP: u64 = 1_443_000_000_000; // ≈1000 markets/day
    const BASE: u64 = 1_000_000_000; // 1 KASS
    const MAX: u64 = 10_000_000_000; // 10 KASS

    #[test]
    fn stays_at_base_at_or_below_threshold() {
        assert_eq!(liquidity_floor(0, THRESHOLD, CAP, BASE, MAX), BASE);
        assert_eq!(liquidity_floor(THRESHOLD, THRESHOLD, CAP, BASE, MAX), BASE);
        assert_eq!(liquidity_floor(THRESHOLD - 1, THRESHOLD, CAP, BASE, MAX), BASE);
    }

    #[test]
    fn capped_at_or_above_cap() {
        assert_eq!(liquidity_floor(CAP, THRESHOLD, CAP, BASE, MAX), MAX);
        assert_eq!(liquidity_floor(CAP + 1, THRESHOLD, CAP, BASE, MAX), MAX);
        assert_eq!(liquidity_floor(u64::MAX, THRESHOLD, CAP, BASE, MAX), MAX);
    }

    #[test]
    fn linear_midpoint() {
        // Exactly halfway across the ramp → ~halfway between base and max.
        let mid = THRESHOLD + (CAP - THRESHOLD) / 2;
        let f = liquidity_floor(mid, THRESHOLD, CAP, BASE, MAX);
        let expected_mid = BASE + (MAX - BASE) / 2;
        assert!(
            f.abs_diff(expected_mid) <= 1,
            "midpoint floor {f} not ≈ {expected_mid}",
        );
    }

    #[test]
    fn monotone_nondecreasing_across_ramp() {
        let mut prev = BASE;
        for k in 0..=10u64 {
            let ema = THRESHOLD + (CAP - THRESHOLD) * k / 10;
            let f = liquidity_floor(ema, THRESHOLD, CAP, BASE, MAX);
            assert!(f >= prev, "not monotone at k={k}: {f} < {prev}");
            prev = f;
        }
        assert_eq!(prev, MAX);
    }

    #[test]
    fn disabled_when_max_at_or_below_base() {
        // The genesis default: any activity level yields the flat base.
        assert_eq!(liquidity_floor(CAP, THRESHOLD, CAP, BASE, BASE), BASE);
        assert_eq!(liquidity_floor(CAP, THRESHOLD, CAP, BASE, BASE - 1), BASE);
        assert_eq!(liquidity_floor(u64::MAX, 0, u64::MAX, BASE, 0), BASE);
    }

    #[test]
    fn degenerate_curve_is_base() {
        // cap <= threshold → treated as disabled (no divide-by-zero / no negative span).
        assert_eq!(liquidity_floor(u64::MAX, CAP, THRESHOLD, BASE, MAX), BASE);
        assert_eq!(liquidity_floor(500, 100, 100, BASE, MAX), BASE);
    }

    #[test]
    fn no_overflow_at_extremes() {
        // max - base spans nearly all of u64, full-width ramp — u128
        // intermediate must not overflow.
        let f = liquidity_floor(u64::MAX / 2, 0, u64::MAX, 0, u64::MAX);
        assert!(f > 0);
        assert!(f.abs_diff(u64::MAX / 2) <= 2, "midpoint {f}");
    }
}
