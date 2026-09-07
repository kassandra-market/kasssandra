//! Ephemeral-rollup session builders (Ix 12–14).

use crate::*;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::system_program;

/// `DelegateMarket` (Ix 12). Payload: `commit_frequency_ms u32 LE ++ validator [32]`
/// (`0` frequency → 30s default).
pub fn delegate_market(
    market: &Pubkey,
    er_session: &Pubkey,
    payer: &Pubkey,
    commit_frequency_ms: u32,
    validator: &Pubkey,
) -> Instruction {
    let mut data = vec![IX_DELEGATE_MARKET];
    data.extend_from_slice(&commit_frequency_ms.to_le_bytes());
    data.extend_from_slice(validator.as_ref());
    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*market, false),
            AccountMeta::new(*er_session, false),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// `CommitMarket` (Ix 13).
pub fn commit_market(market: &Pubkey, er_session: &Pubkey) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*market, false),
            AccountMeta::new(*er_session, false),
        ],
        data: vec![IX_COMMIT_MARKET],
    }
}

/// `UndelegateMarket` (Ix 14).
pub fn undelegate_market(market: &Pubkey, er_session: &Pubkey) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*market, false),
            AccountMeta::new(*er_session, false),
        ],
        data: vec![IX_UNDELEGATE_MARKET],
    }
}
