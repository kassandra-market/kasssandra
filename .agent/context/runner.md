---
id: context-runner
title: AI runner — retired
tags: [context, runner, retired]
updated: 2026-09-09
---

# AI runner — retired

`kassandra-runner` was removed with the oracles program. The attested AI path
is MagicBlock `llm_oracle` talking to solana-gpt-oracle; markets `RequestAi`
CPI `interact_with_llm` and the GPT callback writes `Subject.resolved_option`.

See [`../memories/solana-gpt-oracle.md`](../memories/solana-gpt-oracle.md).
