# Security / Economic / Design-UX Audit — 2026-07-21

Full-codebase audit tracking doc. Findings are triaged by severity and worked
one at a time: implement a fix → mark `[x]` done with the commit hash → commit →
continue until the list is empty.

Scope: `programs/oracles`, `programs/markets`, `app` (React dApp), `indexer`,
`runner`. Baseline verification: both Solana programs are natively coded
(Pinocchio, no Anchor) with disciplined manual validation — type-confusion tags
on every account loader, PDA pinning against precomputed singletons,
`create_program_address`-then-compare for stored bumps, u128 conservation math
with documented floor-dust direction, idempotent cranks. The Solana Security
Standard scanner's 40 SOL-009/SOL-016 flags were reviewed and are false
positives (the flagged `invoke_signed`/stored-bump sites all sit behind correct
authority + derivation checks).

Legend: `[ ]` open · `[x]` done (commit) · `[~]` won't-fix / accepted (with
rationale).

---

## Indexer / Runner

- [x] **I1 (Medium) — Unauthenticated `meta-json` write endpoint, no pubkey validation.** _(done — the POST is now authorized by the on-chain commitment: accepted only when the pubkey is an indexed oracle and the body's sha256 equals its on-chain `uri_hash`; 404 on unknown oracle, 409 on hash mismatch.)_
  `indexer/src/api.rs:224` (`post_oracle_meta_json`) → `indexer/src/db/oracle_meta.rs:84`.
  `POST /oracles/{pubkey}/meta-json` has no auth and never validates `{pubkey}`
  (any string becomes the PK). Enables (a) unbounded-row storage-exhaustion DoS,
  and (b) overwriting a legit oracle's stored JSON with junk so the serve-time
  hash gate returns 409 — a metadata availability/integrity DoS. The serve gate
  stops serving *bad* data but not *displacing good* data.
  Fix: require a shared-secret/bearer from the app proxy, reject pubkeys that
  aren't valid base58 or aren't present in `oracle_metadata`, cap rows per source.

- [x] **I2 (Medium) — Unauthenticated open RPC relay + read-triggered RPC amplification.** _(done — `/rpc` now enforces a JSON-RPC method allowlist (single + batch, fail-closed), rejecting non-dApp methods with 403 so it can't be used as an open proxy; unit-tested. Per-IP rate-limiting and network isolation of `/rpc` + the amplifying `/api/*` reads remain a deployment-edge follow-up, noted below.)_
  `indexer/src/api.rs:83` (`/rpc`) and `indexer/src/market/api.rs:118,239,256,271`.
  `/rpc` forwards arbitrary JSON-RPC verbatim upstream with no method allowlist,
  auth, or rate limit (free open proxy to a paid RPC: `getProgramAccounts`,
  `sendTransaction` spam). `GET /api/markets/{pubkey}` triggers up to two
  upstream reads per request; `/api/account|blockhash|transaction` also reach
  upstream unauthenticated. Fix: allowlist the JSON-RPC methods the dApp needs,
  add auth / network isolation, rate-limit.

- [x] **I3 (Low) — AMM `u64` reserves stored/compared as `i64` (silent wrap above 2^63).** _(done — both price-write sites use checked `i64::try_from`, skipping+logging a reserve above i64::MAX instead of storing a corrupt negative.)_
  `indexer/src/market/api.rs:185,197`, `indexer/src/market/price_subscribe.rs:59-62`,
  `indexer/src/market/db.rs:220`. Reserves decoded `u64` but persisted `as i64`
  and the change-guard compares `b == base as i64`. A reserve > i64::MAX wraps
  negative and corrupts the series/guard. Theoretical for real pools. Fix: store
  `NUMERIC(20)` or bound-check before cast.

- [x] **I4 (Low) — Runner SSRF on chain-controlled URIs.** _(done — ported the indexer resolved-IP guard into `HttpFactFetcher`: pre-fetch host resolution rejects internal/special-use IPs (incl. 169.254.169.254), plus a redirect policy blocking literal-internal redirects; opt-out flag for local tests; unit-tested.)_
  `runner/src/fetch/http.rs:77`, reused by `runner/src/cli/config.rs:152`.
  Fetcher enforces scheme/timeout/body-cap but has no resolved-IP guard, so a
  chain-created oracle with `uri = http://169.254.169.254/...` or an RFC1918
  host makes the runner issue internal requests (redirects followed). Blind SSRF
  (content hash-verified, never reflected). Documented v1 limitation, but the
  indexer already has the exact guard (`indexer/src/meta_fetch.rs:116-159`) the
  runner omits. Fix: port `is_disallowed`/`is_fetchable` into `HttpFactFetcher`.

- [x] **I5 (Low) — Runner signing-key material not zeroized.** _(done — `load_keypair` volatile-wipes the JSON `text` and decoded `bytes` secret buffers via `zeroize`.)_
  `runner/src/submit/build.rs:78` (`load_keypair`). Decoded 64-byte secret
  `Vec<u8>` and `Keypair` held with no zeroize-on-drop. No hardcoded secrets, no
  key logging. Fix: wrap the intermediate buffer in `zeroize` / drop promptly.

---

## Oracles program

Unusually carefully engineered: type-tag discriminators, canonical-PDA pinning,
`checked_*` math with u128 intermediates, conservation reasoning at each
slash/reward site. Scanner SOL-009/SOL-016 flags all confirmed false positives.

- [x] **O1 (High) — Emission enabled by default, contradicting the documented "genesis disabled" intent; permissionless emission farming.** _(done — `init_protocol` now defaults `total_supply_cap=0`/`emission_num=0`; enabling emission is a deliberate governance act. Deeper Sybil-resistance on the emission reward path flagged as a follow-up design item.)_
  `processor/init_protocol.rs:136-138`, `create_oracle.rs:187-219`,
  `finalize_proposals.rs:128-144`, `claims/proposer.rs:78-96`, `reward.rs:48-81`.
  `init_protocol` sets `emission_num=1`, `emission_den=1_000_000`,
  `total_supply_cap=1e18` (the "recommended" consts), so emission is LIVE at
  genesis — directly contradicting `config.rs:256-263` which says a fresh
  Protocol carries `total_supply_cap==0 / emission_num==0`. Each `create_oracle`
  mints `(cap−supply)/1e6` KASS into that oracle's own `stake_vault`, fully
  claimable by a single "correct" proposer. Exploit: create_oracle (fee 0,
  min_stake 0) → propose with a 1-base-unit bond → wait the window →
  finalize_proposals with the sole proposer → trivially all-agree Resolved with
  `reward_pool = emission`, `total_correct_proposer_stake = 1` → claim_proposer
  pays `1 + emission`. Attacker pockets the whole per-oracle emission for ~0 cost,
  repeatably/in parallel. (Contingency: if the KASS mint authority is NOT the
  program PDA, every emission-live `create_oracle` instead reverts
  `BadMintAuthority` — a liveness brick.) Fix: default `total_supply_cap=0` /
  `emission_num=0` in `init_protocol` (match documented genesis-disabled intent;
  governance enables via `set_config`). Consider Sybil resistance on the emission
  reward path (non-trivial min_stake/quorum, or don't treat an uncontested
  single-proposer resolution as emission-reward-eligible).

- [ ] **O2 (Low) — `sweep_oracle` forfeits unclaimed principal with no outstanding-claims guard.**
  `processor/sweep_oracle.rs:159-193` (`SWEEP_GRACE = 30 days`). After
  `phase_ends_at + 30 days`, anyone sweeps the entire residual `stake_vault` to
  the DAO treasury and closes the oracle; an unclaimed staker loses principal.
  Documented intentional trade-off; funds route only to the validated DAO ATA
  (not attacker-directable). Fix (optional): outstanding-claims counter gating
  the sweep.

- [x] **O3 (Low) — Rent-grief via pre-funding predicted PDAs (`propose`/`submit_fact`/`vote_fact`/`open_challenge` escrow).** _(done — added `create_or_adopt_pda`/`create_or_adopt_token_account` to the oracle guards and applied them at all sites (incl. the open_challenge Market PDA); duplicate detection now keys on program-ownership; regression test + re-blessed CU snapshot.)_
  `processor/propose.rs:135`, `submit_fact.rs:125`, `vote_fact.rs:111`,
  `open_challenge/entry.rs:271-306`. Same class as markets M1: `CreateAccount`
  fails on an already-funded account, so 1 lamport blocks one specific
  registration/fact/vote/escrow. Documented known limitation; narrow. Fix
  (deferred): `Allocate`+`Assign` create-or-adopt.

## Markets program

Overall unusually careful: PDAs re-derived + owner/tag-checked, canonical bumps,
LP accounting conserves value on a gross-LP basis, double-claim prevented by
reaping the `Contribution`, resolve→collect_fee→claim_lp ordering gated. No
critical/high fund-loss bug. Scanner SOL-009/SOL-016 flags all confirmed false
positives (every signing bump canonical + self-consistent; every program-signed
CPI re-derives and owner/key-checks its accounts).

- [x] **M1 (Medium) — Permanent market-creation DoS via PDA pre-funding.** _(done — market/escrow/contribution now use create-or-adopt (top-up + `Allocate`+`Assign`); re-init gated on program-ownership not lamports; regression test `create_market_survives_prefunded_pdas`.)_
  `processor/create_market.rs:138-168` (via `create_pda` → `CreateAccount`,
  `guards.rs:131-147`). `create_market` creates the `market`, `escrow`, and
  creator `contribution` PDAs with a bare system `CreateAccount`, which aborts
  ("account already in use") on any account already holding lamports. The market
  PDA `[b"market", oracle, [outcome_index]]` and escrow PDA `[b"escrow", market]`
  are fully deterministic, so an attacker sends 1 lamport to the market/escrow
  PDA before anyone creates that sub-market and every future `create_market` for
  that `(oracle, outcome_index)` reverts forever — ~1 lamport per market, no
  recovery path. The codebase already defends this elsewhere with create-or-adopt
  (`init_config.rs:106-132`, `activate.rs:334-399`); `create_market` was missed.
  Fix: use the same top-up-to-rent + PDA-signed `Allocate`+`Assign` (+
  `InitializeAccount3` for escrow) create-or-adopt path.

- [ ] **M2 (Low) — Protocol `fee_lp` manipulable by skewing AMM reserves before the permissionless `collect_fee` crank.**
  `processor/collect_fee.rs:174-242`. `accrued`/`fee_lp` derive from live
  `Amm.base_amount`/`quote_amount` read at crank time; `collect_fee` is
  permissionless and `claim_lp` is blocked until it runs, so an LP holder can
  front-run the crank and trade the still-tradeable resolved pool to lower
  `pool_value`, shrinking `fee_lp` toward 0. Bounded, one-directional: only
  protocol *revenue* (≤10% of profit) is affected; claimant funds and
  `lp_total`/`lp_vault` conservation are not. Fix (if revenue matters): snapshot
  the fee basis at `resolve_market` instead of reading spot reserves in a
  separately-cranked, sandwichable instruction.

## Frontend app

No XSS vectors (zero `dangerouslySetInnerHTML`/`innerHTML`/`eval`), no secrets
logged, value parsing is bigint-exact throughout. Findings:

- [x] **F1 (High) — Challenge-pool swap floor ignores the AMM's 1% input fee.** _(done)_
  `app/src/data/actions/challengeTrade.ts:119-126,162-166,221-229` +
  `components/oracles/actions/ChallengeTradeControls/SwapForm.tsx:20,47`.
  `minAmountOut` is computed from the fee-less `constantProductOut` estimate minus
  slippage (default 0.5%), but the AMM takes 1% of input before the curve. The
  market side already documents this as CRITICAL and fee-adjusts (`ammSwapOut`,
  `app/src/market/data/actions/trade.ts:34-44`). So the challenge floor sits ~0.5%
  *above* real output: every default-slippage swap reverts, slippage ≤1% is
  unusable, and the "Expected out" preview overstates by ~1%. Fix: port
  `AMM_FEE_BPS`/`ammSwapOut` into `challengeTrade.ts` for both preview and floor.

- [x] **F2 (Medium) — Challenge swap submits with `minAmountOut = 0n` when the pool didn't decode.** _(done — submit disabled when `amm === null`.)_
  `SwapForm.tsx:166` + `challengeTrade.ts:226-229`. With `amm === null` the UI
  says "Pool not readable" but still lets the user swap with an unbounded floor —
  fully sandwichable. Fix: disable submit when `amm === null`.

- [x] **F3 (Medium) — Market BUY proceeds with unbounded slippage when reserves are missing.** _(done — `buildBuyIxs` throws a `ValidationError` without reserves, mirroring `buildSellIxs`.)_
  `app/src/market/data/actions/trade.ts:100-113` (`previewBuy` null branch →
  `outputAmountMin: 0n`; the "tx still guards" comment is wrong) +
  `components/markets/actions/TradePanel.tsx:221-256`. `buildSellIxs` correctly
  refuses without reserves; buy doesn't. Fix: mirror the sell-side
  `ValidationError` for buys with null reserves.

- [x] **F4 (Medium) — Debug modes reachable via URL query param in prod; wallet secret embeddable in bundle.** _(done — `?e2e`/`?mock` query-param branches and the `VITE_E2E_WALLET_SECRET` read are gated on `import.meta.env.DEV`; verified a prod build strips the secret and eliminates the query-param branches even with the env var set.)_
  `app/src/data/mockOracles/mode.ts:5-25`, `app/src/market/lib/e2e.ts:7-10`,
  `providers/AppProviders.tsx:29-35`, `lib/e2eWallet.tsx:36`. `?e2e` swaps in the
  real-signing `E2eWalletProvider`, `?mock` replaces all data with fixtures on the
  prod origin. `VITE_E2E_WALLET_SECRET` is a build-time var: any build with it set
  ships the raw keypair in public JS. Fix: gate the query-param branches on
  `import.meta.env.DEV`, drop the env-var secret path (keep Playwright's
  `window.__E2E_WALLET_SECRET__` injection only).

- [ ] **F5 (Medium) — Transactions built from unverified indexer JSON and relayed through the indexer.**
  `app/src/market/lib/indexer.ts`, `market/data/markets.ts:100-174`,
  `market/data/send.ts:125-134`. Accounts, pool reserves (which set
  `outputAmountMin`), blockhash, and relay are all indexer-supplied with no client
  check. On-chain PDA constraints stop most substitutions, but a compromised
  indexer can bias slippage floors arbitrarily. Fix (cheap): derive/verify
  reserves from a raw `/api/account` read + client decode (as
  `useKassBalance`/`decodeAmmV04` already do) before setting a floor.

- [x] **F6 (Medium) — Sell flow shows no payout estimate and silently strands dust.** _(done — added `previewSell` (estimated KASS received + residual dust) and a sell-mode "You receive ≈" line that notes the unmerged conditional-token residual.)_
  `TradePanel.tsx:366-373` (preview buy-only) + `trade.ts:266-270`
  (`mergeAmount = min(remainder, slippage-floored swap out)` leaves the excess as
  unmerged cYES/cNO, unmentioned). Fix: add a sell preview from
  `optimalUnwindSwap`+`ammSwapOut`, note/handle the residual.

- [x] **F7 (Low) — Quick-add chips round-trip the amount through JS float.** _(done — `bump` now uses bigint base-unit math via `parseKassAmount` + `toPlainAmount`.)_
  `TradePanel.tsx:211-215`: `Number(amount) + n` after a bigint-exact "Max" can
  alter low-order decimals for balances ≳9M KASS. Fix: bump via `parseKassAmount`
  + bigint add + `toPlainAmount`.

- [x] **F8 (Low) — Batch-signed sequences can outlive their blockhashes.** _(done — cap the up-front batch-sign at MAX_BATCH_SIGN_TXS=3; longer sequences fall back to per-tx signing with a fresh blockhash each.)_
  `app/src/market/hooks/useActionSequence.ts:207-231`: all packed txs signed
  upfront then relayed+confirmed sequentially (each confirm up to 30s); later txs
  can expire post-approval with no re-sign path. Fix: cap batch-sign to sequences
  landing within ~60s, else per-tx signing.

- [x] **F9 (Low) — Buy→Sell tab switch keeps the typed amount while the unit changes.** _(done — mode change clears the amount, like belief change.)_
  `TradePanel.tsx:270`: "100" silently flips from KASS to shares. Fix: clear the
  amount on mode change (belief change already does).
