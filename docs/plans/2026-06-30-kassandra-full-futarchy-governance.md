# Full Futarchy Governance — Design + Plan

> **For Claude:** REQUIRED SUB-SKILL: subagent-driven-development (per-task implement + review).

**Goal:** Make Kassandra genuinely governed by a live MetaDAO **futarchy** KASS DAO end-to-end: stand up the real DAO + Squads v4 multisig, harden the on-chain `set_governance` handoff to validate the real linkage, build the SDK builders + bootstrap script, and PROVE the full loop on forked-mainnet surfpool — a real futarchy **proposal → conditional pass/fail KASS markets → real TWAP verdict → Squads `vault_transaction_execute` → a Kassandra `set_config`/`resolve_deadend` actually applied on-chain**. Today this is all simulated with fabricated `Dao` blobs + discriminator-dispatch probes; this milestone makes it real.

**Decisions (locked with the user):**
1. **Bootstrap = off-chain SDK script** (create the futarchy `Dao` via `initialize_dao` → the Squads v4 multisig with `create_key==Dao PDA` → call the existing `set_governance` handoff recording the real Squads **vault** PDA + `Dao` account). No program-driven DAO creation (the on-chain `initialize_dao` Borsh stub stays unused).
2. **Verdict = FULLY REAL** — real conditional markets (v0.6 `conditional_vault` + Meteora DAMM v2), seed liquidity, real `conditional_swap` to a pass, crank/await the real TWAP windows, `finalize_proposal`. NO deterministic shortcut for the verdict. (T4 found live AMM-TWAP cranking non-deterministic on a fork → this is the high-risk part: ATTEMPT IT GENUINELY; if a specific step proves intractable on the fork, STOP-and-report the exact blocker — fall back to a documented deferral ONLY after a real attempt, never fake a pass.)
3. **On-chain hardening = YES** — `set_governance` must validate that `kass_dao` is a real futarchy `Dao` (owner==`FUTARCHY_ID` + discriminator) and that `dao_authority` is the Squads **vault** PDA derived for that DAO — so a bogus/mismatched handoff is rejected on-chain.

**Architecture / source of truth.** The on-chain governance surface (the four instructions `set_governance`/`set_config`/`resolve_deadend`/`kass_price` + their gating + the CPI scaffolding in `cpi/metadao_v06.rs`: program IDs, Anchor discriminators, PDA seed builders/derivers, the `futarchy_spot_twap` reader, invoke wrappers) is ALREADY built + seam-tested. This milestone adds: the G1 program hardening; the SDK futarchy/Squads builders + bootstrap (G2); the fully-real surfpool E2E (G3); docs (G4). Builds on the merged surfpool harness (`sdk/test/surfpool/` — fork mode, `surfnet_timeTravel`, `surfnet_cloneProgramAccount`) + the SDK. The program is otherwise read-only (only `set_governance` + its tests change in G1); the runner is untouched.

**Tech Stack:** Rust (program: Pinocchio; `cpi/metadao_v06.rs` has the Squads/futarchy seed derivers G1 reuses); the SDK (TS, web3.js v3); surfpool 1.0.0 (fork mode for MetaDAO); the existing gated E2E infra (`KASSANDRA_E2E=1`). MetaDAO program IDs: futarchy `FUTARELBfJfQ8RDGhg1wdhddq1odMAJUePHFuBYfUxKq`, conditional_vault `VLTX1ish…`, Meteora DAMM v2 `cpamd…`, Squads v4 `SQDS4…`.

## Tasks

### G1 — Harden the on-chain `set_governance` handoff (program)
- READ `programs/kassandra/src/processor/set_governance.rs` (current: stores payload pubkeys verbatim while `governance_set==0`, admin-gated) + `cpi/metadao_v06.rs` (the Squads multisig/vault PDA seed builders/derivers + `FUTARCHY_ID` + the `Dao` account layout/discriminator) + `state.rs` (Protocol `dao_authority`/`kass_dao`/`governance_set`) + `tests/governance_seam.rs`.
- Change `set_governance` to VALIDATE the linkage (not just store):
  - The instruction now takes the **`kass_dao` account** (read-only) in addition to protocol + authority. Assert `kass_dao.owner == FUTARCHY_ID` and the `Dao` Anchor discriminator matches (reject otherwise → a clear new `KassandraError`).
  - Assert the payload `dao_authority` equals the **Squads v4 vault PDA derived for this DAO** (derive in-program via the `cpi/metadao_v06.rs` Squads seed deriver — the multisig `create_key == Dao PDA` per the design; derive multisig → vault and compare). Reject mismatch.
  - Keep the existing one-shot handoff semantics (admin only while `governance_set==0`; then only the current `dao_authority`; never back to admin) + the non-zero checks. Don't change account sizes (no state-layout size change; if you add fields you must re-pin — prefer NOT to).
- Add the new error code(s) (append to `KassandraError`, ABI-stable). Update the SDK's `setGovernance` builder (`sdk/src/instructions/lifecycle.ts`) to add the `kass_dao` account in the right slot/role + the SDK parity test if it pins set_governance. Extend `tests/governance_seam.rs` (+ any set_governance test): accept the real derived-vault + real Dao; reject a wrong vault, a non-futarchy-owned kass_dao, a bad discriminator.
- `just build` + `cargo test -p kassandra-program` (all green; new + existing) + clippy + fmt; `cd sdk && pnpm typecheck && pnpm test` (the setGovernance account change must keep the SDK suite green incl. parity). Commit `feat(governance): set_governance validates real Squads-vault/futarchy-DAO linkage`.

### G2 — SDK futarchy/Squads builders + the off-chain bootstrap script (recon-heavy; make-or-break for G3)
- RECON (write `sdk/src/futarchy/NOTES.md`): the exact instruction layouts (discriminators + arg encodings + account metas) for the futarchy v0.6 + Squads v4 + (as needed) Meteora DAMM v2 + conditional_vault instructions the lifecycle needs — `initialize_dao`, `initialize_proposal`, `launch_proposal`, `finalize_proposal`, `conditional_swap` (+ the spot-oracle crank/observe if separate); Squads `multisig_create`(v4)/`vault_transaction_create`/`vault_transaction_execute`; conditional_vault `initialize_question`/`initialize_conditional_vault`/`split_tokens`/`merge`/`redeem`; Meteora pool init/add-liquidity/swap. Mirror the Rust `cpi/metadao_v06.rs` discriminators/seed derivers (the authoritative, binary-validated source) and reverse-engineer the arg layouts from the MetaDAO IDLs / dumped binaries (the T4 challenge-market test + `tests/challenge_e2e.rs` already compose some of these — REUSE their account/arg composition). If a layout can't be authoritatively determined, STOP-and-report (don't guess wire formats).
- Build SDK builders (TS, web3.js v3) for those instructions under `sdk/src/futarchy/` (exported), + PDA derivers matching the Rust ones (Dao, Proposal, Squads multisig/vault, conditional vault/question, event authorities). Unit-test the byte layout of each builder (disc + args + metas) against the known discriminators/seeds where possible.
- The **bootstrap script** (`sdk/src/futarchy/bootstrap.ts` or a script): given a connection + payer + the KASS/USDC mints, create the futarchy `Dao` (`initialize_dao`) + the Squads multisig (`create_key==Dao PDA`) + derive the vault, then call the (G1-hardened) `setGovernance` handoff with `dao_authority=vault`, `kass_dao=Dao`. Returns the created addresses. (Unit/typecheck here; the live run is G3.)
- `cd sdk && pnpm typecheck && pnpm test` green (default offline). Commit `feat(sdk): futarchy v0.6 + Squads v4 instruction builders + governance bootstrap`.

### G3 — surfpool E2E: the FULL futarchy governance loop, fully real (headline; high-risk)
- A gated (`KASSANDRA_E2E=1`) surfpool test on **forked mainnet** (the T4 fork harness): 
  1. **Bootstrap (real):** deploy Kassandra + init_protocol, create the KASS/USDC mints, run the G2 bootstrap (real `initialize_dao` + Squads multisig + the G1-hardened `set_governance` handoff). Assert `Protocol.governance_set==1`, `dao_authority`==the real vault, `kass_dao`==the real Dao.
  2. **Proposal (real):** build a futarchy proposal whose action is a Kassandra `set_config` (change a governable param to a new value) staged as a Squads `VaultTransaction`; `initialize_proposal` → `launch_proposal` standing up the real conditional pass/fail KASS markets (v0.6 conditional_vault + Meteora DAMM v2).
  3. **Verdict (FULLY REAL):** seed liquidity into the pass/fail markets; real `conditional_swap`(s) to push the **pass** TWAP above fail; crank/await the real TWAP windows (use `surfnet_timeTravel` to cross the ≥150-slot/delayed-twap windows; the cp-amm/Meteora observation must accumulate — this is the part T4 found hard, attempt genuinely); `finalize_proposal` → assert it marks **Passed**.
  4. **Execute (real):** `vault_transaction_execute` via the real Squads vault → it `invoke_signed`s the staged `set_config` CPI into Kassandra → fetch + `decodeProtocol` → assert the governable param CHANGED to the proposed value. This is the headline: a real futarchy verdict drove a real Kassandra config change through Squads.
  5. **Second arm:** a `resolve_deadend`-via-governance proposal on a seeded `InvalidDeadend` oracle → executed via the same path → assert `Resolved`. AND the **live `kass_price`** read: read the futarchy spot TWAP from the REAL `Dao` (replacing the fabricated `buildDaoBlob`) and assert `kass_price` returns a sane value.
- GENUINE attempt; if a specific step (e.g. the TWAP crank / market observation) proves intractable on the fork after a real attempt, STOP-and-report the exact blocker (the program error / the missing crank) so we decide — then it may be documented as a deferral, NEVER faked. Keep the default `pnpm test` 72 offline; the gated suite spawns surfpool.
- Commit `test(e2e): full futarchy governance loop on forked MetaDAO (proposal->TWAP->Squads->set_config)`.

### G4 — docs + covered-vs-deferred
- A README/section for the futarchy governance E2E: prerequisites, how to run, and WHAT'S PROVEN (the real loop, or the exact extent reached) vs DEFERRED (anything the fully-real attempt couldn't drive on the fork, with the precise reason). Update `sdk/test/surfpool/README.md` + append the final note to this plan. Commit `docs(governance): full-futarchy-governance E2E coverage + deferrals`.

## Out of scope / deferred
- Program-driven DAO creation (finishing the on-chain `initialize_dao` Borsh stub) — bootstrap is off-chain by decision.
- Dead-end economic settlement (token movement for a governance-resolved dead-end) — belongs to the settlement milestone; `resolve_deadend` only stamps the outcome.
- Live-cluster/devnet governance with real funds; mainnet deployment of the real KASS DAO.

## Delta log

### G1 — `set_governance` validates the real Squads-vault / futarchy-DAO linkage (DONE)
- **Program (`processor/set_governance.rs`):** added the `kass_dao` account as a
  third, read-only account (`[protocol(w), authority(signer), kass_dao(ro)]`).
  After the existing non-zero + one-shot/auth gates, the handoff now VALIDATES:
  (a) `kass_dao_ai.key() == payload.kass_dao` (`assert_key` → `InvalidAccount`);
  (b) `kass_dao_ai.is_owned_by(FUTARCHY_ID)` AND first 8 bytes ==
  `DAO_ACCOUNT_DISCRIMINATOR` (→ `InvalidFutarchyDao`); (c) `payload.dao_authority
  == squads_vault_pda(squads_multisig_pda(kass_dao), 0)` derived in-program via
  the `cpi/metadao_v06.rs` Squads derivers (multisig `create_key == kass_dao` →
  multisig → vault idx 0) (→ `DaoAuthorityMismatch`). One-shot / rotation / never-
  back-to-admin semantics + the `governance_set=1` stamp PRESERVED; no `Protocol`
  size/layout change. Derivation confirmed identical to the test harness's
  recorded vault (the old `governance_seam::derive_squads_vault`, now
  `TestCtx::squads_vault_for_dao`).
- **Errors:** appended `InvalidFutarchyDao = 31`, `DaoAuthorityMismatch = 32`
  (ABI-stable; existing 0..=30 unchanged). Mirrored in `sdk/src/constants.ts`
  (enum + messages) + `sdk/test/parity.test.ts` (PINNED map + count 33).
- **SDK (`instructions/lifecycle.ts`):** `setGovernance` now appends the
  `kass_dao` read-only account after the authority; payload unchanged. Lifecycle
  byte-parity test updated for the 3rd meta.
- **Tests:** `governance_setup.rs` — accept-real (fabricated futarchy `Dao` +
  derived vault), one-shot admin-rejected, + 3 reject arms (non-futarchy owner,
  bad discriminator, wrong vault). `governance_seam.rs` gate tests rewired to the
  real validated handoff (accept-real) + a direct-write path. New harness helpers
  in `tests/common/mod.rs`: `squads_vault_for_dao`, `fabricate_dao_and_vault`,
  and `force_governance` (direct Protocol write, used by `set_config` /
  `resolve_deadend` / emissions / kass_price gate-setups + `bless_kass_price`,
  which need a SIGNABLE `dao_authority` the hardened handoff can never produce).
- **Verification:** `just build` ok; `cargo test -p kassandra-program` all green
  (incl. state_layout, governance_setup, governance_seam, set_config,
  resolve_deadend, kass_price); `cargo clippy` + `cargo fmt` clean; `cd sdk &&
  pnpm typecheck && pnpm test` → 72 offline tests green.

## Execution note
After each task: build/test green; the default `pnpm test` stays 72 offline; `cargo test -p kassandra-program` green. G1 is a focused, reviewed PROGRAM change (the only program edit). G2 is the make-or-break SDK builder work (stop-and-report if a MetaDAO wire format can't be authoritatively determined). G3 is the fully-real headline (genuine attempt; stop-and-report a real blocker rather than fake). Append a G1–G4 delta log here.
