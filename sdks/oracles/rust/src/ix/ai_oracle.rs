//! External AI-oracle instruction builders (Ix 27–29).

use kassandra_oracles_program::instruction::Ix;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use super::build;
use crate::SYSTEM_PROGRAM_ID;

/// `SetAiOracleConfig` (Ix 27).
/// Payload: `authority[32] ++ max_staleness_slots u64 LE ++ source u8 ++ enabled u8`.
pub fn set_ai_oracle_config(
    program_id: &Pubkey,
    protocol: Pubkey,
    config: Pubkey,
    authority: Pubkey,
    pusher: Pubkey,
    max_staleness_slots: u64,
    source: u8,
    enabled: bool,
) -> Instruction {
    let mut data = Vec::with_capacity(1 + 42);
    data.push(Ix::SetAiOracleConfig as u8);
    data.extend_from_slice(pusher.as_ref());
    data.extend_from_slice(&max_staleness_slots.to_le_bytes());
    data.push(source);
    data.push(u8::from(enabled));
    build(
        program_id,
        vec![
            AccountMeta::new(protocol, false),
            AccountMeta::new(config, false),
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data,
    )
}

/// `PushAiOracleFeed` (Ix 28).
/// Payload: `option u8 ++ model_id[32] ++ params_hash[32] ++ io_hash[32] ++ attestation[64]`.
#[allow(clippy::too_many_arguments)]
pub fn push_ai_oracle_feed(
    program_id: &Pubkey,
    config: Pubkey,
    oracle: Pubkey,
    feed: Pubkey,
    authority: Pubkey,
    option: u8,
    model_id: &[u8; 32],
    params_hash: &[u8; 32],
    io_hash: &[u8; 32],
    attestation: &[u8; 64],
) -> Instruction {
    let mut data = Vec::with_capacity(1 + 161);
    data.push(Ix::PushAiOracleFeed as u8);
    data.push(option);
    data.extend_from_slice(model_id);
    data.extend_from_slice(params_hash);
    data.extend_from_slice(io_hash);
    data.extend_from_slice(attestation);
    build(
        program_id,
        vec![
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(oracle, false),
            AccountMeta::new(feed, false),
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data,
    )
}

/// `ApplyExternalAiClaim` (Ix 29).
#[allow(clippy::too_many_arguments)]
pub fn apply_external_ai_claim(
    program_id: &Pubkey,
    oracle: Pubkey,
    proposer: Pubkey,
    ai_claim: Pubkey,
    config: Pubkey,
    feed: Pubkey,
    payer: Pubkey,
) -> Instruction {
    build(
        program_id,
        vec![
            AccountMeta::new_readonly(oracle, false),
            AccountMeta::new(proposer, false),
            AccountMeta::new(ai_claim, false),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(feed, false),
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        vec![Ix::ApplyExternalAiClaim as u8],
    )
}
