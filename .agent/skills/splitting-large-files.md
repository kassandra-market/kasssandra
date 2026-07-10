---
id: skill-splitting-large-files
title: "Skill: split a large file into a folder module"
tags: [skill, refactor, modules]
updated: 2026-07-10
---

# Skill: split a large file into a folder module

Convention here: keep files **under ~400 lines**. Splitting is a **pure
move/re-export** — identical behavior, byte layouts, and public API.

## Rust: `foo.rs` → `foo/`

1. `foo.rs` → `foo/mod.rs`.
2. Group items into cohesive `foo/<part>.rs` submodules by responsibility.
3. In `mod.rs`: `mod part;` + re-export everything previously `pub` at `foo::`
   (`pub use part::*;` or explicit) so external paths resolve unchanged. Widen
   cross-submodule private items to `pub(crate)`/`pub(super)`.
4. Each submodule declares its OWN `use` imports (Signer trait for `.pubkey()`,
   error/state types, `AccountMeta`, `Keypair`, `Ix`, …). Missing imports is the
   #1 mistake — `cargo build --workspace` must be clean.
5. Keep `#[cfg(test)] mod tests` beside its code or in `foo/tests.rs`.

### Rust integration tests (`tests/foo.rs`)
- KEEP `foo.rs` as the crate root: `//!` header, `mod common; use common::*;`,
  **the `include_bytes!("fixtures/*.so")` consts** (they resolve relative to the
  containing file — do NOT move them into a subdir), and `#[path = "foo/x.rs"] mod
  x;` declarations. Plain `mod x;` in a test root would look for `tests/x.rs` and
  create a stray test binary — use `#[path]` into `foo/`.
- Move `#[test]` groups into `foo/<group>.rs` with `use super::*;` + explicit
  external imports.
- `common/mod.rs` (shared helpers): keep it, move groups into `common/<g>.rs`,
  `pub use <g>::*;` so `common::foo` still resolves. If `impl X` blocks split
  across files, plain `mod <g>;` is fine (no re-export needed for inherent impls).

## TypeScript: `foo.ts` → `foo/`

1. `foo.ts` → `foo/index.ts` that re-exports the same symbols.
2. Group exports into `foo/<part>.ts`; shared local (non-exported) helpers → a
   `foo/shared.ts`. Use explicit `.js` extensions (SDKs) — the app omits extensions.
3. **`.js` does NOT resolve to `dir/index.ts`** under Bundler resolution — grep
   for direct importers of the old file (`from '.../foo.js'`) and update them to
   `.../foo/index.js`. Update the package barrel too.
4. Respect `noUnusedLocals` + `verbatimModuleSyntax` (`import type`).
5. If a `test/` file imports the target with an explicit extension you can't
   change, keep the original path as a thin re-export **keeper** + siblings.

## React `.tsx` pages/components

`Foo.tsx` → `Foo/index.tsx` (default + named exports preserved) + sibling
sub-components / hooks / `helpers.ts`. Update lazy-import paths in `App.tsx`.

## Verify

Build/typecheck/test the affected package(s) — see
[running-and-verifying.md](running-and-verifying.md). Test **counts** must be
unchanged (splitting a test file into more files keeps every test).
