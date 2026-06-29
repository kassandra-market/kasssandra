//! `set_governance`: one-time admin→DAO handoff recording the DAO linkage.
//!
//! Records `dao_authority` (the Squads v4 multisig **vault** PDA — F0 finding
//! #1, NOT a futarchy PDA) and `kass_dao` (the futarchy `Dao` account whose
//! embedded spot AMM is F5's KASS price source) into the [`Protocol`] singleton.
//! Both pubkeys are passed in the PAYLOAD (the real Squads/futarchy accounts are
//! not threaded here; F1 just stores whatever is supplied — F6 drives the real
//! setup), and validated non-zero.
//!
//! # Trust model (v1, one-shot handoff)
//! - While `governance_set == 0`: callable ONLY by `Protocol.admin` (the
//!   `init_protocol` admin). This is the one-time bootstrap handoff of control
//!   to the DAO.
//! - Once `governance_set == 1`: callable ONLY by the current
//!   `Protocol.dao_authority`, so governance can rotate its own linkage. The
//!   old admin is rejected ([`KassandraError::GovernanceAlreadySet`]).
//!
//! So the trust assumption is: the admin sets the DAO linkage exactly once, and
//! the DAO controls it thereafter (it can rotate itself, never back to the
//! admin).
//!
//! # Mint authority
//! The KASS mint authority is the program PDA `[b"mint_authority"]` (see
//! [`crate::config::MINT_AUTHORITY_SEED`]). F1 only DEFINES that seed; the
//! binding `kass_mint.mint_authority == mint_authority_pda` is asserted at first
//! emission (settlement milestone), since verifying it here would require
//! threading the mint account.
//!
//! # Accounts
//! 0. protocol PDA — writable; the `[b"protocol"]` singleton
//! 1. authority    — signer; `Protocol.admin` pre-handoff, `dao_authority` post
//!
//! # Instruction payload
//! `dao_authority: [u8; 32]` ++ `kass_dao: [u8; 32]` (64 bytes).

use pinocchio::{
    account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey, ProgramResult,
};

use crate::{
    error::KassandraError,
    processor::guards::{assert_signer, load_protocol},
    state::Protocol,
};

pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], payload: &[u8]) -> ProgramResult {
    let [protocol_ai, authority_ai, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // --- payload ------------------------------------------------------------
    if payload.len() < 64 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut dao_authority = [0u8; 32];
    let mut kass_dao = [0u8; 32];
    dao_authority.copy_from_slice(&payload[..32]);
    kass_dao.copy_from_slice(&payload[32..64]);
    // Both linkage keys must be non-zero (a zeroed key is the "unset" sentinel).
    if dao_authority == [0u8; 32] || kass_dao == [0u8; 32] {
        return Err(KassandraError::InvalidAccount.into());
    }

    // --- account validation -------------------------------------------------
    assert_signer(authority_ai)?;
    // load_protocol pins the singleton address, owner, length, and type tag.
    let mut protocol = load_protocol(protocol_ai, program_id)?;

    // --- trust model: admin sets once, then dao_authority rotates -----------
    if protocol.is_governance_set() {
        // Post-handoff: only the current DAO authority may rotate the linkage.
        if authority_ai.key() != &protocol.dao_authority {
            return Err(KassandraError::GovernanceAlreadySet.into());
        }
    } else {
        // Pre-handoff: only the init admin may perform the one-time handoff.
        if authority_ai.key() != &protocol.admin {
            return Err(KassandraError::Unauthorized.into());
        }
    }

    // --- record the linkage -------------------------------------------------
    protocol.dao_authority = dao_authority;
    protocol.kass_dao = kass_dao;
    protocol.governance_set = 1;
    {
        let mut data = protocol_ai.try_borrow_mut_data()?;
        data[..Protocol::LEN].copy_from_slice(bytemuck::bytes_of(&protocol));
    }

    Ok(())
}
