//! Integration tests for the activity-scaled min-liquidity floor
//! (`create_market` reading + bumping `Config.market_creation_ema`, snapshotting
//! `Market.min_liquidity` off the governable threshold/cap/max curve — see
//! `kassandra_markets_program::liquidity_floor`).

mod common;
use common::*;
use kassandra_markets_program::state::Market;
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signer},
};

const PROPOSAL: u8 = 1; // kassandra Phase::Proposal

const BASE: u64 = 1_000_000_000; // 1 KASS
const MAX: u64 = 10_000_000_000; // 10 KASS

fn setup_with_curve(threshold: u64, cap: u64, max: u64) -> (TestCtx, Pubkey, Keypair) {
    let mut ctx = TestCtx::new();
    let kass = ctx.create_mint(9);
    let authority = Keypair::new();
    let fee_destination = ctx.create_token_account(kass, authority.pubkey(), 0);
    let (_config, res) =
        ctx.init_config_with_curve(authority.pubkey(), kass, BASE, 100, fee_destination, threshold, cap, max);
    assert!(res.is_ok(), "{res:?}");
    (ctx, kass, authority)
}

fn create_one(ctx: &mut TestCtx, kass: Pubkey) -> Market {
    let oracle = ctx.seed_kass_oracle(2, PROPOSAL);
    let creator = Keypair::new();
    ctx.svm_airdrop(&creator.pubkey());
    let creator_ata = ctx.create_token_account(kass, creator.pubkey(), 2_000_000_000);
    let (market, res) = ctx.create_market(&creator, oracle, kass, creator_ata, 200_000_000);
    assert!(res.is_ok(), "{res:?}");
    ctx.read_pod(market)
}

#[test]
fn floor_stays_at_base_while_disabled_max_equals_base() {
    // The harness's plain `init_config`/`init_config_full` default — mirrors
    // every OTHER create_market test's expectation that min_liquidity is flat.
    let (mut ctx, kass, _auth) = setup_with_curve(0, 1_000_000_000, BASE); // max == base ⇒ disabled
    for _ in 0..5 {
        let m = create_one(&mut ctx, kass);
        assert_eq!(m.min_liquidity, BASE, "disabled ramp must stay flat regardless of activity");
    }
}

#[test]
fn floor_ramps_up_with_rapid_creation_and_first_market_sees_no_prior_activity() {
    // threshold=0 so even one creation unit of EMA sits inside the ramp;
    // cap=3 creation units so a handful of rapid creates visibly climbs it.
    let one_unit = 1_000_000_000u64; // == MARKET_EMA_INCREMENT
    let (mut ctx, kass, _auth) = setup_with_curve(0, 3 * one_unit, MAX);

    // First market: genesis EMA (0) is AT the threshold (0) ⇒ still the base —
    // the snapshot reads the DECAYED EMA BEFORE this creation's own bump.
    let m1 = create_one(&mut ctx, kass);
    assert_eq!(m1.min_liquidity, BASE, "first market sees zero prior activity");

    // Subsequent markets see the prior bump(s) (no time elapsed ⇒ no decay), so
    // the floor strictly increases each time until the cap.
    let m2 = create_one(&mut ctx, kass);
    let m3 = create_one(&mut ctx, kass);
    let m4 = create_one(&mut ctx, kass); // at/above cap ⇒ pinned at MAX
    assert!(m2.min_liquidity > m1.min_liquidity, "m2 {} should exceed m1 {}", m2.min_liquidity, m1.min_liquidity);
    assert!(m3.min_liquidity > m2.min_liquidity, "m3 {} should exceed m2 {}", m3.min_liquidity, m2.min_liquidity);
    assert_eq!(m4.min_liquidity, MAX, "at/above cap the floor is pinned at max");
}

#[test]
fn floor_decays_back_down_after_idle_time() {
    let one_unit = 1_000_000_000u64;
    let (mut ctx, kass, _auth) = setup_with_curve(0, 3 * one_unit, MAX);

    let _m1 = create_one(&mut ctx, kass);
    let m2 = create_one(&mut ctx, kass); // ramped up from m1's activity
    assert!(m2.min_liquidity > BASE);

    // Several half-lives of idle time decay the EMA well below what m2 itself
    // saw, so the next market's floor must come in LOWER (demand cooled off).
    // (A single half-life isn't enough here to guarantee a strict drop: m2's
    // OWN pre-bump EMA and its post-bump EMA halved once can coincide on this
    // tight 3-unit cap, landing on the identical floor value — a real but
    // curve-specific coincidence, not evidence the decay math is broken.)
    ctx.advance_clock_secs(3 * kassandra_markets_program::config::MARKET_EMA_HALFLIFE_SECS);
    let m3 = create_one(&mut ctx, kass);
    assert!(
        m3.min_liquidity < m2.min_liquidity,
        "m3 {} should be lower than m2 {} after idling",
        m3.min_liquidity,
        m2.min_liquidity
    );

    // A very long idle gap decays the EMA fully back to 0 ⇒ back to the base.
    ctx.advance_clock_secs(kassandra_markets_program::config::MARKET_EMA_HALFLIFE_SECS * 1_000);
    let m4 = create_one(&mut ctx, kass);
    assert_eq!(m4.min_liquidity, BASE, "fully idle ⇒ back to the base floor");
}

#[test]
fn in_flight_markets_are_immune_to_a_later_governance_curve_change() {
    let (mut ctx, kass, authority) = setup_with_curve(0, 1_000_000_000, BASE); // disabled
    let m_before = create_one(&mut ctx, kass);
    assert_eq!(m_before.min_liquidity, BASE);

    // Governance activates the ramp AFTER m_before was created.
    let fee_destination = ctx.create_token_account(kass, authority.pubkey(), 0);
    let res = ctx.update_config_with_curve(&authority, BASE, 100, fee_destination, 0, 1_000_000_000, MAX);
    assert!(res.is_ok(), "{res:?}");

    // The already-created market's snapshot is untouched (config-as-state).
    let m_before_reread: Market = ctx.read_pod(kassandra_markets_sdk::pda::market(
        &Pubkey::new_from_array(m_before.oracle.to_bytes()),
        0,
    ).0);
    assert_eq!(m_before_reread.min_liquidity, BASE, "in-flight market's floor must not retroactively change");

    // A NEW market created after the update reflects the now-active ramp.
    let m_after = create_one(&mut ctx, kass);
    assert!(m_after.min_liquidity > BASE, "a market created after activation should see the ramped floor");
}
