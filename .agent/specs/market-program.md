---
id: spec-market-program
title: Market program spec
tags: [spec, market, program, onchain, metadao]
updated: 2026-09-09
source: programs/markets/src/{instruction.rs,state.rs,processor/}
---

# Market program spec

Crate `kassandra-markets-program` (`programs/markets`). Pinocchio; single-byte
`Ix`; bytemuck-`Pod` accounts. A prediction/decision market funded in SOL that
composes a MetaDAO conditional market and activates a live cYES/cNO AMM pool.

## Instructions (`Ix`, `instruction.rs`)

| # | Variant | Purpose |
|---|---|---|
| 0 | InitConfig | Init the governed `Config` singleton |
| 1 | UpdateConfig | Governance update (min_liquidity, fee_bps, fee_destination) |
| 2 | CreateMarket | Create a market on an oracle outcome, seed SOL |
| 3 | Contribute | Add SOL funding (LP) |
| 4 | Cancel | Cancel a still-Funding market |
| 5 | Refund | Refund a contributor from a cancelled market |
| 6 | Activate | Compose done → drain escrow → seed the cYES/cNO pool (→ Active) |
| 7 | ClaimLp | LP claims pro-rata share |
| 8 | ResolveMarket | Resolve to the winning outcome |
| 9 | CollectFee | Protocol fee collection |
| 10 | CloseMarket | Reap a settled market (account closes) |
| 11 | AddLiquidity | Add SOL liquidity to an Active cYES/cNO pool |
| 12 | DelegateMarket | Create/update per-market `ErSession`; optional MagicBlock CPI |
| 13 | CommitMarket | Stamp last-commit slot; optional Magic Program commit CPI |
| 14 | UndelegateMarket | Mark undelegated; optional commit-and-undelegate CPI |
| 15 | CreateSubject | Stand up a GPT-resolved Subject PDA `[b"subject", nonce_u64_le]` |
| 16 | RequestAi | CPI MagicBlock `interact_with_llm` (short form skips remaining accounts) |

GPT callback (not an `Ix` byte): 8-byte disc
`[0x3b, 0x24, 0x82, 0x78, 0x4d, 0x6f, 0xac, 0x00]`. Accounts: identity PDA
(signer), subject (writable). Payload: Borsh `String` parsed as
`{"option_index": N}`.

## Accounts

- `Config` — governed singleton (min_liquidity, fee_bps, fee_destination, authority).
- `Market` — status (Funding/Active/…; `status` byte at offset 154, Active == 1),
  min_liquidity, total_contributed, SOL/USDC vaults, outcome index, settled flag.
- `Contribution` — per-LP contribution amount.
- `ErSession` (96 B, tag 4) — `[b"er_session", market]` MagicBlock delegation record.
- `Subject` (88 B, tag 5) — `[b"subject", nonce_u64_le]`. GPT resolution source.
  Layout: `account_type, bump, options_count, status, resolved_option, pad[3],
  creator, llm_context, nonce u64, resolved_slot u64`. Status 0=Open, 1=Resolved,
  2=Void. `SUBJECT_OPTION_PENDING = 0xff`.

## Lifecycle

```
CreateSubject → CreateMarket (Funding) ──Contribute*──▶ (funded to floor)
  ──compose (MetaDAO question / conditional vault / AMM, off the SDK flows)──▶
  ──Activate──▶ Active (cYES/cNO pool live) ──trade (split/swap)──▶
  ──ResolveMarket──▶ settled ──ClaimLp / CollectFee / CloseMarket
```

- **Compose** is a client-side sequence (SDK `flows.composeMarketInstructions`, 3
  ixs) that stands up the MetaDAO question + conditional vault + AMM; **Activate**
  drains the funding escrow into the pool.
- Trading: **buy** splits SOL into a cYES+cNO pair and swaps the unwanted leg;
  **sell** unwinds a held leg back to SOL.

## Tokens

- Base = SOL (9 dp). In the challenge/futarchy AMM the quote = USDC (6 dp);
  conditional tokens inherit their vault's decimals (conditional-SOL 9,
  conditional-USDC 6). Always scale by the right decimals in UIs
  ([`../memories/scaled-amounts-ui.md`](../memories/scaled-amounts-ui.md)).

## SDK & app seams

- `@kassandra-market/markets` builds the ixs (`instructions/market/*`) + flows
  (compose/activate/atas). `flows.createAtaIdempotentInstruction` is the
  byte-identical ATA-create leaf shared with the app.
- The Rust SDK `kassandra-markets-sdk` is the **solana-sdk v2 island**.

## Change protocol

Editing ixs/accounts here → update this file + `@kassandra-market/markets` +
`kassandra-markets-sdk` in lockstep; account-meta/byte-layout tests are the guard.
