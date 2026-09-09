//! `submit_ai_claim` (Ix=3) is **retired**.
//!
//! Discriminant 3 is a stable public contract and is never reused. The
//! in-house Anthropic runner is no longer an AI source: MagicBlock
//! solana-gpt-oracle writes [`crate::state::AiOracleFeed`] via the 8-byte
//! callback, and [`super::apply_external_ai_claim`] stamps proposers.

use pinocchio::{
    account::AccountView as AccountInfo, address::Address as Pubkey, ProgramResult,
};

use crate::error::KassandraError;

pub fn process(_program_id: &Pubkey, _accounts: &mut [AccountInfo], _payload: &[u8]) -> ProgramResult {
    Err(KassandraError::SubmitAiClaimRetired.into())
}
