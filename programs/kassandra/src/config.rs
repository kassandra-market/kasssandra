//! Protocol-global constants.
//!
//! Values here are part of the program's economic/temporal contract. Keep them
//! centralized so tasks that reason about windows and thresholds share one
//! source of truth.

/// Duration (seconds) of a dispute phase window. When a phase is advanced, the
/// new `phase_ends_at` is set to `now + PHASE_WINDOW`.
pub const PHASE_WINDOW: i64 = 3600;

/// Protocol-global supermajority threshold (numerator) for fact approval.
///
/// A fact is agreed only if its approve-stake reaches this fraction of the
/// fixed `Oracle.dispute_bond_total`. Default 2/3 (supermajority).
pub const THRESHOLD_NUM: u64 = 2;
/// Protocol-global supermajority threshold (denominator) for fact approval.
pub const THRESHOLD_DEN: u64 = 3;

/// Market slash-trigger margin (numerator). A challenged claim is DISQUALIFIED
/// only if its decision-market `fail` TWAP exceeds its `pass` TWAP by at least
/// this fraction: `fail_twap > pass_twap * (1 + MARKET_THRESHOLD_NUM /
/// MARKET_THRESHOLD_DEN)`. Implemented overflow-safely in `u128` as
/// `fail_twap * DEN > pass_twap * (DEN + NUM)`. This is the protocol-global
/// "fail > pass + threshold" of design §6 / invariant §9.8, expressed as a
/// RELATIVE margin (robust across markets with different price scales).
///
/// Default 1/10 (fail must beat pass by at least 10%): a margin wide enough that
/// ordinary two-sided trading noise does not flip an honest claim, yet narrow
/// enough that a genuine fraud belief (fail bid up, pass bid down) crosses it.
/// SEPARATE from the fact-quorum [`THRESHOLD_NUM`]/[`THRESHOLD_DEN`].
pub const MARKET_THRESHOLD_NUM: u128 = 1;
/// Market slash-trigger margin (denominator). See [`MARKET_THRESHOLD_NUM`].
pub const MARKET_THRESHOLD_DEN: u128 = 10;

/// Fraction (numerator) of a proposer's bond slashed when they FLIP their value
/// at AI-claim time (submitted a `claim_option != original_option`). A flip is
/// penalized but not fatal: the proposer keeps a valid (flipped) claim that
/// still counts in the plurality, so they remain surviving. Default 1/2 (50%).
pub const FLIP_SLASH_NUM: u64 = 1;
/// Fraction (denominator) of the flip slash. See [`FLIP_SLASH_NUM`].
pub const FLIP_SLASH_DEN: u64 = 2;
