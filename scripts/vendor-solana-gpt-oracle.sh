#!/usr/bin/env bash
#
# vendor-solana-gpt-oracle.sh — rebuild MagicBlock solana-gpt-oracle artifacts
# used by LiteSVM + surfpool CI.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY A SOURCE BUILD (NOT A MAINNET DUMP)
# ─────────────────────────────────────────────────────────────────────────────
#
# MagicBlock's deployed program (`LLMrieZMpbJFwN52WgmBNMxYojrpRVYXdC1RCweEbab`)
# hardcodes `ORACLE_IDENTITY = A1ooMmN1fz6LbEFrjh6GukFS2ZeRYFzdyFjeafyyS7Ca`
# as the *only* signer `callback_from_llm` accepts. We do not hold that secret,
# and surfpool has no sigverify bypass, so a mainnet ELF cannot be driven in
# CI. The committed fixture is therefore the same program, rebuilt at a pinned
# SHA with `ORACLE_IDENTITY` swapped to MagicBlock's **public test keypair**
# (`tEsT3eV6RFCWs1BZ7AXTzasHqTtMnMLCB2tjQ42TDXD`).
#
# The off-chain keeper (`llm_oracle`) is NOT committed (host binary, ~6 MiB).
# CI clones this SHA, applies the same patches, and `cargo build -p llm_oracle`.
# A second patch makes `OPENROUTER_API_URL` overridable so CI can mock
# chatgpt_rs (which otherwise hardcodes https://openrouter.ai/...).
#
# SOURCE OF TRUTH:
#   github.com/magicblock-labs/super-smart-contracts
#   pin: 96f1143f86cb83ec3df98bae29df7b7c8a9f92f2
#        ("fix: improve oracle response handling")
#
# USAGE:
#   ./scripts/vendor-solana-gpt-oracle.sh                 # rebuild the .so fixture
#   ./scripts/vendor-solana-gpt-oracle.sh --llm-oracle    # .so + host llm_oracle
#   ./scripts/vendor-solana-gpt-oracle.sh --llm-oracle-only
#       # CI: skip SBF; print LLM_ORACLE_BIN=<path>
#
set -euo pipefail

PINNED_SHA="96f1143f86cb83ec3df98bae29df7b7c8a9f92f2"
REPO_URL="https://github.com/magicblock-labs/super-smart-contracts.git"
EXPECTED_SO_SHA="00553905d3a5a984766b13c4c605a8232dbe72b66cda50d4f26599f3b4cca9dc"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FIXTURE_DIR="${ROOT}/programs/oracles/tests/fixtures"
PATCH="${SCRIPT_DIR}/patches/solana-gpt-oracle/test-identity-and-openrouter.patch"
SRC_DIR="${SOLANA_GPT_ORACLE_SRC:-${TMPDIR:-/tmp}/solana-gpt-oracle-${PINNED_SHA}}"

DO_SBF=1
DO_LLM=0
for arg in "$@"; do
    case "${arg}" in
        --llm-oracle) DO_LLM=1 ;;
        --llm-oracle-only) DO_SBF=0; DO_LLM=1 ;;
        -h|--help)
            sed -n '2,34p' "$0"
            exit 0
            ;;
        *)
            echo "unknown arg: ${arg}" >&2
            exit 2
            ;;
    esac
done

sha_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

clone_and_patch() {
    if [[ ! -d "${SRC_DIR}/.git" ]]; then
        echo "Cloning ${REPO_URL} → ${SRC_DIR}" >&2
        git clone --filter=blob:none "${REPO_URL}" "${SRC_DIR}"
    fi
    git -C "${SRC_DIR}" fetch --filter=blob:none origin "${PINNED_SHA}" \
        || git -C "${SRC_DIR}" fetch --filter=blob:none origin
    git -C "${SRC_DIR}" checkout --force "${PINNED_SHA}"
    git -C "${SRC_DIR}" reset --hard "${PINNED_SHA}"
    git -C "${SRC_DIR}" apply "${PATCH}"
    echo "Patched ${SRC_DIR} @ ${PINNED_SHA}" >&2
}

clone_and_patch

if [[ "${DO_SBF}" -eq 1 ]]; then
    if ! command -v cargo-build-sbf >/dev/null 2>&1 && ! command -v cargo >/dev/null 2>&1; then
        echo "cargo-build-sbf is required to rebuild the fixture" >&2
        exit 1
    fi
    echo "Building solana-gpt-oracle SBF (test identity)…" >&2
    (
        cd "${SRC_DIR}"
        cargo build-sbf --manifest-path programs/solana-gpt-oracle/Cargo.toml
    )
    mkdir -p "${FIXTURE_DIR}"
    cp -f "${SRC_DIR}/target/deploy/solana_gpt_oracle.so" \
        "${FIXTURE_DIR}/solana_gpt_oracle.so"
    got="$(sha_of "${FIXTURE_DIR}/solana_gpt_oracle.so")"
    echo "Wrote ${FIXTURE_DIR}/solana_gpt_oracle.so sha256=${got}" >&2
    if [[ "${got}" != "${EXPECTED_SO_SHA}" ]]; then
        echo "WARNING: sha256 drift for solana_gpt_oracle.so" >&2
        echo "  expected ${EXPECTED_SO_SHA}" >&2
        echo "  got      ${got}" >&2
        echo "  SBF builds are not bit-stable across toolchains; review before committing." >&2
        exit 1
    fi
    echo "OK fixture sha256 pin matches" >&2
fi

if [[ "${DO_LLM}" -eq 1 ]]; then
    echo "Building llm_oracle (host, OpenRouter URL override patched)…" >&2
    (
        cd "${SRC_DIR}"
        cargo build --release -p llm_oracle
    )
    bin="${SRC_DIR}/target/release/llm_oracle"
    if [[ ! -x "${bin}" ]]; then
        echo "llm_oracle binary missing at ${bin}" >&2
        exit 1
    fi
    echo "LLM_ORACLE_BIN=${bin}"
fi
