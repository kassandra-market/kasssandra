//! External AI oracle config + per-oracle feed.

use bytemuck::{Pod, Zeroable};

use super::Pubkey;

/// Protocol singleton configuring the external AI oracle pusher. `size_of == 48`.
///
/// PDA `[b"ai_oracle_config"]`. Created/updated by `set_ai_oracle_config`
/// (DAO-gated). When `enabled == 0` the in-house `submit_ai_claim` path is the
/// only AI round; when `enabled == 1`, `apply_external_ai_claim` consumes
/// [`AiOracleFeed`].
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct AiOracleConfig {
    pub account_type: u8, // AccountType::AiOracleConfig
    pub bump: u8,
    pub enabled: u8,
    /// [`super::AI_ORACLE_SOURCE_EXTERNAL`] / `MAGICBLOCK` / `SWITCHBOARD`.
    pub source: u8,
    pub _pad: [u8; 4],
    /// Signer allowed to `push_ai_oracle_feed`.
    pub authority: Pubkey,
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
/// PDA `[b"ai_feed", oracle]`. Written by `push_ai_oracle_feed` (program stamps
/// slot/timestamp from `Clock`). Consumed by `apply_external_ai_claim`.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct AiOracleFeed {
    pub account_type: u8, // AccountType::AiOracleFeed
    pub bump: u8,
    pub option: u8,
    pub _pad: [u8; 5],
    pub oracle: Pubkey,
    /// Slot at which the program accepted the push (`Clock.slot`).
    pub slot: u64,
    pub timestamp: i64,
    pub model_id: [u8; 32],
    pub params_hash: [u8; 32],
    pub io_hash: [u8; 32],
    /// Opaque attestation (ed25519 signature, TEE quote hash, …). Not verified
    /// on-chain in this slice — the `authority` gate is the trust root.
    pub attestation: [u8; 64],
    pub updated_by: Pubkey,
}

impl AiOracleFeed {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const SEED_PREFIX: &'static [u8] = b"ai_feed";
}
