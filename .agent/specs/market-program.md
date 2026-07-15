---
id: spec-market-program
title: Market program spec
tags: [spec, market, program, onchain, metadao]
updated: 2026-07-10
source: programs/markets/src/{instruction.rs,state.rs,processor/}
---

# Market program spec

Crate `kassandra-markets-program` (`programs/markets`). Pinocchio; single-byte
`Ix`; bytemuck-`Pod` accounts. A prediction/decision market funded in KASS that
composes a MetaDAO conditional market and activates a live cYES/cNO AMM pool.

## Instructions (`Ix`, `instruction.rs`)

| # | Variant | Purpose |
|---|---|---|
| 0 | InitConfig | Init the governed `Config` singleton |
| 1 | UpdateConfig | Governance update (min_liquidity, fee_bps, fee_destination) |
| 2 | CreateMarket | Create a market on an oracle outcome, seed KASS |
| 3 | Contribute | Add KASS funding (LP) |
| 4 | Cancel | Cancel a still-Funding market |
| 5 | Refund | Refund a contributor from a cancelled market |
| 6 | Activate | Compose done → drain escrow → seed the cYES/cNO pool (→ Active) |
| 7 | ClaimLp | LP claims pro-rata share |
| 8 | ResolveMarket | Resolve to the winning outcome |
| 9 | CollectFee | Protocol fee collection |
| 10 | CloseMarket | Reap a settled market (account closes) |

## Accounts

- `Config` — governed singleton (min_liquidity, fee_bps, fee_destination, authority).
- `Market` — status (Funding/Active/…; `status` byte at offset 154, Active == 1),
  min_liquidity, total_contributed, KASS/USDC vaults, outcome index, settled flag.
- `Contribution` — per-LP contribution amount.

## Lifecycle

```
CreateMarket (Funding) ──Contribute*──▶ (funded to floor)
  ──compose (MetaDAO question / conditional vault / AMM, off the SDK flows)──▶
  ──Activate──▶ Active (cYES/cNO pool live) ──trade (split/swap)──▶
  ──ResolveMarket──▶ settled ──ClaimLp / CollectFee / CloseMarket
```

- **Compose** is a client-side sequence (SDK `flows.composeMarketInstructions`, 3
  ixs) that stands up the MetaDAO question + conditional vault + AMM; **Activate**
  drains the funding escrow into the pool.
- Trading: **buy** splits KASS into a cYES+cNO pair and swaps the unwanted leg;
  **sell** unwinds a held leg back to KASS.

## Tokens

- Base = KASS (9 dp). In the challenge/futarchy AMM the quote = USDC (6 dp);
  conditional tokens inherit their vault's decimals (conditional-KASS 9,
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
