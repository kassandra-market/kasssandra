---
id: memory-magicblock-pinocchio-cpi
title: Hand-roll MagicBlock CPI — do not depend on ephemeral-rollups-pinocchio
tags: [memory, magicblock, pinocchio, cpi]
updated: 2026-09-07
---

# Hand-roll MagicBlock CPI

Do **not** add `ephemeral-rollups-pinocchio` (or `ephemeral-rollups-sdk`) as a
program dependency. Those crates pin pinocchio `^0.10`; this workspace is on
`0.11.2`. The same pattern as MetaDAO applies: reconstruct the CPI wire in
`programs/oracles/src/cpi/magicblock.rs`.

## Discriminators

Kassandra `Ix` is a **single byte**. MagicBlock's undelegate **callback** is an
**8-byte** discriminator `[196, 28, 41, 206, 48, 37, 51, 167]`. Intercept it in
`process_instruction` **before** the 1-byte `Ix` dispatch, or a callback will
be parsed as a garbage Kassandra instruction.

Delegate CPI data: `u64 LE disc (0)` ++ serialized args (`commit_frequency_ms`,
seeds, `Option<Address>`).

## LiteSVM vs production

LiteSVM tests use the **short form** (oracle + `ErSession` + payer + system) and
do **not** transfer account ownership. Full MagicBlock account lists (owner
program, buffer, record, metadata, delegation program) are remaining accounts;
CPI is taken only when they are present.

## Companion PDA

Do not resize `Oracle` (368) or `Protocol` (392). Delegation status lives on
`ErSession` at `[b"er_session", oracle]` (or `[b"er_session", market]` on the
markets program). `oracle`/`market` is at offset 8, same as other children.
