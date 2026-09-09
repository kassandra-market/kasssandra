//! Native-token emission is gone: `create_oracle` never mints SOL/USDC.
//! `Oracle.reward_emission` stays in the Pod layout (always 0 at create).
//! Seeded-emission tests below still drive finalize_oracle fold/burn of a
//! harness-stamped `reward_emission` so settlement math stays covered.

mod common;
use common::*;

use kassandra_oracles_program::{
    reward,
    state::{Phase, CLAIM_OPTION_NONE},
};
use solana_pubkey::Pubkey;
use solana_signer::Signer;

/// Test emission-config values (no longer minted; used only to prove create
/// ignores them).
const CAP: u64 = 2_000_000_000_000_000;
const NUM: u64 = 1;
const DEN: u64 = 1_000_000;

/// init_protocol + governance handoff (dao_authority = payer) + a `set_config`
/// that OVERWRITES the emission params with a chosen `(cap, num, den)`. Emission is
/// ON by default; this helper pins an EXACT curve for deterministic emission
/// sizing (or DISABLES it by passing `cap == 0` / `num == 0` to exercise the
/// no-mint path).
fn enable_emission(ctx: &mut TestCtx, cap: u64, num: u64, den: u64) {
    let (_p, res) = ctx.init_protocol();
    assert!(res.is_ok(), "init_protocol: {res:?}");
    // Record the payer (a SIGNABLE key) as `dao_authority` directly so it can
    // sign the set_config below; the Task G1-hardened handoff only accepts the
    // derived (unsignable) Squads vault PDA.
    let payer = ctx.payer.insecure_clone();
    ctx.force_governance(payer.pubkey(), Pubkey::new_unique());
    let mut params = ConfigParams::defaults();
    params.total_supply_cap = cap;
    params.emission_num = num;
    params.emission_den = den;
    let (_p, res) = ctx.set_config(&payer, params);
    assert!(res.is_ok(), "set_config: {res:?}");
}

#[test]
fn create_oracle_never_mints_even_when_emission_configured() {
    let mut ctx = TestCtx::new();
    enable_emission(&mut ctx, CAP, NUM, DEN);

    let supply_before = ctx.mint_supply(ctx.base_mint);
    let deadline = ctx.now() + 1_000;
    let (oracle, res) = ctx.create_oracle(0, 2, deadline, 600);
    assert!(res.is_ok(), "create_oracle: {res:?}");

    let o = ctx.oracle(oracle);
    assert_eq!(o.reward_emission, 0, "no native-token minting");
    assert_eq!(ctx.mint_supply(ctx.base_mint), supply_before);
    let (vault, _) = TestCtx::stake_vault_pda(&ctx.program_id, &oracle);
    assert_eq!(ctx.token_balance(vault), 0);
}

#[test]
fn fee_still_burns_without_minting() {
    let mut ctx = TestCtx::new();
    enable_emission(&mut ctx, CAP, NUM, DEN);

    let deadline = ctx.now() + 1_000_000;
    let (_o0, res) = ctx.create_oracle(0, 2, deadline, 600);
    assert!(res.is_ok(), "genesis create: {res:?}");

    let bal_pre = ctx.token_balance(ctx.payer_base);
    let supply_pre = ctx.mint_supply(ctx.base_mint);
    let (o1, res) = ctx.create_oracle(1, 2, deadline, 600);
    assert!(res.is_ok(), "second create: {res:?}");

    let fee = bal_pre - ctx.token_balance(ctx.payer_base);
    assert!(fee > 0, "a second rapid creation burns a fee");
    assert_eq!(ctx.oracle(o1).reward_emission, 0);
    assert_eq!(
        ctx.mint_supply(ctx.base_mint),
        supply_pre - fee,
        "supply drops by the burned fee only"
    );
}

#[test]
fn resolved_folds_emission_into_reward_pool_and_claim() {
    let mut ctx = TestCtx::new();
    let oracle = ctx.seed_disputed_oracle(&[
        ProposerSpec {
            option: 1,
            bond: 1_000,
        },
        ProposerSpec {
            option: 1,
            bond: 3_000,
        },
    ]);
    let pdas: Vec<Pubkey> = ctx.proposers(oracle).iter().map(|p| p.pda).collect();
    for p in &pdas {
        ctx.set_proposer_claim_option(*p, 1);
    }
    ctx.set_phase(oracle, Phase::Challenge);

    let emission = 600u64;
    ctx.set_reward_emission(oracle, emission);

    let vault = ctx.seeded(oracle).stake_vault;
    let vault_before = ctx.token_balance(vault);
    assert_eq!(
        vault_before,
        4_000 + emission,
        "Σ bonds + emission in vault"
    );

    ctx.warp(WINDOW + 1);
    let ix = ctx.finalize_oracle_ix(oracle, &pdas);
    ctx.send(ix, &[]).expect("finalize should succeed");

    let o = ctx.oracle(oracle);
    assert_eq!(o.phase, Phase::Resolved as u8);
    // reward_pool folds the emission in: bond_pool (0 here) + reward_emission.
    assert_eq!(o.reward_pool, o.bond_pool + emission);
    assert_eq!(o.reward_pool, emission);
    assert_eq!(o.total_correct_proposer_stake, 4_000);
    // No burn on Resolved: the emission stays in the vault for the reward claims.
    assert_eq!(ctx.token_balance(vault), vault_before);

    // Chain S1→S2: a correct proposer's claim reflects the emission-boosted pool.
    let (pbucket, _) = reward::reward_buckets(
        o.reward_pool,
        o.reward_proposer_weight,
        o.reward_fact_weight,
        o.total_correct_proposer_stake,
        o.total_approved_fact_stake,
    );
    let auth0 = ctx.proposers(oracle)[0].authority.insecure_clone();
    let bond0 = ctx.proposers(oracle)[0].bond;
    let pda0 = ctx.proposers(oracle)[0].pda;
    let nonce = ctx.seeded(oracle).nonce;
    let dest = ctx.fund_base(&auth0, 0);
    let ix = ctx.claim_proposer_ix(oracle, nonce, pda0, dest, vault, auth0.pubkey());
    ctx.send(ix, &[]).expect("claim should succeed");

    let expected_reward = reward::proposer_reward(bond0, pbucket, o.total_correct_proposer_stake);
    assert!(expected_reward > 0, "emission funds a positive reward");
    assert_eq!(
        ctx.token_balance(dest),
        bond0 + expected_reward,
        "claim = bond + emission-funded reward"
    );
}

#[test]
fn invalid_deadend_burns_emission_back() {
    let mut ctx = TestCtx::new();
    let oracle = ctx.seed_disputed_oracle(&[
        ProposerSpec {
            option: 0,
            bond: 1_000,
        },
        ProposerSpec {
            option: 1,
            bond: 1_000,
        },
    ]);
    let pdas: Vec<Pubkey> = ctx.proposers(oracle).iter().map(|p| p.pda).collect();
    ctx.set_proposer_claim_option(pdas[0], 0);
    ctx.set_proposer_claim_option(pdas[1], 1); // tie → InvalidDeadend
    ctx.set_phase(oracle, Phase::Challenge);

    let emission = 700u64;
    ctx.set_reward_emission(oracle, emission);

    let vault = ctx.seeded(oracle).stake_vault;
    let supply_before = ctx.mint_supply(ctx.base_mint);
    assert_eq!(ctx.token_balance(vault), 2_000 + emission);

    ctx.warp(WINDOW + 1);
    let ix = ctx.finalize_oracle_ix(oracle, &pdas);
    ctx.send(ix, &[]).expect("finalize should succeed");

    let o = ctx.oracle(oracle);
    assert_eq!(o.phase, Phase::InvalidDeadend as u8);
    assert_eq!(o.resolved_option, CLAIM_OPTION_NONE);
    assert_eq!(o.reward_pool, 0, "no reward distribution out of a dead-end");
    // The emission was burned back: vault returns to Σ stakes, supply drops by it.
    assert_eq!(
        ctx.token_balance(vault),
        2_000,
        "emission burned out of the vault"
    );
    assert_eq!(
        ctx.mint_supply(ctx.base_mint),
        supply_before - emission,
        "burn-back returned the emission to the reservoir"
    );
    // The stamp is left as the durable record of what was minted then burned.
    assert_eq!(o.reward_emission, emission);
}

#[test]
fn mint_authority_mismatch_does_not_block_create() {
    let mut ctx = TestCtx::new();
    enable_emission(&mut ctx, CAP, NUM, DEN);
    // Native-token minting is gone, so a non-PDA mint authority is irrelevant.
    let payer = ctx.payer.pubkey();
    ctx.set_base_mint_authority(payer);

    let deadline = ctx.now() + 1_000;
    let (oracle, res) = ctx.create_oracle(0, 2, deadline, 600);
    assert!(res.is_ok(), "create_oracle: {res:?}");
    assert_eq!(ctx.oracle(oracle).reward_emission, 0);
}

#[test]
fn cap_zero_emits_nothing() {
    // Governance `set_config` with total_supply_cap == 0 →
    // `compute_reward_emission` short-circuits to 0 (harmless). The
    // mint-authority guard is never reached (no mint), so this also proves a
    // disabled-emission create_oracle is unaffected by the PDA mint authority.
    let mut ctx = TestCtx::new();
    enable_emission(&mut ctx, 0, NUM, DEN);

    let supply_before = ctx.mint_supply(ctx.base_mint);
    let deadline = ctx.now() + 1_000;
    let (oracle, res) = ctx.create_oracle(0, 2, deadline, 600);
    assert!(res.is_ok(), "create with cap 0: {res:?}");

    assert_eq!(ctx.oracle(oracle).reward_emission, 0);
    assert_eq!(
        ctx.mint_supply(ctx.base_mint),
        supply_before,
        "supply unchanged"
    );
    let (vault, _) = TestCtx::stake_vault_pda(&ctx.program_id, &oracle);
    assert_eq!(ctx.token_balance(vault), 0, "no emission minted");
}

#[test]
fn emission_num_zero_emits_nothing() {
    // A non-zero cap but emission_num == 0 → disabled (the other disabled knob).
    let mut ctx = TestCtx::new();
    enable_emission(&mut ctx, CAP, 0, DEN);

    let supply_before = ctx.mint_supply(ctx.base_mint);
    let deadline = ctx.now() + 1_000;
    let (oracle, res) = ctx.create_oracle(0, 2, deadline, 600);
    assert!(res.is_ok(), "create with emission_num 0: {res:?}");

    assert_eq!(ctx.oracle(oracle).reward_emission, 0);
    assert_eq!(ctx.mint_supply(ctx.base_mint), supply_before);
}
