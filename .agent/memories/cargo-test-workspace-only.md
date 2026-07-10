---
id: mem-cargo-test-workspace-only
title: "cargo test -p fails — use --workspace"
tags: [memory, gotcha, rust, testing]
updated: 2026-07-10
---

# `cargo test -p <crate>` fails; use `cargo test --workspace`

Running a single crate in isolation (e.g. `cargo test -p kassandra-indexer` or
`-p kassandra-oracles-program`) fails to compile with a `Pod` trait error like:

```
the trait bound `kassandra_oracles_program::state::Oracle: Pod` is not satisfied
```

This is a **feature-unification artifact**: the `bytemuck`/Pod features on the
program crate only get enabled when the whole workspace's feature sets unify. In
isolation the needed feature is off.

**Always test via the whole workspace:** `cargo test --workspace`. Same for
`cargo build --workspace` / `cargo clippy --workspace`. A subagent that "verified
with `-p`" hasn't actually verified.
