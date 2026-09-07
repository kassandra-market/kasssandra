//! `apply_external_ai_claim` (Ix=29): stamp one proposer's `AiClaim` from the
//! live [`AiOracleFeed`].

use bytemuck::Zeroable;
use pinocchio::{
    account::AccountView as AccountInfo, address::Address as Pubkey, cpi::Seed,
    error::ProgramError, ProgramResult,
};

use crate::{
    clock::{now, require_before_end, require_phase, slot},
    error::KassandraError,
    processor::guards::{
        assert_key, create_pda, load_ai_oracle_config, load_ai_oracle_feed, load_oracle,
        load_proposer,
    },
    rent::minimum_rent,
    state::{AccountType, AiClaim, AiOracleFeed, Oracle, Phase},
};

pub fn process(program_id: &Pubkey, accounts: &mut [AccountInfo], payload: &[u8]) -> ProgramResult {
    if !payload.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let [oracle_ai, proposer_ai, claim_ai, config_ai, feed_ai, payer_ai, system_ai, ..] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !payer_ai.is_signer() {
        return Err(KassandraError::Unauthorized.into());
    }
    assert_key(system_ai, &pinocchio_system::ID)?;

    let oracle: Oracle = load_oracle(oracle_ai, program_id)?;
    let mut proposer = load_proposer(proposer_ai, program_id)?;
    require_phase(&oracle, Phase::AiClaim)?;
    require_before_end(&oracle, now()?)?;

    if proposer.oracle != *oracle_ai.address() {
        return Err(KassandraError::InvalidAccount.into());
    }
    if proposer.is_disqualified() {
        return Err(KassandraError::Unauthorized.into());
    }

    let cfg = load_ai_oracle_config(config_ai, program_id)?;
    let (expected_cfg, _) =
        Pubkey::find_program_address(&[crate::state::AiOracleConfig::SEED_PREFIX], program_id);
    assert_key(config_ai, &expected_cfg)?;
    if !cfg.is_enabled() {
        return Err(KassandraError::AiOracleDisabled.into());
    }

    let feed = load_ai_oracle_feed(feed_ai, program_id)?;
    let (expected_feed, _) = Pubkey::find_program_address(
        &[AiOracleFeed::SEED_PREFIX, oracle_ai.address().as_ref()],
        program_id,
    );
    assert_key(feed_ai, &expected_feed)?;
    if feed.oracle != *oracle_ai.address() {
        return Err(KassandraError::AiOracleMismatch.into());
    }
    let now_slot = slot()?;
    if now_slot < feed.slot || now_slot - feed.slot > cfg.max_staleness_slots {
        return Err(KassandraError::StaleAiOracle.into());
    }
    if feed.option >= oracle.options_count {
        return Err(KassandraError::InvalidOption.into());
    }

    let (expected_claim, bump) = Pubkey::find_program_address(
        &[
            b"claim",
            oracle_ai.address().as_ref(),
            proposer_ai.address().as_ref(),
        ],
        program_id,
    );
    assert_key(claim_ai, &expected_claim)?;
    if claim_ai.lamports() != 0 || !claim_ai.is_data_empty() {
        return Err(KassandraError::DuplicateClaim.into());
    }

    let rent = minimum_rent(AiClaim::LEN)?;
    let bump_seed = [bump];
    let signer_seeds = [
        Seed::from(b"claim".as_ref()),
        Seed::from(oracle_ai.address().as_ref()),
        Seed::from(proposer_ai.address().as_ref()),
        Seed::from(&bump_seed),
    ];
    create_pda(
        payer_ai,
        claim_ai,
        &signer_seeds,
        rent,
        AiClaim::LEN,
        program_id,
    )?;

    let mut claim = AiClaim::zeroed();
    claim.account_type = AccountType::AiClaim.as_u8();
    claim.oracle = *oracle_ai.address();
    claim.proposer = *proposer_ai.address();
    claim.model_id = feed.model_id;
    claim.params_hash = feed.params_hash;
    claim.io_hash = feed.io_hash;
    claim.option = feed.option;
    claim.challenged = 0;
    claim.bump = bump;
    claim.authority = proposer.authority;
    {
        let mut data = claim_ai.try_borrow_mut()?;
        data.copy_from_slice(bytemuck::bytes_of(&claim));
    }

    proposer.claim_option = feed.option;
    if feed.option != proposer.original_option {
        proposer.flipped = 1;
    }
    {
        let mut data = proposer_ai.try_borrow_mut()?;
        data[..crate::state::Proposer::LEN].copy_from_slice(bytemuck::bytes_of(&proposer));
    }

    Ok(())
}
