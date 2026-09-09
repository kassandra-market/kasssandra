---
id: context-build-test-ci
title: Build, test & CI
tags: [context, build, test, ci, toolchain]
updated: 2026-09-09
---

# Build, test & CI

## Toolchains

- **Rust** — `rust-toolchain.toml` pins `stable`; SBF via `cargo build-sbf` (Anza
  toolchain). Root Cargo workspace; release has `overflow-checks = true`.
- **JS** — pnpm v10, Node 20 (CI). pnpm workspace: `sdks/markets/ts`, `app`,
  `docs-site`.
- **Docs site** — Mintlify `mint` CLI needs **Node 20** (fails on newer defaults).

## Command surface (Makefile is the front door)

| Command | Does |
|---|---|
| `just build` | Build the markets `.so`. |
| `make setup` | First-run: install deps + build program + SDK. |
| `make build` | Build everything (program, SDK, app, indexer). |
| `make test` | All unit tests (rust workspace + SDK + app + indexer). |
| `make lint` | oxlint (app) + `cargo clippy` (workspace + indexer). |
| `make typecheck` | Build SDK + typecheck SDK + app. |
| `make fmt` / `make fmt-check` | Rust formatting. |
| `make dev` | Full local stack (surfpool + indexer + app). |
| `make ci` | What CI runs. |
| `make version-sync` / `make version-check` | Single-source version stamping / guard. |

## The one testing rule that bites everyone

- Prefer **`cargo test --workspace`**.
  ([`../memories/cargo-test-workspace-only.md`](../memories/cargo-test-workspace-only.md))
- **Run `just build` before `cargo test`** — LiteSVM tests `include_bytes!` the
  `.so`. ([`../memories/rebuild-so-before-tests.md`](../memories/rebuild-so-before-tests.md))

## CI lanes (`.github/workflows/ci.yml`)

- **Build · SBF program** — builds the markets `.so`, uploads it as an artifact.
- **Rust** — program + rust SDK + indexer (`cargo test --workspace`).
- **TS · build · typecheck · lint · unit** — builds SDK `dist/`, typechecks
  SDK + app, oxlint, vitest; runs the version-parity check.
- **Indexer · Postgres integration** — ephemeral Postgres, db-layer tests.
- **E2E · GPT oracle + mock OpenRouter (offline)** — tracked GPT ELF +
  `llm_oracle` against a local OpenRouter mock (no live API).
- **E2E · surfpool + Playwright (browser)** — the local-simnet browser suite.
- **E2E · indexer + candles (Postgres)** — ephemeral PG + real indexer + chart.
- **Docs** workflow builds the Mintlify site.

## Publishing

`.github/workflows/publish.yml` on push to master publishes (idempotent,
skip-if-already-on-registry) crates.io: `kassandra-markets-sdk`, and npm:
`@kassandra-market/markets`. Needs repo secrets `CARGO_REGISTRY_TOKEN` +
`NPM_TOKEN`. See
[`../specs/versioning-and-publishing.md`](../specs/versioning-and-publishing.md).
