//! Protocol-global constants.
//!
//! Values here are part of the program's economic/temporal contract. Keep them
//! centralized so tasks that reason about windows and thresholds share one
//! source of truth.

/// Duration (seconds) of a dispute phase window. When a phase is advanced, the
/// new `phase_ends_at` is set to `now + PHASE_WINDOW`.
pub const PHASE_WINDOW: i64 = 3600;

/// Duration (seconds) of the proposal-registration window. `create_oracle` sets
/// the new oracle's `phase_ends_at = deadline + PROPOSAL_WINDOW`: proposals open
/// at the `deadline` and the window runs for this long afterward.
pub const PROPOSAL_WINDOW: i64 = 3600;

/// Grace period (seconds) after a TERMINAL oracle's `phase_ends_at` before the
/// permissionless `sweep_oracle` (Ix 22) may reap it — route the residual
/// `stake_vault` SOL to the DAO treasury and CLOSE the vault + `Oracle`.
///
/// Deliberately GENEROUS — 30 days, dwarfing the hour-scale phase/proposal
/// windows ([`PHASE_WINDOW`] / [`PROPOSAL_WINDOW`]) — so every honest claimant
/// has ample time to crank their per-staker claim after resolution. The sweep is
/// gated on `now >= oracle.phase_ends_at + SWEEP_GRACE` (AND the oracle being
/// terminal). `phase_ends_at` is the terminal-entry anchor: `finalize_oracle`
/// can only drive the oracle terminal at `now >= phase_ends_at` (the challenge
/// window's end) and does NOT advance it. The sweep is thus gated to a FIXED,
/// publicly known instant — `phase_ends_at + SWEEP_GRACE` — no matter when the
/// finalize actually landed (a delayed finalize enters terminal later, which can
/// shrink the span measured from terminal-entry; the guarantee is this fixed
/// anchor off `phase_ends_at`, not a minimum span since terminal-entry).
///
/// TRADE-OFF (starkly documented): a staker who never claims within the grace
/// FORFEITS their unclaimed SOL principal (swept to the treasury) AND their
/// per-account rent. The long window makes this a genuine abandonment, not a
/// race — see `processor/sweep_oracle.rs`.
pub const SWEEP_GRACE: i64 = 30 * 24 * 60 * 60;

/// Upper bound on an oracle's proposer set, set to a realistic single-transaction
/// account-lock budget (Solana caps a tx at 64 account locks; `finalize_oracle`
/// also locks the oracle + program + fee payer, leaving ~60 read-only proposer
/// slots — fee payer + oracle + 60 proposers + program ≈ 63).
///
/// CONTRACT: this is the DEFENSIVE backstop that keeps `finalize_oracle`'s fixed
/// `votes` buffer from overflowing — AND the liveness guarantee enforced at
/// registration. The `propose` processor caps `proposer_count` at or below this
/// so the one-shot `finalize_oracle` always fits one transaction; otherwise an
/// oversized set would brick the oracle in [`Phase::Challenge`]. Shared by
/// `propose` and `finalize_oracle` so both reason about one constant.
///
/// CALLER OBLIGATION (off-chain, NOT enforced on-chain): the 64-account-lock
/// budget is necessary but NOT sufficient to finalize a near-cap set in one
/// transaction. A LEGACY transaction's 1232-byte packet cannot hold ~63 inline
/// 32-byte account keys (~2016 bytes), so one-shot `finalize_oracle` /
/// `finalize_proposals` over a full 60-proposer set REQUIRES a **versioned (v0)
/// transaction + an Address Lookup Table** (the ALT carries the proposer keys
/// out-of-band, off the packet). A caller restricted to legacy transactions must
/// keep its proposer set well below ~30 to fit the packet. The on-chain program
/// enforces only the 60-cap; assembling a transaction that can actually carry
/// the resulting account set is the caller's responsibility.
pub const MAX_PROPOSERS: u16 = 60;

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

// ---------------------------------------------------------------------------
// Dynamic creation fee (SOL, burned) — Task H2 / design §8 + emission recapture.
// ---------------------------------------------------------------------------
//
// The oracle-creation fee is paid in SOL and BURNED. It has TWO components,
// both driven by the same exponentially-decaying moving average ("EMA") of
// recent creation activity (`Protocol.fee_ema`, a fixed-point accumulator scaled
// by [`FEE_EMA_SCALE`] — `fee_ema == FEE_EMA_SCALE` means "1.0 creation units of
// recent activity"):
//
//   linear_demand = FEE_PER_EMA_UNIT * (decayed_fee_ema / FEE_EMA_SCALE)
//   recapture     = reward_emission * decayed_fee_ema
//                                   / (decayed_fee_ema + FEE_RECAPTURE_HALF_ACTIVITY)
//   fee           = linear_demand + recapture
//
// On every creation we (1) decay the stored EMA by the time elapsed since the
// last creation, (2) charge `fee`, burn it, then (3) bump the EMA by
// [`FEE_EMA_INCREMENT`] and stamp `last_creation_unix`.
//
// # Why the recapture term (the emission-farming throttle)
// Emission mints `reward_emission` SOL per `create_oracle` (see the emission
// section below) that a SINGLE uncontested proposer can claim. Without a fee that
// scales with that reward, an attacker could create oracles in a rapid burst and
// farm the emission for ~0 cost (the linear term alone is small relative to the
// reward). The `recapture` term ties the creation cost to the reward it unlocks:
//   * Quiet network (`fee_ema ≈ 0`) → recapture ≈ 0 → a lone creator keeps
//     ~all of `reward_emission` and mints it SLOWLY. This is the intended
//     distribution channel: emission is ON by default and a single uncontested
//     participant can steadily mint.
//   * Rapid creation → `fee_ema` spikes → recapture → `reward_emission` AND the
//     linear term pushes the total fee ABOVE the reward → net minting is throttled
//     to a slow drip (net-NEGATIVE for aggressive bursts). So the full supply can
//     NOT be minted right away.
// The recapture is proportional to the (shrinking) reward, so the throttle keeps
// its shape for the whole life of the reservoir without retuning. All fee math is
// done in `u128` intermediates and is overflow-safe; the fee is never negative.

/// Fixed-point scale for [`crate::state::Protocol::fee_ema`]. `fee_ema` of this
/// value represents 1.0 "creation units" of recent activity.
pub const FEE_EMA_SCALE: u128 = 1_000_000_000;

/// Half-life (seconds) of the activity EMA: after this much idle time the EMA
/// (and thus the fee) halves. 1 day. Governance-tunable.
pub const FEE_EMA_HALFLIFE_SECS: i64 = 86_400;

/// Scaled EMA bump added per oracle creation: exactly one "creation unit"
/// (`1.0 * FEE_EMA_SCALE`). Each creation adds this to the (decayed) EMA.
pub const FEE_EMA_INCREMENT: u64 = FEE_EMA_SCALE as u64;

/// SOL base units charged per 1.0 of EMA activity (i.e. per `FEE_EMA_SCALE` of
/// `fee_ema`) — the LINEAR demand-fee component. SOL has 9 decimals, so this is
/// 1 SOL per unit of EMA. Governance-tunable.
pub const FEE_PER_EMA_UNIT: u64 = 1_000_000_000;

/// The activity EMA at which the EMISSION-RECAPTURE fee component recaptures HALF
/// of the creation's `reward_emission` (`recapture = emission·ema/(ema+this)`).
/// ≈ 15 creation units ≈ 10 oracles/day of sustained activity (matching
/// [`STAKE_FLOOR_EMA_THRESHOLD`]). Below it a lone creator keeps most of the
/// reward and mints slowly; above it the recapture — together with the linear
/// term — drives the fee toward and past the reward, throttling burst minting.
/// A protocol shape constant (not per-`Protocol` state); the linear term and the
/// EMA half-life/increment remain the governance-tunable fee levers.
pub const FEE_RECAPTURE_HALF_ACTIVITY: u64 = 15_000_000_000;

// ── Activity-scaled minimum-stake floor (bootstrapping) ─────────────────────────
// The minimum stake for propose / submit_fact / vote_fact starts at 0 and ramps
// with the fee-EMA creation-activity signal, so the first oracles are free to
// create + participate in (no premined SOL). See `crate::stake_floor` +
// design `2026-07-08-oracle-stake-floor-bootstrap`. These are the RECOMMENDED
// governance values snapshotted into `Protocol` by `init_protocol`; the curve
// shape (threshold/cap) is pre-set, and the MAGNITUDE (`STAKE_FLOOR_MAX`) defaults
// to 0 (disabled — always-free) so governance activates the ramp deliberately,
// exactly like the emission switch.
//
// At a steady rate of `n` oracles/day the fee-EMA settles at
// `E(n) = FEE_EMA_INCREMENT / (1 − 2^(−1/n))`, so the fee-EMA values below map to
// creation rates: `E(10) ≈ 1.49e10`, `E(1000) ≈ 1.44e12`.

/// Fee-EMA at/below which the stake floor is 0 (the free bootstrap band).
/// ≈ 10 oracles/day. Governance-tunable via `set_config`.
pub const STAKE_FLOOR_EMA_THRESHOLD: u64 = 15_000_000_000;

/// Fee-EMA at/above which the stake floor reaches [`STAKE_FLOOR_MAX`].
/// ≈ 1000 oracles/day. Governance-tunable via `set_config`.
pub const STAKE_FLOOR_EMA_CAP: u64 = 1_443_000_000_000;

/// The maximum stake floor (SOL base units) at full activity. **0 at genesis =
/// disabled** (floor always 0, participation always free) until governance sets it
/// to the token's value via `set_config` — mirroring the emission/`total_supply_cap`
/// switch. Kept a governable magnitude because it depends on SOL's market value,
/// which does not exist at genesis.
pub const STAKE_FLOOR_MAX: u64 = 0;

// Compile-time guards: every fee const used as a divisor on the `create_oracle`
// path MUST be positive, so a future governance retune can never introduce a
// divide-by-zero runtime panic. `decay_fee_ema` divides by
// `FEE_EMA_HALFLIFE_SECS` and `2 * FEE_EMA_HALFLIFE_SECS`; `fee_for_ema` divides
// by `FEE_EMA_SCALE`. A bad value here is a build failure, not a deploy landmine.
const _: () = assert!(FEE_EMA_HALFLIFE_SECS > 0);
const _: () = assert!(FEE_EMA_SCALE > 0);

// ---------------------------------------------------------------------------
// Challenge-market economics (Task C1) — challenger USDC escrow + directional
// fee config.
// ---------------------------------------------------------------------------

/// Fixed-point scale of the futarchy spot-TWAP `spot_price` returns: the value
/// is `quote_raw_units_per_base_raw_unit × SPOT_PRICE_SCALE` (i.e. raw USDC per
/// raw SOL, scaled by `1e12` — see [`crate::cpi::metadao_v06::futarchy_spot_twap`]).
///
/// The challenger's escrow is sized so its USDC value matches the proposer's
/// bond SOL value at this price. Because the TWAP is already in RAW token units
/// (USDC base units per SOL base unit), the cross-decimal (SOL 9dp / USDC 6dp)
/// adjustment is folded into the price itself, so the conversion is simply:
///
/// ```text
/// required_usdc (USDC base units) = bond_kass (SOL base units) × twap / SPOT_PRICE_SCALE
/// ```
///
/// computed in `u128` and checked back into `u64`. Worked example: SOL at
/// $0.50 → twap `500_000_000`; a 1 SOL bond (`1e9` base units) escrows
/// `1e9 × 5e8 / 1e12 = 500_000` USDC base units = $0.50. Sound dimensionally:
/// `[KASS_raw] × [USDC_raw / KASS_raw] = [USDC_raw]`.
pub const SPOT_PRICE_SCALE: u128 = 1_000_000_000_000;

/// USDC fee charged on a FAILED challenge (the claim survives), paid out of the
/// challenger's escrow to the proposer, as the fraction
/// `CHALLENGE_FAIL_USDC_FEE_NUM / CHALLENGE_FAIL_USDC_FEE_DEN`. Default 1/100
/// (1%). Governable (snapshotted onto each `Oracle` at `create_oracle`, retuned
/// by `set_config`). The settle-side routing of this fee is Task C2.
pub const CHALLENGE_FAIL_USDC_FEE_NUM: u64 = 1;
/// Denominator of [`CHALLENGE_FAIL_USDC_FEE_NUM`].
pub const CHALLENGE_FAIL_USDC_FEE_DEN: u64 = 100;

/// SOL fee carved out of a SUCCESSFULLY-challenged (disqualified) proposer's
/// bond and routed to the challenger, as the fraction
/// `CHALLENGE_SUCCESS_BASE_FEE_NUM / CHALLENGE_SUCCESS_BASE_FEE_DEN`. Default
/// 1/100 (1%). Governable (snapshotted onto each `Oracle` at `create_oracle`,
/// retuned by `set_config`). The settle-side routing of this fee is Task C2.
pub const CHALLENGE_SUCCESS_BASE_FEE_NUM: u64 = 1;
/// Denominator of [`CHALLENGE_SUCCESS_BASE_FEE_NUM`].
pub const CHALLENGE_SUCCESS_BASE_FEE_DEN: u64 = 100;

/// Fraction (numerator) of a proposer's bond slashed when they FLIP their value
/// at AI-claim time (submitted a `claim_option != original_option`). A flip is
/// penalized but not fatal: the proposer keeps a valid (flipped) claim that
/// still counts in the plurality, so they remain surviving. Default 1/2 (50%).
pub const FLIP_SLASH_NUM: u64 = 1;
/// Fraction (denominator) of the flip slash. See [`FLIP_SLASH_NUM`].
pub const FLIP_SLASH_DEN: u64 = 2;

// ---------------------------------------------------------------------------
// Staker-settlement reward economics (Task S1).
// ---------------------------------------------------------------------------

/// Cohort reward-split weight of the PROPOSER cohort. The resolution reward
/// pool is split `proposer_bucket = pool·PW/(PW+FW)`, `fact_bucket =
/// pool·FW/(PW+FW)`. Default `2`, with `REWARD_FACT_WEIGHT = 1`, so proposers
/// (who bond capital and carry the resolution) earn twice the fact cohort's
/// share (`PW > FW`, design "Reward pool"). Snapshotted onto each `Oracle` at
/// `create_oracle`; governable via `set_config` (bound: at least one of the two
/// weights `> 0`, so the split denominator `PW+FW` is never zero).
pub const REWARD_PROPOSER_WEIGHT: u64 = 2;
/// Cohort reward-split weight of the FACT cohort (approved-fact submitters +
/// approve-voters). Default `1` (< [`REWARD_PROPOSER_WEIGHT`]). See that const.
pub const REWARD_FACT_WEIGHT: u64 = 1;

/// Fraction (numerator) of an approve-voter's stake SLASHED into `bond_pool`
/// when the fact they approved is REJECTED at `finalize_facts`. The voter later
/// reclaims `stake·(1 − FACT_VOTE_SLASH_NUM/FACT_VOTE_SLASH_DEN)`; the slashed
/// fraction is added (in aggregate, from the rejected fact's `approve_stake`) to
/// `bond_pool` at finalize time — no per-vote iteration. Default 1/2 (50%):
/// approving a fact the quorum rejects costs half the voter's stake, a
/// meaningful penalty without total wipe-out. Snapshotted onto each `Oracle` at
/// `create_oracle`; governable via `set_config` (bound: `den > 0`, `num ≤ den`).
pub const FACT_VOTE_SLASH_NUM: u64 = 1;
/// Denominator of [`FACT_VOTE_SLASH_NUM`].
pub const FACT_VOTE_SLASH_DEN: u64 = 2;

// ---------------------------------------------------------------------------
// Emission — SOL minted at oracle creation from the supply reservoir (Task S3).
// ---------------------------------------------------------------------------
//
// On every `create_oracle`, AFTER the EMA fee burn, the program mints
//
//   reward_emission = (TOTAL_SUPPLY_CAP − base_supply) · EMISSION_NUM / EMISSION_DEN
//
// SOL into the new oracle's `stake_vault` (program-signed by the mint-authority
// PDA). The "reservoir" `TOTAL_SUPPLY_CAP − base_supply` is the un-minted
// headroom: emission is a small fraction of it per oracle, so issuance tapers as
// supply approaches the cap (no epochs — live supply IS the schedule). The fee
// burn shrinks supply first, so burning boosts the SAME-tx reservoir.
//
// # Genesis / disabled is harmless
// These consts are the RECOMMENDED governance values (set via `set_config`), NOT
// the `init_protocol` defaults: a freshly-initialized `Protocol` carries
// `total_supply_cap == 0` + `emission_num == 0`, which makes `reward_emission ==
// 0` (no mint). Emission is a DELIBERATE governance switch — a supply cap below
// the live supply is meaningless, so the cap is left 0 (disabled) at genesis and
// enabled once governance picks the curve. With emission disabled every oracle's
// `stake_vault` holds exactly `Σ stakes` (the pre-S3 conservation invariant).

/// Recommended hard cap on circulating SOL supply (base units): 1e9 SOL at 9
/// decimals = `1e18`. The emission reservoir is `TOTAL_SUPPLY_CAP − supply`.
/// Governance-set via `set_config` (`init_protocol` leaves the cap 0 = disabled).
pub const TOTAL_SUPPLY_CAP: u64 = 1_000_000_000 * 1_000_000_000;

/// Recommended emission rate NUMERATOR. With [`EMISSION_DEN`] = `1_000_000` this
/// mints `1 / 1_000_000` of the remaining reservoir per oracle creation — small
/// and self-tapering. `num ≤ den` (a fraction); governance-set via `set_config`.
pub const EMISSION_NUM: u64 = 1;
/// Recommended emission rate DENOMINATOR (`1_000_000`). See [`EMISSION_NUM`].
/// `set_config` requires `emission_den > 0`.
pub const EMISSION_DEN: u64 = 1_000_000;

/// Seed of the program-controlled **SOL mint-authority PDA**:
/// `[b"mint_authority"]`, program = [`crate::ID`]. Emission mints SOL signed by
/// this PDA (the DAO governs the emission *rate*, not direct minting — design
/// "Bootstrapping"). F1 only DEFINES the seed + records the DAO linkage; the
/// binding `base_mint.mint_authority == mint_authority_pda` is asserted at first
/// emission (settlement milestone), since verifying it requires threading the
/// mint account (and the test-harness SOL mint authority is the payer, not the
/// PDA).
pub const MINT_AUTHORITY_SEED: &[u8] = b"mint_authority";
