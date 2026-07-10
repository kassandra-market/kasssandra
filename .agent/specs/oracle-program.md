---
id: spec-oracle-program
title: Oracle program spec
tags: [spec, oracle, program, onchain]
updated: 2026-07-10
source: programs/oracles/src/{instruction.rs,state.rs,processor/}
---

# Oracle program spec

Crate `kassandra-oracles-program` (`programs/oracles`). Pinocchio; single-byte
`Ix` discriminant; bytemuck-`Pod` accounts. **Verify against
`programs/oracles/src/` before relying on exact offsets** — this is a summary.

## Instructions (`Ix`, `instruction.rs`)

| # | Variant | # | Variant |
|---|---|---|---|
| 0 | SubmitFact | 12 | FinalizeProposals |
| 1 | VoteFact | 13 | SetGovernance |
| 2 | FinalizeFacts | 14 | SetConfig |
| 3 | SubmitAiClaim | 15 | ResolveDeadend |
| 4 | OpenChallenge | 16 | KassPrice |
| 5 | SettleChallenge | 17 | ClaimProposer |
| 6 | FinalizeOracle | 18 | ClaimFact |
| 7 | AdvancePhase | 19 | ClaimFactVote |
| 8 | FinalizeAiClaims | 20 | CloseAiClaim |
| 9 | InitProtocol | 21 | CloseMarket |
| 10 | CreateOracle | 22 | SweepOracle |
| 11 | Propose | 23 | WriteOracleMeta |

Instruction `data` = `[disc_byte, ...payload]`, payload mirrors the processor's
byte layout (LE ints, pubkeys as 32 raw bytes). The SDKs build these byte-exactly.

## Accounts (`AccountType` tag @ byte 0, `state.rs`)

| tag | AccountType | Struct | Notes |
|---|---|---|---|
| 0 | Uninitialized | — | |
| 1 | Oracle | `Oracle` (~392 B) | phase, deadline, options_count, thresholds, bond pool… |
| 2 | Proposer | `Proposer` | option, bond, claim_option (0xFF = none), slashed_amount |
| 3 | Fact | `Fact` | content_hash, uri, approve/duplicate stake |
| 4 | FactVote | `FactVote` | per-voter stake on a fact |
| 5 | AiClaim | `AiClaim` | model_id/params_hash/io_hash (opaque 32B each) + option |
| 6 | Market | `Market` | challenge-market link (challenger, challengerUsdc, twap_end, question/vault…) |
| 7 | Protocol | `Protocol` (368 B) | governance singleton |
| 8 | OracleMeta | companion PDA | subject + option labels on-chain; `uri`+`uri_hash` bind extended JSON |

Every Pod account starts with `account_type: u8` at offset 0
(`ACCOUNT_TYPE_OFFSET`); a getProgramAccounts memcmp filter matches on the bs58 of
that tag byte.

## Phase machine (`Phase`)

`Created(0) → Proposal(1) → FactProposal(2) → FactVoting(3) → AiClaim(4) →
Challenge(5) → FinalRecompute(6) → Resolved(7)`, or `InvalidDeadend(8)`.

- Uncontested proposal → **Resolved** directly (skips 2–6).
- Conflict → dispute path (facts → AI claim → challenge market → recompute).
- Phase transitions are permissionless cranks gated by `phase_ends_at`
  (`AdvancePhase`, `FinalizeProposals`, `FinalizeFacts`, `FinalizeAiClaims`,
  `FinalizeOracle`, `ResolveDeadend`).

## Metadata (on-chain)

`WriteOracleMeta` (Ix 23) writes the `oracle_meta` PDA: length-prefixed
`subject` + per-option labels + `uri` + `uri_hash[32]`. The runner reads the
interpretation from chain (uri → JSON, verified against `uri_hash`). `prompt_hash`
was removed in favor of this. Body layout: `subject_len u16 ‖ subject ‖
options_count u8 ‖ [opt_len u16 ‖ opt]* ‖ uri_len u16 ‖ uri ‖ uri_hash[32]`.

## External CPIs

The challenge market CPIs into MetaDAO: conditional vault, AMM v0.4, futarchy
v0.6 (`programs/oracles/src/cpi/{metadao,metadao_v06}/`). LiteSVM loads their
`.so` from `programs/oracles/tests/fixtures/`.

## Change protocol

Editing instructions/accounts/phases here → update this file AND the SDKs
([`../context/sdks.md`](../context/sdks.md)) in lockstep; the SDK byte-parity tests
are the drift guard.
