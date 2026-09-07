//! Instruction wire format.
//!
//! The first byte of `instruction_data` is the discriminant selecting an
//! [`Ix`] variant; the remaining bytes are that instruction's payload (parsed
//! by the individual processors, not here).
//!
//! Discriminants are a **stable public contract** and are never renumbered.
//! New instructions are APPENDED with the next free discriminant, so
//! [`Ix::from_u8`] stays trivial to extend.

/// Instruction discriminants for the Kassandra dispute-core program.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Ix {
    SubmitFact = 0,
    VoteFact = 1,
    FinalizeFacts = 2,
    SubmitAiClaim = 3,
    OpenChallenge = 4,
    SettleChallenge = 5,
    FinalizeOracle = 6,
    /// Permissionless `FactProposal -> FactVoting` freeze once the proposal
    /// window has elapsed.
    AdvancePhase = 7,
    /// Incremental settlement of the AI-claim round once its window has elapsed
    /// (slash no-shows fully, flippers partially), advancing to `Challenge`.
    FinalizeAiClaims = 8,
    /// One-time protocol initializer: creates the `[b"protocol"]` singleton
    /// recording the admin + canonical SOL/USDC mints. Stable contract.
    InitProtocol = 9,
    /// Create an oracle in [`crate::state::Phase::Proposal`] with a future
    /// deadline plus its program-controlled stake vault (SOL token account at
    /// PDA `[b"vault", oracle]`, authority = oracle PDA). No fee yet (Task H2).
    CreateOracle = 10,
    /// Register a proposal against an oracle in [`crate::state::Phase::Proposal`]
    /// after its `deadline`: a categorical `option` + a SOL `bond` escrowed into
    /// the oracle's stake vault, creating one `Proposer` PDA per (oracle,
    /// authority). Enforces the `MAX_PROPOSERS` cap on-chain.
    Propose = 11,
    /// At the proposal-window end, finalize an oracle in
    /// [`crate::state::Phase::Proposal`]: if every proposer agrees, resolve it
    /// ([`crate::state::Phase::Resolved`] + `resolved_option`); if any conflict,
    /// open the dispute by setting `dispute_bond_total = total_oracle_stake` and
    /// advancing to [`crate::state::Phase::FactProposal`] (the dispute-core seam).
    FinalizeProposals = 12,
    /// One-time DAO-linkage handoff (Task F1): records `dao_authority` (the
    /// Squads v4 multisig vault PDA) + `spot_dao` (the futarchy `Dao` account)
    /// into the `Protocol`. Gated to `Protocol.admin` while `governance_set ==
    /// 0`; once set, only the current `dao_authority` may rotate it (so
    /// governance can rotate itself after handoff).
    SetGovernance = 13,
    /// DAO-gated retune of the `Protocol`-resident governable params (Task F3):
    /// overwrites the monetary + behavioral config fields wholesale from a
    /// fixed 144-byte payload, bounds-checked. Gated to `Protocol.dao_authority`
    /// (signer). Does NOT touch existing oracles (their snapshots are frozen);
    /// subsequently-created oracles snapshot the new values.
    SetConfig = 14,
    /// DAO-gated resolution of a dead-ended oracle (Task F4): sets a final
    /// `resolved_option` and advances an oracle from
    /// [`crate::state::Phase::InvalidDeadend`] to
    /// [`crate::state::Phase::Resolved`]. Gated to `Protocol.dao_authority`
    /// (signer). Economic settlement of the dead-end is DEFERRED to the
    /// settlement milestone; this only stamps the terminal outcome.
    ResolveDeadend = 15,
    /// Governance-anchored SOL/USDC spot TWAP read (Task F5): reads the futarchy
    /// `Dao` account's embedded spot `TwapOracle` (asserting the account ==
    /// `Protocol.spot_dao` + owned by the futarchy program) and returns the
    /// `u128` TWAP (LE) via `set_return_data`. Read-only; no state change. Thin
    /// wrapper over [`crate::price::spot_price`]; no on-chain consumer yet (the
    /// challenge-market rework consumes it next milestone).
    SpotPrice = 16,
    /// Permissionless claim-and-close for ONE proposer after the oracle is
    /// terminal (Task S2): transfers the proposer's SOL entitlement (bond
    /// return ± slash, plus the cohort reward on a correct claim) from the
    /// stake vault to the proposer-authority's SOL account, then CLOSES the
    /// `Proposer` account (rent → its authority). Idempotent by closure.
    ClaimProposer = 17,
    /// Permissionless claim-and-close for ONE fact submitter (Task S2): transfers
    /// the submitter's SOL entitlement (full stake return + fact reward when
    /// agreed; stake when duplicate; 0 when rejected) from the stake vault to the
    /// submitter's SOL account, then CLOSES the `Fact` account (rent → the
    /// submitter). Idempotent by closure.
    ClaimFact = 18,
    /// Permissionless claim-and-close for ONE fact vote (Task S2): transfers the
    /// voter's SOL entitlement (stake + reward for an approve vote on an agreed
    /// fact; the un-slashed remainder for an approve vote on a rejected fact;
    /// full stake for a duplicate vote or on `InvalidDeadend`) from the stake
    /// vault to the voter's SOL account, then CLOSES the `FactVote` account
    /// (rent → the voter). Idempotent by closure.
    ClaimFactVote = 19,
    /// Permissionless rent-reclaim close for ONE `AiClaim` after the oracle is
    /// terminal (Task S4): the `AiClaim` holds no tokens, so this only drains its
    /// rent lamports to `ai_claim.authority` (stamped at submit) and CLOSES it.
    /// Order-INDEPENDENT — it does not load the `Proposer`, so it works whether or
    /// not `claim_proposer` has already run. Idempotent by closure.
    CloseAiClaim = 20,
    /// Permissionless rent-reclaim close for ONE settled challenge `Market` +
    /// its `challenger_usdc_vault` escrow (Task S4): once the oracle is terminal
    /// AND `market.settled == 1` AND the escrow balance is 0 (settle_challenge
    /// drained it), closes the escrow token account (SPL `CloseAccount`, oracle-PDA
    /// signed) and the `Market` PDA, both reclaiming rent to `market.challenger`.
    /// Idempotent by closure.
    CloseMarket = 21,
    /// Permissionless grace-gated dust sweep + terminal-account closure for ONE
    /// oracle (Task SW1): once the oracle is terminal AND `now >=
    /// oracle.phase_ends_at + config::SWEEP_GRACE`, transfers the ENTIRE residual
    /// `stake_vault` SOL (bounded rounding dust — or a no-show staker's
    /// forfeited principal) to the DAO treasury (the SOL ATA of
    /// `Protocol.dao_authority`, oracle-PDA signed), then CLOSES the `stake_vault`
    /// (SPL `CloseAccount`) and the `Oracle` PDA, reclaiming both rents to
    /// `oracle.creator`. Requires governance to be set. Idempotent by closure.
    SweepOracle = 22,
    /// Write the oracle's off-chain-authored but ON-CHAIN metadata — the
    /// plaintext subject + option labels + a `uri`/`uri_hash` for the extended
    /// JSON — into the companion `[b"oracle_meta", oracle]` PDA (sized to fit,
    /// write-once). Lets other programs read the subject/options without our
    /// indexer; the PDA's rent is reclaimed at `sweep_oracle`.
    WriteOracleMeta = 23,
    /// Record an [`crate::state::ErSession`] for this oracle and, when the
    /// remaining-account MagicBlock set is present, CPI the Delegation Program
    /// so the oracle PDA can execute on an Ephemeral Rollup.
    DelegateOracle = 24,
    /// Stamp a commit on the `ErSession` (and optionally CPI Magic Program
    /// `schedule_commit` when remaining accounts are present). Called on the ER.
    CommitOracle = 25,
    /// Mark the `ErSession` undelegated (and optionally CPI commit-and-undelegate).
    /// Called on the ER; the validator later callbacks with the 8-byte
    /// MagicBlock undelegate discriminator.
    UndelegateOracle = 26,
    /// DAO-gated create-or-update of the `[b"ai_oracle_config"]` singleton:
    /// pusher `authority`, `max_staleness_slots`, `source`, `enabled`.
    SetAiOracleConfig = 27,
    /// Authority-gated write of `[b"ai_feed", oracle]`. The program stamps
    /// `Clock.slot` / `Clock.unix_timestamp`; the pusher supplies the
    /// categorical option + opaque commitment hashes + attestation.
    PushAiOracleFeed = 28,
    /// In `Phase::AiClaim`, create this proposer's `AiClaim` from the live
    /// `AiOracleFeed` (one proposer per tx). Replaces the in-house runner as
    /// the protocol's source of truth when the feed is enabled.
    ApplyExternalAiClaim = 29,
    // Future variants are APPENDED here with the next discriminant; add a
    // matching arm to `from_u8` below.
}

impl Ix {
    /// Decode the leading discriminant byte into an [`Ix`], or `None` if it
    /// does not correspond to a known instruction.
    pub fn from_u8(x: u8) -> Option<Self> {
        match x {
            0 => Some(Ix::SubmitFact),
            1 => Some(Ix::VoteFact),
            2 => Some(Ix::FinalizeFacts),
            3 => Some(Ix::SubmitAiClaim),
            4 => Some(Ix::OpenChallenge),
            5 => Some(Ix::SettleChallenge),
            6 => Some(Ix::FinalizeOracle),
            7 => Some(Ix::AdvancePhase),
            8 => Some(Ix::FinalizeAiClaims),
            9 => Some(Ix::InitProtocol),
            10 => Some(Ix::CreateOracle),
            11 => Some(Ix::Propose),
            12 => Some(Ix::FinalizeProposals),
            13 => Some(Ix::SetGovernance),
            14 => Some(Ix::SetConfig),
            15 => Some(Ix::ResolveDeadend),
            16 => Some(Ix::SpotPrice),
            17 => Some(Ix::ClaimProposer),
            18 => Some(Ix::ClaimFact),
            19 => Some(Ix::ClaimFactVote),
            20 => Some(Ix::CloseAiClaim),
            21 => Some(Ix::CloseMarket),
            22 => Some(Ix::SweepOracle),
            23 => Some(Ix::WriteOracleMeta),
            24 => Some(Ix::DelegateOracle),
            25 => Some(Ix::CommitOracle),
            26 => Some(Ix::UndelegateOracle),
            27 => Some(Ix::SetAiOracleConfig),
            28 => Some(Ix::PushAiOracleFeed),
            29 => Some(Ix::ApplyExternalAiClaim),
            _ => None,
        }
    }
}
