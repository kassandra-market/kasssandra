---
name: kassandra-rust-client
description: "Use when integrating with the Kassandra prediction-market Solana program from Rust - a test harness, an off-chain keeper or bot, or another service that builds a Kassandra instruction, derives a Kassandra PDA, or talks to MagicBlock's GPT oracle via CreateSubject / RequestAi. Reach for the kassandra-markets-sdk crate before hand-rolling account metas, discriminant bytes, or PDA seeds."
---

# Integrating Kassandra from Rust

The `kassandra-markets-sdk` crate is the Rust client for the Kassandra markets program. It
mirrors on-chain discriminants, account orders, and PDA seeds. Depend on it (path or git),
not on hand-rolled encoding. This crate is a **solana-sdk v2 island** (the rest of the
workspace uses the granular v3 client stack).

```toml
kassandra-markets-sdk = { git = "https://github.com/kassandra-market/kasssandra", package = "kassandra-markets-sdk" }
```

## Surface

- **`kassandra_markets_sdk::PROGRAM_ID`** (a `solana_sdk::pubkey::Pubkey`) plus the `IX_*`
  discriminant constants (`IX_CREATE_SUBJECT = 15`, `IX_REQUEST_AI = 16`, …).
- **`kassandra_markets_sdk::ix::*`** — one builder per instruction, returning
  `solana_sdk::instruction::Instruction`. These take account pubkeys **explicitly** (derive
  PDAs yourself via `pda::*`). Examples: `ix::init_config`, `ix::create_market`,
  `ix::contribute`, `ix::activate`, `ix::resolve_market`, `ix::create_subject`,
  `ix::request_ai`.
- **`kassandra_markets_sdk::pda::*`** — return `(Pubkey, u8)`: `pda::config()`,
  `pda::subject(nonce)`, `pda::market(&oracle, outcome_index)`, `pda::escrow(&market)`,
  `pda::contribution(&market, &contributor)`.
- **`kassandra_markets_sdk::metadao`** — MetaDAO v0.4 wire (question / vault / AMM) used
  when a market activates.

`create_subject(payer, nonce, options_count, llm_context)` derives the Subject PDA.
`request_ai(subject, payer, text)` is the short form (no GPT remaining accounts). The
on-chain program appends GPT remaining accounts when the caller supplies them.

## Example

```rust
use kassandra_markets_sdk::{ix, pda, PROGRAM_ID};
use solana_sdk::instruction::Instruction;
use solana_sdk::pubkey::Pubkey;

fn stand_up_subject(payer: &Pubkey, llm_context: &Pubkey, nonce: u64) -> Instruction {
    let _ = PROGRAM_ID;
    ix::create_subject(payer, nonce, 2, llm_context)
}

fn bind_binary_market(
    creator: &Pubkey,
    subject: &Pubkey,
    base_mint: &Pubkey,
    creator_base_ata: &Pubkey,
    seed_amount: u64,
) -> Instruction {
    let (_market, _) = pda::market(subject, 0);
    ix::create_market(creator, subject, base_mint, creator_base_ata, seed_amount, 0)
}
```

## Notes

- Resolution is GPT: `Market.oracle` is a Subject pubkey. MagicBlock
  `solana-gpt-oracle` callbacks stamp `Subject.resolved_option`.
- The TS client (`@kassandra-market/markets`) mirrors this — see the
  `kassandra-ts-client` skill.
