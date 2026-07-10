---
id: skill-parallel-subagent-refactor
title: "Skill: fan wide mechanical work across subagents safely"
tags: [skill, subagents, refactor, parallelism]
updated: 2026-07-10
---

# Skill: fan wide mechanical work across subagents

For broad, repetitive, verifiable work (splitting every large file, sweeping a
rename), delegate per-package to subagents. Get the coordination right:

## Concurrency rules (learned the hard way)

- **Rust crates share one `target/` build lock.** Two agents editing different
  crates and both running `cargo build --workspace` cause cross-contamination
  (one compiles the other's half-edited files → spurious failures). → Run **Rust
  agents sequentially**, one at a time.
- **TS packages use pnpm, disjoint from cargo.** A TS agent can run **concurrently
  with a Rust agent** (different toolchain, different files).
- Among TS packages, respect the dep graph: `markets` imports `oracles` dist, the
  app imports both. Split leaf packages first or run them so a rebuild isn't
  racing a dependent's typecheck.
- Keep each agent's file scope **disjoint** and tell it exactly which dirs it may
  touch and which to stay out of.

## Prompt each agent to:

- Do a **pure move/re-export** (spell out: no behavior/API/byte-layout change).
- Add **all** needed imports itself (the common failure mode; see
  [splitting-large-files.md](splitting-large-files.md)).
- **Verify itself** and NOT spawn its own sub-agents (nested cleanup agents
  produced churn + you don't get their notifications). Require green
  `cargo build --workspace --tests` + `cargo test --workspace` (or the pnpm
  equivalent) before reporting.
- **Not commit** — leave changes in the tree; you commit per verified batch.

## Verify ground truth, then commit per batch

- Subagent reports and IDE diagnostics can be stale/optimistic. After each batch,
  run the authoritative `cargo build/clippy/test --workspace` (and pnpm suites)
  **yourself**, fix any residual missing-import issues, then commit a checkpoint.
- If an agent delegates to nested children and returns "waiting", you won't get
  the children's notifications — poll for the working tree to **settle** (a
  background Bash checking file sizes/stability, no cargo) then take over
  verification directly.

## Reference run

The "split every >400-line file" task: 5 verified checkpoint commits, one
subagent per package, Rust serial + TS concurrent, final gate `cargo test
--workspace` (525) + oracles 136 / markets 80 / app 215. See
[pr-workflow.md](pr-workflow.md).
