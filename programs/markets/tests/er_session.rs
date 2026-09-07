//! `DelegateMarket` / `CommitMarket` / `UndelegateMarket` short-form tests.

mod common;
use common::*;

use kassandra_markets_program::state::{ErSession, ER_STATUS_DELEGATED, ER_STATUS_UNDELEGATED};
use kassandra_markets_sdk::ix;
use solana_sdk::{signature::Keypair, signer::Signer};

const PROPOSAL: u8 = 1;

#[test]
fn delegate_commit_undelegate_roundtrip() {
    let mut ctx = TestCtx::new();
    let kass = ctx.create_mint(9);
    let authority = Keypair::new();
    let (_config, res) = ctx.init_config(authority.pubkey(), kass, 1_000_000_000);
    assert!(res.is_ok(), "{res:?}");

    let oracle = ctx.seed_kass_oracle(2, PROPOSAL);
    let creator = Keypair::new();
    ctx.svm_airdrop(&creator.pubkey());
    let creator_ata = ctx.create_token_account(kass, creator.pubkey(), 500_000_000);
    let (market, res) = ctx.create_market(&creator, oracle, kass, creator_ata, 200_000_000);
    assert!(res.is_ok(), "{res:?}");

    let (session, _) = kassandra_markets_sdk::pda::er_session(&market);
    let ix = ix::delegate_market(
        &market,
        &session,
        &ctx.payer.pubkey(),
        0,
        &solana_sdk::pubkey::Pubkey::default(),
    );
    ctx.send(ix, &[]).expect("delegate");
    let s: ErSession = ctx.read_pod(session);
    assert_eq!(s.status, ER_STATUS_DELEGATED);
    assert_eq!(s.commit_frequency_ms, 30_000);

    ctx.send(ix::commit_market(&market, &session), &[])
        .expect("commit");
    ctx.send(ix::undelegate_market(&market, &session), &[])
        .expect("undelegate");
    let s: ErSession = ctx.read_pod(session);
    assert_eq!(s.status, ER_STATUS_UNDELEGATED);
}
