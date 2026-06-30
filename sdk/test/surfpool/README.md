# Kassandra surfpool E2E (gated)

End-to-end tests that drive the **real** Kassandra oracle lifecycle against a
**real RPC validator** ([surfpool](https://github.com/txtx/surfpool)), built by
the merged SDK's web3.js v3 instruction builders and sent as real transactions,
with the **off-chain runner in the loop** producing AI claims from a controllable
**mock Anthropic server**. The forked-MetaDAO challenge-market path is pushed as
far as tractable, and the **full futarchy governance loop** (proposal → real TWAP
verdict → Squads execute → Kassandra config change) runs end to end on forked
mainnet — see "Full futarchy governance" below.

This suite is **GATED / opt-in**: the default `pnpm test` (88 tests) stays fast,
offline, and never spawns surfpool. The E2E suite only runs under
`KASSANDRA_E2E=1` (see `sdk/vitest.config.ts`, which excludes
`test/surfpool/**` otherwise) and **skips cleanly** (does not fail) when surfpool
/ the program `.so` / the runner binary are absent.

## Prerequisites

1. **surfpool** on `PATH` (or set `SURFPOOL_BIN`). Tested against surfpool
   `1.0.0` (`~/.local/bin/surfpool`).
2. **The program artifact:** `just build` → `target/deploy/kassandra_program.so`
   (deployed at the fixed program id via the `surfnet_setAccount` cheatcode).
3. **The runner binary** (for the lifecycle / runner-against-mock arms):
   `cargo build -p kassandra-runner` → `target/debug/kassandra-runner`.
4. **Network access.** surfpool 1.0.0 always boots against a datasource
   (mainnet by default), so even the standalone core path needs network at boot.
   The **challenge-market** and **futarchy-governance** arms **fork mainnet**
   (`--network mainnet`) and lazily fetch the deployed MetaDAO programs over RPC —
   so they need network and are **slower** than the local core path. The
   futarchy-governance arm requires the deployed futarchy **v0.6.1**.

## How to run

```sh
cd sdk
pnpm test          # default: 88 tests, offline, no surfpool
KASSANDRA_E2E=1 pnpm test:e2e   # gated E2E: 98 tests (spawns surfpool, needs network for the forks)
# a single arm:
KASSANDRA_E2E=1 pnpm exec vitest run test/surfpool/challenge-market-e2e.test.ts
KASSANDRA_E2E=1 pnpm exec vitest run test/surfpool/futarchy-governance-e2e.test.ts
```

The harness (`harness.ts` `SurfpoolHarness`) spawns `surfpool start --no-tui
--block-production-mode transaction --no-deploy [--network mainnet]`, polls
`getHealth`, writes the `.so` at the fixed id, and tears the process down. Each
suite owns a distinct port (smoke 8899, lifecycle 8901, challenge 8920,
futarchy-governance 8921) so they never collide.

## Files

| file | what |
| --- | --- |
| `harness.ts` | `SurfpoolHarness` (spawn → wait → deploy → teardown), cheatcode helpers (`setAccount`, `airdrop`, `timeTravel`/`advanceToUnix`), SPL byte fabrication. `fork: "mainnet"` boots a forked simnet (T4). |
| `mock-anthropic.ts` | A local `node:http` Anthropic Messages mock (`POST /v1/messages`) returning the exact shape the runner's `parse_messages_response` consumes; `setOption(N)` / `setRefusal(...)`. |
| `run-runner.ts` | Invoke the real runner binary (`AnthropicProvider` → the mock) and capture the claim metadata. |
| `surfpool-smoke.test.ts` | T1: surfpool up → `.so` deployed → `initProtocol` over RPC → decode Protocol. |
| `runner-mock-anthropic.test.ts` | T2: the real runner against the mock (success + refusal). No surfpool. |
| `lifecycle-e2e.test.ts` | T3: full core lifecycle on a standalone simnet — uncontested resolve + dispute→AI-claim (runner in the loop). |
| `challenge-market-e2e.test.ts` | T4: the challenge-market path against **forked-mainnet** MetaDAO programs. |
| `futarchy-governance-e2e.test.ts` | G3: the FULL futarchy governance loop against **forked-mainnet** MetaDAO programs — bootstrap → staged Squads VaultTransaction → proposal → real TWAP verdict → `vault_transaction_execute` → Kassandra `set_config` + `resolve_deadend` applied on-chain. Requires futarchy **v0.6.1** (the deployed program). |

## Full futarchy governance (G3)

`futarchy-governance-e2e.test.ts` is the headline loop: it proves that a **real
MetaDAO futarchy proposal**, decided by a **real swap-driven TWAP verdict**,
drives a **real Squads v4 `vault_transaction_execute`** that applies a **real
Kassandra `set_config` + `resolve_deadend`** — end to end on **forked mainnet**,
through the actually-deployed programs (futarchy **v0.6.1** `FUTARELBf…`,
conditional_vault `VLTX1ish…`, Squads v4 `SQDS4ep6…`).

### What the loop proves

1. **Bootstrap (real).** `bootstrapGovernance` runs the real `initialize_dao`
   (which atomically creates the `Dao` + the Squads multisig with
   `create_key==Dao` + vault; the Squads `ProgramConfig.treasury` is fetched LIVE
   from the on-chain account) then the **G1-hardened `set_governance`** handoff.
   Asserts on-chain `governanceSet==1`, `daoAuthority==vault`, `kassDao==dao` —
   i.e. G1's hardened linkage check validated against the REAL Squads vault /
   futarchy DAO (owner==`FUTARCHY_ID` + Dao discriminator; `dao_authority` == the
   vault PDA derived `create_key==Dao → multisig → vault 0`).
2. **Stage (real).** A Kassandra `set_config` (sentinel `total_supply_cap`) **and**
   a `resolve_deadend` are staged as **two inner CPIs in ONE Squads
   `VaultTransaction`** (a hand-encoded compact `TransactionMessage`), with a
   `proposal_create(draft:false → Active)`, signed by MetaDAO's public
   permissionless member (`EP3SoC2…`).
3. **Proposal + markets (real).** `initialize_question` (oracle == the futarchy
   Proposal PDA) + base/quote `initialize_conditional_vault` → `initialize_proposal`
   → `launch_proposal` stands up the embedded conditional pass/fail AMM markets.
4. **Verdict (FULLY REAL, swap-driven TWAP).** A trader splits USDC into
   conditional pass/fail quote tokens, then runs **4 real `conditional_swap`
   Buy-Pass** transactions spaced **>60s apart** (via `surfnet_timeTravel`, the
   oracle's 60s rate-limit) to raise the pass observation, then jumps past
   `enqueue + 86400` and a final swap stamps the oracle beyond the
   ProposalTooYoung / MarketsTooYoung windows. `finalize_proposal` resolves
   **Passed** (and CPIs Squads `proposal_approve`).
5. **Execute (real).** `vault_transaction_execute` (member = permissionless)
   `invoke_signed`s BOTH CPIs as the Squads vault. **Headline assertion:**
   on-chain `Protocol.total_supply_cap` == the sentinel; **second arm:** the
   dead-ended oracle is now `Phase::Resolved` with the governance-chosen
   `resolved_option`.
6. **Live `kass_price` (real Dao).** Reads the futarchy spot TWAP from the REAL
   `Dao` (not a fabricated blob) and asserts it is > 0.

### How to run

```sh
cd sdk
KASSANDRA_E2E=1 pnpm exec vitest run test/surfpool/futarchy-governance-e2e.test.ts
```

Needs **network** (it forks mainnet to load MetaDAO's deployed programs) and the
deployed futarchy program is **v0.6.1** — the SDK builders are pinned to that
on-chain IDL (see `sdk/src/futarchy/NOTES.md`, "G3 ADDENDUM"). Skips cleanly
(does not fail) when surfpool / the `.so` is absent.

### Honesty notes (read before trusting the assertion)

1. **The pass margin is thin (determinism over economic width).** The DAO is
   bootstrapped with `passThresholdBps=0` and a ~1.0 starting TWAP on BOTH legs,
   so the pass margin the swaps need to manufacture is narrow. The verdict is
   **genuinely swap-driven** — a falsification run confirms it: removing
   `vault_transaction_execute` makes the headline assertion FAIL, so the config
   change is not seeded — but the test deliberately optimizes for a deterministic
   pass on a fork rather than a wide economic margin. Treat it as a proof of the
   *mechanism*, not of economic robustness.
2. **Input state is fabricated; the GOVERNED OUTCOMES are real.** The dead-end
   oracle and the token / LP balances are `surfnet_setAccount` fabrications — the
   established T4 input-materialization pattern (owner / size / type-tag only,
   canonical SPL or Kassandra bytes). What flows through the REAL programs are the
   **outcomes**: the `set_config` change, the oracle resolution, and the TWAP
   verdict itself all execute through the real futarchy / Squads / Kassandra
   programs. Do not mistake input-fabrication for a faked result — the inputs are
   fabricated, the outcomes are real.
3. **`kass_price` is read via `simulateTransaction`.** The live `kass_price` value
   is a **read-only price query** (the instruction's return data, fetched through
   `simulateTransaction`), NOT part of the verdict / execution path. It confirms a
   real on-chain DAO's spot TWAP is readable; it does not gate the proposal.

## Covered vs deferred

### Covered (proven, real over RPC)

- **FULL futarchy governance loop, on forked mainnet (G3).** The real
  proposal → swap-driven TWAP verdict → Squads `vault_transaction_execute` →
  Kassandra `set_config` + `resolve_deadend` applied on-chain, end to end — see
  "Full futarchy governance" above (incl. the three honesty notes: thin pass
  margin, fabricated-inputs-vs-real-outcomes, `kass_price`-via-simulate).
- **Live `kass_price` from the REAL futarchy Dao (G3).** Read via
  `simulateTransaction` return data from the genuine on-chain `Dao` (no fabricated
  `Dao` blob) — a read-only query, not the verdict path.
- **The G1-hardened `set_governance` handoff, validated live (G3).** The
  on-chain linkage check (`kass_dao` owned by `FUTARCHY_ID` + Dao discriminator;
  `dao_authority` == the derived Squads vault) is exercised against the REAL
  Squads vault / futarchy DAO produced by `bootstrapGovernance`.

- **Core lifecycle, fully real (T3).** On a standalone simnet, every phase is
  driven by REAL Kassandra instructions over RPC — no `setAccount` seeding of any
  Kassandra program account or phase. Two arms:
  - **Uncontested resolve:** `initProtocol → createOracle → propose×3 (same
    option) → finalizeProposals` ⇒ Oracle `Resolved` + the agreed option (decoded
    over RPC); the stake vault holds Σ bonds.
  - **Dispute → AI-claim (runner in the loop):** `create → propose×2 conflicting
    → finalizeProposals → submitFact → advancePhase → voteFact → finalizeFacts →`
    **run the real runner** (genuine `AnthropicProvider` → the mock server,
    `setOption(N)`) `→ submitAiClaimFromRunner → finalizeAiClaims →
    finalizeOracle` ⇒ Oracle `Resolved` with the AI's option, and the on-chain
    `AiClaim` decodes to the runner's exact model_id/params_hash/io_hash/option.
  - The only fabricated state is SPL plumbing (mints + funded KASS token
    accounts), packed as canonical SPL bytes; the program's own SPL CPIs run
    against the real Token program. Phase windows are crossed with
    `surfnet_timeTravel` (it moves the Clock `unix_timestamp` at ~0.4 s/slot, the
    value the program's `now()` reads).
- **Runner real-provider path (T2).** The real `AnthropicProvider` HTTP + parse
  path is exercised against controllable mock responses (success + refusal).
- **Challenge-market on FORKED MetaDAO (T4).**
  - **Programs load.** All five MetaDAO program ids (conditional-vault `VLTX1ish…`,
    AMM v0.4 `AMMyu265…`, futarchy v0.6 `FUTARELBf…`, Meteora DAMM v2, Squads v4)
    are fetched from the mainnet fork as `executable` BPF-upgradeable programs.
  - **Conditional-vault EXECUTES.** A real `initialize_question` CPI against the
    forked vault creates the on-chain `Question` (decoded `oracle`/`num_outcomes`
    match) — far past "program not found".
  - **A challenge is OPENED.** The full dispute core is driven to `Challenge`,
    the MetaDAO market is COMPOSED over RPC (real `initialize_question` +
    KASS/USDC `initialize_conditional_vault` CPIs), and the Kassandra
    `openChallenge` instruction is sent. Its **program-signed `split_tokens`
    CPI runs against the forked conditional-vault**, physically splitting the
    proposer's KASS bond into pass/fail conditional KASS (each == bond, underlying
    in the vault). Asserted: `Market` PDA created + bound, `ai_claim.challenged`
    flipped, USDC escrow funded with the on-chain-computed amount,
    `open_challenge_count == 1`.

### Deferred (NOT asserted — documented honestly)

- **`settle_challenge` on the fork.** Settlement reads a **swap-driven AMM
  TWAP**: it requires building TWO live MetaDAO AMM pools (`create_amm` +
  `add_liquidity`), seeding their conditional-token reserves, executing a real
  `swap`, and cranking the delayed-twap oracle across ≥150-slot windows — all
  over RPC on a fork. In `open_challenge` the pass/fail AMMs only need to be
  **owned by the AMM program**, so the T4 test uses placeholder AMM-owned
  accounts and stops at a successfully **opened** market. The complete settle
  (real AMM pools + TWAP + redeem + directional fees + KASS/USDC conservation) is
  covered exhaustively in the LiteSVM Rust suite
  (`programs/kassandra/tests/challenge_e2e.rs`, against the bundled MetaDAO
  fixtures) and is left to a future surfpool pass — driving the full real-AMM
  TWAP production over a forked RPC validator is substantial and non-deterministic.
  The T4 challenge arm also still sizes its escrow from a fabricated `Dao` blob —
  G3's live `kass_price` read from a real `Dao` is a separate, read-only path and
  does NOT retire the T4 escrow fabrication.
- **Meteora DAMM v2 spot-path builders.** The conditional pass/fail VERDICT
  markets are the futarchy program's OWN embedded AMM (driven by
  `launch_proposal` + `conditional_swap` + `finalize_proposal`) — the G3 verdict
  flows through THOSE, not Meteora. Meteora cp-amm is only the DAO's SPOT
  liquidity / fee collection, which the governance loop does not need; its
  zero-copy `Pool` field offsets (e.g. `sqrt_price`, behind the C-padded
  `PoolFeesStruct`) are undeterminable offline, so only the discriminators are
  pinned. Not built (see `sdk/src/futarchy/NOTES.md`, "Meteora DAMM v2").
- **Dead-end ECONOMIC settlement.** G3 proves `resolve_deadend` is
  governance-driven and STAMPS the outcome (`Phase::Resolved` + `resolved_option`);
  the token movement / payout for a governance-resolved dead-end belongs to the
  settlement milestone and is NOT exercised here.
- **Program-driven DAO creation.** The bootstrap is off-chain by decision
  (`bootstrapGovernance` calls the real `initialize_dao` + `set_governance`); the
  on-chain `initialize_dao` Borsh stub stays unused.
- **Live-cluster / mainnet deployment with real funds.** No devnet/mainnet
  submission of the real KASS DAO with real funds; no real (non-mock) Anthropic
  call (the runner's live test already exists, `#[ignore]`).
- **Making the suite part of the default `pnpm test`** — it is intentionally
  gated (heavier + network for the forks).
