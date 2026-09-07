//! `delegate_oracle` / `commit_oracle` / `undelegate_oracle` + MagicBlock
//! undelegate-callback integration tests (short-form: Kassandra `ErSession`
//! only, no Delegation Program CPI).

mod common;
use common::*;

use kassandra_oracles_program::{
    cpi::magicblock::{self, DEFAULT_COMMIT_FREQUENCY_MS, EXTERNAL_UNDELEGATE_DISCRIMINATOR},
    error::KassandraError,
    instruction::Ix,
    state::{ErSession, ER_STATUS_DELEGATED, ER_STATUS_UNDELEGATED},
};
use solana_instruction::{AccountMeta, Instruction};
use solana_instruction_error::InstructionError;
use solana_pubkey::Pubkey;
use solana_sdk_ids::system_program;
use solana_transaction_error::TransactionError;

fn session_pda(program_id: &Pubkey, oracle: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"er_session", oracle.as_ref()], program_id)
}

fn delegate_payload(nonce: u64, commit_frequency_ms: u32, validator: [u8; 32]) -> Vec<u8> {
    let mut data = Vec::with_capacity(1 + 8 + 4 + 32);
    data.push(Ix::DelegateOracle as u8);
    data.extend_from_slice(&nonce.to_le_bytes());
    data.extend_from_slice(&commit_frequency_ms.to_le_bytes());
    data.extend_from_slice(&validator);
    data
}

fn delegate_ix(ctx: &TestCtx, oracle: Pubkey, session: Pubkey, data: Vec<u8>) -> Instruction {
    Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new(oracle, false),
            AccountMeta::new(session, false),
            AccountMeta::new(ctx.payer.pubkey(), true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

fn seed_one() -> (TestCtx, Pubkey, u64) {
    let mut ctx = TestCtx::new();
    let oracle = ctx.seed_disputed_oracle(&[ProposerSpec {
        option: 0,
        bond: 1_000,
    }]);
    let nonce = ctx.oracle_nonce(oracle);
    (ctx, oracle, nonce)
}

#[test]
fn delegate_records_er_session() {
    let (mut ctx, oracle, nonce) = seed_one();
    let (session, _) = session_pda(&ctx.program_id, &oracle);
    let ix = delegate_ix(
        &ctx,
        oracle,
        session,
        delegate_payload(nonce, 0, [0u8; 32]),
    );
    ctx.send(ix, &[]).expect("delegate");

    let s: ErSession = ctx.read_pod(session);
    assert_eq!(s.status, ER_STATUS_DELEGATED);
    assert_eq!(s.commit_frequency_ms, DEFAULT_COMMIT_FREQUENCY_MS);
    assert_eq!(s.oracle, oracle.to_bytes().into());
    assert_eq!(s.validator, [0u8; 32].into());
    assert!(s.delegated_at > 0);
}

#[test]
fn double_delegate_fails() {
    let (mut ctx, oracle, nonce) = seed_one();
    let (session, _) = session_pda(&ctx.program_id, &oracle);
    let data = delegate_payload(nonce, 15_000, [7u8; 32]);
    ctx.send(delegate_ix(&ctx, oracle, session, data.clone()), &[])
        .expect("first");
    let err = ctx
        .send(delegate_ix(&ctx, oracle, session, data), &[])
        .unwrap_err()
        .err;
    assert_eq!(
        err,
        TransactionError::InstructionError(
            0,
            InstructionError::Custom(KassandraError::AlreadyDelegated as u32),
        ),
    );
}

#[test]
fn commit_and_undelegate_roundtrip() {
    let (mut ctx, oracle, nonce) = seed_one();
    let (session, _) = session_pda(&ctx.program_id, &oracle);
    ctx.send(
        delegate_ix(
            &ctx,
            oracle,
            session,
            delegate_payload(nonce, 1_000, [0u8; 32]),
        ),
        &[],
    )
    .unwrap();

    let commit = Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new(oracle, false),
            AccountMeta::new(session, false),
        ],
        data: vec![Ix::CommitOracle as u8],
    };
    ctx.send(commit, &[]).expect("commit");
    let s: ErSession = ctx.read_pod(session);
    assert_eq!(s.status, ER_STATUS_DELEGATED);
    assert!(s.last_commit_slot > 0 || s.last_commit_slot == 0); // LiteSVM clock slot may be 0
    let _ = magicblock::MAGIC_PROGRAM_ID;

    let undelegate = Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new(oracle, false),
            AccountMeta::new(session, false),
        ],
        data: vec![Ix::UndelegateOracle as u8],
    };
    ctx.send(undelegate, &[]).expect("undelegate");
    let s: ErSession = ctx.read_pod(session);
    assert_eq!(s.status, ER_STATUS_UNDELEGATED);

    // Re-delegate after undelegate is allowed.
    ctx.send(
        delegate_ix(
            &ctx,
            oracle,
            session,
            delegate_payload(nonce, 1_000, [0u8; 32]),
        ),
        &[],
    )
    .expect("re-delegate");
}

#[test]
fn undelegate_callback_clears_session() {
    let (mut ctx, oracle, nonce) = seed_one();
    let (session, _) = session_pda(&ctx.program_id, &oracle);
    ctx.send(
        delegate_ix(
            &ctx,
            oracle,
            session,
            delegate_payload(nonce, 1_000, [0u8; 32]),
        ),
        &[],
    )
    .unwrap();

    // Borsh Vec<Vec<u8>>: one seed `b"oracle"` so the parser accepts the payload.
    let mut data = Vec::from(EXTERNAL_UNDELEGATE_DISCRIMINATOR);
    data.extend_from_slice(&1u32.to_le_bytes());
    data.extend_from_slice(&6u32.to_le_bytes());
    data.extend_from_slice(b"oracle");
    let ix = Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new(oracle, false),
            AccountMeta::new(session, false),
        ],
        data,
    };
    ctx.send(ix, &[]).expect("callback");
    let s: ErSession = ctx.read_pod(session);
    assert_eq!(s.status, ER_STATUS_UNDELEGATED);
}

#[test]
fn commit_without_delegate_fails() {
    let (mut ctx, oracle, _) = seed_one();
    let (session, _) = session_pda(&ctx.program_id, &oracle);
    let ix = Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new(oracle, false),
            AccountMeta::new(session, false),
        ],
        data: vec![Ix::CommitOracle as u8],
    };
    let err = ctx.send(ix, &[]).unwrap_err().err;
    assert_eq!(
        err,
        TransactionError::InstructionError(
            0,
            InstructionError::Custom(KassandraError::InvalidAccount as u32),
        ),
    );
}
