---
id: memory-solana-gpt-oracle
title: Hand-roll MagicBlock solana-gpt-oracle CPI — do not depend on the Anchor crate
tags: [memory, magicblock, gpt-oracle, pinocchio, cpi]
updated: 2026-09-09
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
| Counter PDA | `[b"counter"]` (`count: u32`; first context uses 0) |
| Interaction PDA | `[b"interaction", payer, context]` |
| Context seed | `[b"test-context", counter.count LE]` (created via GPT `create_llm_context`) |

## Test identity (CI / LiteSVM / surfpool)

Production `callback_from_llm` requires payer == `ORACLE_IDENTITY`
`A1ooMmN1fz6LbEFrjh6GukFS2ZeRYFzdyFjeafyyS7Ca`. We do **not** have that secret,
and surfpool has no sigverify bypass, so a mainnet ELF cannot be driven in CI.

The committed fixture `programs/oracles/tests/fixtures/solana_gpt_oracle.so` is
a source rebuild of
[magicblock-labs/super-smart-contracts](https://github.com/magicblock-labs/super-smart-contracts)
at SHA `96f1143f86cb83ec3df98bae29df7b7c8a9f92f2` with `ORACLE_IDENTITY` patched
to MagicBlock's **public test keypair**:

| | |
|---|---|
| Pubkey | `tEsT3eV6RFCWs1BZ7AXTzasHqTtMnMLCB2tjQ42TDXD` |
| `IDENTITY` env (base58 secret) | `62LxqpAW6SWhp7iKBjCQneapn1w6btAhW7xHeREWSpPzw3xZbHCfAFesSR4R76ejQXCLWrndn37cKCCLFvx6Swps` |
| Fixture sha256 | `00553905d3a5a984766b13c4c605a8232dbe72b66cda50d4f26599f3b4cca9dc` |

Rebuild: `./scripts/vendor-solana-gpt-oracle.sh`. Do **not** load this ELF into
every `TestCtx` — only `programs/oracles/tests/gpt_oracle_cpi.rs`.

Short-form callback tests that skip the GPT ELF still use
`LiteSVM::with_sigverify(false)` so the identity PDA can be marked as a signer
without a keypair.

## Off-chain keeper + OpenRouter mock

`llm_oracle` (same repo) watches GPT program accounts over RPC/WS, calls
OpenRouter via `chatgpt_rs`, and sends `callback_from_llm`. CI builds it with
`./scripts/vendor-solana-gpt-oracle.sh --llm-oracle-only` (do **not** commit the
host binary). The vendor patch makes `OPENROUTER_API_URL` overridable;
`sdks/oracles/ts/test/surfpool/mock-openrouter.ts` serves a chatgpt_rs-shaped
`POST /api/v1/chat/completions` body. Set `LLM_ORACLE_BIN`, `RPC_URL`,
`WEBSOCKET_URL` (surfpool `--ws-port`), `OPENROUTER_API_KEY` (dummy).

The GPT surfpool e2e boots surfpool `--offline` so MagicBlock's mainnet
identity/counter PDAs are not lazily fetched (Anchor `init` would fail) and
`llm_oracle`'s `getProgramAccounts` backlog stays empty of live Interaction
accounts.

chatgpt_rs expects `{ id, created, model, usage:{prompt_tokens,completion_tokens,total_tokens},
choices:[{ message:{role:"assistant",content}, finish_reason, index }] }`.
`content` is `{"option_index": N}`.

## Callback

`interact_with_llm` takes `(text, callback_program_id, callback_disc[8], Option<Vec<AccountMeta>>)`.
GPT prepends identity as signer then `invoke_signed` with seeds `["identity"]`.

Kassandra disc: `sha256("global:callback_from_gpt_oracle")[..8]` =
`[0x3b, 0x24, 0x82, 0x78, 0x4d, 0x6f, 0xac, 0x00]`. Payload is Borsh `String`.
Parse `{"option_index": N}` (runner schema) or `{"option": N}` or a bare integer.

GPT's `callback_from_llm` **rejects** remaining accounts that include its own
payer. Do not put that key in `callback_account_metas`. Keeper disc:
`sha256("global:callback_from_llm")[..8]` = `[0x40, 0xca, 0xd1, 0x27, 0x9c, 0x12, 0xd8, 0xaa]`.

Source: <https://github.com/magicblock-labs/super-smart-contracts/blob/main/programs/solana-gpt-oracle/src/lib.rs>
