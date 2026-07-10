---
id: context-build-test-ci
title: Build, test & CI
tags: [context, build, test, ci, toolchain]
updated: 2026-07-10
---

# Build, test & CI

## Toolchains

- **Rust** — `rust-toolchain.toml` pins `stable`; SBF via `cargo build-sbf` (Anza
  toolchain). Root Cargo workspace; release has `overflow-checks = true`.
- **JS** — pnpm v10, Node 20 (CI). pnpm workspace: `sdks/oracles/ts`,
  `sdks/markets/ts`, `app`, `docs-site`.
- **Docs site** — Mintlify `mint` CLI needs **Node 20** (fails on newer defaults).

## Command surface (Makefile is the front door)

| Command | Does |
|---|---|
| `just build` | Build BOTH `.so` (oracle + market). Also `just build-oracle` / `just build-market`. |
| `make setup` | First-run: install deps + build programs + SDKs. |
| `make build` | Build everything (programs, SDKs, app, runner, indexer). |
| `make test` | All unit tests (rust workspace + SDKs + app + indexer). |
| `make lint` | oxlint (app) + `cargo clippy` (workspace + indexer). |
| `make typecheck` | Build SDKs + typecheck SDKs + app. |
| `make fmt` / `make fmt-check` | Rust formatting. |
| `make dev` | Full local stack (surfpool + indexer + mock-runner + app). |
| `make ci` | What CI runs. |
| `make version-sync` / `make version-check` | Single-source version stamping / guard. |

## The one testing rule that bites everyone

- **`cargo test -p <crate>` FAILS** here (a `Pod` feature-unification artifact
  across the granular solana crates). Always **`cargo test --workspace`**.
  ([`../memories/cargo-test-workspace-only.md`](../memories/cargo-test-workspace-only.md))
- **Run `just build` before `cargo test`** — LiteSVM tests `include_bytes!` the
  `.so`. ([`../memories/rebuild-so-before-tests.md`](../memories/rebuild-so-before-tests.md))

## CI lanes (`.github/workflows/ci.yml`)

- **Build · SBF program** — builds both `.so`, uploads them as an artifact.
- **Rust** — program + runner + rust SDK tests (`cargo test --workspace`), clippy.
- **TS · build · typecheck · lint · unit** — builds both SDK `dist/`, typechecks
  SDKs + app, oxlint, vitest; runs the version-parity check.
- **Indexer · Postgres integration** — ephemeral Postgres, db-layer tests.
- **E2E · real runner + mock Anthropic (offline)** — the surfpool runner test.
- **E2E · surfpool + Playwright (browser)** — the local-simnet browser suite.
- **E2E · indexer + candles (Postgres)** — ephemeral PG + real indexer + chart.
- **Docs** workflow builds the Mintlify site.

## Publishing

`.github/workflows/publish.yml` on push to master publishes (idempotent,
skip-if-already-on-registry) crates.io: `kassandra-oracles-program` →
`kassandra-oracles-sdk` → `kassandra-markets-sdk`, and npm:
`@kassandra-market/oracles` → `@kassandra-market/markets`. Needs repo secrets
`CARGO_REGISTRY_TOKEN` + `NPM_TOKEN`. See
[`../specs/versioning-and-publishing.md`](../specs/versioning-and-publishing.md).

## Verification snapshot (current green baseline)

- Rust: `cargo test --workspace` → all pass (0 failures); clippy has a small,
  known pre-existing warning set (`kassandra-oracles-sdk` lib/lib-test,
  `kassandra-runner` lib/lib-test needless-borrows) — introduce **no new** warnings.
- TS: `@kassandra-market/oracles` 136 (+1 skipped), `@kassandra-market/markets`
  80, `app` 215.
