#!/usr/bin/env bash
#
# dev-full.sh — bring up the FULL production-like local stack in one command:
# surfpool (seeded markets) + indexer (ephemeral Postgres) + the
# app in real-wallet mode. Driven by `make dev`.
#
# Requires: surfpool (or SURFPOOL_BIN), the Solana toolchain (to build the .so),
# and Postgres client binaries (`initdb`/`pg_ctl` — or PG_BIN).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> [1/4] preflight: surfpool + postgres binaries"
if ! command -v surfpool >/dev/null 2>&1 && [ -z "${SURFPOOL_BIN:-}" ]; then
  echo "ERROR: surfpool not found on PATH (set SURFPOOL_BIN)." >&2
  exit 1
fi
if ! command -v initdb >/dev/null 2>&1 && [ -z "${PG_BIN:-}" ] \
   && [ ! -x /opt/homebrew/opt/postgresql@16/bin/initdb ] \
   && [ ! -x /opt/homebrew/opt/postgresql@15/bin/initdb ] \
   && [ ! -x /usr/lib/postgresql/16/bin/initdb ] \
   && [ ! -x /usr/lib/postgresql/15/bin/initdb ]; then
  echo "ERROR: postgres binaries (initdb) not found. Set PG_BIN to their directory." >&2
  exit 1
fi

echo "==> [2/4] build the market program (.so), the markets SDK, and the indexer binary"
just build
pnpm --filter @kassandra-market/markets build >/dev/null
cargo build --release --locked --manifest-path indexer/Cargo.toml

echo "==> [3/4] ensure logs/ exists + clear leftovers from a crashed run"
mkdir -p logs
# `make dev` OWNS ITS OWN PORT, so a surfpool still listening on it is assumed
# to be a leftover from a previously HARD-killed run of THIS stack (a clean
# Ctrl-C tears it down). Reusing it would make init_protocol fail with
# AlreadyInitialized, so clear it. SURFPOOL_PORT defaults to 8899 but is
# env-overridable (see app/e2e/dev/env.ts) — set it to a distinct value per
# worktree/checkout running concurrently on the same host, or this WILL kill
# a different worktree's live surfpool out from under its indexer (which then
# fails every getBlockhash call once its RPC connection is dead).
# (The ephemeral Postgres picks a fresh port per run, so it needs no cleanup.)
export SURFPOOL_PORT="${SURFPOOL_PORT:-8899}"
if command -v lsof >/dev/null 2>&1; then
  leftover="$(lsof -tiTCP:"$SURFPOOL_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$leftover" ]; then
    echo "    clearing a leftover process on :$SURFPOOL_PORT (previous run): $leftover"
    echo "$leftover" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
fi

echo "==> [4/4] launching the stack (Ctrl-C to stop everything)"
exec pnpm --filter app exec tsx e2e/dev-full.ts
