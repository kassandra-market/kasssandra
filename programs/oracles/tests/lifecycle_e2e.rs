//! End-to-end lifecycle tests (Task H5).
//!
//! These drive the REAL deployed instructions in LiteSVM from the genuine front
//! door — `init_protocol` → `create_oracle` → `propose` → `finalize_proposals`
//! — and, on the conflict path, hand off to the already-built dispute core
//! (`submit_fact` → `advance_phase` → `vote_fact` → `finalize_facts` →
//! `submit_ai_claim` → `finalize_ai_claims` → `finalize_oracle`) all the way to
//! a terminal state. No `set_phase` shortcuts appear in the critical chain; only
//! `warp` advances time. The point is to prove the real entry point composes
//! with the dispute core end-to-end.
//!
//! They also assert the cheap lifecycle invariants along the way: phase
//! transitions happen in order, counters track the set, and SOL is conserved at
//! the proposal-phase boundary (`stake_vault == total_oracle_stake == Σ bonds`,
//! checked BEFORE any `submit_fact` accrues fact stakes into
//! `total_oracle_stake`).

mod common;
use common::*;

use kassandra_oracles_program::{
    config::PHASE_WINDOW,
    reward,
    state::{Phase, VOTE_APPROVE},
};
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;

// ----- dispute-core instruction builders (mirror the dedicated test files) ---

fn finalize_facts_ix(ctx: &TestCtx, oracle: Pubkey, tail: &[Pubkey]) -> Instruction {
    ctx.finalize_facts_ix(oracle, tail)
}

fn finalize_oracle_ix(ctx: &TestCtx, oracle: Pubkey, tail: &[Pubkey]) -> Instruction {
    // S3 account order (oracle, base_mint, stake_vault, token program, tail) +
    // the oracle-nonce payload, via the shared harness builder.
    ctx.finalize_oracle_ix(oracle, tail)
}

// ----- E2E: happy (uncontested) path ----------------------------------------

#[test]
fn e2e_happy_uncontested_resolves() {
    let mut ctx = TestCtx::new();
    let payer_base = ctx.payer_base;
    let base_mint = ctx.base_mint;

    // No native-token minting. Genesis fee is 0.
    ctx.ensure_protocol();

    // Genesis creation: fee_ema starts at 0, so the dynamic creation fee is 0.
    let bal_before = ctx.token_balance(payer_base);
    let supply_before = ctx.mint_supply(base_mint);

    // init_protocol (once) + create_oracle + warp to the open proposal window.
    let oracle = ctx.create_real_oracle(3, 600);

    // No native-token minting: create_oracle never mints. Genesis fee is 0.
    let emission = ctx.oracle(oracle).reward_emission;
    assert_eq!(emission, 0, "create_oracle never mints a native token");
    assert_eq!(
        ctx.token_balance(payer_base),
        bal_before,
        "genesis creation fee is 0: no SOL burned from the creator"
    );
    assert_eq!(
        ctx.mint_supply(base_mint),
        supply_before + emission,
        "genesis fee is 0 and nothing is minted"
    );
    assert_eq!(ctx.oracle(oracle).phase, Phase::Proposal.as_u8());

    // Three proposers, ALL agreeing on option 1.
    let bond = 5_000u64;
    ctx.propose_real(oracle, 1, bond);
    ctx.propose_real(oracle, 1, bond);
    ctx.propose_real(oracle, 1, bond);

    // --- SOL conservation at the proposal boundary (no facts yet) ----------
    let (vault, _) = TestCtx::stake_vault_pda(&ctx.program_id, &oracle);
    let sum_bonds = 3 * bond;
    let o = ctx.oracle(oracle);
    assert_eq!(o.proposer_count, 3);
    assert_eq!(o.surviving_count, 3);
    assert_eq!(
        o.total_oracle_stake, sum_bonds,
        "total_oracle_stake == Σ bonds (emission is NOT counted as proposer stake)"
    );
    // The vault physically holds Σ bonds PLUS the creation-time emission.
    assert_eq!(
        ctx.token_balance(vault),
        sum_bonds + emission,
        "stake_vault balance == Σ bonds + emission"
    );
    assert_eq!(
        ctx.token_balance(vault),
        o.total_oracle_stake + emission,
        "stake_vault balance == total_oracle_stake + emission"
    );

    // finalize_proposals: all agree => Resolved with the agreed option.
    let res = ctx.finalize_proposals_real(oracle);
    assert!(res.is_ok(), "finalize_proposals should succeed: {res:?}");

    let o = ctx.oracle(oracle);
    assert_eq!(o.phase, Phase::Resolved.as_u8(), "all-agree => Resolved");
    assert_eq!(o.resolved_option, 1, "resolved_option == agreed option");
    assert_eq!(o.dispute_bond_total, 0, "no dispute opened");
    // No token CPI on the resolve path: the vault is untouched (still Σ bonds;
    // reward_emission is 0 so there is nothing extra to distribute).
    assert_eq!(
        ctx.token_balance(vault),
        sum_bonds + emission,
        "vault untouched on resolve (Σ bonds)"
    );

    // Uncontested Resolved: no slash, no minting → reward_pool == 0. Every
    // agreeing proposer is "correct" and claims principal only.
    assert_eq!(
        o.reward_pool,
        o.bond_pool + emission,
        "reward_pool folds the (zero) emission in"
    );
    assert_eq!(o.bond_pool, 0, "no slash on the uncontested path");
    assert_eq!(o.reward_pool, 0, "no slash and no minting → empty reward pool");
    assert_eq!(
        o.total_correct_proposer_stake, sum_bonds,
        "every agreeing proposer counts as correct"
    );

    // Each uncontested-correct proposer claims principal only (`reward_pool == 0`).
    let nonce = ctx.seeded(oracle).nonce;
    let (pbucket, _) = reward::reward_buckets(
        o.reward_pool,
        o.reward_proposer_weight,
        o.reward_fact_weight,
        o.total_correct_proposer_stake,
        o.total_approved_fact_stake,
    );
    let handles: Vec<(Keypair, Pubkey, u64)> = ctx
        .proposers(oracle)
        .iter()
        .map(|p| (p.authority.insecure_clone(), p.pda, p.bond))
        .collect();
    let mut total_reward = 0u64;
    for (auth, pda, pbond) in &handles {
        let expected_reward =
            reward::proposer_reward(*pbond, pbucket, o.total_correct_proposer_stake);
        assert_eq!(
            expected_reward, 0,
            "no slash and no minting → uncontested reward is 0"
        );
        let dest = ctx.fund_base(auth, 0);
        let ix = ctx.claim_proposer_ix(oracle, nonce, *pda, dest, vault, auth.pubkey());
        ctx.send(ix, &[]).expect("claim_proposer (uncontested)");
        assert_eq!(
            ctx.token_balance(dest),
            pbond + expected_reward,
            "uncontested claim == bond (no reward)"
        );
        total_reward += expected_reward;
    }

    // Conservation: Σ (bond + reward) + floor dust == vault (Σ bonds).
    let dust = ctx.token_balance(vault);
    assert_eq!(
        sum_bonds + total_reward + dust,
        sum_bonds + emission,
        "Σ claims + dust == Σ bonds"
    );
    assert_eq!(dust, 0, "empty reward pool → vault drains exactly");
}

#[test]
fn e2e_second_oracle_fee_is_burned() {
    // The dynamic EMA fee is 0 at genesis but positive on the next creation in
    // the same context: assert the second oracle's fee was BURNED (the creator's
    // SOL balance AND the mint supply both drop by the same positive amount).
    let mut ctx = TestCtx::new();
    let payer_base = ctx.payer_base;
    let base_mint = ctx.base_mint;

    // Emission disabled at genesis (fail-safe); enable before the first create so
    // both oracles mint the emission this test folds into its supply-delta math.
    ctx.ensure_protocol();
    ctx.enable_default_emission();

    // First (genesis) oracle: free.
    let _first = ctx.create_real_oracle(2, 600);

    let bal_before = ctx.token_balance(payer_base);
    let supply_before = ctx.mint_supply(base_mint);

    // Second oracle in the same context: fee_ema is now positive => fee burned.
    let second = ctx.create_real_oracle(2, 600);

    let bal_after = ctx.token_balance(payer_base);
    let supply_after = ctx.mint_supply(base_mint);
    let burned = bal_before - bal_after;
    assert!(burned > 0, "second creation must charge a positive fee");
    // Emission is ON by default: the same create_oracle ALSO mints an emission
    // into the vault, so the net supply delta is `emission − burned`, not `−burned`.
    // The fee is still exactly the creator's balance drop.
    let emission = ctx.oracle(second).reward_emission;
    assert_eq!(
        supply_after,
        supply_before - burned + emission,
        "supply delta == emission minted − fee burned"
    );
}

// ----- E2E: dispute path through the dispute core to a terminal state -------

#[test]
fn e2e_dispute_through_dispute_core_to_resolved() {
    let mut ctx = TestCtx::new();
    let bond = 1_000u64;

    // Emission disabled at genesis (fail-safe); enable before the first create so
    // the vault holds the creation-time emission this test accounts for.
    ctx.ensure_protocol();
    ctx.enable_default_emission();

    // create_oracle → propose×2 (DISTINCT options) → finalize_proposals =>
    // FactProposal with dispute_bond_total set. Driven entirely by real ixs.
    let oracle = ctx.dispute_via_real_flow(&[
        ProposerSpec { option: 0, bond },
        ProposerSpec { option: 1, bond },
    ]);

    let (vault, _) = TestCtx::stake_vault_pda(&ctx.program_id, &oracle);

    // --- SOL conservation at the proposal boundary (BEFORE any submit_fact) -
    let sum_bonds = 2 * bond;
    let o = ctx.oracle(oracle);
    // Emission is ON by default: the vault also holds the creation-time emission,
    // which is NOT counted in the bond/stake totals.
    let emission = o.reward_emission;
    assert_eq!(
        o.phase,
        Phase::FactProposal.as_u8(),
        "conflict => FactProposal"
    );
    assert_eq!(o.proposer_count, 2);
    assert_eq!(
        o.total_oracle_stake, sum_bonds,
        "total_oracle_stake == Σ bonds"
    );
    assert_eq!(
        o.dispute_bond_total, sum_bonds,
        "dispute_bond_total == Σ bonds (fact-quorum denominator)"
    );
    assert_eq!(
        ctx.token_balance(vault),
        sum_bonds + emission,
        "stake_vault == Σ bonds + emission"
    );
    assert_eq!(
        ctx.token_balance(vault),
        o.total_oracle_stake + emission,
        "stake_vault == total_oracle_stake + emission"
    );

    // Capture proposer handles for the dispute core.
    let proposer_pdas: Vec<Pubkey> = ctx.proposers(oracle).iter().map(|p| p.pda).collect();

    // 1) submit_fact (one fact) — FactProposal window still open.
    let submitter = Keypair::new();
    ctx.svm.airdrop(&submitter.pubkey(), 1_000_000_000).unwrap();
    let submitter_base = ctx.fund_base(&submitter, 1_000_000);
    let content_hash = [0x07u8; 32];
    let (fact, _) = TestCtx::fact_pda(&ctx.program_id, &oracle, &content_hash);
    let ix = submit_fact_ix(
        &ctx,
        oracle,
        fact,
        submitter.pubkey(),
        submitter_base,
        vault,
        submit_fact_payload(&content_hash, 100, b"ipfs://fact"),
    );
    ctx.send(ix, &[&submitter])
        .expect("submit_fact should succeed");
    assert_eq!(ctx.oracle(oracle).fact_count, 1);
    assert_eq!(ctx.oracle(oracle).phase, Phase::FactProposal.as_u8());

    // 2) warp past the FactProposal window, advance_phase => FactVoting.
    ctx.warp(PHASE_WINDOW + 1);
    let ix = advance_phase_ix(&ctx, oracle);
    ctx.send(ix, &[]).expect("advance_phase should succeed");
    assert_eq!(ctx.oracle(oracle).phase, Phase::FactVoting.as_u8());

    // 3) vote_fact — approve well past the 2/3 quorum of dispute_bond_total
    //    (2000): approve 2000 clears `approve*3 >= 2000*2`.
    let voter = Keypair::new();
    ctx.svm.airdrop(&voter.pubkey(), 1_000_000_000).unwrap();
    let voter_base = ctx.fund_base(&voter, 10_000);
    let (fact_vote, _) = TestCtx::vote_pda(&ctx.program_id, &fact, &voter.pubkey());
    let ix = vote_fact_ix(
        &ctx,
        oracle,
        fact,
        fact_vote,
        voter.pubkey(),
        voter_base,
        vault,
        vote_payload(VOTE_APPROVE, 2_000),
    );
    ctx.send(ix, &[&voter]).expect("vote_fact should succeed");

    // 4) warp past the voting window, finalize_facts => AiClaim (fact agreed).
    ctx.warp(PHASE_WINDOW + 1);
    ctx.send(finalize_facts_ix(&ctx, oracle, &[fact]), &[])
        .expect("finalize_facts should succeed");
    let o = ctx.oracle(oracle);
    assert_eq!(o.phase, Phase::AiClaim.as_u8());
    assert_eq!(ctx.fact(fact).agreed, 1, "the approved fact cleared quorum");

    // 5) apply the GPT feed onto each surviving proposer. The feed option is 0,
    //    so the option-1 proposer flips (partial slash, still surviving).
    let agreed_option = 0u8;
    for pda in &proposer_pdas {
        ctx.stamp_gpt_claim_ok(oracle, *pda, agreed_option);
    }

    // 6) warp past the AiClaim window, finalize_ai_claims => Challenge.
    ctx.warp(PHASE_WINDOW + 1);
    ctx.send(finalize_ai_claims_ix(&ctx, oracle, &proposer_pdas), &[])
        .expect("finalize_ai_claims should succeed");
    let o = ctx.oracle(oracle);
    assert_eq!(o.phase, Phase::Challenge.as_u8());
    assert_eq!(o.ai_finalized_count, 2);
    // The flipper stays surviving (not disqualified) — both proposers survive.
    assert_eq!(o.surviving_count, 2);
    assert_eq!(o.open_challenge_count, 0, "no challenge opened");

    // 7) warp past the challenge window (open_challenge_count stays 0),
    //    finalize_oracle => Resolved with the agreed claim option.
    ctx.warp(PHASE_WINDOW + 1);
    ctx.send(finalize_oracle_ix(&ctx, oracle, &proposer_pdas), &[])
        .expect("finalize_oracle should succeed");
    let o = ctx.oracle(oracle);
    assert_eq!(o.phase, Phase::Resolved.as_u8(), "terminal: Resolved");
    assert_eq!(
        o.resolved_option, agreed_option,
        "resolved_option == the agreed claim option"
    );
}
