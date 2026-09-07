//! Small, shared account-validation helpers used by instruction processors.
//!
//! Kept deliberately minimal — only the checks the current processors need.

use pinocchio::{
    account::AccountView as AccountInfo,
    address::Address as Pubkey,
    cpi::{Seed, Signer},
    error::ProgramError,
    ProgramResult,
};
use pinocchio_system::instructions::{Allocate, Assign, CreateAccount, Transfer};
use pinocchio_token::instructions::InitializeAccount3;
use pinocchio_token::state::Account as TokenAccount;

use crate::{
    error::KassandraError,
    state::{
        AccountType, AiClaim, AiOracleConfig, AiOracleFeed, ErSession, Fact, Oracle, Phase,
        Proposer, Protocol,
    },
};

/// The canonical `[b"protocol"]` singleton PDA (bump 255) for this program id.
/// Hardcoded so [`load_protocol`] validates the singleton with a cheap key
/// comparison instead of a ~1476-CU `find_program_address` on the hot path
/// (`create_oracle` et al.). Guarded against drift by the `protocol_pda_const`
/// integration test, which re-derives it.
pub const PROTOCOL_PDA: Pubkey =
    Pubkey::from_str_const("DUpkpXThaPjDS7TtwwdMJHam7Ki6a8Fg9bmvNf5ggMn6");

/// Canonical bump for [`PROTOCOL_PDA`] (`init_protocol` signs the create with it
/// instead of deriving via `find_program_address`). Guarded by the same test.
pub const PROTOCOL_BUMP: u8 = 255;

/// Require that `account` is owned by `program_id`, else
/// [`KassandraError::InvalidAccount`].
pub fn assert_owned_by_program(account: &AccountInfo, program_id: &Pubkey) -> ProgramResult {
    if !account.owned_by(program_id) {
        return Err(KassandraError::InvalidAccount.into());
    }
    Ok(())
}

/// Require that `account` signed the transaction, else
/// [`KassandraError::Unauthorized`].
pub fn assert_signer(account: &AccountInfo) -> ProgramResult {
    if !account.is_signer() {
        return Err(KassandraError::Unauthorized.into());
    }
    Ok(())
}

/// Require that `signer_ai` BOTH signed the transaction AND is the protocol's
/// recorded `dao_authority` (the Squads v4 multisig vault PDA), else
/// [`KassandraError::Unauthorized`]. This is the shared gate for the privileged
/// governance instructions (`set_config` (F3), `resolve_deadend` (F4)): a passed
/// v0.6 futarchy proposal executes through the Squads vault, which signs as this
/// `dao_authority`. Before `set_governance` records it, `dao_authority` is zero,
/// so no real signer matches and the gate denies (no separate "unset" check
/// needed).
pub fn assert_dao_authority(protocol: &Protocol, signer_ai: &AccountInfo) -> ProgramResult {
    assert_signer(signer_ai)?;
    if signer_ai.address() != &protocol.dao_authority {
        return Err(KassandraError::Unauthorized.into());
    }
    Ok(())
}

/// Require that `account`'s key equals `expected`, else
/// [`KassandraError::InvalidAccount`]. Used to pin sysvar/program ids and
/// stored references (e.g. `oracle.stake_vault`).
pub fn assert_key(account: &AccountInfo, expected: &Pubkey) -> ProgramResult {
    if account.address() != expected {
        return Err(KassandraError::InvalidAccount.into());
    }
    Ok(())
}

/// Move ALL lamports out of `from` into `to` (both must be writable), leaving
/// `from` at zero. The shared rent-reclaim primitive for the permissionless
/// closers (`close_market`, `close_ai_claim`, `sweep_oracle`, the claim
/// finalizers): drain first, then `AccountInfo::close` the emptied PDA. A
/// recipient overflow is a hard [`ProgramError::ArithmeticOverflow`].
pub fn drain_lamports(from: &mut AccountInfo, to: &mut AccountInfo) -> ProgramResult {
    let amount = from.lamports();
    let credited = to
        .lamports()
        .checked_add(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    to.set_lamports(credited);
    from.set_lamports(0);
    Ok(())
}

/// Load and validate an [`Oracle`] account: it must be owned by `program_id`,
/// large enough, and carry the [`AccountType::Oracle`] tag. Rejecting on the
/// tag is the type-confusion fix — a `Fact`/`Proposer`/etc. fed into the oracle
/// slot fails here. Returns an owned, alignment-safe copy.
pub fn load_oracle(account: &AccountInfo, program_id: &Pubkey) -> Result<Oracle, ProgramError> {
    assert_owned_by_program(account, program_id)?;
    if account.data_len() < Oracle::LEN {
        return Err(KassandraError::InvalidAccount.into());
    }
    let oracle: Oracle = {
        let data = account.try_borrow()?;
        bytemuck::pod_read_unaligned::<Oracle>(&data[..Oracle::LEN])
    };
    if oracle.account_type != AccountType::Oracle.as_u8() {
        return Err(KassandraError::InvalidAccount.into());
    }
    Ok(oracle)
}

/// Load and validate a [`Fact`] account: it must be owned by `program_id`,
/// large enough, and carry the [`AccountType::Fact`] tag (the type-confusion
/// guard, mirroring [`load_oracle`]). Returns an owned, alignment-safe copy.
pub fn load_fact(account: &AccountInfo, program_id: &Pubkey) -> Result<Fact, ProgramError> {
    assert_owned_by_program(account, program_id)?;
    if account.data_len() < Fact::LEN {
        return Err(KassandraError::InvalidAccount.into());
    }
    let fact: Fact = {
        let data = account.try_borrow()?;
        bytemuck::pod_read_unaligned::<Fact>(&data[..Fact::LEN])
    };
    if fact.account_type != AccountType::Fact.as_u8() {
        return Err(KassandraError::InvalidAccount.into());
    }
    Ok(fact)
}

/// Load and validate a [`Proposer`] account: it must be owned by `program_id`,
/// large enough, and carry the [`AccountType::Proposer`] tag (the type-confusion
/// guard, mirroring [`load_oracle`]/[`load_fact`]). Returns an owned,
/// alignment-safe copy.
pub fn load_proposer(account: &AccountInfo, program_id: &Pubkey) -> Result<Proposer, ProgramError> {
    assert_owned_by_program(account, program_id)?;
    if account.data_len() < Proposer::LEN {
        return Err(KassandraError::InvalidAccount.into());
    }
    let proposer: Proposer = {
        let data = account.try_borrow()?;
        bytemuck::pod_read_unaligned::<Proposer>(&data[..Proposer::LEN])
    };
    if proposer.account_type != AccountType::Proposer.as_u8() {
        return Err(KassandraError::InvalidAccount.into());
    }
    Ok(proposer)
}

/// Load and validate an [`AiClaim`] account: owned by `program_id`, large
/// enough, and tagged [`AccountType::AiClaim`] (the type-confusion guard,
/// mirroring [`load_oracle`]). Returns an owned, alignment-safe copy.
pub fn load_ai_claim(account: &AccountInfo, program_id: &Pubkey) -> Result<AiClaim, ProgramError> {
    assert_owned_by_program(account, program_id)?;
    if account.data_len() < AiClaim::LEN {
        return Err(KassandraError::InvalidAccount.into());
    }
    let claim: AiClaim = {
        let data = account.try_borrow()?;
        bytemuck::pod_read_unaligned::<AiClaim>(&data[..AiClaim::LEN])
    };
    if claim.account_type != AccountType::AiClaim.as_u8() {
        return Err(KassandraError::InvalidAccount.into());
    }
    Ok(claim)
}

/// Load and validate an [`ErSession`] companion PDA.
pub fn load_er_session(
    account: &AccountInfo,
    program_id: &Pubkey,
) -> Result<ErSession, ProgramError> {
    assert_owned_by_program(account, program_id)?;
    if account.data_len() < ErSession::LEN {
        return Err(KassandraError::InvalidAccount.into());
    }
    let session: ErSession = {
        let data = account.try_borrow()?;
        bytemuck::pod_read_unaligned::<ErSession>(&data[..ErSession::LEN])
    };
    if session.account_type != AccountType::ErSession.as_u8() {
        return Err(KassandraError::InvalidAccount.into());
    }
    Ok(session)
}

/// Load and validate the [`AiOracleConfig`] singleton.
pub fn load_ai_oracle_config(
    account: &AccountInfo,
    program_id: &Pubkey,
) -> Result<AiOracleConfig, ProgramError> {
    assert_owned_by_program(account, program_id)?;
    if account.data_len() < AiOracleConfig::LEN {
        return Err(KassandraError::InvalidAccount.into());
    }
    let cfg: AiOracleConfig = {
        let data = account.try_borrow()?;
        bytemuck::pod_read_unaligned::<AiOracleConfig>(&data[..AiOracleConfig::LEN])
    };
    if cfg.account_type != AccountType::AiOracleConfig.as_u8() {
        return Err(KassandraError::InvalidAccount.into());
    }
    Ok(cfg)
}

/// Load and validate an [`AiOracleFeed`] companion PDA.
pub fn load_ai_oracle_feed(
    account: &AccountInfo,
    program_id: &Pubkey,
) -> Result<AiOracleFeed, ProgramError> {
    assert_owned_by_program(account, program_id)?;
    if account.data_len() < AiOracleFeed::LEN {
        return Err(KassandraError::InvalidAccount.into());
    }
    let feed: AiOracleFeed = {
        let data = account.try_borrow()?;
        bytemuck::pod_read_unaligned::<AiOracleFeed>(&data[..AiOracleFeed::LEN])
    };
    if feed.account_type != AccountType::AiOracleFeed.as_u8() {
        return Err(KassandraError::InvalidAccount.into());
    }
    Ok(feed)
}

/// Load and validate the [`Protocol`] singleton: its address must be the
/// canonical `[b"protocol"]` PDA, owned by `program_id`, large enough, and
/// tagged [`AccountType::Protocol`] (the type-confusion guard, mirroring
/// [`load_oracle`]). Pinning the singleton address against the precomputed
/// [`PROTOCOL_PDA`] means a future second Protocol-typed account can never be
/// substituted for the real one — every caller (`create_oracle` et al.) gets
/// that defense for free.
/// Returns an owned, alignment-safe copy.
pub fn load_protocol(account: &AccountInfo, program_id: &Pubkey) -> Result<Protocol, ProgramError> {
    // Compare against the precomputed singleton address — the `[b"protocol"]` PDA
    // is fixed for this program id, so we skip the `find_program_address` syscall.
    assert_key(account, &PROTOCOL_PDA)?;
    assert_owned_by_program(account, program_id)?;
    if account.data_len() < Protocol::LEN {
        return Err(KassandraError::InvalidAccount.into());
    }
    let protocol: Protocol = {
        let data = account.try_borrow()?;
        bytemuck::pod_read_unaligned::<Protocol>(&data[..Protocol::LEN])
    };
    if protocol.account_type != AccountType::Protocol.as_u8() {
        return Err(KassandraError::InvalidAccount.into());
    }
    Ok(protocol)
}

/// Create a fresh, rent-exempt, program-owned PDA account, signing with the
/// PDA's `seeds` + `bump`. `payer` funds the rent. De-dups the `CreateAccount`
/// CPI boilerplate shared by every account-creating processor.
pub fn create_pda(
    payer: &AccountInfo,
    pda: &AccountInfo,
    seeds: &[Seed],
    lamports: u64,
    space: usize,
    owner: &Pubkey,
) -> ProgramResult {
    let signer = Signer::from(seeds);
    CreateAccount {
        from: payer,
        to: pda,
        lamports,
        space: space as u64,
        owner,
    }
    .invoke_signed(&[signer])
}

/// Create-or-adopt a program-owned PDA DATA account, tolerating a pre-funded
/// (system-owned) account that a bare [`create_pda`]/`CreateAccount` would reject.
/// A PDA's address is deterministic, so an attacker can grief a specific
/// registration (proposer/fact/vote) forever by sending 1 lamport to it first;
/// adoption defeats that. Tops the balance up to rent-exempt (only if short), then
/// PDA-signs `Allocate`+`Assign`. A system-owned pre-funded account carries no data
/// and can only be `Allocate`d by the PDA signer, so adoption always succeeds.
///
/// The CALLER MUST first reject an ALREADY-registered account by OWNERSHIP
/// (program-owned ⇒ duplicate); this only stands up an empty/system-owned slot.
pub fn create_or_adopt_pda(
    payer: &AccountInfo,
    pda: &AccountInfo,
    seeds: &[Seed],
    lamports: u64,
    space: usize,
    owner: &Pubkey,
) -> ProgramResult {
    let current = pda.lamports();
    if current < lamports {
        Transfer {
            from: payer,
            to: pda,
            lamports: lamports - current,
        }
        .invoke()?;
    }
    Allocate {
        account: pda,
        space: space as u64,
    }
    .invoke_signed(&[Signer::from(seeds)])?;
    Assign { account: pda, owner }.invoke_signed(&[Signer::from(seeds)])?;
    Ok(())
}

/// Create-or-adopt an SPL token account PDA whose token authority is `token_owner`
/// on `mint` — the token-account sibling of [`create_or_adopt_pda`] (same
/// pre-funding-grief resistance). If the account is ALREADY our initialized token
/// account (token-program owned, matching mint + authority) this is a no-op; if it
/// is token-program owned but NOT ours it is rejected. Otherwise: top up to
/// rent-exempt, PDA-sign `Allocate`+`Assign` to the token program, then
/// `InitializeAccount3`.
pub fn create_or_adopt_token_account(
    payer: &AccountInfo,
    account: &AccountInfo,
    mint: &AccountInfo,
    token_owner: &Pubkey,
    seeds: &[Seed],
    rent: u64,
) -> ProgramResult {
    if account.owned_by(&pinocchio_token::ID) {
        if let Ok(tok) = TokenAccount::from_account_view(account) {
            if tok.mint() == mint.address() && tok.owner() == token_owner {
                return Ok(());
            }
            return Err(KassandraError::InvalidAccount.into());
        }
    }
    let current = account.lamports();
    if current < rent {
        Transfer {
            from: payer,
            to: account,
            lamports: rent - current,
        }
        .invoke()?;
    }
    Allocate {
        account,
        space: TokenAccount::LEN as u64,
    }
    .invoke_signed(&[Signer::from(seeds)])?;
    Assign {
        account,
        owner: &pinocchio_token::ID,
    }
    .invoke_signed(&[Signer::from(seeds)])?;
    InitializeAccount3 {
        account,
        mint,
        owner: token_owner,
    }
    .invoke()?;
    Ok(())
}

/// Reject if `key` already appears in `prior` — enforces distinctness within a
/// single instruction's account tail (no proposer/fact counted twice).
pub fn require_distinct(prior: &[AccountInfo], key: &Pubkey) -> ProgramResult {
    for a in prior {
        if a.address() == key {
            return Err(KassandraError::InvalidAccount.into());
        }
    }
    Ok(())
}

/// Validate that `oracle_ai` is the canonical `[b"oracle", nonce_le]` PDA, using
/// the oracle's OWN stored bump (written at creation) — one
/// `create_program_address` instead of a looping `find_program_address`. The PDA
/// is the SPL authority of the oracle's vaults, so its seeds sign token moves.
pub fn verify_oracle_pda(
    program_id: &Pubkey,
    oracle_ai: &AccountInfo,
    oracle: &Oracle,
    nonce: u64,
) -> ProgramResult {
    let nonce_le = nonce.to_le_bytes();
    let derived =
        Pubkey::create_program_address(&[b"oracle", &nonce_le, &[oracle.bump]], program_id)
            .map_err(|_| KassandraError::InvalidAccount)?;
    if &derived != oracle_ai.address() {
        return Err(KassandraError::InvalidAccount.into());
    }
    Ok(())
}

/// Assert `account` is an SPL token account on `expected_mint` owned by
/// `expected_owner`. Loads it via [`TokenAccount::from_account_info`] (which pins
/// the token-program owner + the 165-byte length), then compares the mint/owner —
/// the canonical SPL layout, not hand-rolled byte offsets.
pub fn assert_token_account(
    account: &AccountInfo,
    expected_mint: &Pubkey,
    expected_owner: &Pubkey,
) -> ProgramResult {
    let token =
        TokenAccount::from_account_view(account).map_err(|_| KassandraError::InvalidAccount)?;
    if token.mint() != expected_mint || token.owner() != expected_owner {
        return Err(KassandraError::InvalidAccount.into());
    }
    Ok(())
}

/// Require the oracle to be in a TERMINAL phase ([`Phase::Resolved`] or
/// [`Phase::InvalidDeadend`]) — the gate every post-resolution instruction
/// (claims, sweep, closes) shares. Non-terminal → [`KassandraError::WrongPhase`].
pub fn require_terminal(oracle: &Oracle) -> ProgramResult {
    match oracle.phase().ok_or(KassandraError::InvalidAccount)? {
        Phase::Resolved | Phase::InvalidDeadend => Ok(()),
        _ => Err(KassandraError::WrongPhase.into()),
    }
}
