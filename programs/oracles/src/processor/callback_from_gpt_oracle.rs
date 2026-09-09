//! MagicBlock solana-gpt-oracle callback: 8-byte discriminator
//! [`crate::cpi::gpt_oracle::CALLBACK_DISCRIMINATOR`].
//!
//! Invoked by GPT-oracle `callback_from_llm` via `invoke_signed` with the
//! identity PDA (`["identity"]` under `LLMrieZ…`) as signer. Payload is a
//! Borsh `String` (the LLM response). Writes [`AiOracleFeed`].

use pinocchio::{
    account::AccountView as AccountInfo, address::Address as Pubkey, error::ProgramError,
    ProgramResult,
};

use crate::{
    clock::{now, slot},
    cpi::gpt_oracle::{
        self, GPT_ORACLE_PROGRAM_ID, IDENTITY_SEED,
    },
    error::KassandraError,
    processor::guards::{
        assert_key, assert_signer, load_ai_oracle_config, load_ai_oracle_feed, load_oracle,
    },
    state::AiOracleFeed,
};

pub fn process(program_id: &Pubkey, accounts: &mut [AccountInfo], payload: &[u8]) -> ProgramResult {
    let response = parse_borsh_string(payload)?;

    let [identity_ai, config_ai, oracle_ai, feed_ai, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    assert_signer(identity_ai)?;
    let (expected_identity, _) =
        Pubkey::find_program_address(&[IDENTITY_SEED], &GPT_ORACLE_PROGRAM_ID);
    assert_key(identity_ai, &expected_identity)?;

    let cfg = load_ai_oracle_config(config_ai, program_id)?;
    let (expected_cfg, _) =
        Pubkey::find_program_address(&[crate::state::AiOracleConfig::SEED_PREFIX], program_id);
    assert_key(config_ai, &expected_cfg)?;
    if !cfg.is_enabled() {
        return Err(KassandraError::AiOracleDisabled.into());
    }

    let oracle = load_oracle(oracle_ai, program_id)?;
    let option = gpt_oracle::parse_llm_option(response, oracle.options_count)
        .map_err(|_| KassandraError::InvalidAiOracleResponse)?;

    let mut feed = load_ai_oracle_feed(feed_ai, program_id)?;
    let (expected_feed, _) = Pubkey::find_program_address(
        &[AiOracleFeed::SEED_PREFIX, oracle_ai.address().as_ref()],
        program_id,
    );
    assert_key(feed_ai, &expected_feed)?;
    if feed.oracle != *oracle_ai.address() {
        return Err(KassandraError::AiOracleMismatch.into());
    }

    feed.option = option;
    feed.slot = slot()?;
    feed.timestamp = now()?;
    feed.model_id = {
        let mut b = [0u8; 32];
        b.copy_from_slice(GPT_ORACLE_PROGRAM_ID.as_ref());
        b
    };
    feed.params_hash = {
        let mut b = [0u8; 32];
        b.copy_from_slice(cfg.llm_context.as_ref());
        b
    };
    feed.io_hash = gpt_oracle::truncate32(response);
    feed.attestation = gpt_oracle::truncate64(response);
    feed.updated_by = *identity_ai.address();
    {
        let mut data = feed_ai.try_borrow_mut()?;
        data[..AiOracleFeed::LEN].copy_from_slice(bytemuck::bytes_of(&feed));
    }
    Ok(())
}

fn parse_borsh_string(payload: &[u8]) -> Result<&[u8], ProgramError> {
    if payload.len() < 4 {
        return Err(KassandraError::InvalidAiOracleResponse.into());
    }
    let len = u32::from_le_bytes(payload[..4].try_into().unwrap()) as usize;
    if payload.len() != 4 + len {
        return Err(KassandraError::InvalidAiOracleResponse.into());
    }
    Ok(&payload[4..])
}
