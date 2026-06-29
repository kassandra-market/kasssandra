//! `finalize_facts`: settle the fact-voting round once its window has elapsed.
//!
//! This instruction performs NO token CPI. It only mutates account data and
//! advances a running `Oracle.bond_pool` counter of slashed KASS owed to the
//! pool. The actual KASS stays escrowed in the stake vault; per-staker
//! reward / return / withdrawal (paying out approved-fact stakers, returning
//! duplicate/voter stakes, draining the bond pool) is a DEFERRED later task.
//! `bond_pool` here is purely an accounting counter.
//!
//! # Behavior
//! Gated to [`Phase::FactVoting`] after the voting window has elapsed.
//!
//! * **No-facts dead-end** (`fact_count == 0`): the account tail is ALL of the
//!   oracle's proposers. Each is disqualified + slashed, its bond is added to
//!   `bond_pool`, `surviving_count` drops to 0, and the oracle terminates in
//!   [`Phase::InvalidDeadend`]. No facts ever existed to drive a resolution.
//! * **Otherwise**: the tail is ALL of the oracle's facts. Each is classified:
//!   - duplicate-dominant (`duplicate_stake > approve_stake`) → `duplicate=1`,
//!     not slashed (its stake is returned later).
//!   - agreed (`approve_stake > duplicate_stake` AND
//!     `approve_stake * THRESHOLD_DEN >= dispute_bond_total * THRESHOLD_NUM`)
//!     → `agreed=1`, no bond_pool change (reward is a later claim).
//!   - rejected (neither of the above) → `settled` only, and the submitter's
//!     `fact.stake` is added to `bond_pool` (the rejected-fact slash). Voter
//!     stakes on rejected facts are settled later; out of scope here.
//!
//! In the facts case the oracle then advances to [`Phase::AiClaim`] with a
//! fresh window.
//!
//! All facts/proposers are settled exactly once: `settled` is an idempotency
//! guard, and the tail length must match the full set exactly (no partial
//! finalization).
//!
//! # Accounts
//! 0. oracle — writable, owned by this program
//! 1. onward — the tail: either ALL proposers (no-facts case) or ALL facts.
//!    Each writable, owned by this program, belonging to this oracle, distinct.
//!
//! # Instruction payload
//! Empty (after the 1-byte discriminant).

use pinocchio::{
    account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey, ProgramResult,
};

use crate::{
    clock::{now, require_after_end, require_phase},
    config::{PHASE_WINDOW, THRESHOLD_DEN, THRESHOLD_NUM},
    error::KassandraError,
    processor::guards::{assert_owned_by_program, load_fact, load_oracle},
    state::{AccountType, Oracle, Phase, Proposer},
};

/// A fact is agreed iff approve strictly beats duplicate AND clears the
/// protocol supermajority of the fixed `dispute_bond_total`. u128 intermediates
/// avoid overflow on the cross-multiplication.
fn is_agreed(approve_stake: u64, duplicate_stake: u64, dispute_bond_total: u64) -> bool {
    approve_stake > duplicate_stake
        && (approve_stake as u128) * (THRESHOLD_DEN as u128)
            >= (dispute_bond_total as u128) * (THRESHOLD_NUM as u128)
}

/// Reject if `key` appears in `prior` (distinctness within the tail).
fn require_distinct(prior: &[AccountInfo], key: &Pubkey) -> ProgramResult {
    for a in prior {
        if a.key() == key {
            return Err(KassandraError::InvalidAccount.into());
        }
    }
    Ok(())
}

pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], _payload: &[u8]) -> ProgramResult {
    let [oracle_ai, tail @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Owner + size + account_type check, then an owned copy for mutation.
    let mut oracle: Oracle = load_oracle(oracle_ai, program_id)?;

    require_phase(&oracle, Phase::FactVoting)?;
    let now = now()?;
    require_after_end(&oracle, now)?;

    if oracle.fact_count == 0 {
        finalize_no_facts(program_id, oracle_ai, &mut oracle, tail)?;
    } else {
        finalize_with_facts(program_id, oracle_ai, &mut oracle, tail, now)?;
    }

    Ok(())
}

/// No facts ever cleared: slash every proposer's bond into the pool and
/// terminate the oracle in [`Phase::InvalidDeadend`].
fn finalize_no_facts(
    program_id: &Pubkey,
    oracle_ai: &AccountInfo,
    oracle: &mut Oracle,
    proposers: &[AccountInfo],
) -> ProgramResult {
    if proposers.len() != oracle.proposer_count as usize {
        return Err(KassandraError::IncompleteFactSet.into());
    }

    for (i, p_ai) in proposers.iter().enumerate() {
        require_distinct(&proposers[..i], p_ai.key())?;
        assert_owned_by_program(p_ai, program_id)?;
        if p_ai.data_len() < Proposer::LEN {
            return Err(KassandraError::InvalidAccount.into());
        }

        let mut proposer: Proposer = {
            let data = p_ai.try_borrow_data()?;
            bytemuck::pod_read_unaligned::<Proposer>(&data[..Proposer::LEN])
        };
        if proposer.account_type != AccountType::Proposer.as_u8()
            || proposer.oracle != *oracle_ai.key()
        {
            return Err(KassandraError::InvalidAccount.into());
        }

        proposer.disqualified = 1;
        proposer.slashed = 1;
        oracle.bond_pool = oracle
            .bond_pool
            .checked_add(proposer.bond)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        let mut data = p_ai.try_borrow_mut_data()?;
        data[..Proposer::LEN].copy_from_slice(bytemuck::bytes_of(&proposer));
    }

    oracle.surviving_count = 0;
    oracle.set_phase(Phase::InvalidDeadend);
    write_oracle(oracle_ai, oracle)
}

/// Classify and settle every fact, then advance to [`Phase::AiClaim`].
fn finalize_with_facts(
    program_id: &Pubkey,
    oracle_ai: &AccountInfo,
    oracle: &mut Oracle,
    facts: &[AccountInfo],
    now: i64,
) -> ProgramResult {
    if facts.len() != oracle.fact_count as usize {
        return Err(KassandraError::IncompleteFactSet.into());
    }

    for (i, f_ai) in facts.iter().enumerate() {
        require_distinct(&facts[..i], f_ai.key())?;

        // Owner + size + account_type check, then an owned copy for mutation.
        let mut fact = load_fact(f_ai, program_id)?;
        if fact.oracle != *oracle_ai.key() {
            return Err(KassandraError::InvalidAccount.into());
        }
        if fact.is_settled() {
            return Err(KassandraError::AlreadySettled.into());
        }

        if fact.duplicate_stake > fact.approve_stake {
            // Duplicate-dominant: ignored, stake returned later, NOT slashed.
            fact.duplicate = 1;
        } else if is_agreed(fact.approve_stake, fact.duplicate_stake, oracle.dispute_bond_total) {
            // Agreed: reward is a later claim, no bond_pool change here.
            fact.agreed = 1;
        } else {
            // Rejected: slash the submitter's stake into the pool counter.
            oracle.bond_pool = oracle
                .bond_pool
                .checked_add(fact.stake)
                .ok_or(ProgramError::ArithmeticOverflow)?;
        }
        fact.settled = 1;

        let mut data = f_ai.try_borrow_mut_data()?;
        data[..crate::state::Fact::LEN].copy_from_slice(bytemuck::bytes_of(&fact));
    }

    oracle.set_phase(Phase::AiClaim);
    oracle.phase_ends_at = now
        .checked_add(PHASE_WINDOW)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    write_oracle(oracle_ai, oracle)
}

/// Write the mutated oracle back into its account data.
fn write_oracle(oracle_ai: &AccountInfo, oracle: &Oracle) -> ProgramResult {
    let mut data = oracle_ai.try_borrow_mut_data()?;
    data[..Oracle::LEN].copy_from_slice(bytemuck::bytes_of(oracle));
    Ok(())
}
