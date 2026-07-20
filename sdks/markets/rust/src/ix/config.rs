//! Config-singleton instruction builders (Ix 0 `InitConfig`, Ix 1 `UpdateConfig`).

use crate::*;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::pubkey::Pubkey;

/// Governance guardrail mirror of `state::MAX_FEE_BPS` (10% = 1000 bps).
pub const MAX_FEE_BPS: u16 = 1000;

/// `InitConfig` (Ix 0) — create the `Config` singleton at PDA `[b"config"]`.
/// Payload = `authority` (32) ++ `min_liquidity` (u64 LE) ++ `fee_bps` (u16 LE)
/// ++ `fee_destination` (32) ++ `min_liquidity_ema_threshold` (u64 LE) ++
/// `min_liquidity_ema_cap` (u64 LE) ++ `min_liquidity_max` (u64 LE) — the
/// activity-scaled funding-floor curve (`min_liquidity_max <= min_liquidity`
/// disables the ramp — a flat floor, exactly like the oracle's stake-floor
/// bootstrap default). Accounts:
/// `[0] config(pda,w) [1] payer(signer,w) [2] kass_mint(ro) [3] fee_destination(ro)
///  [4] system program [5] program_data(ro)`.
///
/// `program_data` is this program's BPF-Upgradeable-Loader `ProgramData` account
/// (derived from `PROGRAM_ID`): the processor reads its stored `upgrade_authority`
/// and REQUIRES it equals `payer` (the bootstrap front-run defense). Passed
/// read-only.
#[allow(clippy::too_many_arguments)]
pub fn init_config(
    payer: &Pubkey,
    kass_mint: &Pubkey,
    authority: &Pubkey,
    min_liquidity: u64,
    fee_bps: u16,
    fee_destination: &Pubkey,
    min_liquidity_ema_threshold: u64,
    min_liquidity_ema_cap: u64,
    min_liquidity_max: u64,
) -> Instruction {
    let (config, _) = crate::pda::config();
    let (program_data, _) = crate::pda::program_data(&PROGRAM_ID);
    let mut data = vec![IX_INIT_CONFIG];
    data.extend_from_slice(authority.as_ref());
    data.extend_from_slice(&min_liquidity.to_le_bytes());
    data.extend_from_slice(&fee_bps.to_le_bytes());
    data.extend_from_slice(fee_destination.as_ref());
    data.extend_from_slice(&min_liquidity_ema_threshold.to_le_bytes());
    data.extend_from_slice(&min_liquidity_ema_cap.to_le_bytes());
    data.extend_from_slice(&min_liquidity_max.to_le_bytes());
    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(config, false),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*kass_mint, false),
            AccountMeta::new_readonly(*fee_destination, false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
            AccountMeta::new_readonly(program_data, false),
        ],
        data,
    }
}

/// `UpdateConfig` (Ix 1) — futarchy-gated update of `min_liquidity`, `fee_bps`,
/// `fee_destination`, and the activity-scaled funding-floor curve (all six set
/// together). Payload = `min_liquidity` (u64 LE) ++ `fee_bps` (u16 LE) ++
/// `fee_destination` (32) ++ `min_liquidity_ema_threshold` (u64 LE) ++
/// `min_liquidity_ema_cap` (u64 LE) ++ `min_liquidity_max` (u64 LE). Never
/// touches the LIVE `market_creation_ema`/`last_market_creation_unix` — only the
/// curve's governable shape. Accounts: `[0] config(w) [1] authority(signer) [2]
/// fee_destination(ro)`.
#[allow(clippy::too_many_arguments)]
pub fn update_config(
    authority: &Pubkey,
    min_liquidity: u64,
    fee_bps: u16,
    fee_destination: &Pubkey,
    min_liquidity_ema_threshold: u64,
    min_liquidity_ema_cap: u64,
    min_liquidity_max: u64,
) -> Instruction {
    let (config, _) = crate::pda::config();
    let mut data = vec![IX_UPDATE_CONFIG];
    data.extend_from_slice(&min_liquidity.to_le_bytes());
    data.extend_from_slice(&fee_bps.to_le_bytes());
    data.extend_from_slice(fee_destination.as_ref());
    data.extend_from_slice(&min_liquidity_ema_threshold.to_le_bytes());
    data.extend_from_slice(&min_liquidity_ema_cap.to_le_bytes());
    data.extend_from_slice(&min_liquidity_max.to_le_bytes());
    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(config, false),
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new_readonly(*fee_destination, false),
        ],
        data,
    }
}
