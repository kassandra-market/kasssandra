---
name: kassandra-ai-runner
description: "Use when producing, submitting, or verifying a Kassandra AI claim - i.e. running the open-source kassandra-runner to resolve an oracle over its agreed fact set, submitting the on-chain submit_ai_claim as a proposer, or reproducing a claim to decide whether to challenge it. Covers the run and verify subcommands, config sources, keeper (--submit) mode, and the pinned model."
---

# Running the Kassandra AI runner

`kassandra-runner` is the open-source, reproducible AI runner. It assembles the pinned prompt
+ interpretation + agreed fact set, calls a model behind a provider trait, and emits the
on-chain claim metadata — the 97-byte `submit_ai_claim` payload
`model_id[32] || params_hash[32] || io_hash[32] || option[1]`. Anyone runs it to propose a
claim, or to verify one before challenging.

Build/install the `kassandra-runner` crate; it needs an `ANTHROPIC_API_KEY` env var for the
default provider (or use `--mock` for offline/deterministic runs). `ANTHROPIC_BASE_URL`
overrides the API base.

## Subcommands

- **`run`** — resolve an oracle: fetch + verify facts, call the model, print the claim
  metadata + the 97-byte payload as JSON.
- **`verify`** — re-run for the same config and compare the produced `option` to a submitted
  claim's option; advises whether to challenge.

## Config source (pick one)

- `--config <path.json>` — an explicit config (or stdin if omitted).
- `--oracle <pubkey> --rpc-url <url> --prompt-file <path>` — build the config from chain: the
  oracle's `options_count`/`deadline`/agreed facts are read over RPC, and the interpretation
  text comes from `--prompt-file`, whose **sha256 must equal** the on-chain `oracle.prompt_hash`
  (else the run is rejected).

Model knobs: `--model` (default `claude-opus-4-8`), `--max-tokens` (default `4096`), `--mock`.

## Submit as a keeper

`run --submit` signs + sends + confirms the `submit_ai_claim` transaction itself:

```bash
kassandra-runner run \
  --oracle <ORACLE_PUBKEY> --rpc-url <RPC_URL> --prompt-file interpretation.txt \
  --submit --keypair ~/.config/solana/id.json
```

The `--keypair` MUST be the proposer's registered `authority`; the Proposer PDA is derived
from the oracle + the keypair pubkey. Without `--submit` it only emits the payload (no network
write) — you can then submit it yourself via the SDK (`submitAiClaim` / `ix::submit_ai_claim`).

## Verify before challenging

```bash
kassandra-runner verify \
  --oracle <ORACLE_PUBKEY> --rpc-url <RPC_URL> --prompt-file interpretation.txt \
  --option <SUBMITTED_OPTION>
```

If your reproduced option differs from the submitted one, that's your signal to open a
challenge market against the claim.

## Determinism caveat

`model_id` and `params_hash` reproduce byte-for-byte; `io_hash` is a **commitment**, not a
bit-identical transcript — a challenger reproduces the categorical **option**, not the exact
model text. Fabrication is caught economically (via the decision market), not by on-chain
verification.
