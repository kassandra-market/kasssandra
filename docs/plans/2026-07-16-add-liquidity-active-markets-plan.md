# Add Liquidity to Active Markets — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an on-chain `add_liquidity` (Ix 11) that lets anyone deposit KASS into an `Active` market's live cYES/cNO AMM, receiving pooled LP claimable pro-rata alongside the original funders — with `claim_lp`/`collect_fee` reworked to a fair, gross-LP accounting basis, plus SDK, indexer, and UI wiring.

**Architecture:** Program-signed flow mirroring `activate` (Market PDA is the CPI authority): depositor transfers KASS → escrow; program-signed `split_tokens` (escrow → market cYES/cNO) and `amm::add_liquidity` at the live ratio (LP → `lp_vault`); program-signed transfer of the heavy-side remainder back to the depositor. Claims switch from KASS-proportional to **gross-LP-proportional** using new frozen state (`activation_lp`, `activation_contributed`, `gross_lp_total`) and a per-contribution `late_lp`. See `docs/plans/2026-07-16-add-liquidity-active-markets-design.md` for full rationale.

**Tech Stack:** Rust (pinocchio) markets program + LiteSVM tests; Rust & TS SDKs (`sdks/markets/*`); Rust indexer; React app (`app/`).

**Conventions:** `just build` **before** `cargo test` (LiteSVM `include_bytes!` the `.so`). Discriminants are append-only. Keep all state `#[repr(C)]` Pod, fully padded.

---

## Phase A — On-chain state & accounting

### Task 1: Grow `Market` + `Contribution` state

**Files:**
- Modify: `programs/markets/src/state.rs`
- Test: `programs/markets/tests/state_layout.rs`

**Step 1: Write the failing layout test.** In `state_layout.rs`, extend the existing `Market`/`Contribution` size + offset assertions to include the new fields (add explicit offset checks for `activation_lp`, `activation_contributed`, `gross_lp_total`, and `Contribution::late_lp`; bump the asserted `LEN`s). Mirror the style already in the file.

**Step 2: Run to verify it fails.** `just build && cargo test -p kassandra-markets-program --test state_layout` → FAIL (size mismatch).

**Step 3: Implement.** In `state.rs`:
- `Market`: append after `fee_collected`/`outcome_index`/`_pad3` region three `u64`s and re-balance padding:
  ```rust
  pub activation_lp: u64,          // LP minted at activate (frozen; funders' pro-rata basis)
  pub activation_contributed: u64, // total_contributed at activate (frozen)
  pub gross_lp_total: u64,         // activation_lp + Σ late add_liquidity LP (frozen; claim denominator)
  ```
  Keep `#[repr(C)]` packing explicit; adjust trailing `_pad` so `size_of` stays 8-aligned.
- `Contribution`: replace `_pad: [u8; 6]` region so it carries:
  ```rust
  pub late_lp: u64, // LP minted for this contributor by post-activation add_liquidity (0 for pure funders)
  ```
  Re-pad to 8-alignment.

**Step 4: Run to verify it passes.** Same command → PASS.

**Step 5: Commit.** `git add -A && git commit -m "feat(markets): grow Market/Contribution state for gross-LP accounting"`

---

### Task 2: Record activation basis in `activate`

**Files:**
- Modify: `programs/markets/src/processor/activate.rs:299-310`
- Test: `programs/markets/tests/activate.rs`

**Step 1: Failing test.** In `activate.rs` test, after activation assert `market.activation_lp == market.lp_total`, `market.gross_lp_total == market.lp_total`, and `market.activation_contributed == market.total_contributed`.

**Step 2: Verify fails.** `just build && cargo test -p kassandra-markets-program --test activate` → FAIL.

**Step 3: Implement.** In the `--- record bindings ---` block, set:
```rust
m.activation_lp = lp_total;
m.activation_contributed = m.total_contributed;
m.gross_lp_total = lp_total;
```

**Step 4: Verify passes.** → PASS.

**Step 5: Commit.** `git commit -am "feat(markets): snapshot activation LP/contributed basis at activate"`

---

### Task 3: Switch `claim_lp` to gross-LP-proportional

**Files:**
- Modify: `programs/markets/src/processor/claim_lp.rs:44-136`
- Test: `programs/markets/tests/lifecycle_active.rs` (extend), `programs/markets/tests/claim_lp.rs`

**Step 1: Failing test.** Add a test asserting that for an **activation-only** market the new formula gives byte-identical shares to today (regression guard), by computing expected via `gross_lp_i = activation_lp * amount / activation_contributed`. (The mixed-cohort fairness test comes in Task 6 once `add_liquidity` exists.)

**Step 2: Verify fails / passes-as-regression.** `just build && cargo test -p kassandra-markets-program --test lifecycle_active` — expected PASS after Step 3 (regression parity).

**Step 3: Implement.** Replace `pro_rata_share(market.lp_total, contribution.amount, market.total_contributed)` with a gross-LP computation:
```rust
// gross LP owed to this contribution = activation pro-rata share + late adds
fn gross_lp(m: &Market, c: &Contribution) -> Result<u64, ProgramError> {
    let activation = if m.activation_contributed == 0 {
        0
    } else {
        u64::try_from(
            (m.activation_lp as u128)
                .checked_mul(c.amount as u128)
                .ok_or(ProgramError::ArithmeticOverflow)?
                / m.activation_contributed as u128,
        ).map_err(|_| ProgramError::ArithmeticOverflow)?
    };
    activation.checked_add(c.late_lp).ok_or(ProgramError::ArithmeticOverflow.into())
}
```
Then the non-last-claimer share becomes:
```rust
// share = lp_total(post-fee vault) * gross_lp_i / gross_lp_total
let share = if market.open_contributions == 1 {
    // last claimer sweeps the whole vault (absorbs floor dust) — unchanged
    let d = lp_vault_ai.try_borrow()?; metadao::read_u64(&d, SPL_TOKEN_AMOUNT_OFFSET)?
} else {
    let g = gross_lp(&market, &contribution)?;
    u64::try_from(
        (market.lp_total as u128).checked_mul(g as u128).ok_or(ProgramError::ArithmeticOverflow)?
            / market.gross_lp_total as u128,
    ).map_err(|_| ProgramError::ArithmeticOverflow)?
};
```
Guard `gross_lp_total != 0` (it's ≥ activation_lp > 0 for any activated market with LP; if `lp_total == 0` claim_lp already can't reach success via the fee gate). Update the module doc comment to describe gross-LP distribution.

**Step 4: Verify passes.** `just build && cargo test -p kassandra-markets-program --test lifecycle_active --test claim_lp` → PASS.

**Step 5: Commit.** `git commit -am "feat(markets): distribute claim_lp by gross LP, not KASS"`

---

### Task 4: Add `Ix::AddLiquidity = 11` + dispatch stub

**Files:**
- Modify: `programs/markets/src/instruction.rs`, `programs/markets/src/processor/mod.rs`
- Create: `programs/markets/src/processor/add_liquidity.rs`

**Step 1: Failing test.** In a new `programs/markets/tests/add_liquidity.rs`, write the happy-path test skeleton: fund + activate a market, then send Ix 11 depositing KASS, and assert `market.lp_total`/`gross_lp_total` grew and the depositor got a `Contribution` with `late_lp > 0`. (Use `lifecycle_active.rs` helpers/fixtures as the template for setup.)

**Step 2: Verify fails.** `just build && cargo test -p kassandra-markets-program --test add_liquidity` → FAIL (Ix unknown).

**Step 3: Implement dispatch.** Add `AddLiquidity = 11` to `Ix` enum + `from_u8`. In `processor/mod.rs` add the match arm `Ix::AddLiquidity => add_liquidity::process(...)` and `mod add_liquidity;`. Create `add_liquidity.rs` with the full processor (Task 5 fills the body); for this task a compiling stub that returns `Ok(())` is enough to wire dispatch — but prefer to implement the body directly in Task 5 and keep this task to the enum/dispatch only.

**Step 4: Verify.** `just build` compiles; test still fails on assertions (body not implemented) — acceptable handoff to Task 5.

**Step 5: Commit.** `git commit -am "feat(markets): reserve Ix::AddLiquidity=11 + dispatch"`

---

### Task 5: Implement the `add_liquidity` processor

**Files:**
- Modify: `programs/markets/src/processor/add_liquidity.rs`
- Modify (helper reuse): `programs/markets/src/cpi/metadao.rs` (none expected — `split_tokens`, `add_liquidity` builders exist)
- Test: `programs/markets/tests/add_liquidity.rs`

**Payload:** `amount: u64 LE` (8 bytes) `++ quote_amount: u64 LE ++ max_base_amount: u64 LE` (client-computed ratio hints; see design §3). `min_lp_tokens` fixed 0 (returned-remainder model tolerates any deposit).

**Accounts (mirror `activate`, minus the create-market-token-account trio which already exist):**
market(w), oracle(ro), depositor(signer,w), depositor_kass_ata(w), escrow(w), question(ro), vault(w), vault_underlying(w), yes_mint(w), no_mint(w), market_cyes(w), market_cno(w), depositor_cyes_ata(w), depositor_cno_ata(w), amm(w), lp_mint(w), lp_vault(w), amm_vault_base(w), amm_vault_quote(w), contribution(w), cv_event_auth, cv_prog, amm_event_auth, amm_prog, token_prog, system_prog.

**Body (in order):**
1. Parse payload (len == 24), `amount > 0` else `ValidationError`.
2. `assert_signer(depositor)`; assert all program ids (cv/amm/token/system).
3. `load_market`; require `status == Active` else `MarketError::NotActive`.
4. Load oracle, require **non-terminal** (reuse activate's terminal check) else `OracleResolved`.
5. Re-verify recorded bindings against `market.*` exactly as `collect_fee` does (question, vault, mints, amm, lp_mint, lp_vault, amm vaults, event auths, escrow, and the `[b"cyes"|b"cno", market]` PDAs).
6. Ensure depositor cYES/cNO ATAs exist (idempotent create via `associated_token` — reuse the on-chain create-ATA pattern used elsewhere, or require pre-created and just `assert_key` to the derived ATA).
7. Depositor-signed `Transfer(depositor_kass_ata → escrow, amount)`.
8. `market_signer_seeds!`; program-signed `split_tokens(amount)` (copy activate's split metas/infos verbatim).
9. Read `lp_vault` balance `lp_before`.
10. Program-signed `add_liquidity(quote_amount, max_base_amount, 0)` (copy activate's add metas/infos verbatim).
11. Read `lp_vault` balance `lp_after`; `lp_new = lp_after - lp_before` (`checked_sub`, must be > 0 else `MarketError::...` — a zero-LP add is a no-op/misuse → revert so escrow/split don't strand).
12. Program-signed transfer of leftover: for each of `market_cyes`/`market_cno`, read balance; if > 0 `Transfer(market_cX → depositor_cX_ata, bal)` signed by market seeds. (Both may be > 0 only from rounding; typically one side.) End state: `market_cyes == market_cno == 0`.
13. Record contribution: detect create-vs-topup (`contribution_ai.lamports()==0 && is_data_empty()`); `record`/increment with `amount = 0` KASS delta but set `late_lp += lp_new`. **Do not** route KASS to escrow here (escrow already handled). Simplest: hand-write the create/increment (don't reuse `record_contribution`, which transfers KASS). On create: `open_contributions += 1`.
14. Update market: `lp_total += lp_new`; `gross_lp_total += lp_new`; `total_contributed += amount` (conservative, design §4). `write_market`.

**Step-by-step TDD:** write each assertion incrementally — (a) lp growth, (b) contribution `late_lp`, (c) `open_contributions` increment on new depositor / no-increment on repeat, (d) leftover returned (depositor cYES or cNO ATA balance > 0 for a skewed pool; == 0 for a balanced/untraded pool), (e) `market_cyes/cno == 0` and `escrow == 0` after. Run `just build && cargo test -p kassandra-markets-program --test add_liquidity` between assertions.

**Guard tests:** reject on Funding, Resolved, Cancelled; reject on terminal oracle; reject `amount == 0`; reject tampered bindings.

**Commit.** `git commit -am "feat(markets): implement add_liquidity (Ix 11) for active pools"`

---

### Task 6: Fairness + fee interaction integration tests

**Files:**
- Test: `programs/markets/tests/lifecycle_active.rs` (or `add_liquidity.rs`)

**Step 1: Fairness test.** Funder A seeds; activate; execute AMM trades to skew the pool; depositor B `add_liquidity`; resolve + `collect_fee`; both `claim_lp`. Assert each receives their **gross-LP** share to the base unit (A keeps its accrued value; B does not skim it — the design §2.2 example). Last-claimer sweep leaves `lp_vault == 0`.

**Step 2: Fee test.** After a late add, `collect_fee` nets late principal into `accrued = pool_value − total_contributed`; assert `lp_total` reduced by exactly `fee_lp` and fee KASS routed to `fee_destination`; assert `gross_lp_total` unchanged by the fee.

**Step 3: Run.** `just build && cargo test -p kassandra-markets-program` (full suite) → PASS.

**Step 4: Security scan.** Run `/solana-security-standard:scan` (or the `scan_solana_code` MCP tool) over `programs/markets/src/processor/add_liquidity.rs` and the edited `claim_lp.rs`; address findings.

**Step 5: Commit.** `git commit -am "test(markets): add_liquidity fairness + fee integration coverage"`

---

## Phase B — SDKs

### Task 7: Rust SDK ix builder + state fields

**Files:**
- Create: `sdks/markets/rust/src/ix/add_liquidity.rs` (mirror `ix/activate.rs`); register in `ix/mod.rs`.
- Modify: `sdks/markets/rust/src/` state mirror (the `Market`/`Contribution` decode structs) to add the new fields.
- Test: `sdks/markets/rust/tests/account_metas.rs` — assert the Ix-11 account-meta order matches the processor.

TDD: write the account-meta expectation test first, run (fail), implement builder, run (pass), commit.

### Task 8: TS SDK instruction + flow + account decoders

**Files:**
- Create: `sdks/markets/ts/src/instructions/addLiquidity.ts` (payload = disc 11 + amount + quote + maxBase); export in `instructions/index.ts`.
- Create: `sdks/markets/ts/src/flows/addLiquidity.ts` — read live AMM reserves (`metadao/amm.ts`) and compute `quote_amount = min(amount, floor(amount*reserveQuote/reserveBase))`, `max_base_amount = amount`; assemble the full account list.
- Modify: `sdks/markets/ts/src/accounts/market.ts` + `accounts/contribution.ts` decoders for the new fields (offsets must match Task 1).
- Test: `sdks/markets/ts` unit test for payload bytes + reserve→quote math (edge: balanced pool → no remainder; skewed pool → remainder).

TDD per file; run the TS test runner used by the SDK; commit.

---

## Phase C — Indexer

### Task 9: Decode Ix 11 + project new fields

**Files:**
- Modify: `indexer/src/market/*` — market/contribution account decoders (new fields), and any ix-log/decoder that enumerates instruction discriminants; ensure `json.rs` emits `lateLp`/`grossLpTotal`/`activationLp` where the app needs them.
- Test: indexer decode test for a market/contribution carrying the new fields.

TDD: extend the decode fixture/test first; implement; run indexer tests; commit.

---

## Phase D — App

### Task 10: `addLiquidity` action + single-market control

**Files:**
- Create: `app/src/market/data/actions/addLiquidity.ts` (mirror `contribute.ts`; build via the TS SDK flow).
- Modify: `app/src/market/data/actions/index.ts` (export).
- Create: `app/src/components/markets/actions/AddLiquidityControl.tsx` (mirror `ContributeForm`, plus a deployed-vs-returned preview computed from reserves).
- Modify: `app/src/components/markets/actions/MarketActions.tsx:61-71` — in the `Active` arm render `AddLiquidityControl` **above** `ClaimLpControl`.
- Test: `app/test/` render/unit test for the control + action (mirror existing `contribute`/`bulkLiquidity` tests).

### Task 11: Bulk group deposit into Active siblings

**Files:**
- Modify: `app/src/market/data/actions/bulkLiquidity.ts` — add `buildBulkAddLiquiditySteps` (mirror `buildBulkContributeSteps`, using the add-liquidity flow per Active sibling).
- Modify: `app/src/components/markets/actions/GroupLiquidityPanel.tsx` — include `Active` siblings in the deposit set (today only `Funding`), with clear per-phase labeling (funding = contribute, active = add-liquidity); keep the uniform-split UX.
- Test: `app/test/groupLiquidityPanel.render.test.tsx` + `app/test/bulkLiquidity.unit.test.ts` — extend for the Active path.

TDD per component; run `app` test suite; commit each.

---

## Phase E — Verify & finish

### Task 12: End-to-end + docs
- Run the full workspace: program tests, SDK tests, indexer tests, app tests.
- Drive the real app against surfpool (see `NOTES-surfpool.md`) to add liquidity to an Active market and confirm the UI deployed/returned preview matches on-chain (use `/run` or `/verify`).
- Update `docs/` (market lifecycle doc) to describe post-activation liquidity.
- REQUIRED: superpowers:requesting-code-review before merge; then superpowers:finishing-a-development-branch.

---

## Risk notes
- **Compute budget:** `add_liquidity` runs two MetaDAO CPIs + up to two return transfers + ATA creation; if it exceeds the CU limit, split ATA creation into a client-prepended ix (like `contribute` does for the KASS ATA).
- **Rounding:** `lp_new` and the gross-LP claim use `u128` intermediates + floor; the last-claimer sweep absorbs dust (unchanged invariant). Assert `lp_vault == 0` post-full-claim in tests.
- **Conservative fee (design §4C):** `total_contributed += amount` under-collects protocol fee for skewed adds — accepted for v1, covered by the Task 6 fee test (assert direction, not exactness).
