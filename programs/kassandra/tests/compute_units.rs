//! Compute-unit (CU) metering + regression guard.
//!
//! Drives the full front-door lifecycle — `init_protocol` → `create_oracle` →
//! `propose` → `finalize_proposals` → `submit_fact` → `advance_phase` →
//! `vote_fact` → `finalize_facts` → `submit_ai_claim` → `finalize_ai_claims` →
//! `finalize_oracle` — through the REAL deployed program in LiteSVM, and records
//! the compute units each instruction consumes (the harness meters every
//! `TestCtx::send`, keyed by instruction discriminant).
//!
//! It then prints a per-instruction CU report (visible with
//! `cargo test -p kassandra-program compute_units -- --nocapture`) and GUARDS
//! each instruction against a budget ceiling, so a change that regresses an
//! instruction's compute cost fails the suite. The ceilings carry headroom over
//! the measured values — bump them deliberately (with the new number in the
//! commit) when an intentional change moves the cost.

mod common;
use common::*;

use kassandra_program::{
    config::PHASE_WINDOW,
    instruction::Ix,
    state::{Phase, VOTE_APPROVE},
};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
};
use spl_token::ID as TOKEN_PROGRAM_ID;

// ----- dispute-core instruction builders (mirror lifecycle_e2e.rs) -----------

fn submit_fact_payload(content_hash: &[u8; 32], stake: u64, uri: &[u8]) -> Vec<u8> {
    let mut data = Vec::with_capacity(1 + 32 + 8 + 2 + uri.len());
    data.push(Ix::SubmitFact as u8);
    data.extend_from_slice(content_hash);
    data.extend_from_slice(&stake.to_le_bytes());
    data.extend_from_slice(&(uri.len() as u16).to_le_bytes());
    data.extend_from_slice(uri);
    data
}

fn submit_fact_ix(
    ctx: &TestCtx,
    oracle: Pubkey,
    fact: Pubkey,
    submitter: Pubkey,
    submitter_kass: Pubkey,
    vault: Pubkey,
    data: Vec<u8>,
) -> Instruction {
    Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new(oracle, false),
            AccountMeta::new(fact, false),
            AccountMeta::new(submitter, true),
            AccountMeta::new(submitter_kass, false),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

fn advance_phase_ix(ctx: &TestCtx, oracle: Pubkey) -> Instruction {
    Instruction {
        program_id: ctx.program_id,
        accounts: vec![AccountMeta::new(oracle, false)],
        data: vec![Ix::AdvancePhase as u8],
    }
}

fn vote_payload(kind: u8, stake: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(1 + 1 + 8);
    data.push(Ix::VoteFact as u8);
    data.push(kind);
    data.extend_from_slice(&stake.to_le_bytes());
    data
}

#[allow(clippy::too_many_arguments)]
fn vote_fact_ix(
    ctx: &TestCtx,
    oracle: Pubkey,
    fact: Pubkey,
    fact_vote: Pubkey,
    voter: Pubkey,
    voter_kass: Pubkey,
    vault: Pubkey,
    data: Vec<u8>,
) -> Instruction {
    Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new(oracle, false),
            AccountMeta::new(fact, false),
            AccountMeta::new(fact_vote, false),
            AccountMeta::new(voter, true),
            AccountMeta::new(voter_kass, false),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

fn claim_pda(program_id: &Pubkey, oracle: &Pubkey, proposer: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"claim", oracle.as_ref(), proposer.as_ref()], program_id)
}

fn submit_ai_payload(option: u8) -> Vec<u8> {
    let mut data = Vec::with_capacity(1 + 32 + 32 + 32 + 1);
    data.push(Ix::SubmitAiClaim as u8);
    data.extend_from_slice(&[0xAA; 32]); // model_id
    data.extend_from_slice(&[0xBB; 32]); // params_hash
    data.extend_from_slice(&[0xCC; 32]); // io_hash
    data.push(option);
    data
}

fn submit_ai_claim_ix(
    ctx: &TestCtx,
    oracle: Pubkey,
    proposer: Pubkey,
    claim: Pubkey,
    authority: Pubkey,
    data: Vec<u8>,
) -> Instruction {
    Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new(oracle, false),
            AccountMeta::new(proposer, false),
            AccountMeta::new(claim, false),
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

fn finalize_ai_claims_ix(ctx: &TestCtx, oracle: Pubkey, tail: &[Pubkey]) -> Instruction {
    let mut accounts = Vec::with_capacity(1 + tail.len());
    accounts.push(AccountMeta::new(oracle, false));
    for k in tail {
        accounts.push(AccountMeta::new(*k, false));
    }
    Instruction {
        program_id: ctx.program_id,
        accounts,
        data: vec![Ix::FinalizeAiClaims as u8],
    }
}

// ----- per-instruction CU ceilings (measured value + headroom) ---------------
//
// Bump a ceiling ONLY for an intentional cost change, noting the new measured
// number in the commit. A silent regression trips the guard below.
struct Budget {
    ix: &'static str,
    max_cu: u64,
}

// Ceilings = the measured max CU (see the report this test prints) + ~25% headroom.
const BUDGETS: &[Budget] = &[
    Budget { ix: "init_protocol", max_cu: 8_000 },      // measured 6_079
    Budget { ix: "create_oracle", max_cu: 22_000 },     // measured 17_735
    Budget { ix: "propose", max_cu: 20_000 },           // measured 16_023
    Budget { ix: "finalize_proposals", max_cu: 2_000 }, // measured 1_092
    Budget { ix: "submit_fact", max_cu: 15_000 },       // measured 11_518
    Budget { ix: "advance_phase", max_cu: 1_500 },      // measured 577
    Budget { ix: "vote_fact", max_cu: 20_000 },         // measured 16_203
    Budget { ix: "finalize_facts", max_cu: 6_000 },     // measured 4_205
    Budget { ix: "submit_ai_claim", max_cu: 6_000 },    // measured 4_121
    Budget { ix: "finalize_ai_claims", max_cu: 2_500 }, // measured 1_431
    Budget { ix: "finalize_oracle", max_cu: 10_000 },   // measured 7_487
];

#[test]
fn cu_metering_full_lifecycle_under_budget() {
    let mut ctx = TestCtx::new();
    let bond = 1_000u64;

    // create_oracle → propose×2 (DISTINCT options) → finalize_proposals =>
    // FactProposal. `dispute_via_real_flow` sends init_protocol + create_oracle +
    // propose×2 + finalize_proposals through `ctx.send` (all metered).
    let oracle = ctx.dispute_via_real_flow(&[
        ProposerSpec { option: 0, bond },
        ProposerSpec { option: 1, bond },
    ]);
    let (vault, _) = TestCtx::stake_vault_pda(&ctx.program_id, &oracle);
    let proposer_pdas: Vec<Pubkey> = ctx.proposers(oracle).iter().map(|p| p.pda).collect();
    let authorities: Vec<Keypair> = ctx
        .proposers(oracle)
        .iter()
        .map(|p| p.authority.insecure_clone())
        .collect();

    // 1) submit_fact.
    let submitter = Keypair::new();
    ctx.svm.airdrop(&submitter.pubkey(), 1_000_000_000).unwrap();
    let submitter_kass = ctx.fund_kass(&submitter, 1_000_000);
    let content_hash = [0x07u8; 32];
    let (fact, _) = TestCtx::fact_pda(&ctx.program_id, &oracle, &content_hash);
    let ix = submit_fact_ix(
        &ctx,
        oracle,
        fact,
        submitter.pubkey(),
        submitter_kass,
        vault,
        submit_fact_payload(&content_hash, 100, b"ipfs://fact"),
    );
    ctx.send(ix, &[&submitter]).expect("submit_fact");

    // 2) advance_phase => FactVoting.
    ctx.warp(PHASE_WINDOW + 1);
    let ix = advance_phase_ix(&ctx, oracle);
    ctx.send(ix, &[]).expect("advance_phase");

    // 3) vote_fact (approve, clears the 2/3 quorum of dispute_bond_total = 2000).
    let voter = Keypair::new();
    ctx.svm.airdrop(&voter.pubkey(), 1_000_000_000).unwrap();
    let voter_kass = ctx.fund_kass(&voter, 10_000);
    let (fact_vote, _) = TestCtx::vote_pda(&ctx.program_id, &fact, &voter.pubkey());
    let ix = vote_fact_ix(
        &ctx,
        oracle,
        fact,
        fact_vote,
        voter.pubkey(),
        voter_kass,
        vault,
        vote_payload(VOTE_APPROVE, 2_000),
    );
    ctx.send(ix, &[&voter]).expect("vote_fact");

    // 4) finalize_facts => AiClaim.
    ctx.warp(PHASE_WINDOW + 1);
    ctx.send(ctx.finalize_facts_ix(oracle, &[fact]), &[])
        .expect("finalize_facts");
    assert_eq!(ctx.oracle(oracle).phase, Phase::AiClaim.as_u8());

    // 5) submit_ai_claim (each surviving proposer agrees on option 0).
    for (auth, pda) in authorities.iter().zip(&proposer_pdas) {
        ctx.svm.airdrop(&auth.pubkey(), 1_000_000_000).unwrap();
        let (claim, _) = claim_pda(&ctx.program_id, &oracle, pda);
        let ix = submit_ai_claim_ix(&ctx, oracle, *pda, claim, auth.pubkey(), submit_ai_payload(0));
        ctx.send(ix, &[auth]).expect("submit_ai_claim");
    }

    // 6) finalize_ai_claims => Challenge.
    ctx.warp(PHASE_WINDOW + 1);
    ctx.send(finalize_ai_claims_ix(&ctx, oracle, &proposer_pdas), &[])
        .expect("finalize_ai_claims");
    assert_eq!(ctx.oracle(oracle).phase, Phase::Challenge.as_u8());

    // 7) finalize_oracle => Resolved (no challenge opened).
    ctx.warp(PHASE_WINDOW + 1);
    ctx.send(ctx.finalize_oracle_ix(oracle, &proposer_pdas), &[])
        .expect("finalize_oracle");
    assert_eq!(ctx.oracle(oracle).phase, Phase::Resolved.as_u8());

    // --- report + guard ------------------------------------------------------
    print!("{}", ctx.cu_report());

    for b in BUDGETS {
        let used = ctx
            .cu_max(b.ix)
            .unwrap_or_else(|| panic!("instruction `{}` was never metered", b.ix));
        assert!(
            used <= b.max_cu,
            "CU regression: `{}` used {used} CU, over its {} budget — investigate, \
             or bump the ceiling in BUDGETS with the new number if intentional",
            b.ix,
            b.max_cu,
        );
    }
}
