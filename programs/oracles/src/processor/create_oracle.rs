//! `create_oracle`: stand up a new oracle in [`Phase::Proposal`] with a future
//! `deadline` plus its program-controlled stake vault.
//!
//! The stake vault is an SPL token account on the canonical SOL mint, created
//! at PDA `[b"vault", oracle]` and program-signed; its SPL authority is the
//! oracle PDA, so later instructions (`propose`/`open_challenge`/...) can sign
//! transfers out of it via the oracle seeds. The canonical mints are pinned from
//! the [`Protocol`] singleton, so an oracle cannot be created against a spoofed
//! SOL mint (this is what makes the Task H2 fee-burn trustworthy).
//!
//! # Creation fee (Task H2 / design §8)
//! A SOL fee proportional to an EMA of recent creation activity is BURNED from
//! the creator's SOL token account. The [`Protocol`] carries the fixed-point
//! `fee_ema` accumulator: on each creation we decay it toward 0 by the elapsed
//! idle time, charge `fee = FEE_PER_EMA_UNIT * decayed_ema / FEE_EMA_SCALE`,
//! burn it (creator signs as the burn authority), then bump the EMA by one
//! creation unit and stamp `last_creation_unix`. The first-ever creation has
//! `fee_ema == 0` → fee 0 (genesis is free). See [`crate::fee`] / [`crate::config`].
//!
//! # PDA seeds (CONTRACT)
//! * Oracle: `[b"oracle", &nonce.to_le_bytes()]`, program = [`crate::ID`].
//! * Stake vault: `[b"vault", oracle_pubkey]`, program = [`crate::ID`].
//!
//! There is **no native-token emission**. Bonds, stakes, and the creation fee
//! are denominated in the canonical `base_mint` (wrapped SOL). `Oracle.reward_emission`
//! stays in the Pod layout (pinned) but is always recorded as 0 — SOL/USDC cannot
//! be minted by this program. The 10th account (historically the mint-authority
//! PDA) is accepted and ignored so the create_oracle account list stays stable.
//!
//! # Accounts
//! 0. protocol            — writable; pins the canonical mints + holds/updates `fee_ema`
//! 1. oracle PDA          — writable, uninitialized (created here)
//! 2. stake_vault PDA     — writable, uninitialized (created + initialized here)
//! 3. creator             — signer, writable; pays rent, recorded as `creator`, burn authority
//! 4. base_mint           — writable (fee burn decrements supply); == `protocol.base_mint`
//! 5. usdc_mint           — must equal `protocol.usdc_mint`
//! 6. token program
//! 7. system program
//! 8. creator_base_token  — writable; SOL token account on `base_mint` the fee is burned from
//! 9. mint_authority PDA  — unused (kept so the account list stays a stable contract)
//!
//! # Instruction payload (after the 1-byte discriminant), exactly 57 bytes
//! `nonce: u64 LE` ++ `options_count: u8` ++ `deadline: i64 LE` ++
//! `twap_window: i64 LE`. (The former `prompt_hash` was removed — the plaintext
//! subject now lives on-chain in the companion `oracle_meta` account.)

use bytemuck::Zeroable;
use pinocchio::{
    account::AccountView as AccountInfo,
    address::Address as Pubkey,
    cpi::Seed,
    error::ProgramError,
    ProgramResult,
};
use pinocchio_token::instructions::{Burn, InitializeAccount3};
use pinocchio_token::state::Account as TokenAccount;

use crate::{
    clock::now,
    error::KassandraError,
    fee::{bumped_fee_ema, creation_fee, decay_fee_ema},
    processor::guards::{assert_key, assert_signer, create_pda, load_protocol},
    rent::minimum_rent,
    state::{AccountType, Oracle, Phase, Protocol},
};

/// Exact payload length: nonce[8] ++ options_count[1] ++ deadline[8] ++
/// twap_window[8].
const PAYLOAD_LEN: usize = 25;

pub fn process(program_id: &Pubkey, accounts: &mut [AccountInfo], payload: &[u8]) -> ProgramResult {
    // --- payload parse (exact length) --------------------------------------
    if payload.len() != PAYLOAD_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    let nonce = u64::from_le_bytes(payload[0..8].try_into().unwrap());
    let options_count = payload[8];
    let deadline = i64::from_le_bytes(payload[9..17].try_into().unwrap());
    let twap_window = i64::from_le_bytes(payload[17..25].try_into().unwrap());

    let [protocol_ai, oracle_ai, stake_vault_ai, creator_ai, base_mint_ai, usdc_mint_ai, token_prog_ai, system_prog_ai, creator_base_ai, _mint_authority_ai, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // --- signer + program ids ----------------------------------------------
    assert_signer(creator_ai)?;
    assert_key(token_prog_ai, &pinocchio_token::ID)?;
    assert_key(system_prog_ai, &pinocchio_system::ID)?;

    // --- canonical mints pinned from the protocol singleton ----------------
    let protocol = load_protocol(protocol_ai, program_id)?;
    assert_key(base_mint_ai, &protocol.base_mint)?;
    assert_key(usdc_mint_ai, &protocol.usdc_mint)?;

    // --- semantic validations ----------------------------------------------
    let now_ts = now()?;
    if options_count < 2 {
        return Err(KassandraError::InvalidOptionsCount.into());
    }
    if deadline < now_ts {
        return Err(KassandraError::InvalidDeadline.into());
    }
    if twap_window <= 0 {
        return Err(ProgramError::InvalidInstructionData);
    }

    // --- PDA derivations ----------------------------------------------------
    let nonce_le = nonce.to_le_bytes();
    let (expected_oracle, oracle_bump) =
        Pubkey::find_program_address(&[b"oracle", &nonce_le], program_id);
    assert_key(oracle_ai, &expected_oracle)?;

    let (expected_vault, vault_bump) =
        Pubkey::find_program_address(&[b"vault", oracle_ai.address().as_ref()], program_id);
    assert_key(stake_vault_ai, &expected_vault)?;

    // Reject if the oracle PDA already exists (a duplicate nonce).
    if oracle_ai.lamports() != 0 || !oracle_ai.is_data_empty() {
        return Err(KassandraError::InvalidAccount.into());
    }

    // No native-token minting: reward_emission is always 0. The creation fee is
    // the linear demand fee only (`creation_fee(0, ema) == fee_for_ema(ema)`).
    let reward_emission = 0u64;

    // --- dynamic EMA creation fee (burned in SOL) -------------------------
    // Decay the stored activity EMA toward 0 by the idle time since the last
    // creation, charge the linear demand fee, burn it, then record the bumped
    // EMA + timestamp. Genesis (`fee_ema == 0`) decays to 0 → fee 0 → no burn.
    let decayed_ema = decay_fee_ema(protocol.fee_ema, protocol.last_creation_unix, now_ts);
    let fee = creation_fee(reward_emission, decayed_ema);
    if fee > 0 {
        // The burn source must be a SOL token account; the SPL Burn additionally
        // proves the creator (signer) is its owner/delegate.
        let base_token_mint = {
            let data = creator_base_ai.try_borrow()?;
            if data.len() < 32 {
                return Err(KassandraError::InvalidAccount.into());
            }
            let mut m = [0u8; 32];
            m.copy_from_slice(&data[0..32]);
            m
        };
        if base_token_mint != base_mint_ai.address().to_bytes() {
            return Err(KassandraError::InvalidAccount.into());
        }
        Burn::new(creator_base_ai, base_mint_ai, creator_ai, fee).invoke()?;
    }
    // Persist the new EMA state (protocol is writable).
    {
        let mut protocol_mut = protocol;
        protocol_mut.fee_ema = bumped_fee_ema(decayed_ema);
        protocol_mut.last_creation_unix = now_ts;
        let mut data = protocol_ai.try_borrow_mut()?;
        data[..Protocol::LEN].copy_from_slice(bytemuck::bytes_of(&protocol_mut));
    }

    // --- create the stake vault (program-signed) ---------------------------
    // Create the bare SPL token account at the vault PDA, then initialize it on
    // the SOL mint with the oracle PDA as its token authority.
    let vault_rent = minimum_rent(TokenAccount::LEN)?;
    let vault_bump_seed = [vault_bump];
    let vault_seeds = [
        Seed::from(b"vault".as_ref()),
        Seed::from(oracle_ai.address().as_ref()),
        Seed::from(&vault_bump_seed),
    ];
    create_pda(
        creator_ai,
        stake_vault_ai,
        &vault_seeds,
        vault_rent,
        TokenAccount::LEN,
        &pinocchio_token::ID,
    )?;
    InitializeAccount3 {
        account: stake_vault_ai,
        mint: base_mint_ai,
        owner: oracle_ai.address(),
    }
    .invoke()?;

    // --- create + initialize the Oracle (program-signed) -------------------
    let oracle_rent = minimum_rent(Oracle::LEN)?;
    let oracle_bump_seed = [oracle_bump];
    let oracle_seeds = Oracle::signer_seeds(&nonce_le, &oracle_bump_seed);
    create_pda(
        creator_ai,
        oracle_ai,
        &oracle_seeds,
        oracle_rent,
        Oracle::LEN,
        program_id,
    )?;

    // Use the snapshotted proposal window (== PROPOSAL_WINDOW by default) so the
    // window and the per-oracle snapshot below stay consistent.
    let phase_ends_at = deadline
        .checked_add(protocol.proposal_window)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let mut oracle = Oracle::zeroed();
    oracle.account_type = AccountType::Oracle.as_u8();
    oracle.creator = *creator_ai.address();
    oracle.base_mint = protocol.base_mint;
    oracle.usdc_mint = protocol.usdc_mint;
    oracle.stake_vault = *stake_vault_ai.address();
    oracle.deadline = deadline;
    oracle.phase_ends_at = phase_ends_at;
    oracle.twap_window = twap_window;
    oracle.options_count = options_count;
    oracle.set_phase(Phase::Proposal);
    oracle.proposer_count = 0;
    oracle.surviving_count = 0;
    oracle.fact_count = 0;
    oracle.total_oracle_stake = 0;
    oracle.bond_pool = 0;
    oracle.dispute_bond_total = 0;
    oracle.settled_count = 0;
    oracle.ai_finalized_count = 0;
    oracle.resolved_option = 0;
    oracle.open_challenge_count = 0;
    oracle.bump = oracle_bump;
    // Native-token minting is gone: this is always 0. The field stays pinned in
    // the Pod layout; finalize_oracle still folds it into reward_pool if a test
    // harness seeds a non-zero value.
    oracle.reward_emission = reward_emission;
    // Snapshot the governable behavioral params from the Protocol (F2). The
    // downstream processors read these from the Oracle, so an in-flight oracle
    // keeps its snapshot even if governance retunes the Protocol mid-dispute.
    oracle.threshold_num = protocol.threshold_num;
    oracle.threshold_den = protocol.threshold_den;
    oracle.market_threshold_num = protocol.market_threshold_num;
    oracle.market_threshold_den = protocol.market_threshold_den;
    oracle.flip_slash_num = protocol.flip_slash_num;
    oracle.flip_slash_den = protocol.flip_slash_den;
    oracle.phase_window = protocol.phase_window;
    oracle.proposal_window = protocol.proposal_window;
    oracle.fact_vote_slash_num = protocol.fact_vote_slash_num;
    oracle.fact_vote_slash_den = protocol.fact_vote_slash_den;
    oracle.reward_proposer_weight = protocol.reward_proposer_weight;
    oracle.reward_fact_weight = protocol.reward_fact_weight;
    // Snapshot the challenge-fee config (C1) too.
    oracle.challenge_fail_usdc_fee_num = protocol.challenge_fail_usdc_fee_num;
    oracle.challenge_fail_usdc_fee_den = protocol.challenge_fail_usdc_fee_den;
    oracle.challenge_success_base_fee_num = protocol.challenge_success_base_fee_num;
    oracle.challenge_success_base_fee_den = protocol.challenge_success_base_fee_den;
    // Bootstrapping: snapshot the activity-scaled minimum-stake floor from the SAME
    // decayed fee-EMA used for the creation fee (so the floor tracks recent creation
    // activity). 0 at genesis / low activity or while disabled → free participation.
    oracle.min_stake = crate::stake_floor::stake_floor(
        decayed_ema,
        protocol.stake_floor_ema_threshold,
        protocol.stake_floor_ema_cap,
        protocol.stake_floor_max,
    );
    {
        let mut data = oracle_ai.try_borrow_mut()?;
        data.copy_from_slice(bytemuck::bytes_of(&oracle));
    }

    Ok(())
}
