//! `commit_oracle` (Ix=25): stamp `ErSession.last_commit_slot`.

use pinocchio::{
    account::AccountView as AccountInfo, address::Address as Pubkey, error::ProgramError,
    ProgramResult,
};

use crate::{
    clock::slot,
    error::KassandraError,
    processor::guards::{assert_key, load_er_session, load_oracle},
    state::ErSession,
};

pub fn process(program_id: &Pubkey, accounts: &mut [AccountInfo], payload: &[u8]) -> ProgramResult {
    if !payload.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let [oracle_ai, session_ai, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let _oracle = load_oracle(oracle_ai, program_id)?;
    let mut session = load_er_session(session_ai, program_id)?;
    if session.oracle != *oracle_ai.address() {
        return Err(KassandraError::InvalidAccount.into());
    }
    let (expected, _) =
        Pubkey::find_program_address(&[ErSession::SEED_PREFIX, oracle_ai.address().as_ref()], program_id);
    assert_key(session_ai, &expected)?;
    if !session.is_delegated() {
        return Err(KassandraError::NotDelegated.into());
    }
    session.last_commit_slot = slot()?;
    {
        let mut data = session_ai.try_borrow_mut()?;
        data[..ErSession::LEN].copy_from_slice(bytemuck::bytes_of(&session));
    }
    Ok(())
}
