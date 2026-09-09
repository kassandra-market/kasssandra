//! `set_ai_oracle_config` (Ix=27): DAO-gated create-or-update of the AI-oracle
//! singleton.

use bytemuck::Zeroable;
use pinocchio::{
    account::AccountView as AccountInfo, address::Address as Pubkey, cpi::Seed,
    error::ProgramError, ProgramResult,
};

use crate::{
    error::KassandraError,
    processor::guards::{
        assert_dao_authority, assert_key, create_or_adopt_pda, load_ai_oracle_config, load_protocol,
    },
    rent::minimum_rent,
    state::{AccountType, AiOracleConfig, AI_ORACLE_SOURCE_SWITCHBOARD},
};

/// `llm_context[32] ++ max_staleness_slots u64 LE ++ source u8 ++ enabled u8`.
const PAYLOAD_LEN: usize = 32 + 8 + 1 + 1;

pub fn process(program_id: &Pubkey, accounts: &mut [AccountInfo], payload: &[u8]) -> ProgramResult {
    if payload.len() != PAYLOAD_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    let llm_context: Pubkey = <[u8; 32]>::try_from(&payload[..32]).unwrap().into();
    let max_staleness_slots = u64::from_le_bytes(payload[32..40].try_into().unwrap());
    let source = payload[40];
    let enabled = payload[41];
    if max_staleness_slots == 0 {
        return Err(KassandraError::InvalidConfig.into());
    }
    if source > AI_ORACLE_SOURCE_SWITCHBOARD {
        return Err(KassandraError::InvalidConfig.into());
    }
    if enabled != 0 && llm_context == Pubkey::default() {
        return Err(KassandraError::InvalidConfig.into());
    }

    let [protocol_ai, config_ai, authority_ai, system_ai, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    assert_key(system_ai, &pinocchio_system::ID)?;
    let protocol = load_protocol(protocol_ai, program_id)?;
    // Admin until DAO handoff; dao_authority afterwards (mirrors set_governance).
    if protocol.is_governance_set() {
        assert_dao_authority(&protocol, authority_ai)?;
    } else {
        crate::processor::guards::assert_signer(authority_ai)?;
        if authority_ai.address() != &protocol.admin {
            return Err(KassandraError::Unauthorized.into());
        }
    }

    let (expected, bump) =
        Pubkey::find_program_address(&[AiOracleConfig::SEED_PREFIX], program_id);
    assert_key(config_ai, &expected)?;

    let bump_seed = [bump];
    let signer_seeds = [
        Seed::from(AiOracleConfig::SEED_PREFIX),
        Seed::from(&bump_seed),
    ];

    if !(config_ai.owned_by(program_id) && config_ai.data_len() >= AiOracleConfig::LEN) {
        let rent = minimum_rent(AiOracleConfig::LEN)?;
        create_or_adopt_pda(
            authority_ai,
            config_ai,
            &signer_seeds,
            rent,
            AiOracleConfig::LEN,
            program_id,
        )?;
    } else {
        // Already initialized — still DAO-gated overwrite below.
        let _ = load_ai_oracle_config(config_ai, program_id)?;
    }

    let mut cfg = AiOracleConfig::zeroed();
    cfg.account_type = AccountType::AiOracleConfig.as_u8();
    cfg.bump = bump;
    cfg.enabled = if enabled == 0 { 0 } else { 1 };
    cfg.source = source;
    cfg.llm_context = llm_context;
    cfg.max_staleness_slots = max_staleness_slots;
    {
        let mut data = config_ai.try_borrow_mut()?;
        data[..AiOracleConfig::LEN].copy_from_slice(bytemuck::bytes_of(&cfg));
    }
    Ok(())
}
