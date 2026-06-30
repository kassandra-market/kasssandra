//! `close_ai_claim` (Task S4): permissionless, post-resolution rent reclaim for
//! one [`AiClaim`] account.
//!
//! An [`AiClaim`] holds NO tokens — it is a pinned-model commitment record — so
//! this instruction performs NO token movement. Once the oracle is TERMINAL
//! ([`Phase::Resolved`] or [`Phase::InvalidDeadend`]) the claim is dead weight;
//! anyone may crank this to drain its rent lamports to the proposer's human
//! authority and CLOSE it. Idempotent BY CLOSURE — a second call finds the
//! account reaped (zero lamports → owner no longer the program) and fails the
//! load guard.
//!
//! # Rent recipient binding + ordering vs `claim_proposer` (the decision)
//! [`AiClaim`] stores `proposer` = the **Proposer PDA key**, not the human
//! authority that paid the claim's rent. To pay rent to the human we read
//! `proposer.authority` from the still-present [`Proposer`] account, passed
//! read-only and bound both ways (`ai_claim.proposer == proposer_ai.key()` AND
//! `proposer.oracle == oracle`). The `rent_recipient` is then pinned to
//! `proposer.authority`, so a cranker cannot redirect the rent.
//!
//! CONSEQUENCE — `close_ai_claim` MUST run BEFORE `claim_proposer` closes the
//! `Proposer` it reads the authority from (if the Proposer is already closed,
//! the `load_proposer` guard fails with `InvalidAccount` and the caller simply
//! cranks the two in the right order). This mirrors the S2 fact-close ordering
//! (`claim_fact` runs last, after every `claim_fact_vote`): a cheap,
//! permissionless ordering constraint rather than duplicating the authority onto
//! the `AiClaim`. The rent is the proposer's regardless of order, so no one is
//! stranded — only the close sequence is fixed.
//!
//! # Accounts
//! 0. oracle         — read-only; owned by this program; must be terminal.
//! 1. ai_claim       — writable; the [`AiClaim`] account, CLOSED here.
//! 2. proposer       — read-only; `== ai_claim.proposer`, `proposer.oracle ==
//!    oracle`; its `authority` is the rent recipient.
//! 3. rent_recipient — writable; `== proposer.authority` (reclaimed rent).
//!
//! # Instruction payload
//! None (exactly 0 bytes after the discriminant). No PDA signature is needed —
//! the close is a pure lamport drain on a program-owned account.

use pinocchio::{
    account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey, ProgramResult,
};

use crate::{
    error::KassandraError,
    processor::guards::{assert_key, load_ai_claim, load_oracle, load_proposer},
    state::Phase,
};

pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], payload: &[u8]) -> ProgramResult {
    if !payload.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let [oracle_ai, ai_claim_ai, proposer_ai, rent_recipient_ai, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Oracle must be owned by this program and TERMINAL.
    let oracle = load_oracle(oracle_ai, program_id)?;
    match oracle.phase().ok_or(KassandraError::InvalidAccount)? {
        Phase::Resolved | Phase::InvalidDeadend => {}
        _ => return Err(KassandraError::WrongPhase.into()),
    }

    // Bind the AiClaim to this oracle.
    let ai_claim = load_ai_claim(ai_claim_ai, program_id)?;
    if &ai_claim.oracle != oracle_ai.key() {
        return Err(KassandraError::InvalidAccount.into());
    }

    // Bind the Proposer both ways (it is the source of the rent recipient): the
    // AiClaim points at exactly this Proposer, and the Proposer belongs to this
    // oracle. Pay rent to the Proposer's human authority.
    let proposer = load_proposer(proposer_ai, program_id)?;
    if &ai_claim.proposer != proposer_ai.key() || &proposer.oracle != oracle_ai.key() {
        return Err(KassandraError::InvalidAccount.into());
    }
    assert_key(rent_recipient_ai, &proposer.authority)?;

    // Drain rent lamports → recipient, then zero the account (data / lamports /
    // owner). Idempotent: a second call finds it reaped.
    {
        let mut from = ai_claim_ai.try_borrow_mut_lamports()?;
        let mut to = rent_recipient_ai.try_borrow_mut_lamports()?;
        *to = to
            .checked_add(*from)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        *from = 0;
    }
    ai_claim_ai.close()
}
