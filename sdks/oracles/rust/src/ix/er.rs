//! Ephemeral-rollup session instruction builders (Ix 24–26).

use kassandra_oracles_program::instruction::Ix;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use super::build;
use crate::SYSTEM_PROGRAM_ID;

/// `DelegateOracle` (Ix 24) — short form (Kassandra `ErSession` only).
/// Payload: `nonce u64 LE ++ commit_frequency_ms u32 LE ++ validator [u8;32]`
/// (`commit_frequency_ms == 0` → MagicBlock default 30s; validator all-zero → none).
pub fn delegate_oracle(
    program_id: &Pubkey,
    oracle: Pubkey,
    er_session: Pubkey,
    payer: Pubkey,
    nonce: u64,
    commit_frequency_ms: u32,
    validator: &Pubkey,
) -> Instruction {
    let mut data = Vec::with_capacity(1 + 44);
    data.push(Ix::DelegateOracle as u8);
    data.extend_from_slice(&nonce.to_le_bytes());
    data.extend_from_slice(&commit_frequency_ms.to_le_bytes());
    data.extend_from_slice(validator.as_ref());
    build(
        program_id,
        vec![
            AccountMeta::new(oracle, false),
            AccountMeta::new(er_session, false),
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data,
    )
}

/// `CommitOracle` (Ix 25).
pub fn commit_oracle(program_id: &Pubkey, oracle: Pubkey, er_session: Pubkey) -> Instruction {
    build(
        program_id,
        vec![
            AccountMeta::new(oracle, false),
            AccountMeta::new(er_session, false),
        ],
        vec![Ix::CommitOracle as u8],
    )
}

/// `UndelegateOracle` (Ix 26).
pub fn undelegate_oracle(program_id: &Pubkey, oracle: Pubkey, er_session: Pubkey) -> Instruction {
    build(
        program_id,
        vec![
            AccountMeta::new(oracle, false),
            AccountMeta::new(er_session, false),
        ],
        vec![Ix::UndelegateOracle as u8],
    )
}
