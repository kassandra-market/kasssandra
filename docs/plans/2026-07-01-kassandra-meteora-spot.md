# Meteora DAMM v2 Spot-Path Builders — Design + Plan

> **For Claude:** REQUIRED SUB-SKILL: subagent-driven-development (per-task implement + review).

**Goal:** Add SDK-side Meteora DAMM v2 (cp-amm) spot-path builders + zero-copy decoders — the full position-based lifecycle (initialize_pool, create_position, add_liquidity, remove_liquidity, swap, claim_position_fee) + Pool & Position decoders — and prove them on a mainnet-fork surfpool E2E (clone the real Meteora program + a pool config, drive init→add_liquidity→swap over RPC, decode the Pool and assert sqrt_price moved / reserves correct, verifying the computed zero-copy offsets against the DEPLOYED binary). This lifts the long-deferred "Meteora Pool offsets not determinable offline" blocker (the repo source resolves every offset) and lets a futarchy governance E2E use REAL DAO spot liquidity instead of a fabricated blob.

**Context / honest scope.** Meteora is PERIPHERAL to the Kassandra oracle protocol: the program does NOT CPI Meteora (it only pins the id + 3 discs + the Pool disc "for completeness" in `cpi/metadao_v06.rs`); `kass_price` reads the futarchy EMBEDDED-AMM spot TWAP (`price.rs`/`kass_price.rs`), NOT Meteora (cp-amm has no oracle). This milestone is the DAO's SPOT-LIQUIDITY/treasury side — SDK builders + decoders + an E2E — NOT a program change. NO on-chain program change.

## Decisions (locked with the user)
1. **Full position-based spot path + decoders.** cp-amm v2 is POSITION-based (unlike the v0.4 AMM): initialize_pool + create_position + add_liquidity + remove_liquidity + swap + claim_position_fee, plus the Pool + Position zero-copy decoders (sqrt_price/liquidity/reserves/fees).
2. **Prove on a mainnet-fork surfpool E2E.** Clone the real Meteora program + a pool config from mainnet, drive init→add_liquidity→swap over RPC, decode the resulting Pool (assert sqrt_price moved + reserves), verifying the computed offsets against the DEPLOYED binary (not just repo source).
3. **SDK-only** (new `sdk/src/meteora/`, mirroring `sdk/src/amm-v04/`: constants/pda/instructions/index). No program change.

## Source of truth (from the repo + local, verified)
- **Repo:** `github.com/MeteoraAg/damm-v2`, program `cp-amm`, id `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` (mainnet-beta; cross-confirmed in `cpi/metadao_v06.rs:89-90` + MeteoraAg/damm-v2-sdk). Pin the layouts against the deployed program — the E2E clones the real mainnet program/pool to verify.
- **Zero-copy layouts PINNED from source (all `#[account(zero_copy)]`/`#[zero_copy]`, `#[repr(C)]`, `const_assert` sizes):**
  - `Pool` (`programs/cp-amm/src/state/pool.rs`, `INIT_SPACE == 1104`): field order = `pool_fees: PoolFeesStruct(160)`, `token_a_mint/token_b_mint/token_a_vault/token_b_vault/whitelisted_vault: Pubkey(32 each)`, `padding_0:[u8;32]`, `liquidity:u128`, `padding_1:u128`, `protocol_a_fee:u64`, `protocol_b_fee:u64`, `padding_2:u128`, `sqrt_min_price:u128`, `sqrt_max_price:u128`, **`sqrt_price:u128`**, `activation_point:u64`, … `creator:Pubkey`, `token_a_amount:u64`, `token_b_amount:u64`, … (+reward_infos). **Computed struct-relative offsets** (add 8 for the Anchor disc → absolute): token_a_mint=160, token_b_mint=192, token_a_vault=224, token_b_vault=256, liquidity=352, `sqrt_price = 448` (absolute **456**), token_a_amount/token_b_amount near the tail. Every u128 sits on a 16-byte boundary via the explicit padding fields. **VERIFY these against a cloned real mainnet Pool in the E2E — do not trust the arithmetic blindly** (re-read the current repo `pool.rs` at implementation time in case `main` shifted; pin the exact commit).
  - `PoolFeesStruct` (`state/fee.rs`, `INIT_SPACE == 160`): `base_fee: BaseFeeStruct(40)`, `protocol_fee_percent:u8`, `padding_0:u8`, `referral_fee_percent:u8`, `padding_1:[u8;3]`, `compounding_fee_bps:u16`, `dynamic_fee: DynamicFeeStruct(96)`, `init_sqrt_price:u128`.
  - `Position` (`state/position.rs`, `INIT_SPACE == 400`): `pool:Pubkey`, `nft_mint:Pubkey`, `fee_a_per_token_checkpoint:[u8;32]`, `fee_b_per_token_checkpoint:[u8;32]`, `fee_a_pending:u64`, `fee_b_pending:u64`, `unlocked_liquidity:u128`, `vested_liquidity:u128`, `permanent_locked_liquidity:u128`, `metrics: PositionMetrics(16)`, `reward_infos:[UserRewardInfo;NUM_REWARDS]`, `inner_vesting: InnerVesting`, `delegate_permission:u32`, `padding:[u8;12]`. (Confirm `NUM_REWARDS` + `InnerVesting` size from the repo.)
- **Instruction discriminators (Anchor `sha256("global:<name>")[..8]`) — 3 ALREADY pinned in `cpi/metadao_v06.rs`:** `initialize_pool = 5fb40aac54aee828`, `swap = f8c69e91e17587c8`, `add_liquidity = b59d59438fb63448`. NEED (compute + confirm from the repo): `create_position`, `remove_liquidity`, `claim_position_fee` (exact ix names per the repo's `lib.rs`/handlers). NOTE `swap`'s disc `f8c69e91e17587c8` == the v0.4 AMM swap disc (same `global:swap` scheme — a good cross-check).
- **The ARG layouts + ACCOUNT lists + PDA seeds per instruction MUST be byte-sourced from the repo handlers** (`programs/cp-amm/src/instructions/*.rs` + `lib.rs`) at implementation time — the WebFetch raw URLs (`raw.githubusercontent.com/MeteoraAg/damm-v2/<commit>/programs/cp-amm/src/...`). Pin a specific commit/tag matching the deployed program; document it.
- **Local mirror pattern:** `sdk/src/amm-v04/{constants,pda,instructions,index}.ts` (the v0.4 AMM SDK module — discs as byte arrays, PDA derivers, builders returning web3.js v3 `TransactionInstruction`, byte-layout unit tests) + `sdk/test/surfpool/{harness.ts,challenge-market-e2e.test.ts}` (the harness clone/setAccount cheatcodes + how challenge-market drove the real v0.4 AMM). The surfpool memory note (slot-vs-timestamp) — cp-amm price is instantaneous (no TWAP crank), so no slot-mode needed for the swap→sqrt_price assertion.

## Tasks

### M1 — SDK Meteora DAMM v2 module (builders + decoders)
- New `sdk/src/meteora/{constants,pda,instructions,accounts,index}.ts` (mirror `amm-v04`), barrel-exported from `sdk/src/index.ts`.
- **Fetch the authoritative wire formats from the repo** (pin a commit): for EACH of `initialize_pool`, `create_position`, `add_liquidity`, `remove_liquidity`, `swap`, `claim_position_fee` — the disc, the Borsh arg layout, the account list (order + roles), and the PDA seeds (pool, position, token vaults, pool authority, event authority, config). Cite the repo file:line in the module header.
- **Builders:** each returns a web3.js v3 `TransactionInstruction` with `data = disc ++ borsh(args)` + the account metas in the exact handler order. Confirm the 3 pinned discs match the repo; compute + pin the 3 new ones. Position-based: create_position mints a position NFT (the cp-amm scheme — reproduce it accurately).
- **Decoders (`accounts.ts`):** `decodePool` (sqrt_price/liquidity/token_a_amount/token_b_amount/mints/vaults — from the computed offsets) + `decodePosition` (pool/owner-nft/unlocked_liquidity/fees). VERIFY the discriminator + `INIT_SPACE` length. RE-READ the current repo structs at impl time (guard against `main` drift; pin the commit).
- **Offline unit tests:** each builder's `data` (disc ++ borsh args) + account metas/roles + PDA derivations for known inputs; the decoders round-trip a hand-built Pool/Position byte blob (asserting sqrt_price/liquidity land at the computed offsets + the size == INIT_SPACE). Keep default `pnpm test` green + offline.
- `cd sdk && pnpm typecheck && pnpm test`. Commit `feat(sdk): Meteora DAMM v2 spot-path builders + Pool/Position decoders`.

### M2 — Mainnet-fork surfpool E2E (verify against the deployed program)
- New gated (`KASSANDRA_E2E=1`) `sdk/test/surfpool/meteora-spot-e2e.test.ts`. Boot surfpool forking mainnet (`--network mainnet`) so the REAL Meteora program `cpamd…` is present (or `surfnet_cloneProgramAccount` it). Clone a real pool CONFIG account from mainnet (cp-amm requires a config for initialize_pool — find a live config via the Meteora SDK/explorer; document the address cloned). Fabricate two SPL mints + funded token accounts for the DAO signer.
- **Drive over RPC:** `initialize_pool` → `create_position` → `add_liquidity` → `swap` → (optionally `claim_position_fee`/`remove_liquidity`). After the swap, `decodePool` the on-chain Pool and ASSERT: sqrt_price MOVED in the correct direction, token reserves updated, the position's liquidity is as expected. **This verifies the computed zero-copy offsets against the DEPLOYED binary** — assert the decoder reads a sane sqrt_price/liquidity from the REAL account (if the offsets were wrong, these assertions fail).
- If a genuine blocker surfaces (cp-amm needs an un-clonable dependency, a config that can't be sourced, or an account whose construction is undocumented), STOP-and-report with the exact error — do NOT fabricate a passing test. A partial proof (e.g. clone a real existing mainnet Pool + decode it to verify offsets, if driving a fresh init is blocked) is an acceptable fallback IF the full init flow is truly blocked — document what's driven vs cloned.
- Keep default `pnpm test` offline + green (gated). Update the SDK `NOTES.md`/futarchy `NOTES.md` + `sdk/README.md`: Meteora DAMM v2 spot builders now DONE (remove the "DEFERRED / STOP-REPORTED" note), offsets verified against the deployed program. Append the M1/M2 delta to this plan.
- Commit `test(e2e): Meteora DAMM v2 spot path on forked mainnet (offsets verified vs deployed)`.

## Out of scope / deferred
- On-chain program change (none — the program doesn't CPI Meteora; it already pins the discs it references).
- A futarchy-governance E2E rewired to use real Meteora DAO liquidity (this milestone delivers the builders; wiring them into the governance E2E is a possible follow-on).
- Meteora dynamic-fee / reward-emission mechanics beyond what the spot lifecycle needs.

## Execution note
SDK-only; default `pnpm test` stays offline + green; the E2E is gated. Byte-source EVERYTHING from the repo (pin a commit) + VERIFY the offsets against a real cloned mainnet Pool (that's the whole point — the blocker was "offsets not determinable offline"; the E2E proves them against the deployed binary). Mirror the `amm-v04` module + the challenge-market surfpool harness. Append an M1/M2 delta log here.

## Delta log

### M1 — DONE (SDK module `sdk/src/meteora/{constants,pda,instructions,accounts,index}.ts` + `test/meteora.test.ts`)

**Pinned commit:** `MeteoraAg/damm-v2@bdd8a1e355f484b3cff131578a662c560b97b72f` (resolved off `main` 2026-07-01). Program id `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` (`lib.rs:41`). Raw source via `raw.githubusercontent.com/MeteoraAg/damm-v2/<commit>/programs/cp-amm/src/…`.

**6 instruction discs** (Anchor `sha256("global:<name>")[..8]`):
| ix | disc | source |
|----|------|--------|
| `initialize_pool` | `5fb40aac54aee828` | ✓ matches `cpi/metadao_v06.rs:127` |
| `swap` | `f8c69e91e17587c8` | ✓ matches `metadao_v06.rs:129` (== v0.4 `global:swap`) |
| `add_liquidity` | `b59d59438fb63448` | ✓ matches `metadao_v06.rs:131` |
| `create_position` | `30d7c59960cbb485` | computed (name `lib.rs:246`) |
| `remove_liquidity` | `5055d14818ceb16c` | computed (name `lib.rs:257`) |
| `claim_position_fee` | `b4269a118521a2d3` | computed (name `lib.rs:294`) |

Account discs: `Pool = f19a6d0411b16dbc` (✓ `metadao_v06.rs:133`), `Position = aabc8fe47a40f7d0`.

**Arg layouts** (Borsh LE): `initialize_pool` = `liquidity:u128 ++ sqrt_price:u128 ++ activation_point:Option<u64>`; `create_position` = none; `add_liquidity`/`remove_liquidity` = `liquidity_delta:u128 ++ token_a_amount_threshold:u64 ++ token_b_amount_threshold:u64` (add = MAX to spend, remove = MIN to receive); `swap` = `amount_in:u64 ++ minimum_amount_out:u64`; `claim_position_fee` = none.

**PDA seeds** (from `constants.rs` `mod seeds` + `const_pda.rs`): Pool `[b"pool", config, max(mint_a,mint_b), min(mint_a,mint_b)]` (mints SORTED by raw bytes, larger first; keyed by a `config` account); Position `[b"position", nft_mint]`; Position-NFT token acct `[b"position_nft_account", nft_mint]`; Token vault `[b"token_vault", mint, pool]`; Pool authority `[b"pool_authority"]` (const); Event authority `[b"__event_authority"]`.

**Decoder offsets (RE-DERIVED from the pinned field order; every u128 is 16-byte aligned via explicit padding):** Pool `INIT_SPACE == 1104`, on-chain `8 + 1104 = 1112`; `sqrt_price` at STRUCT-offset **448 / ABSOLUTE 456** (confirmed ✓ — matches the plan). Other Pool abs offsets: token_a_mint 168, token_b_mint 200, token_a_vault 232, token_b_vault 264, liquidity 360, sqrt_min_price 424, sqrt_max_price 440, protocol_a_fee 392, protocol_b_fee 400, creator 648, token_a_amount 680, token_b_amount 688. Position `INIT_SPACE == 400`, on-chain 408; abs: pool 8, nft_mint 40, fee_a_pending 136, fee_b_pending 144, unlocked_liquidity 152, vested_liquidity 168, permanent_locked_liquidity 184. `NUM_REWARDS == 2`, `UserRewardInfo::INIT_SPACE == 48`, `PoolFeesStruct::INIT_SPACE == 160`, `PoolMetrics == 80` — all confirmed against the pinned structs.

**Deviations from the plan's assumptions (repo is source of truth):**
- **`swap` has NO `swap_type`/direction arg** (the plan carried the v0.4 AMM shape). Direction is IMPLICIT — determined by which token account is `input`/`output`. `swap` also has a trailing OPTIONAL `referral_token_account` (Anchor `Option<…>`; the program-id is passed as the None sentinel).
- **`initialize_pool` also mints the FIRST position + its Token-2022 NFT** (combined) and takes `liquidity` + `sqrt_price` directly; `create_position` opens an EMPTY position. Both mint the NFT under **Token-2022** (`TokenzQd…`).
- **Pool PDA requires a `config` account** (fee/price-range params) plus the sorted mint pair — there is no bare `[prefix, a, b]` pool.
- **`claim_position_fee`'s `pool` account is READ-ONLY** (fees live on the Position); `remove_liquidity` prefixes the account list with `pool_authority` (the vault-transfer signer) vs `add_liquidity`.
- `Pool` struct at this commit adds `PoolMetrics(80)` / `layout_version` / extra padding vs the plan's sketch, but the pinned offsets still land `sqrt_price` at abs 456 and total 1104 — the plan's arithmetic holds.

**Verification:** `pnpm typecheck` clean; `pnpm test` → 13 files, **124 passed** (incl. 20 new meteora tests: builder `data` bytes, account metas/roles, PDA seeds, decoder round-trips asserting sqrt_price@456 + sizes 1112/408). Offline/hermetic — no network in the default suite. Program UNTOUCHED (added a shared `readU128LE` to `sdk/src/accounts/common.ts`; barrel-exported `meteora` from `sdk/src/index.ts`). Offsets still to be verified against the DEPLOYED binary in M2.
