# 2026-09-07 — Ephemeral Rollups + external AI oracle

Append-only historical note. Living spec:
[`.agent/specs/ephemeral-rollups-and-ai-oracle.md`](../../.agent/specs/ephemeral-rollups-and-ai-oracle.md).

Kassandra is revisited so interactive dispute/trading can run on MagicBlock
Ephemeral Rollups (programs stay on Solana; accounts are delegated) and the
AI-claim round consumes an external attested feed rather than the in-house
runner being protocol-critical. Challenge markets stay the economic override.
Existing `Oracle`/`Protocol` Pod sizes are not resized — companion PDAs carry
the new state.
