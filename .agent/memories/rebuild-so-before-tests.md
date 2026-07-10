---
id: mem-rebuild-so-before-tests
title: "Rebuild the .so before running Rust tests"
tags: [memory, gotcha, litesvm, build]
updated: 2026-07-10
---

# Rebuild the `.so` before Rust tests (`just build`)

The LiteSVM tests `include_bytes!` the compiled program `.so`
(`target/deploy/kassandra_oracles_program.so`,
`kassandra_markets_program.so`). `cargo test` does **not** rebuild the SBF `.so`
(that's `cargo build-sbf`), so a stale `.so` means you test **old bytecode**.

**Always run `just build` before `cargo test --workspace`** when you've changed a
program's source (or after a rename/layout change). The classic symptom of a
stale `.so` is `invalid instruction data` (the SDK's new layout no longer matches
the deployed old program).

Dev/e2e scripts always rebuild the `.so` for this reason.
