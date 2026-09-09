//! GPT Subject builders (Ix 15 `CreateSubject`, Ix 16 `RequestAi`).

use crate::*;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::system_program;

/// `CreateSubject` (Ix 15). Payload: `nonce u64 LE ++ options_count u8 ++ llm_context [32]`.
pub fn create_subject(
    payer: &Pubkey,
    nonce: u64,
    options_count: u8,
    llm_context: &Pubkey,
) -> Instruction {
    let (subject, _) = crate::pda::subject(nonce);
    let mut data = vec![IX_CREATE_SUBJECT];
    data.extend_from_slice(&nonce.to_le_bytes());
    data.push(options_count);
    data.extend_from_slice(llm_context.as_ref());
    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(subject, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// `RequestAi` (Ix 16) short form (no GPT CPI remaining accounts).
/// Payload: `text_len u32 LE ++ text`.
pub fn request_ai(subject: &Pubkey, payer: &Pubkey, text: &[u8]) -> Instruction {
    let mut data = vec![IX_REQUEST_AI];
    data.extend_from_slice(&(text.len() as u32).to_le_bytes());
    data.extend_from_slice(text);
    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*subject, false),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}
