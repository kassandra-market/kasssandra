---
id: mem-no-native-token
title: "No native Kassandra token — fees and stakes are SOL/USDC"
tags: [memory, tokens, economics]
updated: 2026-09-07
---

# No native protocol token

Kassandra does **not** mint a KASS (or any other) native token. The oracle is
backed by a trusted external AI feed plus decision markets, so a custom token
is not needed for dispute security.

- **SOL** (wrapped, 9 dp) is `Protocol.base_mint` / `Config.base_mint`: bonds,
  fact stakes, market funding/LP, creation-fee burns, protocol `fee_bps`.
- **USDC** (6 dp) remains the challenge-market quote and challenger escrow.
- `create_oracle` **never mints**. `Oracle.reward_emission` stays in the Pod
  layout (pinned) but is always 0 at create. `init_protocol` defaults
  `emission_num = 0` / `total_supply_cap = 0`.
- Field rename: `kass_mint` → `base_mint`, `KassPrice` → `SpotPrice` (SOL/USDC
  TWAP). Token-account args follow (`oraclePassBase`, `challengerBase`,
  `contributorBaseAta`, `ensureBaseAta`). Product names (`kassandra`,
  `kass_oracle`, program IDs) are unchanged.
- Historical `docs/plans/` still mention KASS; do not rewrite those.
