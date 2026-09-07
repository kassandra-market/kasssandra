//! `delegate_oracle` (Ix=24): record an [`ErSession`] and optionally CPI MagicBlock.

use bytemuck::Zeroable;
use pinocchio::{
    account::AccountView as AccountInfo, address::Address as Pubkey, cpi::Seed,
    error::ProgramError, ProgramResult,
};

use crate::{
    clock::now,
    cpi::magicblock::{self, DEFAULT_COMMIT_FREQUENCY_MS},
    error::KassandraError,
    processor::guards::{
        assert_key, assert_signer, create_or_adopt_pda, load_er_session, load_oracle,
        verify_oracle_pda,
    },
    rent::minimum_rent,
    state::{AccountType, ErSession, Oracle, ER_STATUS_DELEGATED},
};

/// `nonce u64 LE ++ commit_frequency_ms u32 LE ++ validator [u8;32]`.
const PAYLOAD_LEN: usize = 8 + 4 + 32;

pub fn process(program_id: &Pubkey, accounts: &mut [AccountInfo], payload: &[u8]) -> ProgramResult {
    if payload.len() != PAYLOAD_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    let nonce = u64::from_le_bytes(payload[0..8].try_into().unwrap());
    let mut commit_frequency_ms = u32::from_le_bytes(payload[8..12].try_into().unwrap());
    if commit_frequency_ms == 0 {
        commit_frequency_ms = DEFAULT_COMMIT_FREQUENCY_MS;
    }
    let validator_bytes: [u8; 32] = payload[12..44].try_into().unwrap();
    let validator: Pubkey = validator_bytes.into();
    let validator_is_set = validator_bytes != [0u8; 32];

    let [oracle_ai, session_ai, payer_ai, system_ai, rest @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    assert_signer(payer_ai)?;
    assert_key(system_ai, &pinocchio_system::ID)?;

    let oracle: Oracle = load_oracle(oracle_ai, program_id)?;
    verify_oracle_pda(program_id, oracle_ai, &oracle, nonce)?;

    let (expected_session, bump) =
        Pubkey::find_program_address(&[ErSession::SEED_PREFIX, oracle_ai.address().as_ref()], program_id);
    assert_key(session_ai, &expected_session)?;

    let now = now()?;
    let mut session = if session_ai.owned_by(program_id) && session_ai.data_len() >= ErSession::LEN {
        let existing = load_er_session(session_ai, program_id)?;
        if existing.is_delegated() {
            return Err(KassandraError::AlreadyDelegated.into());
        }
        existing
    } else {
        let rent = minimum_rent(ErSession::LEN)?;
        let bump_seed = [bump];
        let signer_seeds = [
            Seed::from(ErSession::SEED_PREFIX),
            Seed::from(oracle_ai.address().as_ref()),
            Seed::from(&bump_seed),
        ];
        create_or_adopt_pda(
            payer_ai,
            session_ai,
            &signer_seeds,
            rent,
            ErSession::LEN,
            program_id,
        )?;
        let mut s = ErSession::zeroed();
        s.account_type = AccountType::ErSession.as_u8();
        s.bump = bump;
        s.oracle = *oracle_ai.address();
        s
    };

    session.status = ER_STATUS_DELEGATED;
    session.validator = validator;
    session.commit_frequency_ms = commit_frequency_ms;
    session.delegated_at = now;
    session.last_commit_slot = 0;
    {
        let mut data = session_ai.try_borrow_mut()?;
        data[..ErSession::LEN].copy_from_slice(bytemuck::bytes_of(&session));
    }

    // Optional MagicBlock CPI when the remaining-account set is present.
    if rest.len() >= 5 {
        let owner_program = &rest[0];
        let buffer = &rest[1];
        let record = &rest[2];
        let metadata = &rest[3];
        let delegation_program = &rest[4];
        assert_key(owner_program, program_id)?;
        assert_key(delegation_program, &magicblock::DELEGATION_PROGRAM_ID)?;
        let nonce_le = nonce.to_le_bytes();
        let bump_seed = [oracle.bump];
        let pda_seeds: [&[u8]; 2] = [Oracle::SEED_PREFIX, &nonce_le];
        let signer_seeds = Oracle::signer_seeds(&nonce_le, &bump_seed);
        let validator_ref = validator_is_set.then_some(&validator);
        magicblock::cpi_delegate(
            payer_ai,
            oracle_ai,
            owner_program,
            buffer,
            record,
            metadata,
            system_ai,
            commit_frequency_ms,
            &pda_seeds,
            validator_ref,
            &signer_seeds,
        )?;
    }

    Ok(())
}
