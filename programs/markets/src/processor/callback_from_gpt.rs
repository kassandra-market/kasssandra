//! MagicBlock GPT-oracle callback: 8-byte [`CALLBACK_DISCRIMINATOR`].
//!
//! GPT `callback_from_llm` invoke_signed-s here with the identity PDA as
//! signer. Payload is a Borsh `String`. Writes [`Subject`].

use pinocchio::{
    account::AccountView, address::Address, error::ProgramError,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{
    cpi::gpt_oracle::{self, GPT_ORACLE_PROGRAM_ID, IDENTITY_SEED},
    error::MarketError,
    processor::guards::{assert_key, assert_signer, load_subject, write_subject},
    state::{SubjectStatus, SUBJECT_OPTION_PENDING},
};

pub fn process(program_id: &Address, accounts: &mut [AccountView], payload: &[u8]) -> ProgramResult {
    let response = parse_borsh_string(payload)?;

    let [identity_ai, subject_ai, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    assert_signer(identity_ai)?;
    let (expected_identity, _) =
        Address::find_program_address(&[IDENTITY_SEED], &GPT_ORACLE_PROGRAM_ID);
    assert_key(identity_ai, &expected_identity)?;

    let mut subject = load_subject(subject_ai, program_id)?;
    if !subject.is_open() || subject.resolved_option != SUBJECT_OPTION_PENDING {
        return Err(MarketError::AlreadySettled.into());
    }

    let option = gpt_oracle::parse_llm_option(response, subject.options_count)?;
    subject.resolved_option = option;
    subject.status = SubjectStatus::Resolved.as_u8();
    subject.resolved_slot = Clock::get()?.slot;
    write_subject(subject_ai, &subject)
}

fn parse_borsh_string(payload: &[u8]) -> Result<&[u8], ProgramError> {
    if payload.len() < 4 {
        return Err(MarketError::InvalidAiResponse.into());
    }
    let len = u32::from_le_bytes(payload[..4].try_into().unwrap()) as usize;
    if payload.len() != 4 + len {
        return Err(MarketError::InvalidAiResponse.into());
    }
    Ok(&payload[4..])
}
