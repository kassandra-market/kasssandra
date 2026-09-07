//! Market ER-session instructions: DelegateMarket / CommitMarket / UndelegateMarket.

use bytemuck::Zeroable;
use pinocchio::{
    account::AccountView, address::Address, cpi::Seed, error::ProgramError,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{
    error::MarketError,
    instruction::Ix,
    processor::guards::{
        assert_key, assert_signer, create_or_adopt_pda, load_market,
    },
    state::{AccountType, ErSession, ER_STATUS_DELEGATED, ER_STATUS_UNDELEGATED},
};

const DEFAULT_COMMIT_FREQUENCY_MS: u32 = 30_000;
const DELEGATE_PAYLOAD: usize = 4 + 32; // commit_frequency_ms + validator

pub fn process_delegate(
    program_id: &Address,
    accounts: &mut [AccountView],
    payload: &[u8],
) -> ProgramResult {
    if payload.len() != DELEGATE_PAYLOAD {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut commit_frequency_ms = u32::from_le_bytes(payload[0..4].try_into().unwrap());
    if commit_frequency_ms == 0 {
        commit_frequency_ms = DEFAULT_COMMIT_FREQUENCY_MS;
    }
    let validator: Address = <[u8; 32]>::try_from(&payload[4..36]).unwrap().into();

    let [market_ai, session_ai, payer_ai, system_ai, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    assert_signer(payer_ai)?;
    assert_key(system_ai, &pinocchio_system::ID)?;
    let _market = load_market(market_ai, program_id)?;

    let (expected, bump) =
        Address::find_program_address(&[ErSession::SEED_PREFIX, market_ai.address().as_ref()], program_id);
    assert_key(session_ai, &expected)?;

    let now = Clock::get()?.unix_timestamp;
    let mut session = if session_ai.owned_by(program_id) && session_ai.data_len() >= ErSession::LEN {
        let existing: ErSession = {
            let data = session_ai.try_borrow()?;
            bytemuck::pod_read_unaligned(&data[..ErSession::LEN])
        };
        if existing.account_type != AccountType::ErSession.as_u8() {
            return Err(MarketError::InvalidAccount.into());
        }
        if existing.is_delegated() {
            return Err(MarketError::AlreadyDelegated.into());
        }
        existing
    } else {
        let rent = crate::processor::guards::rent_exempt_lamports(ErSession::LEN)?;
        let bump_seed = [bump];
        let signer_seeds = [
            Seed::from(ErSession::SEED_PREFIX),
            Seed::from(market_ai.address().as_ref()),
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
        s.market = *market_ai.address();
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
    Ok(())
}

fn load_session(
    program_id: &Address,
    market_ai: &AccountView,
    session_ai: &AccountView,
) -> Result<ErSession, ProgramError> {
    let _market = load_market(market_ai, program_id)?;
    let (expected, _) =
        Address::find_program_address(&[ErSession::SEED_PREFIX, market_ai.address().as_ref()], program_id);
    assert_key(session_ai, &expected)?;
    if !session_ai.owned_by(program_id) || session_ai.data_len() < ErSession::LEN {
        return Err(MarketError::InvalidAccount.into());
    }
    let session: ErSession = {
        let data = session_ai.try_borrow()?;
        bytemuck::pod_read_unaligned(&data[..ErSession::LEN])
    };
    if session.account_type != AccountType::ErSession.as_u8() {
        return Err(MarketError::InvalidAccount.into());
    }
    if session.market != *market_ai.address() {
        return Err(MarketError::InvalidAccount.into());
    }
    Ok(session)
}

pub fn process_commit(
    program_id: &Address,
    accounts: &mut [AccountView],
    payload: &[u8],
) -> ProgramResult {
    if !payload.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let [market_ai, session_ai, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let mut session = load_session(program_id, market_ai, session_ai)?;
    if !session.is_delegated() {
        return Err(MarketError::NotDelegated.into());
    }
    session.last_commit_slot = Clock::get()?.slot;
    {
        let mut data = session_ai.try_borrow_mut()?;
        data[..ErSession::LEN].copy_from_slice(bytemuck::bytes_of(&session));
    }
    Ok(())
}

pub fn process_undelegate(
    program_id: &Address,
    accounts: &mut [AccountView],
    payload: &[u8],
) -> ProgramResult {
    if !payload.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let [market_ai, session_ai, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let mut session = load_session(program_id, market_ai, session_ai)?;
    if !session.is_delegated() {
        return Err(MarketError::NotDelegated.into());
    }
    session.status = ER_STATUS_UNDELEGATED;
    {
        let mut data = session_ai.try_borrow_mut()?;
        data[..ErSession::LEN].copy_from_slice(bytemuck::bytes_of(&session));
    }
    Ok(())
}

/// Dispatch helper so `processor::process` stays a thin match.
pub fn process(
    program_id: &Address,
    accounts: &mut [AccountView],
    payload: &[u8],
    ix: Ix,
) -> ProgramResult {
    match ix {
        Ix::DelegateMarket => process_delegate(program_id, accounts, payload),
        Ix::CommitMarket => process_commit(program_id, accounts, payload),
        Ix::UndelegateMarket => process_undelegate(program_id, accounts, payload),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
