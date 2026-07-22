//! Dynamic creation-fee math (Task H2 / design §8).
//!
//! Pure, overflow-safe integer routines for the KASS creation fee that is
//! BURNED on every `create_oracle`. See [`crate::config`] for the model and the
//! tunable constants. Kept in its own module so the EMA decay can be unit-tested
//! without an on-chain harness.

use crate::config::{
    FEE_EMA_HALFLIFE_SECS, FEE_EMA_INCREMENT, FEE_EMA_SCALE, FEE_PER_EMA_UNIT,
    FEE_RECAPTURE_HALF_ACTIVITY,
};

/// Exponentially decay the fixed-point activity EMA toward 0 by the time
/// elapsed since the last creation.
///
/// # Approximation
/// True exponential decay is `ema * 2^(-elapsed / H)` for half-life `H`. We
/// approximate it with whole-half-life halvings plus a LINEAR interpolation over
/// the leftover fraction of the current half-life — all in `u128`:
///
/// ```text
/// whole = elapsed / H      rem = elapsed % H
/// base  = ema >> whole                       (exact halving per whole H)
/// decayed = base * (2H - rem) / (2H)         (linear within the half-life)
/// ```
///
/// At `rem == 0` this is `base`; at `rem == H` it is `base / 2` — so it joins
/// continuously with the next whole halving. The result is monotonic
/// non-increasing in `elapsed` and never exceeds `fee_ema`.
///
/// Edge cases: `fee_ema == 0` or `elapsed <= 0` returns `fee_ema` unchanged;
/// `whole >= 64` (well past any practical idle gap) collapses to 0.
pub fn decay_fee_ema(fee_ema: u64, last_unix: i64, now: i64) -> u64 {
    if fee_ema == 0 {
        return 0;
    }
    let elapsed = now.saturating_sub(last_unix);
    if elapsed <= 0 {
        return fee_ema;
    }
    let h = FEE_EMA_HALFLIFE_SECS as u128; // compile-time positive
    let elapsed = elapsed as u128;
    let whole = elapsed / h;
    if whole >= 64 {
        // `fee_ema` fits in u64; shifting right by >= 64 is always 0.
        return 0;
    }
    let rem = elapsed % h;
    let base = (fee_ema as u128) >> whole;
    // Linear interpolation across the current half-life. `base <= u64::MAX` and
    // `2H - rem <= 2H`, so the product stays far inside u128.
    let decayed = base * (2 * h - rem) / (2 * h);
    decayed as u64 // decayed <= base <= fee_ema, so it fits in u64
}

/// KASS base units to burn for a creation given the already-decayed EMA.
///
/// `fee = FEE_PER_EMA_UNIT * decayed_fee_ema / FEE_EMA_SCALE`, saturating to
/// `u64`. Zero when `decayed_fee_ema == 0` (genesis is free).
pub fn fee_for_ema(decayed_fee_ema: u64) -> u64 {
    let scaled = (FEE_PER_EMA_UNIT as u128).saturating_mul(decayed_fee_ema as u128) / FEE_EMA_SCALE;
    u64::try_from(scaled).unwrap_or(u64::MAX)
}

/// The EMISSION-RECAPTURE fee component: the fraction of this creation's
/// `reward_emission` recaptured (burned) as a function of recent creation
/// activity — `emission · ema / (ema + FEE_RECAPTURE_HALF_ACTIVITY)` (u128,
/// floor).
///
/// Properties (the emission-farming throttle):
/// * `ema == 0` (quiet / genesis) → 0: a lone creator keeps the full reward and
///   mints it slowly (the intended distribution channel).
/// * strictly `< emission` for any finite `ema` (the ratio is `< 1`), so the
///   recapture ALONE never fully erases the reward — a single uncontested
///   participant can always still mint. The linear demand term is what pushes the
///   TOTAL fee past the reward under heavy activity.
/// * monotonic non-decreasing in `ema` → `emission` as `ema → ∞`.
pub fn emission_recapture_fee(emission: u64, decayed_fee_ema: u64) -> u64 {
    if emission == 0 || decayed_fee_ema == 0 {
        return 0;
    }
    let ema = decayed_fee_ema as u128;
    // emission ≤ u64::MAX and ema ≤ u64::MAX, so the product ≤ 2^128 − … fits u128.
    let recaptured = (emission as u128) * ema / (ema + FEE_RECAPTURE_HALF_ACTIVITY as u128);
    recaptured as u64 // recaptured < emission ≤ u64::MAX
}

/// The TOTAL creation fee burned on `create_oracle`: the linear demand fee
/// ([`fee_for_ema`]) PLUS the emission-recapture fee
/// ([`emission_recapture_fee`]), saturating to `u64`.
///
/// At `decayed_fee_ema == 0` (genesis / quiet) this is 0. As activity rises the
/// linear term grows without bound and the recapture term approaches
/// `reward_emission`, so the total can EXCEED the reward — making a rapid emission
/// farm net-negative while leaving a lone slow creator's fee ≈ 0.
pub fn creation_fee(reward_emission: u64, decayed_fee_ema: u64) -> u64 {
    fee_for_ema(decayed_fee_ema).saturating_add(emission_recapture_fee(reward_emission, decayed_fee_ema))
}

/// The EMA value to store after a creation: the decayed EMA plus one creation
/// unit. Saturates (the EMA is an unbounded-demand accumulator; saturation only
/// bites at absurd, unreachable activity levels).
pub fn bumped_fee_ema(decayed_fee_ema: u64) -> u64 {
    decayed_fee_ema.saturating_add(FEE_EMA_INCREMENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: i64 = FEE_EMA_HALFLIFE_SECS;

    #[test]
    fn zero_elapsed_is_unchanged() {
        let ema = 5 * FEE_EMA_SCALE as u64;
        assert_eq!(decay_fee_ema(ema, 1_000, 1_000), ema);
        // Negative elapsed (clock went backwards) is clamped to unchanged.
        assert_eq!(decay_fee_ema(ema, 1_000, 500), ema);
    }

    #[test]
    fn genesis_zero_stays_zero() {
        assert_eq!(decay_fee_ema(0, 0, 1_000_000), 0);
    }

    #[test]
    fn one_half_life_is_about_half() {
        let ema = 1_000_000_000u64;
        let got = decay_fee_ema(ema, 0, H);
        // Exactly half at a whole half-life (rem == 0 → base = ema >> 1).
        assert_eq!(got, ema / 2);
    }

    #[test]
    fn two_half_lives_is_about_quarter() {
        let ema = 1_000_000_000u64;
        assert_eq!(decay_fee_ema(ema, 0, 2 * H), ema / 4);
    }

    #[test]
    fn half_a_half_life_is_between_full_and_half() {
        let ema = 1_000_000_000u64;
        let got = decay_fee_ema(ema, 0, H / 2);
        // Linear interp at rem = H/2: base * (2H - H/2)/(2H) = base * 3/4.
        assert!(got < ema && got > ema / 2, "got {got}");
        assert_eq!(got, ema * 3 / 4);
    }

    #[test]
    fn large_elapsed_decays_to_zero() {
        let ema = u64::MAX;
        assert_eq!(decay_fee_ema(ema, 0, H * 1_000), 0);
    }

    #[test]
    fn monotonic_non_increasing_in_elapsed() {
        let ema = 9_876_543_210u64;
        let mut prev = decay_fee_ema(ema, 0, 0);
        for k in 1..=400 {
            let now = (H * k) / 7; // sub-half-life steps across many half-lives
            let cur = decay_fee_ema(ema, 0, now);
            assert!(cur <= prev, "not monotonic at k={k}: {cur} > {prev}");
            prev = cur;
        }
        assert_eq!(prev, 0, "should reach 0 after many half-lives");
    }

    #[test]
    fn never_exceeds_input() {
        let ema = 7 * FEE_EMA_SCALE as u64;
        for k in 0..50i64 {
            assert!(decay_fee_ema(ema, 0, k * 137) <= ema);
        }
    }

    #[test]
    fn fee_is_zero_at_genesis_and_grows_with_ema() {
        assert_eq!(fee_for_ema(0), 0);
        // 1.0 EMA unit → FEE_PER_EMA_UNIT; 2.0 → 2x.
        assert_eq!(fee_for_ema(FEE_EMA_SCALE as u64), FEE_PER_EMA_UNIT);
        assert_eq!(fee_for_ema(2 * FEE_EMA_SCALE as u64), 2 * FEE_PER_EMA_UNIT);
    }

    #[test]
    fn bump_adds_one_unit() {
        assert_eq!(bumped_fee_ema(0), FEE_EMA_INCREMENT);
        assert_eq!(
            bumped_fee_ema(FEE_EMA_SCALE as u64),
            2 * FEE_EMA_SCALE as u64
        );
    }

    // ---- emission-recapture fee + combined creation fee ---------------------

    const EMISSION: u64 = 1_000_000_000_000; // 1000 KASS, ≈ a genesis per-oracle reward

    #[test]
    fn recapture_is_zero_at_genesis_or_no_emission() {
        // Quiet network (ema 0) → a lone creator keeps the whole reward.
        assert_eq!(emission_recapture_fee(EMISSION, 0), 0);
        // No emission → nothing to recapture.
        assert_eq!(emission_recapture_fee(0, 5 * FEE_EMA_SCALE as u64), 0);
    }

    #[test]
    fn recapture_is_half_at_the_half_activity_point() {
        // At ema == FEE_RECAPTURE_HALF_ACTIVITY the fee recaptures exactly half.
        let got = emission_recapture_fee(EMISSION, FEE_RECAPTURE_HALF_ACTIVITY);
        assert_eq!(got, EMISSION / 2);
    }

    #[test]
    fn recapture_is_always_below_emission_so_a_lone_miner_can_always_mint() {
        // The ratio ema/(ema+H) < 1 for every finite ema, so recapture < emission
        // — a single uncontested participant always nets something positive from
        // the recapture component alone.
        for units in [1u64, 5, 10, 100, 1_000, 1_000_000] {
            let ema = units.saturating_mul(FEE_EMA_SCALE as u64);
            assert!(
                emission_recapture_fee(EMISSION, ema) < EMISSION,
                "recapture must stay below the reward at {units} units"
            );
        }
    }

    #[test]
    fn recapture_monotonic_non_decreasing_and_approaches_emission() {
        let mut prev = emission_recapture_fee(EMISSION, 0);
        for units in 1..=2_000u64 {
            let ema = units * FEE_EMA_SCALE as u64;
            let cur = emission_recapture_fee(EMISSION, ema);
            assert!(cur >= prev, "recapture must be non-decreasing at {units} units");
            prev = cur;
        }
        // Deep into heavy activity the recapture is within 1% of the full reward.
        assert!(prev > EMISSION - EMISSION / 100);
    }

    #[test]
    fn combined_fee_zero_at_genesis() {
        // Genesis: no activity → free creation → the lone creator mints the full
        // reward (slow distribution).
        assert_eq!(creation_fee(EMISSION, 0), 0);
    }

    #[test]
    fn combined_fee_exceeds_reward_under_heavy_activity() {
        // The whole point: sustained rapid creation drives the fee ABOVE the
        // reward, so an emission farm at that activity level is net-NEGATIVE.
        // 200 creation units ≈ a heavy burst.
        let ema = 200 * FEE_EMA_SCALE as u64;
        let fee = creation_fee(EMISSION, ema);
        assert!(
            fee > EMISSION,
            "fee ({fee}) must exceed the reward ({EMISSION}) under heavy activity"
        );
    }

    #[test]
    fn combined_fee_leaves_a_lone_slow_creator_net_positive() {
        // A lone creator on a quiet network (ema ≈ a fraction of a unit) pays a
        // fee far below the reward and nets most of it — the intended slow mint.
        let ema = FEE_EMA_SCALE as u64 / 10; // 0.1 units of recent activity
        let fee = creation_fee(EMISSION, ema);
        assert!(fee < EMISSION / 10, "quiet-network fee ({fee}) should be a small fraction of the reward");
    }
}
