//! Fixed-size, zero-copy on-chain account layouts.
//!
//! Every account struct is `#[repr(C)]`, `Pod` + `Zeroable`, fully packed with
//! explicit `_pad`, and carries an `AccountType` tag as its first byte so
//! processors can reject type-confusion.

use bytemuck::{Pod, Zeroable};

/// 32-byte key. `Address` is `#[repr(transparent)] struct Address([u8; 32])` and
/// is `Pod`+`Zeroable` under solana-address's `bytemuck` feature, so every state
/// struct below keeps a byte-identical, zero-copy layout (same offsets as the
/// former `[u8; 32]` alias).
pub type Pubkey = pinocchio::address::Address;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AccountType {
    Uninitialized = 0,
    Config = 1,
    Market = 2,
    Contribution = 3,
    /// Companion PDA recording MagicBlock ER delegation for one market.
    ErSession = 4,
}
impl AccountType {
    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

/// Market lifecycle. Phase 1 uses only `Funding` and `Cancelled`; the rest are
/// reserved for Phase 2 (activation + settlement).
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MarketStatus {
    Funding = 0,
    Active = 1,
    Resolved = 2,
    Void = 3,
    Cancelled = 4,
}
impl MarketStatus {
    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

/// Governance guardrail: the largest protocol `fee_bps` the futarchy may set
/// (10% = 1000 bps). `init_config`/`update_config` reject anything above this.
pub const MAX_FEE_BPS: u16 = 1000;

/// Governed singleton at PDA `[b"config"]`. `authority` is the KASS futarchy DAO
/// executor; only it may `update_config`.
///
/// `fee_bps` + `fee_destination` are the futarchy-governed protocol-fee config:
/// the KASS cut (in basis points, `<= MAX_FEE_BPS`) and the KASS token account
/// (on `kass_mint`) fees are routed to. Appended after `bump` so the Phase-1
/// offsets (`authority@8`/`kass_mint@40`/`min_liquidity@72`) stay pinned.
///
/// `market_creation_ema` + `last_market_creation_unix` track recent
/// market-CREATION demand (mirroring the Kassandra oracle's creation-fee EMA);
/// `min_liquidity_ema_threshold`/`_cap`/`_max` are the governable curve
/// `create_market` evaluates against the decayed EMA to snapshot a new market's
/// `min_liquidity` floor (see `crate::liquidity_floor`) — `min_liquidity` above
/// is the BASE (low-demand) floor, ramping up to `min_liquidity_max` as demand
/// rises. Appended after the fee-config tail; all four new curve/EMA fields are
/// 8-byte values so no padding is introduced.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Config {
    pub account_type: u8, // AccountType::Config
    pub _pad_hdr: [u8; 7],
    pub authority: Pubkey,
    pub kass_mint: Pubkey,
    pub min_liquidity: u64, // BASE floor — used at/below the EMA threshold (low demand)
    pub bump: u8,
    pub _pad0: u8,
    pub fee_bps: u16,            // protocol fee in basis points (<= MAX_FEE_BPS)
    pub fee_destination: Pubkey, // KASS token account fees are routed to
    pub _pad: [u8; 4],
    // ---- Activity-scaled min-liquidity floor (mirrors the oracle's stake_floor) --
    pub market_creation_ema: u64,         // fixed-point EMA of recent market-creation activity
    pub last_market_creation_unix: i64,   // for EMA decay; 0 at genesis
    pub min_liquidity_ema_threshold: u64, // EMA at/below which the floor is `min_liquidity` (base)
    pub min_liquidity_ema_cap: u64,       // EMA at/above which the floor reaches `min_liquidity_max`
    pub min_liquidity_max: u64,           // ceiling; `<= min_liquidity` at genesis == disabled (flat)
}
impl Config {
    pub const LEN: usize = core::mem::size_of::<Self>();
}

/// One sub-market per outcome per oracle, PDA `[b"market", oracle, [outcome_index]]`.
/// A categorical (N-option) oracle is modeled as N independent binary sub-markets,
/// each a "will the oracle resolve to `outcome_index`? YES/NO" market; binary is
/// the special case `outcome_index = 0` on a 2-option oracle. `min_liquidity` is
/// snapshot from `Config` at creation so in-flight markets are immune to
/// governance changes (config-as-state, mirroring Kassandra).
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Market {
    pub account_type: u8, // AccountType::Market
    pub _pad_hdr: [u8; 7],
    pub oracle: Pubkey,
    pub creator: Pubkey,
    pub kass_mint: Pubkey,
    pub escrow_vault: Pubkey,
    pub min_liquidity: u64,
    pub total_contributed: u64,
    pub open_contributions: u16, // count of live Contribution accounts (rent-reclaim counter; formerly _reserved_152/open_yes_bps)
    pub status: u8,              // MarketStatus
    pub bump: u8,
    pub escrow_bump: u8,
    pub _pad: [u8; 3],
    // --- Phase-2a MetaDAO bindings (recorded at `activate`) ---
    pub question: Pubkey, // MetaDAO binary Question (oracle-authority == this Market PDA)
    pub vault: Pubkey,    // KASS conditional vault
    pub yes_mint: Pubkey, // conditional-KASS mint idx 0 (cYES)
    pub no_mint: Pubkey,  // conditional-KASS mint idx 1 (cNO)
    pub amm: Pubkey,      // the cYES/cNO pool
    pub lp_mint: Pubkey,  // the pool's LP mint
    pub lp_vault: Pubkey, // Market-PDA-owned LP token account holding seeded liquidity
    pub lp_total: u64,    // LP tokens minted at activation (basis for pro-rata claim_lp)
    pub settled: u8,      // reserved for Phase 2c (resolve_market)
    pub _pad2: u8,
    pub fee_bps: u16, // protocol fee snapshot from Config at creation (config-as-state)
    pub fee_collected: u8, // 1 once `collect_fee` has cut the accrued LP fee (gates `claim_lp`)
    pub outcome_index: u8, // this sub-market's oracle outcome (YES = oracle resolves to it)
    pub _pad3: [u8; 2],
    // --- post-activation liquidity accounting (gross-LP basis) ---
    // `activation_lp`/`activation_contributed` are FROZEN at `activate` and are the
    // basis for a funder's pro-rata LP share (`activation_lp · amount /
    // activation_contributed`). `gross_lp_total` = activation LP + Σ post-activation
    // `add_liquidity` LP; it is the (fee-independent) denominator for `claim_lp`.
    // `lp_total`/`total_contributed` above widen to include late adds (lp_total is
    // still reduced by `collect_fee`); for an activation-only market these reduce to
    // the pre-add_liquidity semantics exactly.
    pub activation_lp: u64,
    pub activation_contributed: u64,
    pub gross_lp_total: u64,
}
impl Market {
    pub const LEN: usize = core::mem::size_of::<Self>();
}

/// Per-contributor stake, PDA `[b"contribution", market, contributor]`.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Contribution {
    pub account_type: u8, // AccountType::Contribution
    pub _pad_hdr: [u8; 7],
    pub market: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    pub claimed: u8, // bool: refunded/claimed
    pub bump: u8,
    pub _pad: [u8; 6],
    // LP minted for this contributor by post-activation `add_liquidity` (0 for pure
    // funders). Added to the funder's activation pro-rata share to form the
    // contribution's gross LP for `claim_lp`.
    pub late_lp: u64,
}
impl Contribution {
    pub const LEN: usize = core::mem::size_of::<Self>();
}

/// `ErSession.status`: not delegated.
pub const ER_STATUS_UNDELEGATED: u8 = 0;
/// `ErSession.status`: delegated to an Ephemeral Rollup validator.
pub const ER_STATUS_DELEGATED: u8 = 1;

/// Per-market ER-delegation record. PDA `[b"er_session", market]`. `size_of == 96`.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct ErSession {
    pub account_type: u8, // AccountType::ErSession
    pub bump: u8,
    pub status: u8,
    pub _pad: [u8; 5],
    pub market: Pubkey,
    pub validator: Pubkey,
    pub commit_frequency_ms: u32,
    pub _pad2: [u8; 4],
    pub delegated_at: i64,
    pub last_commit_slot: u64,
}
impl ErSession {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const SEED_PREFIX: &'static [u8] = b"er_session";

    pub fn is_delegated(&self) -> bool {
        self.status == ER_STATUS_DELEGATED
    }
}
