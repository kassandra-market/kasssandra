use core::mem::{offset_of, size_of};
use kassandra_program::state::*;

#[test]
fn account_sizes_are_stable() {
    // size_of and LEN must agree (LEN is defined as size_of).
    assert_eq!(size_of::<Oracle>(), Oracle::LEN);
    assert_eq!(size_of::<Proposer>(), Proposer::LEN);
    assert_eq!(size_of::<Fact>(), Fact::LEN);
    assert_eq!(size_of::<FactVote>(), FactVote::LEN);
    assert_eq!(size_of::<AiClaim>(), AiClaim::LEN);

    // Absolute pinned on-chain ABI sizes. Changing a struct's layout must
    // be a deliberate, visible break of these constants.
    assert_eq!(Oracle::LEN, 216);
    assert_eq!(Proposer::LEN, 80);
    assert_eq!(Fact::LEN, 328);
    assert_eq!(FactVote::LEN, 80);
    assert_eq!(AiClaim::LEN, 168);
}

#[test]
fn field_offsets_are_pinned() {
    // Lock a few key field offsets per struct so reordering/resizing breaks.
    assert_eq!(offset_of!(Oracle, proposer_count), 154);
    assert_eq!(offset_of!(Oracle, surviving_count), 156);
    assert_eq!(offset_of!(Oracle, total_oracle_stake), 160);
    assert_eq!(offset_of!(Oracle, prompt_hash), 184);

    assert_eq!(offset_of!(Proposer, bond), 64);

    assert_eq!(offset_of!(Fact, uri), 128);

    assert_eq!(offset_of!(FactVote, stake), 64);

    assert_eq!(offset_of!(AiClaim, io_hash), 128);
}

#[test]
fn phase_discriminants_and_roundtrip() {
    assert_eq!(Phase::Created as u8, 0);
    assert_eq!(Phase::InvalidDeadend as u8, 8);

    assert!(Phase::from_u8(9).is_none());

    for v in [
        Phase::Created,
        Phase::Proposal,
        Phase::FactProposal,
        Phase::FactVoting,
        Phase::AiClaim,
        Phase::Challenge,
        Phase::FinalRecompute,
        Phase::Resolved,
        Phase::InvalidDeadend,
    ] {
        assert_eq!(Phase::from_u8(v as u8), Some(v));
        assert_eq!(v.as_u8(), v as u8);
    }
}
