---
id: memory-solana-gpt-oracle
title: Hand-roll MagicBlock solana-gpt-oracle CPI — do not depend on the Anchor crate
tags: [memory, magicblock, gpt-oracle, pinocchio, cpi]
updated: 2026-09-08
---

# Hand-roll solana-gpt-oracle CPI

Do **not** add `solana-gpt-oracle` (or `ephemeral-rollups-sdk`) as a program
dependency. Those crates pull Anchor and pin pinocchio `^0.10`; this workspace
is `0.11.2`. Reconstruct the wire in `programs/oracles/src/cpi/gpt_oracle.rs`.

## Program + PDAs

| Item | Value |
|---|---|
| Program | `LLMrieZMpbJFwN52WgmBNMxYojrpRVYXdC1RCweEbab` |
| Identity PDA | `[b"identity"]` |
| Interaction PDA | `[b"interaction", payer, context]` |
| Context seed | `[b"test-context", counter.count LE]` (created via GPT `create_llm_context`) |

The off-chain oracle keypair `A1ooMmN1…` is GPT's `callback_from_llm` *payer*,
not the identity PDA. Kassandra's callback trusts **identity is_signer** +
address == the identity PDA.

## Callback

`interact_with_llm` takes `(text, callback_program_id, callback_disc[8], Option<Vec<AccountMeta>>)`.
GPT prepends identity as signer then `invoke_signed` with seeds `["identity"]`.

Kassandra disc: `sha256("global:callback_from_gpt_oracle")[..8]` =
`[0x3b, 0x24, 0x82, 0x78, 0x4d, 0x6f, 0xac, 0x00]`. Payload is Borsh `String`.
Parse `{"option_index": N}` (runner schema) or `{"option": N}` or a bare integer.

GPT's `callback_from_llm` **rejects** remaining accounts that include its own
payer (`A1ooMmN1…`). Do not put that key in `callback_account_metas`.

## LiteSVM

Short-form `RequestAiOracle` creates the feed (`option = 0xFF`) without CPI.
Callback tests use `LiteSVM::with_sigverify(false)` so the identity PDA can be
marked as a signer without a keypair.

Source: <https://github.com/magicblock-labs/super-smart-contracts/blob/main/programs/solana-gpt-oracle/src/lib.rs>
