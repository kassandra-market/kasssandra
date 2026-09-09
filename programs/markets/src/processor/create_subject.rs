//! `create_subject` (Ix 15): stand up a GPT-resolved [`Subject`].
//!
//! PDA `[b"subject", nonce_u64_le]`. Payload (after disc): `nonce u64 LE`
//! ++ `options_count u8` ++ `llm_context [32]`.
//!
//! Accounts: 0 payer (signer, w) 1 subject PDA (w) 2 system.

use bytemuck::Zeroable;
use pinocchio::{
    account::AccountView, address::Address, cpi::Seed, error::ProgramError, ProgramResult,
};

use crate::{
    error::MarketError,
    processor::guards::{assert_key, assert_signer, create_or_adopt_pda, rent_exempt_lamports},
    state::{AccountType, Subject, SUBJECT_OPTION_PENDING, SubjectStatus},
};

const PAYLOAD_LEN: usize = 8 + 1 + 32;

pub fn process(
    program_id: &Address,
    accounts: &mut [AccountView],
    payload: &[u8],
) -> ProgramResult {
    if payload.len() != PAYLOAD_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    let nonce = u64::from_le_bytes(payload[0..8].try_into().unwrap());
    let options_count = payload[8];
    if options_count < 2 {
        return Err(MarketError::InvalidOutcome.into());
    }
    let llm_bytes: [u8; 32] = payload[9..41].try_into().unwrap();
    let llm_context = Address::from(llm_bytes);

    let [payer_ai, subject_ai, system_ai, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    assert_signer(payer_ai)?;
    assert_key(system_ai, &pinocchio_system::ID)?;

    let nonce_bytes = nonce.to_le_bytes();
    let (expected, bump) =
        Address::find_program_address(&[Subject::SEED_PREFIX, &nonce_bytes], program_id);
    assert_key(subject_ai, &expected)?;
    if subject_ai.owned_by(program_id) {
        return Err(MarketError::AlreadyInitialized.into());
    }

    let rent = rent_exempt_lamports(Subject::LEN)?;
    let bump_seed = [bump];
    let seeds = [
        Seed::from(Subject::SEED_PREFIX),
        Seed::from(nonce_bytes.as_ref()),
        Seed::from(&bump_seed),
    ];
    create_or_adopt_pda(payer_ai, subject_ai, &seeds, rent, Subject::LEN, program_id)?;

    let mut s = Subject::zeroed();
    s.account_type = AccountType::Subject.as_u8();
    s.bump = bump;
    s.options_count = options_count;
    s.status = SubjectStatus::Open.as_u8();
    s.resolved_option = SUBJECT_OPTION_PENDING;
    s.creator = *payer_ai.address();
    s.llm_context = llm_context;
    s.nonce = nonce;
    {
        let mut d = subject_ai.try_borrow_mut()?;
        d[..Subject::LEN].copy_from_slice(bytemuck::bytes_of(&s));
    }
    Ok(())
}
