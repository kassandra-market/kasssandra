# Kassandra Staker Settlement — Design + Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The final economic layer — turn the counter-only ledger into real token movements: per-staker **claims** (bond/stake returns + rewards), **bond_pool reward distribution** to honest cohorts, **emissions** (minted at oracle creation from the supply reservoir), and **account closure** (rent reclaim). Closes the "stranded bonds" gap and completes the protocol economics. Final step of the roadmap: KASS futarchy ✅ → challenge-market rework ✅ → **staker settlement**.

**Architecture:** Extends the existing Pinocchio program. Per-staker **pull** model (each participant claims their own account, claim-and-close). Entitlements computed from the claimant's own account + a few oracle-level totals stamped at resolution — no global iteration at claim time.

**Tech Stack:** Rust, `pinocchio` 0.8, `bytemuck`, `litesvm`, `solana-sdk` (test-only), `spl-token`.

**Source of truth:** the agreed economics in `docs/plans/2026-06-29-kassandra-settlement-economics.md` (THIS plan implements it) + the **conservation hand-off contract** from `docs/plans/2026-06-29-kassandra-challenge-rework.md` (Out-of-scope section). Plus the dispute-core/happy-path/futarchy/challenge live-state deltas. FOLLOW THE LIVE STATE.

---

## Agreed economic model (from the settlement note — implement exactly)

### Trigger: per-staker PULL, claim-and-close
After an oracle is terminal (`Resolved`/`InvalidDeadend`), each participant calls a `claim_*` for their own account; the program computes entitlement from that account + oracle-level totals stamped at resolution, transfers KASS from `stake_vault` (program-signed by the oracle PDA), and **closes the account** (rent → claimant). No global iteration; no one-tx cap.

### CONSERVATION CONTRACT (from the challenge milestone — CRITICAL)
`total_oracle_stake` is an **IDEALIZED accumulator, NOT physical KASS** (a successful challenge sent `kass_fee` out; external donations can inflate balances). **Settlement MUST source payouts from the real `stake_vault`/`bond_pool` balances + the per-proposer `slashed_amount` ledger — NEVER from `total_oracle_stake` or live token-account balances.** The authoritative per-proposer figure is `slashed_amount == bond_pool contribution`.

### Reward pool (only on `Resolved`)
`reward_pool = bond_pool + reward_emission`, split into **cohort buckets** by config weights (`reward_proposer_weight` PW, `reward_fact_weight` FW; default PW>FW): `proposer_bucket = reward_pool·PW/(PW+FW)`, `fact_bucket = reward_pool·FW/(PW+FW)`. Each bucket pro-rata within its cohort via two totals stamped at resolution: `total_correct_proposer_stake`, `total_approved_fact_stake`. **Empty cohort's bucket rolls into the proposer cohort** (always ≥1 winner on Resolved).

### Per-actor matrix (on `Resolved`)
| Actor | Entitlement |
|---|---|
| Correct proposer (survived, `claim_option == resolved_option`) | `bond + bond·proposer_rate` |
| Wrong-but-survived proposer (`claim_option != resolved_option`, not disq) | `bond` (no reward) |
| Disqualified/slashed proposer | `bond − slashed_amount` |
| Approved-fact submitter (fact `agreed`) | `stake + stake·fact_rate` |
| Approve-voter on an `agreed` fact | `stake + stake·fact_rate` |
| Duplicate-voter / staker on a duplicate-dominant fact | `stake` (no reward, no slash) |
| Rejected-fact submitter | `0` (funded bond_pool) |
| Approve-voter on a **rejected** fact | `stake·(1 − fact_vote_slash_frac)` |

`proposer_rate = proposer_bucket / total_correct_proposer_stake`; `fact_rate = fact_bucket / total_approved_fact_stake` (u128; pro-rata by the staker's own stake). 

### On `InvalidDeadend`
Every staker reclaims their **full stake** (proposers: full bond; fact stakers: full stake); **no rewards**; `reward_emission` **burned back** to the reservoir; creator fee stays burned.

### Emissions — minted at CREATION from the reservoir
`reward_emission = (TOTAL_SUPPLY_CAP − kass_supply) · emission_num/den`, computed in `create_oracle` AFTER the EMA fee burn (so burning boosts the same-tx emission), **minted immediately into `stake_vault`** (program-PDA mint authority), recorded as `Oracle.reward_emission`. On `Resolved` it joins `bond_pool` in the reward pool; on `InvalidDeadend` it is burned back. No epochs; live supply is the reservoir. Mint authority = the program PDA `[b"mint_authority"]` (seed already defined as `config::MINT_AUTHORITY_SEED`); the KASS mint's authority MUST be that PDA (bootstrapping requirement).

---

## Conventions (unchanged)
TDD; `just build` before `cargo test`; clippy + fmt clean; commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`, git author `Kassandra <hexadecifish@gmail.com>`; append-only Ix/error discriminants; re-pin `tests/state_layout.rs` on layout change. rust-analyzer false positives — rely on real cargo runs.

## Live-state entry points
- `Ix` up to `KassPrice=16`; `KassandraError` up to `InvalidConfig=26`. `Protocol` LEN 368 (emission_num/den, total_supply_cap, fee params, reward_proposer_weight/fact_weight [default 0], fact_vote_slash_num/den [reserved], etc.). `Oracle` LEN 360 (phase, resolved_option, bond_pool, total_oracle_stake, dispute_bond_total, proposer_count, surviving_count, the governable snapshots incl. reward weights + fact_vote_slash + challenge fees, stake_vault, kass_mint). `Proposer` LEN 96 (bond, original_option, claim_option, disqualified/slashed/flipped/ai_finalized, slashed_amount). `Fact` LEN 336 (stake, approve_stake, duplicate_stake, agreed, duplicate, settled, proposer). `FactVote` LEN 88 (fact, voter, stake, kind). `Market` LEN 416.
- `finalize_facts` (incremental; settles facts → bond_pool slash on rejected SUBMITTER stake; advances to AiClaim). `finalize_oracle` (plurality → Resolved+resolved_option / InvalidDeadend). `create_oracle` (EMA fee burn; loads Protocol; creates stake_vault). Guards: `load_oracle/proposer/fact/protocol/ai_claim`, `assert_*`, `assert_token_account`, `create_pda`. Oracle-PDA signing via `[b"oracle", nonce_le, [bump]]` (nonce in payload, re-derived).

---

## Tasks (full settlement, phased)

### S1 — Resolution totals + reward-pool math
- **Real reward-weight defaults:** set `config` defaults `REWARD_PROPOSER_WEIGHT`/`REWARD_FACT_WEIGHT` (e.g. 2/1, PW>FW) and `FACT_VOTE_SLASH_NUM/DEN` (e.g. 1/2 — the rejected-fact approve-voter slash); `init_protocol` defaults them; (set_config already covers reward weights + fact_vote_slash with bounds). Confirm bounds.
- **Add stamped totals to `Oracle`** (re-pin layout): `total_correct_proposer_stake: u64`, `total_approved_fact_stake: u64`, `reward_pool: u64` (finalized at resolution). 
- **`finalize_facts`:** when a fact is **agreed**, accumulate `oracle.total_approved_fact_stake += fact.stake + fact.approve_stake` (submitter + approve-voter stake that will earn the fact_rate). When a fact is **rejected** (non-duplicate), ALSO add the approve-voters' slash to bond_pool: `bond_pool += fact.stake (submitter, full) + fact.approve_stake·fact_vote_slash_frac` (aggregate — no per-vote iteration). Document; keep the existing submitter-full-slash.
- **`finalize_oracle`:** on the `Resolved` branch, stamp `total_correct_proposer_stake = Σ bond over surviving proposers with claim_option == resolved_option` (computed from the proposer tail it already iterates) and finalize `reward_pool = bond_pool + reward_emission` + the bucket split (store the buckets or recompute in claims from reward_pool + weights + totals — your call; storing `reward_pool` + reading weights/totals at claim time is fine and avoids extra fields).
- A **pure reward-math helper** (`src/reward.rs`, unit-tested): given (reward_pool, PW, FW, total_correct_proposer_stake, total_approved_fact_stake), compute proposer_bucket/fact_bucket with the empty-cohort roll-into-proposer rule; and `proposer_reward(bond)`, `fact_reward(stake)`. u128, overflow-safe, floor division (document rounding/dust direction — dust stays in stake_vault, claimable by no one / swept later; note it).
- Tests: the pure helper (buckets, empty-fact-cohort roll-in, pro-rata, dust); finalize_facts accumulates the totals + the rejected approve-voter slash; finalize_oracle stamps total_correct_proposer_stake + reward_pool. NO token movement yet (S2).

### S2 — claim_proposer / claim_fact / claim_fact_vote (returns + rewards, claim-and-close)
Three permissionless claim instructions (anyone can crank a claim for an account; funds go to the account's owner). Each: require terminal phase; load+verify the claimant account belongs to this oracle + not already claimed; compute entitlement per the matrix; transfer KASS from `stake_vault` → the claimant-owner's KASS account (program-signed by oracle PDA); **close the account** (reclaim rent → a rent-recipient; the account's authority/owner). Source ALL payouts from `stake_vault` (the contract). Decrement a "claims outstanding" sense if needed, but simplest: each claim is independent + idempotent via closing the account.
- `claim_proposer`: matrix rows for proposers (correct→bond+reward; wrong-survived→bond; disqualified→bond−slashed_amount). On `InvalidDeadend`→ full bond. Reward only on Resolved + correct. Close the Proposer account.
- `claim_fact` (submitter): agreed→stake+reward; rejected→0 (but still close + reclaim rent to submitter); duplicate-dominant→stake. InvalidDeadend→ full stake.
- `claim_fact_vote`: approve-voter on agreed→stake+reward; approve-voter on rejected→stake·(1−fact_vote_slash_frac); duplicate-voter→stake. InvalidDeadend→ full stake. Close the FactVote.
- Accounts per claim: oracle(w), the claimant account(w, closed), the owner's KASS token account(w), stake_vault(w), token program, + oracle nonce in payload for signing. Validate the destination token account ↔ the account's authority + mint==kass_mint.
- Tests: each matrix row (Resolved + InvalidDeadend); double-claim → fails (account closed/gone); rent reclaimed; KASS conservation per claim (stake_vault decremented by exactly the entitlement). Drive from a real resolved oracle (seed + finalize, or the e2e harness).

### S3 — Emissions: mint-authority bootstrap + mint-at-creation + burn-back
- **Mint-authority bootstrap:** the KASS mint's authority must be the program PDA `[b"mint_authority"]`. Update the test harness to create `kass_mint` with that PDA as the mint authority (currently the payer). Add a guard/assert that the mint authority matches at mint time.
- **`create_oracle`:** after the EMA fee burn, compute `reward_emission = (total_supply_cap − kass_supply)·emission_num/den` (u128, read from Protocol; if total_supply_cap==0 or emission_num==0 → emission 0, harmless), **mint it into `stake_vault`** (program-signed by the mint-authority PDA), record `oracle.reward_emission`. This deducts the reservoir at creation (deterministic, reservation-serialized). Set real `config` emission defaults (e.g. total_supply_cap = some cap, emission_num/den = a small fraction) — document; keep genesis sane.
- **`finalize_oracle`:** the `reward_pool = bond_pool + reward_emission` already folds it (S1). On the **InvalidDeadend** branch, **burn `reward_emission` back** from `stake_vault` (program-signed) to return it to the reservoir (so a dead-end doesn't leak emission). 
- Tests: create_oracle mints reward_emission into stake_vault (supply rises by emission, reservoir shrinks); burning fee first boosts the same-tx emission; reward_pool includes emission on Resolved (a correct proposer's reward reflects bond_pool+emission); InvalidDeadend burns the emission back (supply returns); claim payouts now include emission-funded rewards. Mint-authority mismatch → rejected.

### S4 — Account closure: close_ai_claim + Market/escrow rent reclaim
- **`close_ai_claim`** (permissionless, post-resolution): close each `AiClaim` account (reclaim rent → its proposer/authority). Incremental/per-claim (no one-tx cap). 
- **Market/escrow closure:** a `close_market` (or fold into the last claim) that, once the market is `settled` AND the oracle terminal, closes the `Market` PDA + the `challenger_usdc_vault` escrow (reclaim rent → challenger), per the challenge-milestone deferral. Ensure the escrow is empty (settle already drained it).
- Tests: close_ai_claim after Resolved reclaims rent; before resolution → fails; close_market after settle reclaims rent; non-empty/unsettled → fails.

### S5 — End-to-end settlement + conservation fuzz
- **E2E:** full lifecycle (create → propose → [resolve uncontested] AND [dispute → ... → finalize_oracle Resolved]) → every staker claims → assert each entitlement (matrix), all accounts closed, `stake_vault` drained to dust, KASS conservation. Also an InvalidDeadend path → everyone reclaims full stake + emission burned.
- **Conservation fuzz:** a proptest arm that, for a resolved oracle with fuzzed bonds/fact-stakes/votes/outcome, asserts: `Σ all claim payouts + dust == stake_vault initial (= Σ stakes + reward_emission, on Resolved)`; on InvalidDeadend `Σ payouts == Σ stakes` (emission burned). Independent reference for the bucket/pro-rata math. Modest case count.
- Update the existing `invariants.rs` conservation arms to account for the now-physical settlement (no longer counter-only).

---

## Out of scope (future)
- KASS bootstrapping presale-avoidance details beyond the emission curve; the runner/SDK/app; MetaDAO futarchy proposal-lifecycle on a real validator (seam already done); migrating challenge markets to v0.6.
- Dust sweeping (floor-division remainder in stake_vault) — note it; a governance sweep can reclaim it later.

## Execution note
After each task: `just build` → `cargo test` → clippy/fmt, green, commit. Re-pin layouts. The riskiest spots: the mint-authority bootstrap + mint-at-creation (S3, real KASS supply change — validate the harness mint-authority setup), and the conservation math across the whole settlement (S5). Source payouts from stake_vault/bond_pool, NEVER total_oracle_stake. Append an S1–S5 delta log here.
