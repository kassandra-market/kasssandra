//! MagicBlock undelegate callback: 8-byte discriminator
//! [`crate::cpi::magicblock::EXTERNAL_UNDELEGATE_DISCRIMINATOR`].
//!
//! The ER validator CPI-calls this on the base layer after undelegation. We
//! parse the seed vector, locate the matching `ErSession`, and mark it
//! undelegated. Full account-recreate-from-buffer (MagicBlock's pinocchio
//! `undelegate`) is deferred until ownership-transfer delegation is exercised
//! in production; if the oracle PDA is already program-owned (our short-form
//! path never transferred it) we only update the session.

use pinocchio::{
    account::AccountView as AccountInfo, address::Address as Pubkey, error::ProgramError,
    ProgramResult,
};

use crate::{
    error::KassandraError,
    processor::guards::{load_er_session, load_oracle},
    state::{ErSession, ER_STATUS_UNDELEGATED},
};

pub fn process(program_id: &Pubkey, accounts: &mut [AccountInfo], payload: &[u8]) -> ProgramResult {
    // MagicBlock encodes `Vec<Vec<u8>>` as Borsh: u32 len + [u32 len + bytes]*.
    let mut rest = payload;
    let n = read_u32(&mut rest)? as usize;
    if n == 0 || n > 16 {
        return Err(ProgramError::InvalidInstructionData);
    }
    for _ in 0..n {
        let elem_len = read_u32(&mut rest)? as usize;
        if rest.len() < elem_len {
            return Err(ProgramError::InvalidInstructionData);
        }
        rest = &rest[elem_len..];
    }
    if !rest.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let [oracle_ai, session_ai, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    // Short-form: the oracle is still program-owned. Reject anything else so we
    // never silently accept a callback against a stranger account.
    let _oracle = load_oracle(oracle_ai, program_id)?;
    let mut session = load_er_session(session_ai, program_id)?;
    if session.oracle != *oracle_ai.address() {
        return Err(KassandraError::InvalidAccount.into());
    }
    if !session.is_delegated() {
        return Err(KassandraError::NotDelegated.into());
    }
    session.status = ER_STATUS_UNDELEGATED;
    {
        let mut data = session_ai.try_borrow_mut()?;
        data[..ErSession::LEN].copy_from_slice(bytemuck::bytes_of(&session));
    }
    Ok(())
}

fn read_u32(bytes: &mut &[u8]) -> Result<u32, ProgramError> {
    if bytes.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let val = u32::from_le_bytes(bytes[..4].try_into().unwrap());
    *bytes = &bytes[4..];
    Ok(val)
}
