//! Companion [`ErSession`] PDA: MagicBlock Ephemeral Rollup delegation record.

use bytemuck::{Pod, Zeroable};

use super::Pubkey;

/// Per-oracle ER-delegation record. `size_of == 96`.
///
/// Lives at `[b"er_session", oracle]`. Created by `delegate_oracle`; status is
/// flipped by `commit_oracle` / `undelegate_oracle` / the MagicBlock undelegate
/// callback. Does NOT replace MagicBlock's own delegation-record PDAs — it is
/// Kassandra's queryable view so the app/indexer can show L1 vs ER without
/// calling Magic Router.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct ErSession {
    pub account_type: u8, // AccountType::ErSession
    pub bump: u8,
    /// [`super::ER_STATUS_UNDELEGATED`] or [`super::ER_STATUS_DELEGATED`].
    pub status: u8,
    pub _pad: [u8; 5],
    pub oracle: Pubkey,
    /// ER validator pubkey (32 zero = unspecified / Magic Router default).
    pub validator: Pubkey,
    pub commit_frequency_ms: u32,
    pub _pad2: [u8; 4],
    pub delegated_at: i64,
    pub last_commit_slot: u64,
}

impl ErSession {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const SEED_PREFIX: &'static [u8] = b"er_session";

    pub fn is_delegated(&self) -> bool {
        self.status == super::ER_STATUS_DELEGATED
    }
}
