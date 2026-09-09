//! `request_ai` (Ix 16): CPI MagicBlock `interact_with_llm` for a [`Subject`].
//!
//! Payload: `text_len u32 LE ++ text`. Remaining accounts (optional, required
//! to actually talk to GPT): gpt program, interaction PDA, llm_context.
//!
//! Accounts: 0 subject (ro) 1 payer (signer, w) 2 system
//!           [3 gpt program 4 interaction (w) 5 llm_context].

use pinocchio::{
    account::AccountView, address::Address, error::ProgramError, ProgramResult,
};

use crate::{
    cpi::gpt_oracle::{
        self, CALLBACK_DISCRIMINATOR, GPT_ORACLE_PROGRAM_ID, INTERACT_IX_MAX, INTERACTION_SEED,
        MAX_INTERACT_TEXT,
    },
    error::MarketError,
    processor::guards::{assert_key, assert_signer, load_subject},
};

pub fn process(
    program_id: &Address,
    accounts: &mut [AccountView],
    payload: &[u8],
) -> ProgramResult {
    if payload.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let text_len = u32::from_le_bytes(payload[..4].try_into().unwrap()) as usize;
    if payload.len() != 4 + text_len || text_len > MAX_INTERACT_TEXT {
        return Err(ProgramError::InvalidInstructionData);
    }
    let text = &payload[4..];

    let [subject_ai, payer_ai, system_ai, rest @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    assert_signer(payer_ai)?;
    assert_key(system_ai, &pinocchio_system::ID)?;

    let subject = load_subject(subject_ai, program_id)?;
    if !subject.is_open() {
        return Err(MarketError::OracleResolved.into());
    }
    if subject.llm_context.as_ref() == &[0u8; 32] {
        return Err(MarketError::InvalidAccount.into());
    }

    if rest.len() < 3 {
        // Short form: LiteSVM tests invoke the callback directly.
        return Ok(());
    }
    let gpt_program = &rest[0];
    let interaction = &rest[1];
    let context = &rest[2];
    assert_key(gpt_program, &GPT_ORACLE_PROGRAM_ID)?;
    assert_key(context, &subject.llm_context)?;
    let (expected_ixn, _) = Address::find_program_address(
        &[
            INTERACTION_SEED,
            payer_ai.address().as_ref(),
            context.address().as_ref(),
        ],
        &GPT_ORACLE_PROGRAM_ID,
    );
    assert_key(interaction, &expected_ixn)?;

    let metas = [(*subject_ai.address(), false, true)];
    let mut buf = [0u8; INTERACT_IX_MAX];
    let n = gpt_oracle::encode_interact_with_llm(
        &mut buf,
        text,
        program_id,
        &CALLBACK_DISCRIMINATOR,
        &metas,
    )?;
    gpt_oracle::cpi_interact_with_llm(payer_ai, interaction, context, system_ai, &buf[..n])
}
