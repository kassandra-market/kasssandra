//! Program-derived address helpers.
//!
//! These seed conventions are part of the program's public contract; downstream
//! code MUST derive with exactly these seeds. Each function returns
//! `(address, bump)` like [`solana_pubkey::Pubkey::find_program_address`].

use kassandra_oracles_program::config::MINT_AUTHORITY_SEED;
use solana_pubkey::Pubkey;

use crate::{ATA_PROGRAM_ID, TOKEN_PROGRAM_ID};

/// Oracle PDA — seeds `[b"oracle", nonce_le]`.
pub fn oracle(program_id: &Pubkey, nonce: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"oracle", &nonce.to_le_bytes()], program_id)
}

/// Oracle-metadata PDA — seeds `[b"oracle_meta", oracle]`. Holds the plaintext
/// subject + option labels + uri/uri_hash written by `write_oracle_meta`.
pub fn oracle_meta(program_id: &Pubkey, oracle: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"oracle_meta", oracle.as_ref()], program_id)
}

/// Protocol singleton PDA — seeds `[b"protocol"]`.
pub fn protocol(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"protocol"], program_id)
}

/// SOL mint-authority PDA — seeds `[MINT_AUTHORITY_SEED]`. Handed to the SOL
/// mint so the program's emission `MintTo` can program-sign.
pub fn mint_authority(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], program_id)
}

/// Stake-vault PDA for an oracle — seeds `[b"vault", oracle]`. An SPL token
/// account on the SOL mint whose authority is the oracle PDA.
pub fn stake_vault(program_id: &Pubkey, oracle: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"vault", oracle.as_ref()], program_id)
}

/// Challenger USDC escrow-vault PDA for a market — seeds `[b"challenge_usdc", market]`.
pub fn challenge_usdc_vault(program_id: &Pubkey, market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"challenge_usdc", market.as_ref()], program_id)
}

/// Proposer PDA — seeds `[b"proposer", oracle, authority]`.
pub fn proposer(program_id: &Pubkey, oracle: &Pubkey, authority: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"proposer", oracle.as_ref(), authority.as_ref()],
        program_id,
    )
}

/// Fact PDA — seeds `[b"fact", oracle, content_hash]`.
pub fn fact(program_id: &Pubkey, oracle: &Pubkey, content_hash: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"fact", oracle.as_ref(), content_hash.as_ref()],
        program_id,
    )
}

/// FactVote PDA — seeds `[b"vote", fact, voter]`.
pub fn vote(program_id: &Pubkey, fact: &Pubkey, voter: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"vote", fact.as_ref(), voter.as_ref()], program_id)
}

/// AiClaim PDA — seeds `[b"claim", oracle, proposer]`.
pub fn ai_claim(program_id: &Pubkey, oracle: &Pubkey, proposer: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"claim", oracle.as_ref(), proposer.as_ref()], program_id)
}

/// ER-session companion PDA — seeds `[b"er_session", oracle]`.
pub fn er_session(program_id: &Pubkey, oracle: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"er_session", oracle.as_ref()], program_id)
}

/// External AI-oracle config singleton — seeds `[b"ai_oracle_config"]`.
pub fn ai_oracle_config(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"ai_oracle_config"], program_id)
}

/// External AI feed PDA — seeds `[b"ai_feed", oracle]`.
pub fn ai_oracle_feed(program_id: &Pubkey, oracle: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"ai_feed", oracle.as_ref()], program_id)
}

/// MagicBlock solana-gpt-oracle program id.
const GPT_ORACLE_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("LLMrieZMpbJFwN52WgmBNMxYojrpRVYXdC1RCweEbab");

/// MagicBlock solana-gpt-oracle identity PDA — seeds `[b"identity"]`.
pub fn gpt_oracle_identity() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"identity"], &GPT_ORACLE_PROGRAM_ID)
}

/// MagicBlock interaction PDA — seeds `[b"interaction", payer, context]`.
pub fn gpt_oracle_interaction(payer: &Pubkey, context: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"interaction", payer.as_ref(), context.as_ref()],
        &GPT_ORACLE_PROGRAM_ID,
    )
}

/// MagicBlock counter PDA — seeds `[b"counter"]`. First `create_llm_context`
/// uses `count = 0`.
pub fn gpt_oracle_counter() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"counter"], &GPT_ORACLE_PROGRAM_ID)
}

/// MagicBlock `ContextAccount` PDA — seeds `[b"test-context", count_u32_le]`.
pub fn gpt_oracle_context(count: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"test-context", &count.to_le_bytes()],
        &GPT_ORACLE_PROGRAM_ID,
    )
}

/// The canonical SOL associated-token-account of `owner` — where the DAO
/// treasury lives. Derived under the ATA program from `[owner, token_program, mint]`.
pub fn base_ata(owner: &Pubkey, base_mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            owner.as_ref(),
            TOKEN_PROGRAM_ID.as_ref(),
            base_mint.as_ref(),
        ],
        &ATA_PROGRAM_ID,
    )
    .0
}
