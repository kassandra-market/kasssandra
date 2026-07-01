# Settlement Dust Sweeping + Terminal-Account Closure — Design + Plan

> **For Claude:** REQUIRED SUB-SKILL: subagent-driven-development (per-task implement + review).

**Goal:** Add a permissionless `sweep_oracle` instruction that, after a grace period past a terminal oracle, routes the residual `stake_vault` KASS (bounded rounding dust — or, for a claimant who missed the grace, their forfeited principal) to the **DAO treasury**, then CLOSES the `stake_vault` (SPL CloseAccount) + the `Oracle` account, refunding the ~0.0057 SOL rent to `oracle.creator`. Reclaims the rent + treasury-recovers the dust that today stays locked forever.

**Decisions (locked with the user):**
1. **Forced close with a grace period — NO new Oracle state.** Gate: oracle TERMINAL (`Resolved`/`InvalidDeadend`) AND `now >= phase_ends_at + SWEEP_GRACE` (a generous grace so honest claimants have ample time). No outstanding-claims counter, no Oracle::LEN change. TRADE-OFF (must be starkly documented): a staker who never claimed within the grace forfeits their unclaimed KASS principal to the treasury and their per-account rent — the grace is deliberately long to make this a genuine abandonment, not a race.
2. **Dust → DAO treasury (Transfer, not burn).** Transfer the ENTIRE remaining vault balance (dust + any forfeited principal) to the DAO treasury KASS account, oracle-PDA-signed, before closing the vault. The treasury = the KASS **associated token account of `Protocol.dao_authority`** (the Squads vault) — so the sweep REQUIRES governance to be set (`Protocol.governance_set==1`) and VALIDATES the passed treasury account == ATA(dao_authority, kass_mint). (Rationale: no new Protocol treasury field needed; the DAO vault's KASS ATA is the natural treasury, consistent with the futarchy-governance model. If governance is NOT set, sweep is rejected — an oracle can't be swept until the DAO exists; acceptable, and document it.)
3. **Permissionless; rent → `oracle.creator`.** Anyone may crank `sweep_oracle` (matches close_market/close_ai_claim/claims — all permissionless). The reclaimed SOL rent (vault + oracle account) refunds to `oracle.creator` (the original payer, `create_oracle.rs:38`), matching the system's "rent → original payer" convention.

## Source of truth (from investigation, file:line)
- **Dust:** bounded floor/ceil rounding residue in `stake_vault` (reward bucket/pro-rata floors `reward.rs:48-91`; ceil voter-slash vs floor bond_pool credit `finalize_facts.rs:335-340` / `claims.rs:242-248`; disqualified-proposer forfeit remainder `claims.rs:299-303`). Always under-pay, never short. The dead-end milestone already BURNED the only non-dust strand (bond_pool + emission at finalize) — so the vault, after all claims, holds only this bounded dust (+ any unclaimed principal from a no-show staker).
- **Open accounts:** `Oracle` (LEN 392, rent ≈ 3,619,200 lamports) + `stake_vault` (SPL token acct, 165 B, rent ≈ 2,039,280). Both paid by `creator_ai` at `create_oracle.rs:38,173-241`, `oracle.creator` recorded.
- **No "all-settled" signal exists** (`staker-settlement.md:68` chose not to add one) — hence the grace-period gate (decision 1) instead of a counter.
- **Close patterns to mirror:** program-account lamport-drain + `AccountInfo::close()` (`close_market.rs:152-160`, `close_ai_claim.rs:66-74`, `claims.rs:216-227`); SPL CloseAccount oracle-PDA-signed with the `EscrowNotEmpty`-style empty check (`close_market.rs:119-148`); oracle-PDA signer from the 8-byte `oracle_nonce` payload (`claims.rs:170-181`, `close_market.rs:87-91`); Transfer/Burn-from-vault oracle-PDA-signed (`finalize_oracle.rs:278-291`). Dispatch: new `Ix` = 22 (`instruction.rs`, CloseMarket=21 is last) + arm in `processor/mod.rs`.
- `require_terminal` (`claims.rs:159-165`); `phase_ends_at` on the Oracle; `stake_vault` amount at token-account offset 64.

## Tasks

### SW1 — `sweep_oracle` instruction (program)
- Add `Ix::SweepOracle = 22` (`instruction.rs` + `from_u8`) + a dispatch arm (`processor/mod.rs`) + `processor/sweep_oracle.rs`. Payload: `oracle_nonce: u64` (for the PDA signer). Config const `SWEEP_GRACE` (seconds — a generous window, e.g. ≥ the phase windows; pick + document in `config.rs`).
- Accounts (propose the cleanest order; ~): `[0] oracle(w, closed) [1] stake_vault(w, closed) [2] kass_mint(w — for any burn? NO, we transfer; still needed? only if a token op needs it — Transfer doesn't need the mint, so likely omit) [3] protocol(ro — for dao_authority/governance_set) [4] dao_treasury(w) = ATA(dao_authority, kass_mint) [5] creator(w) = rent recipient == oracle.creator [6] token program]`. Re-derive + verify the oracle PDA from `oracle_nonce`; verify `stake_vault == oracle.stake_vault`, `dao_treasury == ATA(protocol.dao_authority, kass_mint)`, `creator == oracle.creator`.
- Logic: assert oracle TERMINAL + `now >= phase_ends_at + SWEEP_GRACE` (new error e.g. `SweepGraceNotElapsed`); assert `protocol.governance_set==1` (else `GovernanceNotSet`) + the treasury == ATA(dao_authority, kass_mint) (else a clear error). Read the vault `amount`; if `> 0`, **Transfer** the full amount vault→dao_treasury (oracle-PDA-signed, mirror finalize_oracle's signed CPI). Then SPL **CloseAccount** the (now-empty) stake_vault → rent to creator (oracle-PDA-signed, mirror close_market). Then lamport-drain + `close()` the Oracle account → rent to creator. Idempotent by closure (a reaped oracle fails the load/terminal guard).
- New error code(s) appended to `KassandraError` (ABI-stable). 
- Tests (`programs/kassandra/tests/`, mirror `closure.rs`): 
  - **Happy:** terminal oracle, all claims done (vault = dust), governance set → after grace, sweep transfers dust to the treasury ATA, closes vault + oracle, rent → creator, both accounts gone. Assert the treasury ATA received exactly the dust; creator lamports += both rents.
  - **Before grace:** `now < phase_ends_at + SWEEP_GRACE` → rejected (`SweepGraceNotElapsed`).
  - **Governance not set:** → rejected.
  - **Wrong treasury** (not ATA(dao_authority,kass_mint)) / **wrong creator** / **wrong stake_vault** → rejected.
  - **Non-terminal oracle** → rejected.
  - **Forfeiture arm:** a terminal oracle with an UNCLAIMED staker (vault still holds their principal) swept after grace → the FULL balance (principal + dust) goes to the treasury, oracle+vault closed (documents the forfeiture; the late claimant can no longer claim — assert their subsequent claim fails on the closed oracle). This is the starkly-documented trade-off.
  - **Idempotent:** second sweep finds the oracle reaped → fails cleanly.
- `just build` + `cargo test -p kassandra-program` (all green) + clippy + fmt. Commit `feat(settlement): sweep_oracle — grace-gated dust->treasury + close terminal Oracle/vault`.

### SW2 — SDK builder + docs + covered-vs-deferred
- SDK `sweepOracle` builder in `sdk/src/instructions/settlement.ts` (alongside closeMarket/closeAiClaim) + the `Ix.SweepOracle=22` discriminant in `constants.ts` + barrel export + the error code(s) in constants + parity test. Unit test: data == `[disc, oracle_nonce LE]` + the account metas/roles + the treasury/creator/vault derivations. (No Oracle layout change → decodeOracle untouched.)
- Docs: update the staker-settlement + settlement-economics covered-vs-deferred — dust sweeping + terminal-account closure now DONE (the grace-forced-close model, dust→DAO-treasury, permissionless + rent→creator, and the FORFEITURE trade-off starkly noted). Append the final note to this plan.
- `cd sdk && pnpm typecheck && pnpm test` (default offline green incl. the new builder test + parity). Commit `feat(sdk): sweepOracle builder + dust-sweep docs`.

## Out of scope / deferred
- An outstanding-claims counter / strict no-strand closure (decision: grace-forced instead).
- Sweeping/closing the Protocol singleton (never closed) or the AiClaim/Market accounts (their own close instructions exist; their rent binds to their own authority, order-independent — but note: if they're unclosed at sweep, their rent is separate and not reclaimed by sweep_oracle; document that close_ai_claim/close_market should be cranked too, they're independent).
- The remaining deferred item #4 (SDK/runner integration) — separate milestone.

## SW1 delta (DONE — program)

- **Ix 22 `SweepOracle`** wired: `instruction.rs` (variant + `from_u8`), `processor/mod.rs` (module + dispatch arm), new `processor/sweep_oracle.rs`. Payload = `oracle_nonce: u64 LE` (8 bytes). NO `Oracle` layout change.
- **`SWEEP_GRACE = 30 * 24 * 60 * 60` (30 days)** in `config.rs` — deliberately generous (dwarfs the hour-scale `PHASE_WINDOW`/`PROPOSAL_WINDOW`) so a no-show is a genuine abandonment, not a race. Gate: `now >= oracle.phase_ends_at + SWEEP_GRACE`. Documented that `phase_ends_at` is the terminal-ENTRY anchor (`finalize_oracle` runs at `now >= phase_ends_at` and does NOT advance it → a lower bound on the true terminal time, so the effective grace is never shorter).
- **Account order** (module header + `# Accounts`): `[0] oracle(w, closed) [1] stake_vault(w, closed) [2] protocol(ro) [3] dao_treasury(w) [4] creator(w) [5] token program]`. NO `kass_mint` account (Transfer + CloseAccount don't need it; the mint is validated via the ATA derivation off `protocol.kass_mint`).
- **New errors (ABI-appended, discriminants unchanged):** `SweepGraceNotElapsed = 33`, `GovernanceNotSet = 34`, `InvalidTreasury = 35`.
- **Treasury ATA validation:** re-derive `ATA(protocol.dao_authority, protocol.kass_mint)` in-program via `find_program_address([dao_authority, TOKEN_PROGRAM, kass_mint], ATA_PROGRAM_ID)` (`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`, `pinocchio_pubkey::pubkey!`); require `dao_treasury.key() == derived` else `InvalidTreasury`. Requires `protocol.governance_set == 1` (else `GovernanceNotSet`) — an oracle can't be swept until the DAO exists. `protocol` loaded via the singleton-pinning `load_protocol` guard.
- **The one new CPI:** full-balance `Transfer` vault→treasury (oracle-PDA-signed `[b"oracle", nonce_le, [bump]]`), mirroring `finalize_oracle`'s signed token CPI (Transfer instead of Burn). Zero balance = no-op. Then the two closes mirror `close_market` EXACTLY: SPL `CloseAccount` of the vault (rent → creator) + lamport-drain + `AccountInfo::close()` of the Oracle (rent → creator). Permissionless; idempotent by closure.
- **Tests** (`tests/sweep.rs`, 10 arms, mirror `closure.rs`): happy (dust → treasury ATA, both closed, rent → creator) + empty-vault-still-closes + before-grace (`SweepGraceNotElapsed`) + governance-not-set + wrong-treasury (`InvalidTreasury`) + wrong-creator + wrong-vault + non-terminal (`WrongPhase`) + **forfeiture** (unclaimed staker's FULL principal + dust → treasury, oracle+vault closed, the no-show's later `claim_proposer` fails on the closed oracle) + idempotent (second sweep → `InvalidAccount`). Harness helpers added to `tests/common/mod.rs`: `set_creator`, `fund_vault`, `kass_ata`, `seed_kass_treasury`, `sweep_oracle_ix`, `ATA_PROGRAM_ID`. `just build` + `cargo test -p kassandra-program` (all green incl. existing) + clippy + fmt clean.

## SW2 delta (DONE — SDK + docs)

- **SDK `sweepOracle` builder** (`sdk/src/instructions/settlement.ts`, barrel-exported):
  `sweepOracle({ nonce, kassMint, daoAuthority, creator, programId? })`. Derives the
  oracle PDA (`[b"oracle", nonce_le]`), the `stake_vault` PDA (`[b"vault", oracle]`), the
  `protocol` singleton (`[b"protocol"]`), and the DAO treasury = `ATA(daoAuthority,
  TOKEN_PROGRAM, kassMint)` under the ATA program. Emits `data = [Ix.SweepOracle,
  oracle_nonce u64 LE]` and the EXACT processor account order/roles:
  `[oracle(w), stake_vault(w), protocol(ro), dao_treasury(w), creator(w), token program(ro)]`.
- **Shared ATA deriver:** `pda.associatedTokenAccount(owner, mint)` — seeds
  `[owner, TOKEN_PROGRAM, mint]` under the new top-level `ATA_PROGRAM_ID`
  (`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`) in `constants.ts` — mirrors the
  in-program `ATA(dao_authority, kass_mint)` validation. (The amm-v04/futarchy modules
  keep their own local `ata`; this is the shared main-SDK one for the treasury.)
- **Constants + parity:** `Ix.SweepOracle = 22` + `KassandraError` 33/34/35
  (`SweepGraceNotElapsed`/`GovernanceNotSet`/`InvalidTreasury`) + their `decodeError`
  messages in `constants.ts`; `parity.test.ts` bumped (Ix count 23 / 0..=22, error
  count 36 / 0..=35).
- **Unit test** (`instructions-dispute.test.ts`, settlement suite): asserts
  `data == [Ix.SweepOracle, ...nonce LE]`, the 6 account metas (order + isSigner/isWritable)
  match the processor, and the derived treasury == `ATA(dao_authority, kass_mint)` for
  known inputs. Offline / default suite.
- **Docstring precision fix (SW1 review):** `processor/sweep_oracle.rs` + `config.rs` — the
  grace guarantee is reworded from the imprecise "effective grace is never SHORTER than
  SWEEP_GRACE" to the accurate statement that the sweep is gated to a FIXED, publicly known
  instant `phase_ends_at + SWEEP_GRACE` (a delayed finalize can shrink the span measured
  from terminal-entry; the anchor off `phase_ends_at` is the real guarantee). Docs-only, no
  logic change; program still green.
- **Docs / covered-vs-deferred:** `2026-06-30-kassandra-staker-settlement.md` +
  `2026-06-29-kassandra-settlement-economics.md` updated — dust sweeping + terminal-account
  closure moved from DEFERRED to DONE, with the grace-forced-close model (30-day
  `SWEEP_GRACE`, gated to `phase_ends_at + SWEEP_GRACE`), dust + forfeited principal → DAO
  treasury ATA, permissionless + rent → creator, and the FORFEITURE trade-off starkly noted
  (a no-show staker forfeits BOTH unclaimed principal AND rent).

## Execution note
After each task: `just build` + `cargo test -p kassandra-program` green; default `pnpm test` stays green. SW1 is the program instruction (the grace gate + the treasury-validated transfer + the two closes + the forfeiture semantics — get the oracle-PDA-signed Transfer/CloseAccount right, mirror the existing patterns). SW2 is the SDK builder + docs. The forfeiture trade-off (a no-show staker's principal → treasury after grace) MUST be documented starkly. Append a SW1/SW2 delta log here.
