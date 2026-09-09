//! `request_ai_oracle` (Ix=28): create `[b"ai_feed", oracle]` and optionally
//! CPI MagicBlock `interact_with_llm`.

use bytemuck::Zeroable;
use pinocchio::{
    account::AccountView as AccountInfo, address::Address as Pubkey, cpi::Seed,
    error::ProgramError, ProgramResult,
};

use crate::{
    cpi::gpt_oracle::{
        self, CALLBACK_DISCRIMINATOR, GPT_ORACLE_PROGRAM_ID, INTERACT_IX_MAX, INTERACTION_SEED,
        MAX_INTERACT_TEXT,
    },
    error::KassandraError,
    processor::guards::{
        assert_key, assert_signer, create_or_adopt_pda, load_ai_oracle_config, load_oracle,
    },
    rent::minimum_rent,
    state::{AccountType, AiOracleFeed},
};

pub fn process(program_id: &Pubkey, accounts: &mut [AccountInfo], payload: &[u8]) -> ProgramResult {
    if payload.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let text_len = u32::from_le_bytes(payload[..4].try_into().unwrap()) as usize;
    if payload.len() != 4 + text_len || text_len > MAX_INTERACT_TEXT {
        return Err(ProgramError::InvalidInstructionData);
    }
    let text = &payload[4..];

    let [config_ai, oracle_ai, feed_ai, payer_ai, system_ai, rest @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    assert_signer(payer_ai)?;
    assert_key(system_ai, &pinocchio_system::ID)?;

    let cfg = load_ai_oracle_config(config_ai, program_id)?;
    let (expected_cfg, _) =
        Pubkey::find_program_address(&[crate::state::AiOracleConfig::SEED_PREFIX], program_id);
    assert_key(config_ai, &expected_cfg)?;
    if !cfg.is_enabled() {
        return Err(KassandraError::AiOracleDisabled.into());
    }
    if cfg.llm_context == Pubkey::default() {
        return Err(KassandraError::InvalidConfig.into());
    }

    let oracle = load_oracle(oracle_ai, program_id)?;
    let _ = oracle.options_count;

    let (expected_feed, bump) = Pubkey::find_program_address(
        &[AiOracleFeed::SEED_PREFIX, oracle_ai.address().as_ref()],
        program_id,
    );
    assert_key(feed_ai, &expected_feed)?;

    if !(feed_ai.owned_by(program_id) && feed_ai.data_len() >= AiOracleFeed::LEN) {
        let rent = minimum_rent(AiOracleFeed::LEN)?;
        let bump_seed = [bump];
        let signer_seeds = [
            Seed::from(AiOracleFeed::SEED_PREFIX),
            Seed::from(oracle_ai.address().as_ref()),
            Seed::from(&bump_seed),
        ];
        create_or_adopt_pda(
            payer_ai,
            feed_ai,
            &signer_seeds,
            rent,
            AiOracleFeed::LEN,
            program_id,
        )?;
        let mut feed = AiOracleFeed::zeroed();
        feed.account_type = AccountType::AiOracleFeed.as_u8();
        feed.bump = bump;
        feed.option = AiOracleFeed::OPTION_PENDING;
        feed.oracle = *oracle_ai.address();
        {
            let mut data = feed_ai.try_borrow_mut()?;
            data[..AiOracleFeed::LEN].copy_from_slice(bytemuck::bytes_of(&feed));
        }
    }

    // Optional MagicBlock CPI when the remaining-account set is present
    // (gpt program, interaction PDA, llm_context). LiteSVM tests use the
    // short form and invoke the callback directly.
    if rest.len() >= 3 {
        let gpt_program = &rest[0];
        let interaction = &rest[1];
        let context = &rest[2];
        assert_key(gpt_program, &GPT_ORACLE_PROGRAM_ID)?;
        assert_key(context, &cfg.llm_context)?;
        let (expected_ixn, _) = Pubkey::find_program_address(
            &[
                INTERACTION_SEED,
                payer_ai.address().as_ref(),
                context.address().as_ref(),
            ],
            &GPT_ORACLE_PROGRAM_ID,
        );
        assert_key(interaction, &expected_ixn)?;

        let metas = [
            (*config_ai.address(), false, false),
            (*oracle_ai.address(), false, false),
            (*feed_ai.address(), false, true),
        ];
        let mut buf = [0u8; INTERACT_IX_MAX];
        let n = gpt_oracle::encode_interact_with_llm(
            &mut buf,
            text,
            program_id,
            &CALLBACK_DISCRIMINATOR,
            &metas,
        )?;
        gpt_oracle::cpi_interact_with_llm(payer_ai, interaction, context, system_ai, &buf[..n])?;
    }

    Ok(())
}
