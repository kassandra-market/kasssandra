---
id: context-runner
title: The AI runner (runner/)
tags: [context, runner, ai, offchain]
updated: 2026-07-10
---

# The AI runner (`runner/`)

`kassandra-runner` — an off-chain, **reproducible** binary that produces a
categorical AI claim for a disputed oracle and (optionally, `--submit`) signs +
sends the `submit_ai_claim` transaction.

## Pipeline (a black box: config in → 97-byte payload out)

```
config (--config JSON | --oracle over RPC)
  → fetch + verify agreed facts (content_hash == sha256(bytes))
  → assemble the canonical prompt (pinned interpretation + facts)
  → complete via a provider (Anthropic, or MockProvider offline)
  → hash: model_id ‖ params_hash ‖ io_hash  (each sha256, deterministic)
  → 97-byte submit_ai_claim payload = model_id[32] ‖ params_hash[32] ‖ io_hash[32] ‖ option[1]
```

The on-chain program stores the three 32-byte commitments **opaquely** — it does
NOT compute them. A challenger's independent re-run must reproduce them, so the
hashing scheme is the protocol contract (`runner/HASHING.md` + `runner/src/hashing/`).

## Determinism contract

- Every preimage byte is deterministic: fixed-width **big-endian** ints, 4-byte
  length-prefixed strings, no map iteration/locale/timestamps.
- `PROMPT_ASSEMBLY_VERSION` + `OUTPUT_SCHEMA_ID/VERSION` are folded into
  `params_hash` — bump them when prompt assembly / answer schema changes.

## Structure (post-split)

Folder modules: `cli/` (config/output/args/run + tests), `rpc/`, `fetch/`,
`submit/`, `prompt/`, `anthropic/`, `hashing/` — each re-exports its prior public
API from `mod.rs`.

## Testing

- Fully offline via `MockProvider` + a local mock Anthropic server (no API key).
- `hex`/`bs58`/`sha2` are used from their crates (no hand-rolled codecs).
- Verify with `cargo test --workspace` (NOT `-p`). The runner's `.so`-independent
  tests (hashing/e2e) run offline; `make dev` wires a real mock-Anthropic runner.
