//! `push_ai_oracle_feed` (Ix=28): authority-gated write of `[b"ai_feed", oracle]`.

use bytemuck::Zeroable;
use pinocchio::{
    account::AccountView as AccountInfo, address::Address as Pubkey, cpi::Seed,
    error::ProgramError, ProgramResult,
};

use crate::{
    clock::{now, slot},
    error::KassandraError,
    processor::guards::{
        assert_key, assert_signer, create_or_adopt_pda, load_ai_oracle_config, load_oracle,
    },
    rent::minimum_rent,
    state::{AccountType, AiOracleFeed},
};

/// `option u8 ++ model_id[32] ++ params_hash[32] ++ io_hash[32] ++ attestation[64]`.
const PAYLOAD_LEN: usize = 1 + 32 + 32 + 32 + 64;

pub fn process(program_id: &Pubkey, accounts: &mut [AccountInfo], payload: &[u8]) -> ProgramResult {
    if payload.len() != PAYLOAD_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    let option = payload[0];
    let model_id: [u8; 32] = payload[1..33].try_into().unwrap();
    let params_hash: [u8; 32] = payload[33..65].try_into().unwrap();
    let io_hash: [u8; 32] = payload[65..97].try_into().unwrap();
    let attestation: [u8; 64] = payload[97..161].try_into().unwrap();

    let [config_ai, oracle_ai, feed_ai, authority_ai, system_ai, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    assert_signer(authority_ai)?;
    assert_key(system_ai, &pinocchio_system::ID)?;

    let cfg = load_ai_oracle_config(config_ai, program_id)?;
    let (expected_cfg, _) =
        Pubkey::find_program_address(&[crate::state::AiOracleConfig::SEED_PREFIX], program_id);
    assert_key(config_ai, &expected_cfg)?;
    if !cfg.is_enabled() {
        return Err(KassandraError::AiOracleDisabled.into());
    }
    if authority_ai.address() != &cfg.authority {
        return Err(KassandraError::Unauthorized.into());
    }

    let oracle = load_oracle(oracle_ai, program_id)?;
    if option >= oracle.options_count {
        return Err(KassandraError::InvalidOption.into());
    }

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
            authority_ai,
            feed_ai,
            &signer_seeds,
            rent,
            AiOracleFeed::LEN,
            program_id,
        )?;
    }

    let mut feed = AiOracleFeed::zeroed();
    feed.account_type = AccountType::AiOracleFeed.as_u8();
    feed.bump = bump;
    feed.option = option;
    feed.oracle = *oracle_ai.address();
    feed.slot = slot()?;
    feed.timestamp = now()?;
    feed.model_id = model_id;
    feed.params_hash = params_hash;
    feed.io_hash = io_hash;
    feed.attestation = attestation;
    feed.updated_by = *authority_ai.address();
    {
        let mut data = feed_ai.try_borrow_mut()?;
        data[..AiOracleFeed::LEN].copy_from_slice(bytemuck::bytes_of(&feed));
    }
    Ok(())
}
