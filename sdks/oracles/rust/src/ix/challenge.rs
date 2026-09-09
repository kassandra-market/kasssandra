//! MetaDAO decision-market challenge instruction builders (Ix 4–5).

use kassandra_oracles_program::instruction::Ix;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use super::build;
use crate::{SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID};

// ===================================================================== Ix 4
/// The 25 accounts `OpenChallenge` (Ix 4) requires, in wire order. The MetaDAO
/// slots (question, conditional vaults, AMMs, conditional-token mints, event
/// authority) are composed by the challenger beforehand and passed in.
#[derive(Clone, Copy, Debug)]
pub struct OpenChallengeAccounts {
    pub oracle: Pubkey,
    pub ai_claim: Pubkey,
    pub proposer: Pubkey,
    pub market: Pubkey,
    pub challenger: Pubkey,
    pub question: Pubkey,
    pub base_vault: Pubkey,
    pub usdc_vault: Pubkey,
    pub pass_amm: Pubkey,
    pub fail_amm: Pubkey,
    pub stake_vault: Pubkey,
    pub base_vault_underlying: Pubkey,
    pub pass_base_mint: Pubkey,
    pub fail_base_mint: Pubkey,
    pub oracle_pass_base: Pubkey,
    pub oracle_fail_base: Pubkey,
    pub cv_program: Pubkey,
    pub cv_event_authority: Pubkey,
    pub protocol: Pubkey,
    pub spot_dao: Pubkey,
    pub usdc_mint: Pubkey,
    pub challenger_usdc_src: Pubkey,
    pub challenger_usdc_vault: Pubkey,
}

/// `OpenChallenge` (Ix 4) — open a MetaDAO decision market against an AI claim.
/// Payload is the oracle `nonce` (split signer). Escrow size is computed on-chain.
pub fn open_challenge(program_id: &Pubkey, a: &OpenChallengeAccounts, nonce: u64) -> Instruction {
    let mut data = Vec::with_capacity(1 + 8);
    data.push(Ix::OpenChallenge as u8);
    data.extend_from_slice(&nonce.to_le_bytes());
    build(
        program_id,
        vec![
            AccountMeta::new(a.oracle, false),
            AccountMeta::new(a.ai_claim, false),
            AccountMeta::new(a.proposer, false),
            AccountMeta::new(a.market, false),
            AccountMeta::new(a.challenger, true),
            AccountMeta::new_readonly(a.question, false),
            AccountMeta::new(a.base_vault, false),
            AccountMeta::new_readonly(a.usdc_vault, false),
            AccountMeta::new_readonly(a.pass_amm, false),
            AccountMeta::new_readonly(a.fail_amm, false),
            AccountMeta::new(a.stake_vault, false),
            AccountMeta::new(a.base_vault_underlying, false),
            AccountMeta::new(a.pass_base_mint, false),
            AccountMeta::new(a.fail_base_mint, false),
            AccountMeta::new(a.oracle_pass_base, false),
            AccountMeta::new(a.oracle_fail_base, false),
            AccountMeta::new_readonly(a.cv_program, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
            AccountMeta::new_readonly(a.cv_event_authority, false),
            AccountMeta::new_readonly(a.protocol, false),
            AccountMeta::new_readonly(a.spot_dao, false),
            AccountMeta::new_readonly(a.usdc_mint, false),
            AccountMeta::new(a.challenger_usdc_src, false),
            AccountMeta::new(a.challenger_usdc_vault, false),
        ],
        data,
    )
}

// ===================================================================== Ix 5
/// The 21 accounts `SettleChallenge` (Ix 5) requires, in wire order.
#[derive(Clone, Copy, Debug)]
pub struct SettleChallengeAccounts {
    pub oracle: Pubkey,
    pub market: Pubkey,
    pub ai_claim: Pubkey,
    pub proposer: Pubkey,
    pub question: Pubkey,
    pub pass_amm: Pubkey,
    pub fail_amm: Pubkey,
    pub cv_program: Pubkey,
    pub cv_event_authority: Pubkey,
    pub stake_vault: Pubkey,
    pub base_vault: Pubkey,
    pub base_vault_underlying: Pubkey,
    pub pass_base_mint: Pubkey,
    pub fail_base_mint: Pubkey,
    pub oracle_pass_base: Pubkey,
    pub oracle_fail_base: Pubkey,
    pub challenger_usdc_vault: Pubkey,
    pub proposer_usdc: Pubkey,
    pub challenger_usdc_dest: Pubkey,
    pub challenger_base: Pubkey,
}

/// `SettleChallenge` (Ix 5) — read the market TWAP, apply the verdict, resolve
/// the question, redeem, and route directional fees. Payload is the oracle `nonce`.
pub fn settle_challenge(
    program_id: &Pubkey,
    a: &SettleChallengeAccounts,
    nonce: u64,
) -> Instruction {
    let mut data = Vec::with_capacity(1 + 8);
    data.push(Ix::SettleChallenge as u8);
    data.extend_from_slice(&nonce.to_le_bytes());
    build(
        program_id,
        vec![
            AccountMeta::new(a.oracle, false),
            AccountMeta::new(a.market, false),
            AccountMeta::new_readonly(a.ai_claim, false),
            AccountMeta::new(a.proposer, false),
            AccountMeta::new(a.question, false),
            AccountMeta::new_readonly(a.pass_amm, false),
            AccountMeta::new_readonly(a.fail_amm, false),
            AccountMeta::new_readonly(a.cv_program, false),
            AccountMeta::new_readonly(a.cv_event_authority, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
            AccountMeta::new(a.stake_vault, false),
            AccountMeta::new(a.base_vault, false),
            AccountMeta::new(a.base_vault_underlying, false),
            AccountMeta::new(a.pass_base_mint, false),
            AccountMeta::new(a.fail_base_mint, false),
            AccountMeta::new(a.oracle_pass_base, false),
            AccountMeta::new(a.oracle_fail_base, false),
            AccountMeta::new(a.challenger_usdc_vault, false),
            AccountMeta::new(a.proposer_usdc, false),
            AccountMeta::new(a.challenger_usdc_dest, false),
            AccountMeta::new(a.challenger_base, false),
        ],
        data,
    )
}
