---
id: spec-er-ai-oracle
title: Ephemeral Rollups + external AI oracle
tags: [spec, magicblock, ephemeral-rollups, ai-oracle, architecture]
updated: 2026-09-07
source: programs/oracles/src/{instruction.rs,state,cpi/magicblock,processor}
---

# Ephemeral Rollups + external AI oracle

Kassandra stays a Solana program. Interactive dispute/trading state can be
**delegated** to a MagicBlock Ephemeral Rollup (ER). The AI-claim round consumes
an **external attested feed** rather than treating the in-house runner as the
protocol's source of truth. Challenge markets remain the economic override.

## Scope decisions (questions this work answers)

These are the product questions a redesign of this size would normally ask.
They are recorded here so later work does not re-litigate them silently.

| Question | Decision |
|---|---|
| Which rollup? | **MagicBlock Ephemeral Rollups**. Programs stay deployed on Solana L1; accounts are delegated to an ER validator. Magic Router (`devnet-router.magicblock.app`) routes txs. |
| L1 vs ER split? | **L1:** `InitProtocol`, `CreateOracle`, token custody (SOL/USDC ATAs), MetaDAO challenge compose/settle, claims, sweep, governance. **ER:** after `DelegateOracle`, the interactive phase machine (propose/facts/votes/AI apply/phase cranks) and market trading. **v1 custody:** base-layer ATAs + post-commit payout — not Ephemeral SPL yet. |
| External AI oracle = ? | A **Kassandra-owned `AiOracleFeed` PDA** written by a governance-configured pusher (MagicBlock chain-pusher pattern). Not Allora (price forecasts) and not a hard Switchboard dependency. The in-house runner becomes one optional pusher via `PushAiOracleFeed`. |
| Keep the dispute machine? | **Yes.** Facts + challenge markets stay. The AI round changes: a single attested feed is applied onto proposers (`ApplyExternalAiClaim`) instead of N independent Anthropic re-runs being protocol-critical. `SubmitAiClaim` remains as a fallback when the feed is disabled. |
| Markets program too? | **Yes** — parallel `DelegateMarket` / `CommitMarket` / `UndelegateMarket`. |
| Resize `Oracle`/`Protocol`? | **No.** Companion PDAs so existing Pod ABIs stay pinned (368 / 392). |
| Live MagicBlock in CI? | **No.** LiteSVM tests the Kassandra state machine (short-form, no ownership transfer). Full MagicBlock account lists are encoded in the SDK for production; CPI is taken when those remaining accounts are present. |
| Pinocchio SDK crate? | **Do not depend on `ephemeral-rollups-pinocchio`** (it pins pinocchio `^0.10`; this workspace is `0.11.2`). Hand-roll the CPI wire (same approach as MetaDAO) in `cpi/magicblock/`. |

Out of this slice: session keys, eATA Global Vault custody, Magic Actions
post-commit payouts, Private ER/TEE, live ER validator in `make dev`.

## Account additions (companion PDAs)

| AccountType | tag | PDA seeds | Size | Role |
|---|---|---|---|---|
| `ErSession` | 9 | `[b"er_session", oracle]` | 96 | Delegation record (status, validator, commit cadence) |
| `AiOracleConfig` | 10 | `[b"ai_oracle_config"]` | 48 | Protocol singleton: pusher authority, staleness, enabled |
| `AiOracleFeed` | 11 | `[b"ai_feed", oracle]` | 248 | Latest attested categorical answer for one oracle |

`Oracle` (368) and `Protocol` (392) are **not** resized.

## New instructions (appended; never renumber)

| # | Ix | Layer | Notes |
|---|---|---|---|
| 24 | `DelegateOracle` | L1 | Create/update `ErSession`; optional MagicBlock CPI when remaining accounts present |
| 25 | `CommitOracle` | ER | Stamp `last_commit_slot`; optional Magic Program `schedule_commit` CPI |
| 26 | `UndelegateOracle` | ER | Mark undelegated; optional commit-and-undelegate CPI |
| 27 | `SetAiOracleConfig` | L1 | DAO-gated (`Protocol.dao_authority`) |
| 28 | `PushAiOracleFeed` | ER or L1 | Gated to `AiOracleConfig.authority`; program stamps Clock slot/ts |
| 29 | `ApplyExternalAiClaim` | ER or L1 | AiClaim phase; reads feed; creates the proposer's `AiClaim` from the feed |

MagicBlock's undelegate **callback** is an 8-byte discriminator
`[196, 28, 41, 206, 48, 37, 51, 167]` — handled in `process_instruction`
*before* 1-byte dispatch.

## MagicBlock constants

| Name | Value |
|---|---|
| Delegation program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| Magic program | `Magic11111111111111111111111111111111111111` |
| Magic context | `MagicContext1111111111111111111111111111111` |
| Default commit frequency | `30_000` ms |
| Devnet validators | `MAS1…` (AS), `MEUG…` (EU), `MUS3…` (US), `MTEW…` (TEE) |

Delegate CPI data: `u64 LE disc (0)` ++ `commit_frequency_ms u32` ++ `seeds_len u32`
++ `[seed_len u32 ++ seed bytes]*` ++ `Option<Address>` (1-byte tag + 32).

## External AI flow

```
governance SetAiOracleConfig(authority, max_staleness_slots, enabled=1)
  → pusher PushAiOracleFeed(option, model_id, params_hash, io_hash, attestation)
  → crank ApplyExternalAiClaim (one proposer per tx, same incremental style as finalize)
  → existing FinalizeAiClaims → Challenge → FinalizeOracle
```

When `enabled=0`, `SubmitAiClaim` is unchanged (in-house runner still works).

`ApplyExternalAiClaim` rejects: wrong phase, closed window, stale feed
(`Clock.slot - feed.slot > max_staleness_slots`), option out of range,
disabled config, already-claimed proposer.

Flip-slash semantics are unchanged: `claim_option != original_option` marks
`flipped`.

## Client / app

- TS + Rust SDKs grow builders, PDAs, decoders, parity pins.
- App: `VITE_MAGIC_ROUTER_URL` (Magic Router as the RPC when set); ER session
  + AI feed panel on oracle detail; Apply-claim crank next to SubmitAiClaim.
- Runner: `run --push-feed` writes `PushAiOracleFeed` instead of (or before)
  `submit_ai_claim`.
- Indexer: new Ix variants + child tags 9 and 11 (`oracle` still at offset 8).

## Markets program

Ix 12/13/14 `DelegateMarket` / `CommitMarket` / `UndelegateMarket` with
`[b"er_session", market]` — same short-form + optional MagicBlock remaining
accounts. `AccountType::ErSession = 4`.
