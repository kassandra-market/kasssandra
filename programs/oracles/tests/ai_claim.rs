//! GPT-feed `apply_external_ai_claim` + `finalize_ai_claims` integration tests.
//!
//! These compose the real deployed instructions in LiteSVM, starting from a
//! seeded disputed oracle warped/forced into the [`Phase::AiClaim`] window.
//! They lock in:
//!
//! * AiClaim PDA seeds `[b"claim", oracle, proposer]` stamped from `AiOracleFeed`.
//! * Apply gating (phase / window / option range / one-per-proposer).
//! * `claim_option` / `flipped` recording (flip = original_option != feed.option).
//! * Incremental finalize: FULL slash for no-shows, PARTIAL (1/2) for flippers,
//!   no slash for honest submitters; phase advances to Challenge only once the
//!   whole proposer set is ai-finalized; `bond_pool` is a counter (no token CPI).
//! * Ix 3 `SubmitAiClaim` is retired (`SubmitAiClaimRetired`).

mod common;
use common::*;

use kassandra_oracles_program::state::Phase;
use solana_pubkey::Pubkey;

#[path = "ai_claim/submit.rs"]
mod submit;
#[path = "ai_claim/finalize.rs"]
mod finalize;

// ----- instruction builders -------------------------------------------------

/// Derive the AiClaim PDA: seeds `[b"claim", oracle, proposer]`.
fn claim_pda(program_id: &Pubkey, oracle: &Pubkey, proposer: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"claim", oracle.as_ref(), proposer.as_ref()], program_id)
}

// ----- fixture --------------------------------------------------------------

/// Seed a disputed oracle from the given specs and force it into AiClaim with
/// the window still open (seed sets `phase_ends_at = now + WINDOW`).
fn seed_ai(specs: &[ProposerSpec]) -> (TestCtx, Pubkey) {
    let mut ctx = TestCtx::new();
    let oracle = ctx.seed_disputed_oracle(specs);
    ctx.set_phase(oracle, Phase::AiClaim);
    (ctx, oracle)
}

/// Stamp a GPT-feed claim of `option` for the seeded proposer at `idx`.
#[allow(clippy::result_large_err)]
fn submit_for(
    ctx: &mut TestCtx,
    oracle: Pubkey,
    idx: usize,
    option: u8,
) -> litesvm::types::TransactionResult {
    let proposer_pda = ctx.proposers(oracle)[idx].pda;
    ctx.stamp_gpt_claim(oracle, proposer_pda, option)
}
