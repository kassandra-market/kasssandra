---
id: spec-er-ai-oracle
title: Ephemeral Rollups + external AI oracle
tags: [spec, magicblock, ephemeral-rollups, ai-oracle, architecture]
updated: 2026-09-08
source: programs/oracles/src/{instruction.rs,state,cpi/{magicblock,gpt_oracle},processor}
---

# Ephemeral Rollups + external AI oracle

Kassandra stays a Solana program. Interactive dispute/trading state can be
**delegated** to a MagicBlock Ephemeral Rollup (ER). The AI-claim round consumes
**MagicBlock solana-gpt-oracle** (`LLMrieZMpbJFwN52WgmBNMxYojrpRVYXdC1RCweEbab`)
rather than treating the in-house runner as the protocol's source of truth.
Challenge markets remain the economic override.

## Scope decisions (questions this work answers)

These are the product questions a redesign of this size would normally ask.
They are recorded here so later work does not re-litigate them silently.

| Question | Decision |
|---|---|
| Which rollup? | **MagicBlock Ephemeral Rollups**. Programs stay deployed on Solana L1; accounts are delegated to an ER validator. Magic Router (`devnet-router.magicblock.app`) routes txs. |
| L1 vs ER split? | **L1:** `InitProtocol`, `CreateOracle`, token custody (SOL/USDC ATAs), MetaDAO challenge compose/settle, claims, sweep, governance. **ER:** after `DelegateOracle`, the interactive phase machine (propose/facts/votes/AI apply/phase cranks) and market trading. **v1 custody:** base-layer ATAs + post-commit payout — not Ephemeral SPL yet. |
| External AI oracle = ? | **MagicBlock [solana-gpt-oracle](https://github.com/magicblock-labs/super-smart-contracts/blob/main/programs/solana-gpt-oracle/src/lib.rs)** is the **only** AI source. Governance stores the GPT `ContextAccount` on `AiOracleConfig.llm_context`. `RequestAiOracle` CPIs `interact_with_llm`; the GPT oracle later CPIs Kassandra's 8-byte callback, which writes `AiOracleFeed`. `ApplyExternalAiClaim` stamps proposers. Not Allora, not Switchboard, not the in-house runner. `SubmitAiClaim` (Ix 3) is retired (discriminant kept; processor rejects). |
| Keep the dispute machine? | **Yes.** Facts + challenge markets stay. The AI round: one attested GPT feed is applied onto proposers (`ApplyExternalAiClaim`) instead of N independent Anthropic re-runs. |
| Markets program too? | **Yes** — parallel `DelegateMarket` / `CommitMarket` / `UndelegateMarket`. |
| Resize `Oracle`/`Protocol`? | **No.** Companion PDAs so existing Pod ABIs stay pinned (368 / 392). |
| Live MagicBlock in CI? | **No.** LiteSVM tests the Kassandra state machine (short-form, no ownership transfer). Full MagicBlock account lists are encoded in the SDK for production; CPI is taken when those remaining accounts are present. Callback tests skip sigverify so the identity PDA can be marked as a signer. |
| Pinocchio SDK crate? | **Do not depend on `ephemeral-rollups-pinocchio` or `solana-gpt-oracle`** (Anchor + ER SDK pin pinocchio `^0.10`; this workspace is `0.11.2`). Hand-roll the CPI wire in `cpi/magicblock.rs` and `cpi/gpt_oracle.rs`. |

Out of this slice: session keys, eATA Global Vault custody, Magic Actions
post-commit payouts, Private ER/TEE, live ER validator in `make dev`.

## Account additions (companion PDAs)

| AccountType | tag | PDA seeds | Size | Role |
|---|---|---|---|---|
| `ErSession` | 9 | `[b"er_session", oracle]` | 96 | Delegation record (status, validator, commit cadence) |
| `AiOracleConfig` | 10 | `[b"ai_oracle_config"]` | 48 | Protocol singleton: GPT `llm_context`, staleness, enabled |
| `AiOracleFeed` | 11 | `[b"ai_feed", oracle]` | 248 | Latest attested categorical answer for one oracle |

`Oracle` (368) and `Protocol` (392) are **not** resized. Offset 8 of
`AiOracleConfig` is `llm_context` (same 32 bytes as the former pusher
`authority`).

## Instructions (appended; never renumber)

| # | Ix | Layer | Notes |
|---|---|---|---|
| 24 | `DelegateOracle` | L1 | Create/update `ErSession`; optional MagicBlock CPI when remaining accounts present |
| 25 | `CommitOracle` | ER | Stamp `last_commit_slot`; optional Magic Program `schedule_commit` CPI |
| 26 | `UndelegateOracle` | ER | Mark undelegated; optional commit-and-undelegate CPI |
| 27 | `SetAiOracleConfig` | L1 | DAO-gated (`Protocol.dao_authority`); payload `llm_context[32] ++ staleness ++ source ++ enabled` |
| 28 | `RequestAiOracle` | ER or L1 | Create feed PDA (`option = 0xFF` pending); optional CPI `interact_with_llm` when remaining accounts present |
| 29 | `ApplyExternalAiClaim` | ER or L1 | AiClaim phase; reads feed; creates the proposer's `AiClaim` from the feed |

8-byte callbacks intercepted in `process_instruction` *before* 1-byte dispatch:

| Disc | Source |
|---|---|
| `[196, 28, 41, 206, 48, 37, 51, 167]` | MagicBlock undelegate |
| `[0x3b, 0x24, 0x82, 0x78, 0x4d, 0x6f, 0xac, 0x00]` | GPT-oracle callback (`sha256("global:callback_from_gpt_oracle")[..8]`) |

## MagicBlock constants

| Name | Value |
|---|---|
| Delegation program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| Magic program | `Magic11111111111111111111111111111111111111` |
| Magic context | `MagicContext1111111111111111111111111111111` |
| solana-gpt-oracle | `LLMrieZMpbJFwN52WgmBNMxYojrpRVYXdC1RCweEbab` |
| GPT identity PDA | `[b"identity"]` under the GPT program |
| GPT interaction PDA | `[b"interaction", payer, context]` under the GPT program |
| Default commit frequency | `30_000` ms |
| Devnet validators | `MAS1…` (AS), `MEUG…` (EU), `MUS3…` (US), `MTEW…` (TEE) |

Delegate CPI data: `u64 LE disc (0)` ++ `commit_frequency_ms u32` ++ `seeds_len u32`
++ `[seed_len u32 ++ seed bytes]*` ++ `Option<Address>` (1-byte tag + 32).

`interact_with_llm` CPI data: Anchor disc ++ Borsh `String` ++ callback program
++ 8-byte callback disc ++ `Option<Vec<AccountMeta>>` (config, oracle, feed).

## External AI flow

```
governance SetAiOracleConfig(llm_context, max_staleness_slots, source=MAGICBLOCK, enabled=1)
  → RequestAiOracle(text)  // creates feed; CPIs interact_with_llm when remaining accounts present
  → GPT oracle callback_from_llm → Kassandra callback writes AiOracleFeed
      (parses {"option_index": N}; identity PDA must sign)
  → crank ApplyExternalAiClaim (one proposer per tx)
  → existing FinalizeAiClaims → Challenge → FinalizeOracle
```

When `enabled=0`, `SubmitAiClaim` is unchanged (in-house runner still works).

`ApplyExternalAiClaim` rejects: wrong phase, closed window, stale feed
(`Clock.slot - feed.slot > max_staleness_slots`), option out of range
(including pending `0xFF`), disabled config, already-claimed proposer.

Flip-slash semantics are unchanged: `claim_option != original_option` marks
`flipped`.

## Client / app

- TS + Rust SDKs grow builders, PDAs, decoders, parity pins.
- App: `VITE_MAGIC_ROUTER_URL` (Magic Router as the RPC when set); ER session
  + AI feed panel on oracle detail; Request-AI + Apply-claim next to SubmitAiClaim.
- Runner: `run --request-ai` (alias `--push-feed`) sends `RequestAiOracle` with
  the assembled user prompt; `--llm-context` appends the GPT CPI accounts.
- Indexer: Ix 28 is `request_ai_oracle`; child tags 9 and 11 (`oracle` still at offset 8).

## Markets program

Ix 12/13/14 `DelegateMarket` / `CommitMarket` / `UndelegateMarket` with
`[b"er_session", market]` — same short-form + optional MagicBlock remaining
accounts. `AccountType::ErSession = 4`.
