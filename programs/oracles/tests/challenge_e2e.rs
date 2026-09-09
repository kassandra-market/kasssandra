//! End-to-end CHALLENGE lifecycle (Task C3).
//!
//! Drives the FULL challenge market against the REAL deployed MetaDAO v0.4
//! `amm` + `conditional_vault` binaries in LiteSVM, for BOTH outcomes
//! (fraud → disqualified, honest → survives), and asserts the physical
//! settlement + directional fees + SOL/USDC conservation against an
//! INDEPENDENT reference computation ([`ConservationModel`]) derived from the
//! bond + the governable fee config alone (it never trusts the program's own
//! accounting).
//!
//! # What is REAL vs SEEDED (honest split)
//! * **Dispute core (front door) — REAL.** [`front_door_to_challenge`] drives
//!   `create_oracle → propose×2 (conflict) → finalize_proposals → submit_fact →
//!   advance_phase → vote_fact → finalize_facts → submit_ai_claim×2 →
//!   finalize_ai_claims` through the genuine instructions to land the oracle in
//!   [`Phase::Challenge`] with a real [`AiClaim`] for a surviving, UN-slashed
//!   proposer (option-0 proposer claims option 0 → no flip). No `set_phase`
//!   shortcut is used in the e2e tests; only `warp`/`warp_slots` advance time.
//! * **MetaDAO market — REAL.** The challenger composes the binary question +
//!   SOL/USDC conditional vaults + pass/fail AMMs via real CPIs (exactly how a
//!   real challenger composes the market off-chain), then `open_challenge`
//!   verifies + records them, escrows the challenger USDC, and program-signs the
//!   bond split — all real instructions.
//! * **TWAP — REAL, swap-driven on the fraud path.** The fraud test pushes the
//!   FAIL pool's price up with a genuine `swap` (BUY) and accumulates it into the
//!   slot-weighted TWAP across TWO `crank_that_twap` calls 300 slots apart, so
//!   the disqualify decision is driven by real trading moving the TWAP past the
//!   `pass + threshold` margin (not by a fabricated price). The honest test
//!   leaves both pools at their seeded neutral price (pass == fail → survives).
//! * **`settle_challenge` — REAL.** `resolve_question` + `redeem_tokens` +
//!   directional-fee transfers are all program-signed real CPIs.
//!
//! The conservation FUZZ arm at the bottom uses a FABRICATED AMM account with a
//! chosen aggregator (a stubbed/known TWAP) so it can cheaply sweep both
//! outcomes × fee rates × bond sizes against [`ConservationModel`] while still
//! driving the REAL `open_challenge` (split + escrow) and `settle_challenge`
//! (redeem + fees) — the real-AMM *TWAP-production* path is covered by the two
//! deterministic e2e tests above + `settle_challenge.rs`. See the module-level
//! note at the bottom for why the heavy real-AMM path is not itself fuzzed.
//!
//! This binary is split across `challenge_e2e/` submodules (shared helpers in
//! `support`/`ops`/`lifecycle_common`; the tests in `honest`/`fraud`/`donation`/
//! `fuzz`) purely to keep each file small — the logic is unchanged.

mod common;
use common::*;

const VAULT_SO: &[u8] = include_bytes!("fixtures/metadao_conditional_vault.so");
const AMM_SO: &[u8] = include_bytes!("fixtures/metadao_amm.so");

#[path = "challenge_e2e/support.rs"]
mod support;
#[path = "challenge_e2e/ops.rs"]
mod ops;
#[path = "challenge_e2e/lifecycle_common.rs"]
mod lifecycle_common;
#[path = "challenge_e2e/honest.rs"]
mod honest;
#[path = "challenge_e2e/fraud.rs"]
mod fraud;
#[path = "challenge_e2e/donation.rs"]
mod donation;
#[path = "challenge_e2e/fuzz.rs"]
mod fuzz;
