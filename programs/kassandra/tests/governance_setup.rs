//! Tests for `set_governance` (Task F1): the one-time DAO-linkage handoff.

mod common;
use common::*;

use kassandra_program::error::KassandraError;
use kassandra_program::state::AccountType;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};

/// Decode a LiteSVM transaction error into its `Custom(u32)` code, if any.
fn custom_code(res: &litesvm::types::TransactionResult) -> Option<u32> {
    use solana_sdk::instruction::InstructionError;
    use solana_sdk::transaction::TransactionError;
    match res {
        Err(meta) => match &meta.err {
            TransactionError::InstructionError(_, InstructionError::Custom(code)) => Some(*code),
            _ => None,
        },
        Ok(_) => None,
    }
}

#[test]
fn admin_sets_governance_records_linkage_and_defaults() {
    let mut ctx = TestCtx::new();
    let (protocol_pda, res) = ctx.init_protocol();
    assert!(res.is_ok(), "init_protocol should succeed: {res:?}");

    // Pre-handoff: linkage unset, monetary params == config defaults.
    let p0 = ctx.protocol(protocol_pda);
    assert_eq!(p0.governance_set, 0);
    assert_eq!(p0.dao_authority, [0u8; 32]);
    assert_eq!(p0.kass_dao, [0u8; 32]);
    assert_eq!(p0.emission_num, 0);
    assert_eq!(p0.emission_den, 1);
    assert_eq!(p0.total_supply_cap, 0);
    assert_eq!(
        p0.fee_ema_halflife,
        kassandra_program::config::FEE_EMA_HALFLIFE_SECS
    );
    assert_eq!(
        p0.fee_per_ema_unit,
        kassandra_program::config::FEE_PER_EMA_UNIT
    );
    assert_eq!(
        p0.fee_ema_increment,
        kassandra_program::config::FEE_EMA_INCREMENT
    );

    let (dao_authority, kass_dao) = TestCtx::stand_in_governance(0xAA);
    let payer = ctx.payer.insecure_clone();
    let (_pda, res) = ctx.set_governance(&payer, dao_authority, kass_dao);
    assert!(res.is_ok(), "admin set_governance should succeed: {res:?}");

    let p = ctx.protocol(protocol_pda);
    assert_eq!(p.account_type, AccountType::Protocol.as_u8());
    assert_eq!(p.governance_set, 1);
    assert_eq!(p.dao_authority, dao_authority.to_bytes());
    assert_eq!(p.kass_dao, kass_dao.to_bytes());
    // Monetary params untouched by the handoff.
    assert_eq!(p.emission_den, 1);
    assert_eq!(
        p.fee_per_ema_unit,
        kassandra_program::config::FEE_PER_EMA_UNIT
    );
}

#[test]
fn non_admin_cannot_set_governance() {
    let mut ctx = TestCtx::new();
    let (_pda, res) = ctx.init_protocol();
    assert!(res.is_ok());

    let stranger = Keypair::new();
    ctx.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let (dao_authority, kass_dao) = TestCtx::stand_in_governance(0xBB);
    let (_pda, res) = ctx.set_governance(&stranger, dao_authority, kass_dao);
    assert_eq!(
        custom_code(&res),
        Some(KassandraError::Unauthorized as u32),
        "non-admin set_governance must fail Unauthorized: {res:?}"
    );
}

#[test]
fn handoff_is_one_shot_admin_rejected_dao_can_rotate() {
    let mut ctx = TestCtx::new();
    let (protocol_pda, res) = ctx.init_protocol();
    assert!(res.is_ok());

    // Admin performs the one-time handoff; dao_authority = a real keypair so it
    // can later sign the rotation.
    let dao_kp = Keypair::new();
    ctx.svm.airdrop(&dao_kp.pubkey(), 1_000_000_000).unwrap();
    let (_da, kass_dao) = TestCtx::stand_in_governance(0xCC);
    let payer = ctx.payer.insecure_clone();
    let (_pda, res) = ctx.set_governance(&payer, dao_kp.pubkey(), kass_dao);
    assert!(res.is_ok(), "admin handoff should succeed: {res:?}");
    assert_eq!(ctx.protocol(protocol_pda).governance_set, 1);

    // The OLD admin can no longer change the linkage.
    let (da2, kd2) = TestCtx::stand_in_governance(0xDD);
    let (_pda, res) = ctx.set_governance(&payer, da2, kd2);
    assert_eq!(
        custom_code(&res),
        Some(KassandraError::GovernanceAlreadySet as u32),
        "post-handoff admin must be rejected GovernanceAlreadySet: {res:?}"
    );

    // The current dao_authority CAN rotate the linkage.
    let (da3, kd3) = TestCtx::stand_in_governance(0xEE);
    let (_pda, res) = ctx.set_governance(&dao_kp, da3, kd3);
    assert!(
        res.is_ok(),
        "dao_authority rotation should succeed: {res:?}"
    );
    let p = ctx.protocol(protocol_pda);
    assert_eq!(p.dao_authority, da3.to_bytes());
    assert_eq!(p.kass_dao, kd3.to_bytes());
}

#[test]
fn zero_linkage_keys_rejected() {
    let mut ctx = TestCtx::new();
    let (_pda, res) = ctx.init_protocol();
    assert!(res.is_ok());
    let payer = ctx.payer.insecure_clone();

    // Zero dao_authority.
    let (_pda, res) = ctx.set_governance(&payer, Pubkey::default(), Pubkey::new_unique());
    assert_eq!(
        custom_code(&res),
        Some(KassandraError::InvalidAccount as u32),
        "zero dao_authority must be rejected: {res:?}"
    );

    // Zero kass_dao.
    let (_pda, res) = ctx.set_governance(&payer, Pubkey::new_unique(), Pubkey::default());
    assert_eq!(
        custom_code(&res),
        Some(KassandraError::InvalidAccount as u32),
        "zero kass_dao must be rejected: {res:?}"
    );
}
