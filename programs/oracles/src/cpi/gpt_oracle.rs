//! MagicBlock `solana-gpt-oracle` program IDs, Anchor discriminators, and
//! CPI helpers.
//!
//! We do **not** depend on the `solana-gpt-oracle` crate (it pulls Anchor +
//! `ephemeral-rollups-sdk`). The wire format is reconstructed from
//! <https://github.com/magicblock-labs/super-smart-contracts/blob/main/programs/solana-gpt-oracle/src/lib.rs>
//! the same way [`super::metadao`] reconstructs MetaDAO CPIs.
//!
//! Flow: Kassandra `RequestAiOracle` CPIs `interact_with_llm`; MagicBlock's
//! off-chain oracle later CPIs `callback_from_llm`, which invoke_signed-s into
//! Kassandra's 8-byte [`CALLBACK_DISCRIMINATOR`] with the identity PDA as
//! signer. That callback is the only writer of [`crate::state::AiOracleFeed`].

use pinocchio::{
    account::AccountView as AccountInfo,
    address::Address as Pubkey,
    cpi::invoke_signed_with_slice,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    ProgramResult,
};

/// MagicBlock solana-gpt-oracle program
/// (`LLMrieZMpbJFwN52WgmBNMxYojrpRVYXdC1RCweEbab`).
pub const GPT_ORACLE_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("LLMrieZMpbJFwN52WgmBNMxYojrpRVYXdC1RCweEbab");

/// Identity PDA seed under the GPT oracle program (`["identity"]`).
pub const IDENTITY_SEED: &[u8] = b"identity";
/// Counter PDA seed (`["counter"]`) — bumped by `create_llm_context`.
pub const COUNTER_SEED: &[u8] = b"counter";
/// Interaction PDA seed (`["interaction", payer, context]`).
pub const INTERACTION_SEED: &[u8] = b"interaction";
/// LLM context PDA seed prefix (`["test-context", counter.count LE]`).
pub const CONTEXT_SEED: &[u8] = b"test-context";

/// `sha256("global:initialize")[..8]`.
pub const INITIALIZE: [u8; 8] = [0xaf, 0xaf, 0x6d, 0x1f, 0x0d, 0x98, 0x9b, 0xed];
/// `sha256("global:create_llm_context")[..8]`.
pub const CREATE_LLM_CONTEXT: [u8; 8] = [0xe0, 0x6d, 0x04, 0xad, 0xbf, 0x19, 0x2a, 0xa2];
/// `sha256("global:interact_with_llm")[..8]`.
pub const INTERACT_WITH_LLM: [u8; 8] = [0x02, 0x36, 0x05, 0x10, 0x57, 0x7b, 0xdb, 0x84];
/// `sha256("global:callback_from_llm")[..8]` — the GPT program's keeper ix
/// (distinct from Kassandra's [`CALLBACK_DISCRIMINATOR`]).
pub const CALLBACK_FROM_LLM: [u8; 8] = [0x40, 0xca, 0xd1, 0x27, 0x9c, 0x12, 0xd8, 0xaa];

/// 8-byte discriminator Kassandra registers as the GPT-oracle callback.
/// `sha256("global:callback_from_gpt_oracle")[..8]`. Intercepted in
/// `process_instruction` *before* 1-byte `Ix` dispatch.
pub const CALLBACK_DISCRIMINATOR: [u8; 8] = [0x3b, 0x24, 0x82, 0x78, 0x4d, 0x6f, 0xac, 0x00];

/// Max user-text bytes forwarded to `interact_with_llm` (fits a legacy tx).
pub const MAX_INTERACT_TEXT: usize = 700;

/// `interact_with_llm` account metas we ask the GPT oracle to echo into our
/// callback after it prepends the identity PDA: config, oracle, feed.
pub const CALLBACK_META_COUNT: u32 = 3;

/// Stack buffer for the `interact_with_llm` instruction data:
/// disc[8] ++ String(4+text) ++ pubkey[32] ++ disc[8] ++ Option::Some[1]
/// ++ Vec len[4] ++ 3 × AccountMeta (34).
pub const INTERACT_IX_MAX: usize = 8 + 4 + MAX_INTERACT_TEXT + 32 + 8 + 1 + 4 + (3 * 34);

/// Borsh-encode `interact_with_llm(text, callback_program, callback_disc, Some(metas))`.
///
/// `metas` is `(pubkey, is_signer, is_writable)` in callback-account order
/// (config, oracle, feed). Returns the number of bytes written into `out`.
pub fn encode_interact_with_llm(
    out: &mut [u8],
    text: &[u8],
    callback_program: &Pubkey,
    callback_disc: &[u8; 8],
    metas: &[(Pubkey, bool, bool)],
) -> Result<usize, ProgramError> {
    if text.len() > MAX_INTERACT_TEXT {
        return Err(ProgramError::InvalidInstructionData);
    }
    let need = 8 + 4 + text.len() + 32 + 8 + 1 + 4 + metas.len() * 34;
    if out.len() < need {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut off = 0;
    out[off..off + 8].copy_from_slice(&INTERACT_WITH_LLM);
    off += 8;
    out[off..off + 4].copy_from_slice(&(text.len() as u32).to_le_bytes());
    off += 4;
    out[off..off + text.len()].copy_from_slice(text);
    off += text.len();
    out[off..off + 32].copy_from_slice(callback_program.as_ref());
    off += 32;
    out[off..off + 8].copy_from_slice(callback_disc);
    off += 8;
    out[off] = 1; // Option::Some
    off += 1;
    out[off..off + 4].copy_from_slice(&(metas.len() as u32).to_le_bytes());
    off += 4;
    for (pk, is_signer, is_writable) in metas {
        out[off..off + 32].copy_from_slice(pk.as_ref());
        off += 32;
        out[off] = u8::from(*is_signer);
        off += 1;
        out[off] = u8::from(*is_writable);
        off += 1;
    }
    Ok(off)
}

/// CPI `interact_with_llm` on the GPT oracle program.
///
/// Account order (MagicBlock contract): payer (ws), interaction (w),
/// context (ro), system (ro).
pub fn cpi_interact_with_llm(
    payer: &AccountInfo,
    interaction: &AccountInfo,
    context: &AccountInfo,
    system_program: &AccountInfo,
    data: &[u8],
) -> ProgramResult {
    let metas = [
        InstructionAccount::writable_signer(payer.address()),
        InstructionAccount::writable(interaction.address()),
        InstructionAccount::readonly(context.address()),
        InstructionAccount::readonly(system_program.address()),
    ];
    let ix = InstructionView {
        program_id: &GPT_ORACLE_PROGRAM_ID,
        accounts: &metas,
        data,
    };
    let infos = [payer, interaction, context, system_program];
    invoke_signed_with_slice(&ix, &infos, &[])
}

/// Parse a GPT-oracle LLM response into a categorical `option_index`.
///
/// Accepts `{"option_index": N}` (the runner's structured-output schema),
/// `{"option": N}`, or a bare unsigned integer. Extra JSON fields are ignored.
pub fn parse_llm_option(response: &[u8], options_count: u8) -> Result<u8, ProgramError> {
    if options_count == 0 {
        return Err(ProgramError::InvalidInstructionData);
    }
    if let Some(v) = parse_json_u8_field(response, b"option_index") {
        return check_option(v, options_count);
    }
    if let Some(v) = parse_json_u8_field(response, b"option") {
        return check_option(v, options_count);
    }
    if let Some(v) = parse_bare_u8(response) {
        return check_option(v, options_count);
    }
    Err(ProgramError::InvalidInstructionData)
}

fn check_option(v: u8, options_count: u8) -> Result<u8, ProgramError> {
    if v >= options_count {
        return Err(crate::error::KassandraError::InvalidOption.into());
    }
    Ok(v)
}

fn parse_json_u8_field(haystack: &[u8], key: &[u8]) -> Option<u8> {
    let mut i = 0;
    while i + key.len() < haystack.len() {
        if &haystack[i..i + key.len()] == key {
            let mut j = i + key.len();
            while j < haystack.len()
                && (haystack[j] == b' ' || haystack[j] == b'\t' || haystack[j] == b'"')
            {
                j += 1;
            }
            if j < haystack.len() && haystack[j] == b':' {
                j += 1;
                while j < haystack.len() && haystack[j].is_ascii_whitespace() {
                    j += 1;
                }
                return parse_u8_at(&haystack[j..]);
            }
        }
        i += 1;
    }
    None
}

fn parse_bare_u8(bytes: &[u8]) -> Option<u8> {
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    parse_u8_at(&bytes[i..])
}

fn parse_u8_at(bytes: &[u8]) -> Option<u8> {
    if bytes.is_empty() || !bytes[0].is_ascii_digit() {
        return None;
    }
    let mut n: u16 = 0;
    for &b in bytes {
        if !b.is_ascii_digit() {
            break;
        }
        n = n.saturating_mul(10).saturating_add((b - b'0') as u16);
        if n > 255 {
            return None;
        }
    }
    Some(n as u8)
}

/// Copy up to 32 bytes of `src` into a hash-sized buffer (zero-padded).
pub fn truncate32(src: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let n = src.len().min(32);
    out[..n].copy_from_slice(&src[..n]);
    out
}

/// Copy up to 64 bytes of `src` into an attestation buffer (zero-padded).
pub fn truncate64(src: &[u8]) -> [u8; 64] {
    let mut out = [0u8; 64];
    let n = src.len().min(64);
    out[..n].copy_from_slice(&src[..n]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_option_index_json() {
        assert_eq!(parse_llm_option(br#"{"option_index": 1}"#, 3).unwrap(), 1);
        assert_eq!(
            parse_llm_option(br#"{"option_index":1,"reason":"x"}"#, 3).unwrap(),
            1
        );
        assert_eq!(parse_llm_option(br#"{"option": 0}"#, 2).unwrap(), 0);
        assert_eq!(parse_llm_option(b"  2\n", 4).unwrap(), 2);
    }

    #[test]
    fn parse_rejects_oob() {
        assert!(parse_llm_option(br#"{"option_index": 3}"#, 3).is_err());
        assert!(parse_llm_option(b"not json", 2).is_err());
    }

    #[test]
    fn encode_interact_fits() {
        let mut buf = [0u8; INTERACT_IX_MAX];
        let pk = Pubkey::default();
        let metas = [(pk, false, false), (pk, false, false), (pk, false, true)];
        let n = encode_interact_with_llm(&mut buf, b"hello", &pk, &CALLBACK_DISCRIMINATOR, &metas)
            .unwrap();
        assert_eq!(&buf[..8], &INTERACT_WITH_LLM);
        assert_eq!(&buf[8..12], &5u32.to_le_bytes());
        assert_eq!(&buf[12..17], b"hello");
        assert!(n > 17);
    }
}
