//! `finalize_oracle`: the final plurality recompute that drives the oracle into
//! a terminal state (design §6, §7).
//!
//! Runs once, after the [`Phase::Challenge`] window has elapsed AND every
//! challenge decision market has settled. It recomputes the plurality over the
//! SURVIVING proposers (Task 8's pure [`plurality`]) and writes the terminal
//! phase:
//! * [`Plurality::Winner`]`(opt)` → [`Phase::Resolved`], `oracle.resolved_option
//!   = opt`.
//! * [`Plurality::Tie`] → [`Phase::InvalidDeadend`].
//! * [`Plurality::NoSurvivors`] (every proposer disqualified) →
//!   [`Phase::InvalidDeadend`].
//!
//! # One-shot (NOT incremental)
//! Unlike `finalize_facts` / `finalize_ai_claims`, the plurality needs the WHOLE
//! surviving set at once, so finalize_oracle is one-shot: the caller must pass
//! every proposer account in a single transaction (`tail.len() ==
//! proposer_count`). The full set is therefore bounded by Solana's per-tx
//! account-lock limit — fine, since a dispute's proposer set is small. The
//! survivor votes are gathered into a fixed stack buffer (no heap, matching the
//! rest of the program); [`MAX_PROPOSERS`] caps it well above any single-tx set.
//!
//! # Gating
//! * [`Phase::Challenge`] (the only entry; `FinalRecompute` is reserved/unused —
//!   we transition Challenge → terminal directly).
//! * `now >= phase_ends_at` (the challenge window has closed).
//! * `oracle.open_challenge_count == 0` — every challenged claim has been settled
//!   by `settle_challenge`; otherwise a challenged-but-unsettled proposer is not
//!   yet disqualified and would be wrongly counted as surviving
//!   ([`KassandraError::ChallengesOutstanding`]).
//!
//! # Consistency guards
//! * `tail.len() == proposer_count` and each account is distinct, program-owned,
//!   tagged [`AccountType::Proposer`], and belongs to THIS oracle — so the full
//!   proposer set is provably present.
//! * The number of non-disqualified proposers collected MUST equal
//!   `oracle.surviving_count` — a state-consistency check that also confirms no
//!   survivor was omitted. A mismatch is [`KassandraError::InvalidAccount`].
//! * A non-disqualified proposer with `claim_option == CLAIM_OPTION_NONE` is an
//!   invariant violation (a no-show is disqualified in `finalize_ai_claims`
//!   before this point), rejected as [`KassandraError::InvalidAccount`].
//!
//! # Idempotency
//! Runs exactly once: the phase becomes terminal (Resolved / InvalidDeadend), so
//! a second call fails `require_phase(Challenge)` with
//! [`KassandraError::WrongPhase`].
//!
//! # No token CPI / deferred settlement (design §7)
//! Like every instruction in this milestone, finalize_oracle performs NO token
//! CPI: it records the terminal phase + result only. Physical settlement —
//! returning surviving bonds, returning all bonds/stakes on InvalidDeadend,
//! reward distribution from `bond_pool`, and AiClaim-account rent reclamation
//! (the design's "close AiClaim accounts on resolution") — is a DEFERRED later
//! task, consistent with `finalize_facts`/`finalize_ai_claims`/`settle_challenge`
//! treating `bond_pool` as a counter. Account closure, when built, will be a
//! SEPARATE permissionless per-claim instruction (callable post-resolution): it
//! has the same one-tx capacity concern as finalize, so it must not be crammed
//! into this recompute, and finalize must not block on it.
//!
//! # Accounts
//! 0. oracle — writable, owned by this program.
//! 1. onward — the FULL proposer set: exactly `proposer_count` accounts, each
//!    writable, owned by this program, tagged Proposer, belonging to this oracle,
//!    distinct within the call.
//!
//! # Instruction payload
//! Empty (after the 1-byte discriminant).

use pinocchio::{
    account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey, ProgramResult,
};

use crate::{
    clock::{now, require_after_end, require_phase},
    error::KassandraError,
    plurality::{plurality, Plurality},
    processor::guards::{load_oracle, load_proposer},
    state::{Oracle, Phase, CLAIM_OPTION_NONE},
};

/// Upper bound on the proposer set finalize_oracle will gather votes for. The
/// real bound is Solana's per-tx account-lock limit (well under this); the
/// buffer is sized generously so the cap is never the limiting factor.
const MAX_PROPOSERS: usize = 256;

/// Reject if `key` appears in `prior` (distinctness within the call).
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

    require_phase(&oracle, Phase::Challenge)?;
    let now = now()?;
    require_after_end(&oracle, now)?;

    // Every challenged claim must have settled, else an unsettled (and thus
    // not-yet-disqualified) challenged proposer would be miscounted as surviving.
    if oracle.open_challenge_count != 0 {
        return Err(KassandraError::ChallengesOutstanding.into());
    }

    // One-shot: the FULL proposer set must be supplied in this single call.
    if tail.len() != oracle.proposer_count as usize {
        return Err(KassandraError::InvalidAccount.into());
    }
    if tail.len() > MAX_PROPOSERS {
        // Unreachable within a single transaction's account-lock limit;
        // defensive so the fixed votes buffer can never overflow.
        return Err(KassandraError::InvalidAccount.into());
    }

    // Gather the surviving proposers' claim_options (one proposer = one vote).
    let mut votes = [0u8; MAX_PROPOSERS];
    let mut n = 0usize;
    for (i, p_ai) in tail.iter().enumerate() {
        require_distinct(&tail[..i], p_ai.key())?;

        let proposer = load_proposer(p_ai, program_id)?;
        if proposer.oracle != *oracle_ai.key() {
            return Err(KassandraError::InvalidAccount.into());
        }
        if proposer.is_disqualified() {
            continue;
        }
        // A surviving proposer always carries a real claim_option (no-shows were
        // disqualified in finalize_ai_claims). CLAIM_OPTION_NONE here is an
        // invariant violation, never a vote for option 0xFF.
        if proposer.claim_option == CLAIM_OPTION_NONE {
            return Err(KassandraError::InvalidAccount.into());
        }
        votes[n] = proposer.claim_option;
        n += 1;
    }

    // Consistency: the survivors counted must match the oracle's running tally.
    // This also proves no surviving proposer was omitted from the call.
    if n != oracle.surviving_count as usize {
        return Err(KassandraError::InvalidAccount.into());
    }

    match plurality(&votes[..n]) {
        Plurality::Winner(opt) => {
            oracle.resolved_option = opt;
            oracle.set_phase(Phase::Resolved);
        }
        // A tie has no plurality winner, and zero survivors means every proposer
        // was disqualified: both are terminal dead-ends (design §7).
        Plurality::Tie | Plurality::NoSurvivors => {
            oracle.set_phase(Phase::InvalidDeadend);
        }
    }

    let mut data = oracle_ai.try_borrow_mut_data()?;
    data[..Oracle::LEN].copy_from_slice(bytemuck::bytes_of(&oracle));
    Ok(())
}
