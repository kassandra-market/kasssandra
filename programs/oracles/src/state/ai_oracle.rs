//! External AI oracle config + per-oracle feed.

use bytemuck::{Pod, Zeroable};

use super::Pubkey;

/// Protocol singleton configuring MagicBlock's solana-gpt-oracle. `size_of == 48`.
///
/// PDA `[b"ai_oracle_config"]`. Created/updated by `set_ai_oracle_config`
/// (DAO-gated). When `enabled == 0`, `request_ai_oracle` / `apply_external_ai_claim`
/// reject (`AiOracleDisabled`) — MagicBlock is the only AI source. When
/// `enabled == 1`, `request_ai_oracle` CPIs into MagicBlock and
/// `callback_from_gpt_oracle` writes [`AiOracleFeed`].
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct AiOracleConfig {
    pub account_type: u8, // AccountType::AiOracleConfig
    pub bump: u8,
    pub enabled: u8,
    /// [`super::AI_ORACLE_SOURCE_EXTERNAL`] / `MAGICBLOCK` / `SWITCHBOARD`.
    pub source: u8,
    pub _pad: [u8; 4],
    /// MagicBlock `ContextAccount` pubkey (created via `create_llm_context`).
    /// Same offset as the former pusher `authority` field (layout-stable).
    pub llm_context: Pubkey,
    /// `apply_external_ai_claim` rejects a feed when
    /// `Clock.slot - feed.slot > max_staleness_slots`.
    pub max_staleness_slots: u64,
}

impl AiOracleConfig {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const SEED_PREFIX: &'static [u8] = b"ai_oracle_config";

    pub fn is_enabled(&self) -> bool {
        self.enabled != 0
    }
}

/// Latest attested categorical answer for one oracle. `size_of == 248`.
///
/// PDA `[b"ai_feed", oracle]`. Created by `request_ai_oracle`; written by the
/// MagicBlock GPT-oracle callback (identity PDA signer). Consumed by
/// `apply_external_ai_claim`.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct AiOracleFeed {
    pub account_type: u8, // AccountType::AiOracleFeed
    pub bump: u8,
    pub option: u8,
    pub _pad: [u8; 5],
    pub oracle: Pubkey,
    /// Slot at which the program accepted the GPT-oracle callback (`Clock.slot`).
    pub slot: u64,
    pub timestamp: i64,
    pub model_id: [u8; 32],
    pub params_hash: [u8; 32],
    pub io_hash: [u8; 32],
    /// Opaque copy of the LLM response prefix (not an ed25519 signature).
    pub attestation: [u8; 64],
    pub updated_by: Pubkey,
}

impl AiOracleFeed {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const SEED_PREFIX: &'static [u8] = b"ai_feed";
    /// Stamped by `request_ai_oracle` before the GPT callback arrives.
    /// `apply_external_ai_claim` rejects it (`option >= options_count`).
    pub const OPTION_PENDING: u8 = 0xFF;
}
