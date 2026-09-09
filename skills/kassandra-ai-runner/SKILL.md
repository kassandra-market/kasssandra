---
name: kassandra-ai-runner
description: "Use when driving MagicBlock's llm_oracle keeper against a Kassandra Subject - requesting AI resolution via RequestAi, running the off-chain GPT oracle sidecar, or mocking OpenRouter in tests. The in-house kassandra-runner crate was removed."
---

# Driving MagicBlock's GPT oracle

Kassandra no longer ships an in-house AI runner. Markets own a **Subject** PDA;
`RequestAi` CPIs into MagicBlock `solana-gpt-oracle`, and the off-chain
`llm_oracle` keeper posts the callback that stamps `Subject.resolved_option`.

## On-chain path

1. `CreateSubject` — payer + nonce + `options_count` + `llm_context` pubkey.
2. `RequestAi` — subject + payer + prompt text. Pass `llmContext` in the TS
   builder so GPT remaining accounts (program, interaction PDA, context) are
   appended.
3. GPT callback (`sha256("global:callback_from_gpt_oracle")[..8]`) writes
   `status=Resolved` and `resolved_option`.
4. `ResolveMarket` reads the Subject and settles the binary sub-market.

Program id: `LLMrieZMpbJFwN52WgmBNMxYojrpRVYXdC1RCweEbab`.

## Off-chain keeper

Build MagicBlock's host binary from the pin in `scripts/vendor-solana-gpt-oracle.sh`
(`GPT_ORACLE_SHA`, currently `96f1143f…`):

```bash
./scripts/vendor-solana-gpt-oracle.sh --llm-oracle-only
```

Env the keeper needs:

- `IDENTITY` — MagicBlock identity secret (test identity is public; production
  identity is not committed).
- `RPC_URL` / `WEBSOCKET_URL`
- `OPENROUTER_API_KEY` / `OPENROUTER_API_URL` (override the latter to a mock)

Surfpool GPT e2e **must** use `--offline`. Mainnet-forked identity/counter PDAs
make Anchor `initialize` fail. Fixture ELF:
`programs/markets/tests/fixtures/solana_gpt_oracle.so` (test identity
`tEsT3eV6RFCWs1BZ7AXTzasHqTtMnMLCB2tjQ42TDXD`).

## Tests

The gated suite is
`sdks/markets/ts/test/surfpool/gpt-oracle-e2e.test.ts`
(`KASSANDRA_MARKET_E2E=1`). It deploys the tracked ELF, stands up a Subject,
calls `RequestAi`, runs `llm_oracle` against `MockOpenRouter`, and asserts
`Subject.resolved_option`.

Do **not** commit a host `llm_oracle` binary. CI builds it at the pin.
