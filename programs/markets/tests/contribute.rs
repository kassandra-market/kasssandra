//! Integration tests for `contribute` (adds SOL to a `Funding` market).

mod common;
use common::*;
use kassandra_markets_program::error::MarketError;
use kassandra_markets_program::state::{Contribution, Market, MarketStatus};
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signer},
};

const PROPOSAL: u8 = 0; // SubjectStatus::Open

/// Stand up a funded market with the creator seeding 200M SOL.
fn setup_funding_market() -> (TestCtx, Pubkey /*base*/, Pubkey /*market*/) {
    let mut ctx = TestCtx::new();
    let base = ctx.create_mint(9);
    let authority = Keypair::new();
    let (_config, res) = ctx.init_config(authority.pubkey(), base, 1_000_000_000);
    assert!(res.is_ok(), "{res:?}");

    let oracle = ctx.seed_kass_oracle(2, PROPOSAL);
    let creator = Keypair::new();
    ctx.svm_airdrop(&creator.pubkey());
    let creator_ata = ctx.create_token_account(base, creator.pubkey(), 500_000_000);
    let (market, res) = ctx.create_market(&creator, oracle, base, creator_ata, 200_000_000);
    assert!(res.is_ok(), "{res:?}");
    (ctx, base, market)
}

#[test]
fn contribute_happy_second_contributor() {
    let (mut ctx, base, market) = setup_funding_market();

    let contributor = Keypair::new();
    ctx.svm_airdrop(&contributor.pubkey());
    let contributor_ata = ctx.create_token_account(base, contributor.pubkey(), 400_000_000);

    let res = ctx.contribute(&contributor, market, contributor_ata, 300_000_000);
    assert!(res.is_ok(), "{res:?}");

    let m: Market = ctx.read_pod(market);
    assert_eq!(m.total_contributed, 500_000_000);
    // A brand-new contributor grows the live-Contribution counter (creator + this).
    assert_eq!(
        m.open_contributions, 2,
        "new contributor increments counter"
    );
    assert_eq!(
        ctx.token_balance(Pubkey::new_from_array(m.escrow_vault.to_bytes())),
        500_000_000
    );
    assert_eq!(ctx.token_balance(contributor_ata), 100_000_000);

    let (contribution, _) = kassandra_markets_sdk::pda::contribution(&market, &contributor.pubkey());
    let c: Contribution = ctx.read_pod(contribution);
    assert_eq!(c.amount, 300_000_000);
    assert_eq!(c.contributor.to_bytes(), contributor.pubkey().to_bytes());
    assert_eq!(c.market.to_bytes(), market.to_bytes());
}

#[test]
fn contribute_repeat_increments() {
    let (mut ctx, base, market) = setup_funding_market();

    let contributor = Keypair::new();
    ctx.svm_airdrop(&contributor.pubkey());
    let contributor_ata = ctx.create_token_account(base, contributor.pubkey(), 400_000_000);

    let res = ctx.contribute(&contributor, market, contributor_ata, 300_000_000);
    assert!(res.is_ok(), "{res:?}");
    let res = ctx.contribute(&contributor, market, contributor_ata, 100_000_000);
    assert!(res.is_ok(), "{res:?}");

    let (contribution, _) = kassandra_markets_sdk::pda::contribution(&market, &contributor.pubkey());
    let c: Contribution = ctx.read_pod(contribution);
    assert_eq!(c.amount, 400_000_000);

    let m: Market = ctx.read_pod(market);
    assert_eq!(m.total_contributed, 600_000_000);
    // A repeat top-up by an EXISTING contributor must NOT double-count: creator (1)
    // + this contributor's single Contribution (1) == 2, despite two contribute calls.
    assert_eq!(
        m.open_contributions, 2,
        "repeat contribution does not increment"
    );
}

#[test]
fn contribute_rejects_not_funding() {
    let mut ctx = TestCtx::new();
    let base = ctx.create_mint(9);
    let authority = Keypair::new();
    let (_config, res) = ctx.init_config(authority.pubkey(), base, 1_000_000_000);
    assert!(res.is_ok(), "{res:?}");

    // Fabricate a Cancelled market so the status guard fires before any token move.
    let oracle = Pubkey::new_unique();
    let escrow = Pubkey::new_unique();
    let market = ctx.seed_market_with_status(oracle, base, escrow, MarketStatus::Cancelled.as_u8());

    let contributor = Keypair::new();
    ctx.svm_airdrop(&contributor.pubkey());
    let contributor_ata = ctx.create_token_account(base, contributor.pubkey(), 400_000_000);

    let res = ctx.contribute(&contributor, market, contributor_ata, 100_000_000);
    assert_eq!(custom_code(&res), Some(MarketError::NotFunding as u32));
}
