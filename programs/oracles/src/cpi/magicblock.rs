//! MagicBlock Ephemeral Rollup program IDs, PDA seeds, and optional CPI helpers.
//!
//! We do **not** depend on `ephemeral-rollups-pinocchio` (it pins pinocchio
//! `^0.10`; this workspace is `0.11.2`). The wire format is reconstructed from
//! MagicBlock's published pinocchio SDK (`ephemeral-rollups-sdk` v0.16), the
//! same way [`super::metadao`] reconstructs Anchor CPIs.
//!
//! Full ownership-transfer delegation (buffer PDA + `Assign` to the Delegation
//! Program) is taken only when the caller supplies the remaining-account set.
//! LiteSVM tests use the short-form instructions that only write our
//! [`crate::state::ErSession`].

use pinocchio::{
    account::AccountView as AccountInfo,
    address::Address as Pubkey,
    cpi::{invoke_signed_with_slice, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    ProgramResult,
};

/// MagicBlock Delegation Program.
pub const DELEGATION_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

/// MagicBlock Magic Program (commit / undelegate intents on the ER).
pub const MAGIC_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("Magic11111111111111111111111111111111111111");

/// Magic Context account (passed to commit CPIs).
pub const MAGIC_CONTEXT_ID: Pubkey =
    Pubkey::from_str_const("MagicContext1111111111111111111111111111111");

/// Buffer PDA seed under the *owner* program (`["buffer", delegated_pda]`).
pub const BUFFER_SEED: &[u8] = b"buffer";
/// Delegation-record PDA seed under the delegation program (`["delegation", pda]`).
pub const DELEGATION_RECORD_SEED: &[u8] = b"delegation";
/// Delegation-metadata PDA seed (`["delegation-metadata", pda]`).
pub const DELEGATION_METADATA_SEED: &[u8] = b"delegation-metadata";

/// Discriminator the ER validator uses to CPI back into the owner program
/// after undelegation. Handled in `process_instruction` *before* 1-byte dispatch.
pub const EXTERNAL_UNDELEGATE_DISCRIMINATOR: [u8; 8] = [196, 28, 41, 206, 48, 37, 51, 167];

/// Default commit cadence (30s), matching MagicBlock's `DelegateConfig` default
/// when not `u32::MAX`.
pub const DEFAULT_COMMIT_FREQUENCY_MS: u32 = 30_000;

/// Max seeds the delegation program accepts (Solana PDA limit).
const MAX_SEEDS: usize = 16;
const MAX_SEED_LEN: usize = 32;

/// `cpi_delegate` instruction data: `u64 LE disc` ++ serialized
/// `DelegateAccountArgs`. Disc `0` = specified validator; `19` = any validator.
const MAX_DELEGATE_ARGS: usize = 4 // commit_frequency_ms
    + 4 // seeds_len
    + MAX_SEEDS * (4 + MAX_SEED_LEN)
    + 1
    + 32;

/// Encode MagicBlock `DelegateAccountArgs` after an 8-byte u64 LE discriminator.
pub fn encode_delegate_data(
    disc: u64,
    commit_frequency_ms: u32,
    seeds: &[&[u8]],
    validator: Option<&Pubkey>,
) -> Result<([u8; 8 + MAX_DELEGATE_ARGS], usize), ProgramError> {
    if seeds.len() >= MAX_SEEDS {
        return Err(ProgramError::InvalidArgument);
    }
    let mut data = [0u8; 8 + MAX_DELEGATE_ARGS];
    data[..8].copy_from_slice(&disc.to_le_bytes());
    let mut off = 8;
    data[off..off + 4].copy_from_slice(&commit_frequency_ms.to_le_bytes());
    off += 4;
    data[off..off + 4].copy_from_slice(&(seeds.len() as u32).to_le_bytes());
    off += 4;
    for seed in seeds {
        if seed.len() > MAX_SEED_LEN {
            return Err(ProgramError::InvalidArgument);
        }
        data[off..off + 4].copy_from_slice(&(seed.len() as u32).to_le_bytes());
        off += 4;
        data[off..off + seed.len()].copy_from_slice(seed);
        off += seed.len();
    }
    match validator {
        Some(pk) => {
            data[off] = 1;
            off += 1;
            data[off..off + 32].copy_from_slice(pk.as_ref());
            off += 32;
        }
        None => {
            data[off] = 0;
            off += 1;
        }
    }
    Ok((data, off))
}

/// CPI the Delegation Program's `delegate` (disc 0) when the caller supplied
/// the 7 MagicBlock accounts. The oracle PDA must sign via `signer_seeds`.
///
/// Account order (MagicBlock contract): payer (ws), pda (ws), owner_program (ro),
/// buffer (w), delegation_record (w), delegation_metadata (w), system (ro).
#[allow(clippy::too_many_arguments)]
pub fn cpi_delegate(
    payer: &AccountInfo,
    pda: &AccountInfo,
    owner_program: &AccountInfo,
    buffer: &AccountInfo,
    delegation_record: &AccountInfo,
    delegation_metadata: &AccountInfo,
    system_program: &AccountInfo,
    commit_frequency_ms: u32,
    seeds: &[&[u8]],
    validator: Option<&Pubkey>,
    signer_seeds: &[Seed],
) -> ProgramResult {
    let (buf, len) = encode_delegate_data(0, commit_frequency_ms, seeds, validator)?;
    let metas = [
        InstructionAccount::writable_signer(payer.address()),
        InstructionAccount::writable_signer(pda.address()),
        InstructionAccount::readonly(owner_program.address()),
        InstructionAccount::writable(buffer.address()),
        InstructionAccount::writable(delegation_record.address()),
        InstructionAccount::writable(delegation_metadata.address()),
        InstructionAccount::readonly(system_program.address()),
    ];
    let ix = InstructionView {
        program_id: &DELEGATION_PROGRAM_ID,
        accounts: &metas,
        data: &buf[..len],
    };
    let infos = [
        payer,
        pda,
        owner_program,
        buffer,
        delegation_record,
        delegation_metadata,
        system_program,
    ];
    invoke_signed_with_slice(&ix, &infos, &[Signer::from(signer_seeds)])
}
