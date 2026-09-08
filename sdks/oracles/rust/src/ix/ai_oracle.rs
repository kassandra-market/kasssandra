//! External AI-oracle instruction builders (Ix 27–29) + the GPT-oracle callback.

use kassandra_oracles_program::cpi::gpt_oracle::{
    CALLBACK_DISCRIMINATOR, GPT_ORACLE_PROGRAM_ID as GPT_ORACLE_PINOCCHIO, MAX_INTERACT_TEXT as GPT_MAX_TEXT,
};
use kassandra_oracles_program::instruction::Ix;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use super::build;
use crate::SYSTEM_PROGRAM_ID;

/// Max user-text bytes `RequestAiOracle` forwards to MagicBlock.
pub const MAX_INTERACT_TEXT: usize = GPT_MAX_TEXT;

/// MagicBlock solana-gpt-oracle program id.
pub fn gpt_oracle_program_id() -> Pubkey {
    let mut b = [0u8; 32];
    b.copy_from_slice(GPT_ORACLE_PINOCCHIO.as_ref());
    Pubkey::new_from_array(b)
}

/// `SetAiOracleConfig` (Ix 27).
/// Payload: `llm_context[32] ++ max_staleness_slots u64 LE ++ source u8 ++ enabled u8`.
pub fn set_ai_oracle_config(
    program_id: &Pubkey,
    protocol: Pubkey,
    config: Pubkey,
    authority: Pubkey,
    llm_context: Pubkey,
    max_staleness_slots: u64,
    source: u8,
    enabled: bool,
) -> Instruction {
    let mut data = Vec::with_capacity(1 + 42);
    data.push(Ix::SetAiOracleConfig as u8);
    data.extend_from_slice(llm_context.as_ref());
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

/// `RequestAiOracle` (Ix 28) — short form (no MagicBlock CPI).
/// Payload: `text_len u32 LE ++ text`.
pub fn request_ai_oracle(
    program_id: &Pubkey,
    config: Pubkey,
    oracle: Pubkey,
    feed: Pubkey,
    payer: Pubkey,
    text: &[u8],
) -> Instruction {
    request_ai_oracle_inner(program_id, config, oracle, feed, payer, text, None)
}

/// `RequestAiOracle` (Ix 28) with the remaining-account GPT-oracle CPI set.
pub fn request_ai_oracle_with_gpt(
    program_id: &Pubkey,
    config: Pubkey,
    oracle: Pubkey,
    feed: Pubkey,
    payer: Pubkey,
    text: &[u8],
    interaction: Pubkey,
    llm_context: Pubkey,
) -> Instruction {
    request_ai_oracle_inner(
        program_id,
        config,
        oracle,
        feed,
        payer,
        text,
        Some((interaction, llm_context)),
    )
}

fn request_ai_oracle_inner(
    program_id: &Pubkey,
    config: Pubkey,
    oracle: Pubkey,
    feed: Pubkey,
    payer: Pubkey,
    text: &[u8],
    gpt: Option<(Pubkey, Pubkey)>,
) -> Instruction {
    let mut data = Vec::with_capacity(1 + 4 + text.len());
    data.push(Ix::RequestAiOracle as u8);
    data.extend_from_slice(&(text.len() as u32).to_le_bytes());
    data.extend_from_slice(text);
    let mut accounts = vec![
        AccountMeta::new_readonly(config, false),
        AccountMeta::new_readonly(oracle, false),
        AccountMeta::new(feed, false),
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
    ];
    if let Some((interaction, llm_context)) = gpt {
        accounts.push(AccountMeta::new_readonly(gpt_oracle_program_id(), false));
        accounts.push(AccountMeta::new(interaction, false));
        accounts.push(AccountMeta::new_readonly(llm_context, false));
    }
    build(program_id, accounts, data)
}

/// 8-byte GPT-oracle callback (not a Kassandra `Ix` byte).
pub fn callback_from_gpt_oracle(
    program_id: &Pubkey,
    identity: Pubkey,
    config: Pubkey,
    oracle: Pubkey,
    feed: Pubkey,
    response: &str,
) -> Instruction {
    let mut data = Vec::with_capacity(8 + 4 + response.len());
    data.extend_from_slice(&CALLBACK_DISCRIMINATOR);
    data.extend_from_slice(&(response.len() as u32).to_le_bytes());
    data.extend_from_slice(response.as_bytes());
    build(
        program_id,
        vec![
            AccountMeta::new_readonly(identity, true),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(oracle, false),
            AccountMeta::new(feed, false),
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
