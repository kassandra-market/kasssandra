---
id: spec-versioning-publishing
title: Versioning & publishing
tags: [spec, versioning, publishing, ci]
updated: 2026-07-10
source: Cargo.toml, scripts/sync-version.mjs, .github/workflows/publish.yml
---

# Versioning & publishing

## Single source of truth

`[workspace.package].version` in the root `Cargo.toml` is the ONE version.

- Every Rust crate uses `version.workspace = true`.
- The internal `[workspace.dependencies]` path deps carry an explicit `version`
  (so the SDK crates can publish to crates.io) — kept equal to the workspace
  version by the sync script.
- Both TS SDK `package.json` versions are stamped from it.

**To release:** bump `[workspace.package].version` once → `make version-sync`
(writes TS package.json + the path-dep versions) → commit → merge to master.
`make version-check` / `node scripts/sync-version.mjs --check` is the CI guard
(wired into the JS lane).

## `scripts/sync-version.mjs`

Reads `[workspace.package].version`, writes it into:
1. `sdks/oracles/ts/package.json`, `sdks/markets/ts/package.json`.
2. The internal Cargo path-dep `version` fields (`{ path = "…", version = "X" }`).

`--check` exits 1 if anything is out of sync.

## Publish workflow (`.github/workflows/publish.yml`)

On push to master (and `workflow_dispatch`), idempotent — skips any version
already on the registry.

- **crates.io**, in dependency order:
  `kassandra-oracles-program` → `kassandra-oracles-sdk` → `kassandra-markets-sdk`.
- **npm**: `@kassandra-market/oracles` → `@kassandra-market/markets`.
- Secrets: `CARGO_REGISTRY_TOKEN`, `NPM_TOKEN`. Scoped npm packages publish with
  `publishConfig.access: public`.

## Publish gotchas (don't undo)

- `kassandra-oracles-program`'s **dev-dep** on the oracle SDK is a *versionless
  path dep* (`{ path = "../../sdks/oracles/rust" }`), NOT the workspace dep — a
  versionless path dev-dep is stripped from the published manifest, which breaks
  the otherwise-cyclic publish (oracles-sdk → program → oracles-sdk).
- `programs/oracles/Cargo.toml` has `exclude = ["tests/"]` — the ~6.5 MiB of
  LiteSVM `.so` fixtures must stay out of the packaged crate.
- `runner`, `indexer`, `kassandra-markets-program` are `publish = false`.
- License: MIT (root `LICENSE`); crates carry `license`/`repository` via
  `[workspace.package]`.
