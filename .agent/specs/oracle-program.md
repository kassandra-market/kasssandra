---
id: spec-oracle-program
title: Oracle program — retired
tags: [spec, oracle, retired]
updated: 2026-09-09
---

# Oracle program — retired

`programs/oracles` and `sdks/oracles/{rust,ts}` were **removed**. Resolution is
a markets-owned **Subject** PDA that MagicBlock GPT stamps. See
[`market-program.md`](market-program.md) (`CreateSubject`, `RequestAi`, GPT
callback) and [`ephemeral-rollups-and-ai-oracle.md`](ephemeral-rollups-and-ai-oracle.md).

Historical design notes remain under `docs/plans/` (append-only; do not rewrite).
