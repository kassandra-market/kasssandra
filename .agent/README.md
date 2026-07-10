---
id: agent-kb-index
title: .agent knowledge base — index & protocol
tags: [meta, index, maintenance]
updated: 2026-07-10
---

# `.agent/` — the agent knowledge base

The durable, AI-first knowledge base for this repo. Entry point is
[`../AGENT.md`](../AGENT.md). Read the folder relevant to your task **before**
editing code; update it **as part of** finishing the work.

## Folders

| Folder | Purpose | When to write |
|---|---|---|
| `context/` | High-level notes summarizing each part of the codebase (what it is, where it lives, how it fits). | When a subsystem's shape/role changes. |
| `specs/` | Detailed, evolving specifications (instruction sets, account layouts, phases, versioning/publishing, testing infra). | When you change behavior, layouts, or process. Keep in lockstep with code. |
| `skills/` | Reusable procedures derived from work here (how to split files, verify, open a PR, run a parallel refactor). | When you find yourself repeating a non-trivial procedure. |
| `memories/` | Non-obvious facts & gotchas — the things that cost time to re-discover. | The moment you learn something remarkable. |

## Format (optimized for agent parsing)

Every file is **Markdown with a YAML frontmatter block**:

```yaml
---
id: kebab-case-unique-id
title: Human title
tags: [area, kind]
updated: YYYY-MM-DD
---
```

- One topic per file; keep them short. Prefer tables and lists over prose.
- Cross-link with **relative paths** (`../specs/oracle-program.md`).
- State facts with their source of truth (file path + symbol) so they're verifiable.
- When a fact names a file/symbol/flag, it may drift — verify against the code
  before relying on it, and fix the doc if it's stale.

## Index

### context
- [`context/overview.md`](context/overview.md) — the whole system in one page.
- [`context/programs.md`](context/programs.md) — the two on-chain (pinocchio) programs.
- [`context/sdks.md`](context/sdks.md) — the four SDKs (rust+ts × oracles+markets).
- [`context/app.md`](context/app.md) — the React/Vite dApp.
- [`context/runner.md`](context/runner.md) — the off-chain AI runner.
- [`context/indexer.md`](context/indexer.md) — the Carbon→Postgres indexer + read API.
- [`context/build-test-ci.md`](context/build-test-ci.md) — toolchains, commands, CI lanes.

### specs
- [`specs/oracle-program.md`](specs/oracle-program.md) — instructions, accounts, phases.
- [`specs/market-program.md`](specs/market-program.md) — instructions, accounts, lifecycle.
- [`specs/versioning-and-publishing.md`](specs/versioning-and-publishing.md) — single-source version + publish workflow.
- [`specs/testing-infrastructure.md`](specs/testing-infrastructure.md) — LiteSVM, surfpool, ephemeral Postgres, Playwright.

### skills
- [`skills/running-and-verifying.md`](skills/running-and-verifying.md) — how to build/test/lint reliably.
- [`skills/splitting-large-files.md`](skills/splitting-large-files.md) — module-splitting Rust & TS.
- [`skills/parallel-subagent-refactor.md`](skills/parallel-subagent-refactor.md) — fanning wide mechanical work across subagents safely.
- [`skills/pr-workflow.md`](skills/pr-workflow.md) — branch/commit/PR conventions here.

### memories
- [`memories/web3js-address-variant.md`](memories/web3js-address-variant.md)
- [`memories/program-and-sdk-naming.md`](memories/program-and-sdk-naming.md)
- [`memories/cargo-test-workspace-only.md`](memories/cargo-test-workspace-only.md)
- [`memories/rebuild-so-before-tests.md`](memories/rebuild-so-before-tests.md)
- [`memories/surfpool-gotchas.md`](memories/surfpool-gotchas.md)
- [`memories/external-crates-over-handrolled.md`](memories/external-crates-over-handrolled.md)
- [`memories/scaled-amounts-ui.md`](memories/scaled-amounts-ui.md)
- [`memories/markets-rust-v2-island.md`](memories/markets-rust-v2-island.md)
