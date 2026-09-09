//! `spot_price` instruction wrapper (Task F5).
//!
//! A thin, read-only seam over [`crate::price::spot_price`]: it loads the
//! `Protocol` singleton, reads the governance-anchored futarchy spot TWAP from
//! the `spot_dao` account, and returns the value (a `u128`, little-endian) via
//! `set_return_data`. There is no state mutation and no token movement.
//!
//! The pure helper ([`crate::price::spot_price`]) is the core F5 deliverable; this
//! instruction exists so the read can be driven on-chain (the next-milestone
//! challenge-market rework is the first real consumer) and queried off-chain via
//! a simulated transaction's return data. It has **no on-chain consumer yet** —
//! that is expected, not dead code.
//!
//! # Accounts
//! 0. protocol PDA — read-only; the `[b"protocol"]` singleton (read `spot_dao`)
//! 1. spot_dao     — read-only; the futarchy `Dao` account == `protocol.spot_dao`
//!
//! # Return data
//! The 16-byte little-endian `u128` TWAP (quote units per base × `1e12`).

use pinocchio::{
    account::AccountView as AccountInfo, address::Address as Pubkey, cpi::set_return_data,
    error::ProgramError, ProgramResult,
};

use crate::{price::spot_price, processor::guards::load_protocol};

pub fn process(
    program_id: &Pubkey,
    accounts: &mut [AccountInfo],
    _payload: &[u8],
) -> ProgramResult {
    let [protocol_ai, spot_dao_ai, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // `load_protocol` pins the canonical `[b"protocol"]` PDA, so a substituted
    // protocol account (carrying a wrong `spot_dao`) is rejected here.
    let protocol = load_protocol(protocol_ai, program_id)?;

    // Governance-anchored + owner-checked spot TWAP read (see `price::spot_price`).
    let twap = spot_price(&protocol, spot_dao_ai)?;

    set_return_data(&twap.to_le_bytes());
    Ok(())
}
