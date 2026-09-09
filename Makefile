# Kassandra — one entrypoint for every useful task.
#
# `make` (or `make help`) lists every target. Targets delegate to the underlying
# tools (cargo, just, pnpm, and scripts/*.sh) so there is a single surface to
# remember. Grouped: setup · build · test · lint · dev (local nodes + seed) · docs.
#
# This repo hosts the prediction-market program (`programs/markets`), resolved
# by MagicBlock's GPT oracle, a single web app (`app/`), and a Postgres-backed
# indexer (`indexer/`).
#
# Requirements: rust + the Solana/Anza toolchain (cargo build-sbf), `just`, pnpm,
# and — for the e2e / dev targets — `surfpool` and Postgres (initdb/pg_ctl).

# Use bash with strict flags for recipe reliability.
SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
help: ## List all targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | sort \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  Common flows:  make setup  ·  make test  ·  make lint  ·  make dev"

# ===== Setup ================================================================
setup: install build-program build-sdk ## Install deps + build the program (.so) & SDK (first-run bootstrap)

install: ## Install JS workspace deps (frozen lockfile)
	corepack enable >/dev/null 2>&1 || true
	pnpm install --frozen-lockfile

# ===== Build ================================================================
build: build-program build-sdk build-app build-indexer ## Build everything

build-program: ## Build the SBF program artifact (market → target/deploy/*.so)
	just build

build-sdk: ## Build the TypeScript SDK (@kassandra-market/markets → dist/)
	pnpm --filter @kassandra-market/markets build

version-sync: ## Stamp Cargo [workspace.package].version into the TS SDK package.json files
	node scripts/sync-version.mjs

version-check: ## Verify every TS SDK version matches the workspace version (CI guard)
	node scripts/sync-version.mjs --check

build-app: build-sdk ## Build the web app (Vite → app/dist)
	pnpm --filter ./app build

build-indexer: ## Build the indexer service (release)
	cargo build --release --locked --manifest-path indexer/Cargo.toml

# ===== Test =================================================================
test: test-rust test-sdk test-app test-indexer ## Run all UNIT tests (rust workspace + sdk + app + indexer)

test-rust: build-program ## Rust workspace tests (program LiteSVM + rust SDK + indexer)
	cargo test --workspace

test-program: ## Program tests only (rebuilds the .so first)
	just test

test-sdk: ## Markets SDK vitest (litesvm + decoders)
	pnpm --filter @kassandra-market/markets test

test-app: ## App vitest (unit + render)
	pnpm --filter ./app test

test-indexer: ## Indexer cargo tests
	cargo test --manifest-path indexer/Cargo.toml

test-e2e: ## Browser E2E: surfpool + funded wallet + app (scripts/e2e-playwright.sh)
	scripts/e2e-playwright.sh

test-e2e-indexer: ## Browser E2E: surfpool + Postgres + indexer + app
	scripts/e2e-playwright-indexer.sh

test-e2e-candles: ## Browser E2E: surfpool + ws + Postgres + indexer + app candlestick chart
	scripts/e2e-playwright-candles.sh

test-all: test test-e2e test-e2e-indexer ## Every test incl. the (non-forked) browser E2E suites

# ===== Lint / typecheck / format ===========================================
lint: ## Lint: app (oxlint) + rust clippy (workspace + indexer)
	pnpm --filter ./app lint
	cargo clippy --workspace --all-targets
	cargo clippy --manifest-path indexer/Cargo.toml --all-targets

typecheck: build-sdk ## Typecheck SDK + app
	pnpm --filter @kassandra-market/markets typecheck
	pnpm --filter ./app typecheck

fmt: ## Format Rust (cargo fmt)
	cargo fmt --all
	cargo fmt --manifest-path indexer/Cargo.toml

fmt-check: ## Check Rust formatting without writing
	cargo fmt --all --check
	cargo fmt --manifest-path indexer/Cargo.toml --check

# ===== Dev: local nodes + seed =============================================
# Ports (surfpool 8899, indexer 3111, app 5173) are fixed defaults, shared by
# every checkout on this host. Running a second worktree's dev stack while
# one is already up on the same ports WILL kill the other's surfpool out from
# under its indexer (dev-full.sh's crashed-run cleanup can't tell them apart)
# — that live indexer then fails every getBlockhash call. Set distinct
# SURFPOOL_PORT/INDEXER_PORT/APP_PORT env vars per concurrent worktree, e.g.
# `SURFPOOL_PORT=8901 INDEXER_PORT=3112 APP_PORT=5175 make dev`.
chain: ## Boot surfpool + deploy + seed markets, and HOLD (Ctrl-C to stop)
	scripts/dev-up.sh chain

app-local: ## Run the app dev server against the local surfpool (VITE_E2E funded wallet)
	scripts/dev-up.sh app

dev: ## Full production-like local stack: surfpool + indexer + app (real wallet); logs/ + Ctrl-C teardown
	scripts/dev-full.sh

dev-e2e: ## Lighter dev: seeded chain + app in VITE_E2E mode (auto-connected scripted wallet, no indexer)
	scripts/dev-up.sh all

indexer-run: ## Run the indexer binary (needs RPC_URL + DATABASE_URL in the env)
	cargo run --release --manifest-path indexer/Cargo.toml

# ===== Docs ================================================================
docs: ## Serve the Mintlify docs locally (needs Node 20 — see docs-site/README)
	pnpm --filter kassandra-docs-site dev

# ===== CI mirror / housekeeping ============================================
ci: ## Run what CI runs: build .so, rust workspace tests, and the JS lane
	just build
	cargo test --workspace
	pnpm --filter @kassandra-market/markets build
	pnpm --filter @kassandra-market/markets test
	pnpm --filter ./app typecheck
	pnpm --filter ./app lint
	pnpm --filter ./app test

clean: ## Remove build artifacts (cargo target, dist, indexer target)
	cargo clean
	cargo clean --manifest-path indexer/Cargo.toml
	rm -rf app/dist sdks/markets/ts/dist

.PHONY: help setup install build build-program build-sdk build-app \
        build-indexer test test-rust test-program test-sdk test-app test-indexer \
        test-e2e test-e2e-indexer test-all lint typecheck fmt \
        fmt-check chain app-local dev indexer-run docs ci clean
