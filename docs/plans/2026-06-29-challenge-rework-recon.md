# Challenge-market rework recon: v0.4 AMM/vault LP-resolution mechanics

**Task C0 — research spike. READ-ONLY. No production `src/` change.**
Goal: nail down EXACTLY how the deployed MetaDAO v0.4 AMM + conditional vault
handle add/remove-liquidity and post-resolution redemption, so we can lock the
economic model for the challenge rework (bond provides KASS liquidity,
challenger provides matching USDC, real two-sided conditional-AMM liquidity).

All citations are to the on-chain SOURCE fetched via `gh api` from
`metaDAOproject/programs`:

- `amm` at tag **`proposal-duration-v0.4.2`** (matches the deployed `AMMyu…`
  delayed-twap binary dumped at mainnet slot 326427490; `add/remove_liquidity`,
  `swap`, `create_amm`, `amm.rs` are byte-identical across `v0.4`,
  `delayed-twap-v0.4.1`, and `v0.4.2` — only the TWAP-oracle layout differs).
- `conditional_vault` at tag **`v0.4`** (declare_id `VLTX1…`, deployed binary).

Discriminators below independently recomputed as `sha256("global:<name>")[..8]`
and confirmed to match `src/cpi/metadao.rs`.

---

## 0. TL;DR / recommendation

- **A program PDA CAN be the LP** (the AMM `user` is a `Signer`; the oracle PDA
  can `invoke_signed`). So the mechanics do not block protocol-owned liquidity.
- **Remove-liquidity is pro-rata the pool reserves AT REMOVAL** — classic
  impermanent loss. CONFIRMED from source AND empirically against the real
  binary (`tests/recon_lp_resolution.rs`).
- **Redeem is winning-side 1:1, losing-side → 0**, and the LP token is a
  SEPARATE mint from the conditional tokens, so the order is forced:
  **remove-liquidity FIRST (get conditional tokens) → redeem THEN**.
- **The crux is real:** once the bond's conditional-KASS is sitting in a traded
  AMM pool, the protocol recovers a PRICE-DEPENDENT `(KASS, USDC)` mix, not a
  clean `B` KASS. This breaks both the "bond is a clean slashable quantity"
  assumption AND the current physical-KASS-conservation invariant
  (`stake_vault + vault_underlying == total_oracle_stake`).
- **Recommendation: ESCROW / IDEALIZED model.** Keep the bond as a clean,
  escrowed, slashable `B` KASS (essentially today's behavior: split into idle
  conditional-KASS that redeems exactly because it is never traded). If real
  two-sided liquidity is wanted, fund it from challenger USDC + a *separate*
  protocol KASS float and assign IL to the challenger / the 1% LP fee — do NOT
  make the slashable bond the at-risk LP capital. The real v0.4 mechanics make
  faithful-LP-of-the-bond and clean-slashing mutually exclusive; pick clean
  slashing. Details + the faithful-LP escape hatch in §4 and §7.

---

## 1. Add-liquidity

`amm/src/instructions/add_liquidity.rs`, accounts in
`amm/src/instructions/common.rs` (`AddOrRemoveLiquidity`, `#[event_cpi]`).

- **Discriminator:** `add_liquidity` = `b5 9d 59 43 8f b6 34 48`.
- **Args** `AddLiquidityArgs` (Borsh, 24 bytes): `quote_amount: u64`,
  `max_base_amount: u64`, `min_lp_tokens: u64`.
- **Accounts** (`AddOrRemoveLiquidity`, same struct for add AND remove):
  0. `user` — **Signer**, writable
  1. `amm` — writable, `has_one = lp_mint`
  2. `lp_mint` — writable
  3. `user_lp_account` — writable, `token::authority = user`
  4. `user_base_account` — writable, `token::authority = user`
  5. `user_quote_account` — writable, `token::authority = user`
  6. `vault_ata_base` — writable, ATA(authority = amm, mint = base)
  7. `vault_ata_quote` — writable, ATA(authority = amm, mint = quote)
  8. `token_program`
  9. `event_authority` (amm's `__event_authority` PDA)
  10. `amm` program id
  (Matches `tests/settle_challenge.rs::build_amm`, already proven.)

- **Initial price / amount relationship.** When `lp_mint.supply == 0` (first
  add): `base_amount = max_base_amount`, `quote_amount = quote_amount` are taken
  AS GIVEN, and `initial_lp_tokens = quote_amount`. So **the depositor sets the
  initial price purely by the ratio of the two amounts deposited.** There is a
  floor: `require_gte!(quote_amount, 100_000_000)` (≈ $100 if quote is 6-dp
  USDC). For subsequent adds (`supply > 0`) the base is forced to match the
  current reserve ratio: `base_amount = quote_amount * base_reserve /
  quote_reserve + 1`, capped by `max_base_amount`; LP minted =
  `quote_amount * total_lp_supply / quote_reserve`.

- **LP representation / recipient.** A dedicated SPL `lp_mint` (PDA
  `["amm_lp_mint", amm]`, 9 decimals, mint+freeze authority = the amm PDA;
  `create_amm.rs`). LP tokens are minted to `user_lp_account` (the depositor's
  account, `token::authority = user`). **The LP token is NOT a conditional
  token** — this forces the remove-then-redeem order (§3).

- **Can a program-owned (oracle) PDA be the LP?** YES. `user` only needs to be a
  transaction `Signer`; a PDA satisfies that via `invoke_signed`. The
  `user_lp/base/quote` accounts just need `authority == user`, i.e. owned by the
  PDA. No constraint forbids a PDA depositor. (Same pattern `open_challenge`
  already uses to sign the vault `split_tokens` with the oracle PDA seeds.)

---

## 2. Remove-liquidity (the IL confirmation)

`amm/src/instructions/remove_liquidity.rs` + `amm.rs`.

- **Discriminator:** `remove_liquidity` = `50 55 d1 48 18 ce b1 6c`.
- **Args** `RemoveLiquidityArgs` (Borsh, 24 bytes): `lp_tokens_to_burn: u64`,
  `min_quote_amount: u64`, `min_base_amount: u64`.
- **Accounts:** identical `AddOrRemoveLiquidity` struct as §1.
- **Payout math** (`Amm::get_base_and_quote_withdrawable`):
  ```
  base_to_withdraw  = lp_tokens_to_burn * amm.base_amount  / lp_total_supply
  quote_to_withdraw = lp_tokens_to_burn * amm.quote_amount / lp_total_supply
  ```
  i.e. **pro-rata the pool's CURRENT reserves at removal.** It then burns the LP
  and transfers `base_to_withdraw`/`quote_to_withdraw` out of the vault ATAs
  (authority = amm PDA).

- **Price dependence / IL — CONFIRMED.** Because the withdrawn amounts track the
  reserves *as they are at removal*, and trading (`swap`, 1% fee, constant
  product, `amm.rs::swap`) moves those reserves, an LP gets back a different
  `(base, quote)` split than it deposited. For the sole 100%-LP at constant
  product (ignoring fees), if the price moves from `P` to `p`, the deposited
  `(B base, P·B quote)` comes back as `(B·sqrt(P/p) base, B·sqrt(P·p) quote)`.
  The base quantity returned ≠ `B` unless `p == P`.

- **Empirical proof against the real binary:**
  `tests/recon_lp_resolution.rs::remove_liquidity_returns_price_dependent_mix`
  drives `create_amm → add_liquidity(100 KASS / 100 USDC) → BUY 50 USDC →
  remove_liquidity(100% LP)` on the dumped `metadao_amm.so` and asserts the
  withdrawn amounts equal the *swap-shifted* reserves: **less KASS and more USDC
  than deposited.** PASSES. This is the bond-not-cleanly-recoverable mechanic,
  observed, not just read.

---

## 3. Conditional resolution + redeem

`conditional_vault/src/instructions/{resolve_question,redeem_tokens,split_tokens}.rs`.

- **resolve_question** (`settle_challenge` already calls this): sets
  `payout_denominator = Σ numerators`, `payout_numerators = args`. Binary
  pass-wins `[1,0]` → denom 1, num[0]=1, num[1]=0; fail-wins `[0,1]` → num[1]=1.
  One-shot (`require payout_denominator == 0` before). Signer = the question's
  `oracle` (our oracle PDA). Proven in `tests/settle_challenge.rs`.

- **redeem_tokens** discriminator `f6 62 86 29 98 21 78 45`. Gated by
  `question.is_resolved()`. For a holder's conditional-token accounts it computes
  ```
  total_redeemable = Σ_i  user_balance_i * payout_numerators[i] / payout_denominator
  ```
  burns the holder's FULL balance of EVERY outcome's conditional token, and
  transfers `total_redeemable` underlying out of the vault to the holder.
  For binary pass-wins `[1,0]`: `total = pass_balance*1/1 + fail_balance*0/1 =
  pass_balance`. **Winning side redeems 1:1; losing side → 0, and both are
  burned in the one call.** (`merge_tokens` is the pre-resolution inverse of
  split; not needed on the resolution path.)

- **Order of operations is FORCED.** The LP token is its own `lp_mint`
  (§1), NOT a conditional token, so you cannot redeem an LP position directly.
  You must **`remove_liquidity` FIRST** (burn LP → receive conditional base +
  conditional quote into PDA-owned token accounts), **THEN `redeem_tokens`** on
  each conditional vault (KASS vault and USDC vault separately, same shared
  question). `redeem` requires the question resolved, which `settle_challenge`
  does. So the settlement crank for a real-liquidity market is:
  `resolve_question → remove_liquidity(pass) → remove_liquidity(fail) →
  redeem_tokens(KASS vault) → redeem_tokens(USDC vault)`.

- **LiteSVM status:** `split_tokens` + `resolve_question` are already driven
  against the real vault binary (`open_challenge.rs`, `settle_challenge.rs`).
  `redeem_tokens` is NOT yet driven but is an ordinary CPI on the same loaded
  binary; its behavior is unambiguous in source. (Not added to the recon test to
  keep it minimal; flagged as the one remaining binary-level confirmation for
  the implementation task — see §6.)

---

## 4. Net-flow trace for an LP across the full lifecycle (THE KEY FINDING)

Setup the rework intends: bond `B` KASS supplies the conditional-KASS liquidity;
challenger supplies USDC sized off `kass_price` spot TWAP `P` (USDC per KASS).

Pre-trade construction (one `split` mints BOTH legs):
- `split` `B` KASS in the KASS vault → `B` pass-KASS **+** `B` fail-KASS.
- `split` `Q = P·B` USDC in the USDC vault → `P·B` pass-USDC **+** `P·B`
  fail-USDC.
- Add to **pass pool**: `B` pass-KASS + `P·B` pass-USDC (price `P`).
- Add to **fail pool**: `B` fail-KASS + `P·B` fail-USDC (price `P`).
- Protocol (oracle PDA) holds 100% of both pools' LP.

Total drawn in: exactly `B` KASS (bond) and `P·B` USDC (challenger). Good.

### Baseline: NO trading
Remove both pools → `B` pass-KASS + `B` fail-KASS + `P·B` pass-USDC + `P·B`
fail-USDC. Redeem on outcome:
- **pass-wins `[1,0]`:** pass-KASS→`B` KASS, pass-USDC→`P·B` USDC, fail legs→0.
- **fail-wins `[0,1]`:** fail-KASS→`B` KASS, fail-USDC→`P·B` USDC, pass legs→0.

Either way the protocol recovers **exactly `B` KASS + `P·B` USDC.** The "losing
world" tokens always vanish, but they were duplicates from the same split, so
with no trading there is NO net loss. (This is why today's *idle*-conditional-KASS
design recovers the bond cleanly.)

### With trading (where IL/PnL lands)
Let the WINNING pool end at reserves `(k_win, q_win)` (shifted by trades + 1%
fees), the LOSING pool at `(k_lose, q_lose)`.

Settlement (`remove_liquidity` both → `redeem_tokens`), say **pass-wins**:
- Protocol withdraws `(k_pass, q_pass)` pass-tokens and `(k_fail, q_fail)`
  fail-tokens (pro-rata, 100% LP, §2).
- Redeem KASS vault `[1,0]`: pass-KASS `k_pass` → `k_pass` KASS; fail-KASS
  `k_fail` → **0**.
- Redeem USDC vault `[1,0]`: pass-USDC `q_pass` → `q_pass` USDC; fail-USDC
  `q_fail` → **0**.
- **Protocol recovers `k_pass` KASS + `q_pass` USDC** = the WINNING pool's
  reserves at settlement. **The entire losing (fail) pool evaporates.**

Symmetric for fail-wins (recovers `k_fail` KASS + `q_fail` USDC).

**Where each thing ends up:**
- **Bond KASS:** comes back as `k_win` (winning pool's KASS reserve), which =
  `B` only if the winning pool's price never moved. After trading
  `k_win = B·sqrt(P/p_win) ≠ B`. The bond is recovered as a **price-dependent
  KASS amount**, not the clean `B`.
- **Challenger USDC:** comes back as `q_win` (winning pool's USDC reserve), `≠
  P·B` after trading.
- **IL / trading PnL:** the counterparties (traders who moved the price) capture
  the value the LP "loses" relative to holding; the protocol-LP's only
  compensation is the 1% swap fee retained in `k` (so `k_win·q_win` grows
  slightly with volume). The losing-pool wipeout is NOT extra loss vs the
  baseline — the baseline also wiped it — but it means the protocol's recovery
  comes entirely from the winning pool, whose composition is set by the market.

**Net:** `recovered_KASS + recovered_USDC` is a single price-dependent bundle in
which the bond and the challenger's stake are **commingled and inseparable**.
You cannot, at settlement, hand back "exactly the bond `B` KASS" and "exactly the
challenger's `P·B` USDC" — the split between them is whatever the winning pool's
reserves happen to be. THIS is the collision the spike was sent to confirm.

---

## 5. TWAP interaction

- The pass/fail decision is read from each AMM's built-in slot-weighted TWAP
  (`Amm::get_twap = aggregator / (last_updated_slot - (created_at_slot +
  start_delay_slots))`), exactly what `settle_challenge.rs` reads.
- **Every state-changing AMM ix folds the TWAP first:** `add_liquidity`,
  `remove_liquidity`, and `swap` all call `amm.update_twap(clock.slot)` BEFORE
  mutating reserves (`add_liquidity.rs`, `remove_liquidity.rs`, `swap.rs`). So
  real liquidity ops AND trades feed the same TWAP the slash reads — the slash
  trigger keeps working with real two-sided liquidity.
- **Timing matters (already designed for):** `update_twap` records at most once
  per `ONE_MINUTE_IN_SLOTS == 150` slots, clamps each observation by
  `max_observation_change_per_update`, and (delayed-twap) ignores observations
  before `created_at_slot + start_delay_slots`. So *when* liquidity is added
  affects the window: the `start_delay_slots` lets you add liquidity, let the
  book settle, and only then start the averaging window. The aggregator is
  weighted by elapsed slots, so an LP add at price `P` that is immediately
  cranked seeds the window at `P`. `settle_challenge` divides by the FULL
  elapsed window and treats `aggregator == 0`/no-slots as TWAP `0` (= "no
  counter-trading → survive"), which is unchanged by adding real liquidity.
- The existing `settle_last_block_swap_does_not_flip_outcome` test already shows
  a last-moment swap does not move the stored TWAP within a minute. Real
  liquidity does not change that property.

---

## 6. LiteSVM feasibility

Driven against the REAL dumped binaries in LiteSVM:

| Step | Status |
|---|---|
| `initialize_question` / vaults | proven (`settle_challenge.rs`, `metadao_cpi.rs`) |
| `split_tokens` (program-signed by oracle PDA) | proven (`open_challenge.rs`) |
| `create_amm` | proven (`settle_challenge.rs::build_amm`) |
| `add_liquidity` | proven (`build_amm`) |
| `swap` | proven (`settle_last_block_swap_*`) |
| `crank_that_twap` | proven (`build_amm`) |
| `resolve_question` (program-signed) | proven (`settle_challenge.rs`) |
| **`remove_liquidity`** | **proven here** (`recon_lp_resolution.rs`, real binary) |
| `redeem_tokens` | NOT yet driven; ordinary CPI on the already-loaded vault binary, source unambiguous — low risk for the impl task |

**Conclusion: the full lifecycle `add → swap → crank → warp → remove → resolve →
redeem` is LiteSVM-driveable against the dumped binaries.** No real-validator
dependency was found for any step. The only piece not yet executed end-to-end is
the final `redeem_tokens` CPI and the *program-signed* `remove_liquidity` (the
recon test signed as a plain payer, not the oracle PDA) — both are mechanically
identical to CPIs already proven program-signed (`split_tokens`,
`resolve_question`), so they are an implementation detail, not a feasibility
risk. Slot accounting in LiteSVM is manual (`warp_slots`), which the TWAP tests
already cope with.

---

## 7. Recommendation: faithful-LP vs escrow/idealized

### Faithful-LP (LP genuinely bears IL; bond NOT cleanly recoverable)
- **What it is:** the bond's conditional-KASS really sits in the traded pools;
  on settlement the protocol recovers `(k_win, q_win)` per §4.
- **Consequences (evidence: §2, §4):**
  - The slashable bond is no longer a fixed `B` KASS. `settle_challenge`'s
    accounting (`bond_pool += bond`, `slashed_amount == bond`) and the physical
    conservation invariant `stake_vault + vault_underlying == total_oracle_stake`
    (asserted in `settle_challenge.rs::assert_kass_conserved`) BOTH break: after
    trading, external traders hold conditional tokens against the vault's
    underlying, so the protocol can only ever pull `k_win ≤ B` back.
  - The bond and the challenger USDC become an inseparable price-dependent
    bundle — there is no rule-free way to say "return the bond, keep/forfeit the
    rest."
  - To adopt it you must redefine slashing to operate on the *recovered* amount
    and drop the clean-quantity conservation invariant. That is a deep change to
    settled accounting (Tasks 7/11/12) for little benefit.

### Escrow / idealized (protocol guarantees bond + challenger return; IL assigned by rule) — RECOMMENDED
- **Why it is clean AND feasible given the real mechanics:**
  - Redeem on the winning side is EXACTLY 1:1 and an UNTRADED split round-trips
    to exactly `B` (§3, §4 baseline). The current design already exploits this:
    the bond is split into *idle* conditional-KASS held in oracle-owned accounts
    and redeemed on resolution — clean, no IL, conservation holds. This is
    already proven end-to-end.
  - If product wants REAL two-sided liquidity for price discovery, provide it
    WITHOUT putting the slashable bond at risk: fund the conditional-KASS
    liquidity from a **separate protocol KASS float** (not the bond) matched
    against the challenger's USDC, and assign IL/trading-PnL by rule to the
    challenger (who opted into the market) and/or absorb it via the 1% LP fee.
    The bond stays escrowed/idle and slashes cleanly; the slash trigger still
    reads the real TWAP produced by the real liquidity (§5).
  - This keeps every existing settled invariant intact and confines the new
    surface to "who funds the float and who eats IL", a pure economic-policy
    knob rather than a rewrite of slash accounting.

### The honest tension
You cannot simultaneously have (a) "the bond IS the at-risk KASS liquidity
exposed to traders" and (b) "the bond is a clean slashable `B` KASS recovered in
full." The deployed v0.4 remove/redeem mechanics force the choice (§2, §4). The
recommendation is to keep (b) — clean slashing — and get real price discovery
from challenger-funded + protocol-float liquidity, not from the bond itself. If
the team explicitly prefers (a), the impl task must: redefine slash on recovered
amount, drop `assert_kass_conserved`, and add the
`remove → redeem` settlement crank (all LiteSVM-driveable per §6).

---

## 8. Blockers / unknowns

- **None for the recon question.** Source is unambiguous and the IL half is now
  empirically pinned against the real binary.
- Not yet executed (deferred to the impl task, NOT blockers): a single LiteSVM
  test driving the *full* program-signed `remove_liquidity` + `redeem_tokens`
  crank for both pools, and the conditional-USDC split/redeem path (today
  `open_challenge` only splits the KASS bond; the rework adds a USDC split that
  must be funded by the challenger).
- Economic-policy decision required from product before implementation: confirm
  escrow/idealized (recommended) vs faithful-LP, and if escrow, who funds the
  KASS float and who bears IL.

## Appendix: verified discriminators (sha256("global:<name>")[..8])

```
add_liquidity     b5 9d 59 43 8f b6 34 48
remove_liquidity  50 55 d1 48 18 ce b1 6c
swap              f8 c6 9e 91 e1 75 87 c8
create_amm        f2 5b 15 aa 05 44 7d 40
crank_that_twap   dc 64 19 f9 00 5c c3 c1
split_tokens      4f c3 74 00 8c b0 49 b3
redeem_tokens     f6 62 86 29 98 21 78 45
```
All match `src/cpi/metadao.rs`.
