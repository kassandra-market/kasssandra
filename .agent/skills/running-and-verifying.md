---
id: skill-running-verifying
title: "Skill: build, test & verify reliably"
tags: [skill, testing, verification]
updated: 2026-07-10
---

# Skill: build, test & verify reliably

The exact commands that work here, and the traps.

## Rust

```bash
just build                              # rebuild BOTH .so (do this before any test that loads a program)
cargo build --workspace                 # fast compile check
cargo clippy --workspace --all-targets  # lint — introduce NO new warnings vs baseline
cargo test --workspace                  # THE way to run tests (never -p)
```

- **Never `cargo test -p <crate>`** — it fails on a `Pod` feature-unification
  artifact across the granular solana crates. Use `--workspace`.
- **Rebuild `.so` before tests** — LiteSVM `include_bytes!`s them; a stale `.so`
  silently tests old bytecode (and, after a rename/layout change, "invalid
  instruction data").
- Clippy baseline (pre-existing, OK): `kassandra-oracles-sdk` lib+lib-test (1),
  `kassandra-runner` lib+lib-test (needless-borrows). Anything else is yours to fix.

## TypeScript SDKs

```bash
pnpm --filter @kassandra-market/oracles build      # tsc → dist
pnpm --filter @kassandra-market/oracles typecheck  # tsc --noEmit
pnpm --filter @kassandra-market/oracles test       # vitest (litesvm + decoders)
# markets depends on oracles dist — build oracles first if you changed it.
```

## App

```bash
pnpm --filter ./app typecheck            # tsc -b  (src only; NOT e2e/test)
pnpm --filter ./app lint                 # oxlint  (1 known standardWallet warning)
pnpm --filter ./app exec vitest run      # 215 unit tests
pnpm --filter ./app build                # vite + verify-css
```

To typecheck `app/e2e` + `app/test` (not in the default project), create a temp
tsconfig and delete it after:

```jsonc
// app/tsconfig.e2echeck.json
{ "extends": "./tsconfig.app.json",
  "compilerOptions": { "erasableSyntaxOnly": false },
  "include": ["src", "e2e", "test"] }
```
(`dev-full.ts` has a known pre-existing `indexer.kill()` boolean-into-void nit —
leave it.)

## Full gate

`make ci` runs the CI equivalent. Before opening a PR, at minimum: `cargo test
--workspace` + the three TS suites + `make version-check`.

## Verify ground truth, not diagnostics

rust-analyzer "unlinked-file"/"module not found" diagnostics **lag** during heavy
file churn (esp. after subagent edits). Trust `cargo build --workspace` /
`cargo test --workspace`, not stale IDE diagnostics.
