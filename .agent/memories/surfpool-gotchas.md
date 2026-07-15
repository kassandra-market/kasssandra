---
id: mem-surfpool-gotchas
title: "surfpool simnet gotchas"
tags: [memory, gotcha, surfpool, e2e]
updated: 2026-07-10
---

# surfpool simnet gotchas

surfpool is the local simnet for TS/browser e2e. Notes learned:

- **`timeTravel` moves `getSlot`/`unix_timestamp` but NOT the execution
  `Clock.slot`.** Slot-based cranks (e.g. the v0.4 AMM TWAP) need `clock`
  block-production mode + a fast slot-time; time-traveling alone won't advance the
  clock the program reads.
- **No sig-verify-bypass / impersonation cheatcode.** To drive an instruction with
  a hardcoded signer you don't hold, use a **LiteSVM** test with
  `withSigverify(false)` instead of surfpool.
- The indexer's price subscriber connects to surfpool's **websocket at RPC port +
  1** (bound explicitly, e.g. `ws://127.0.0.1:8900` for RPC `8899`).
- `make dev` owns port 8899; a leftover surfpool from a hard-killed run must be
  cleared (init_protocol would otherwise fail `AlreadyInitialized`).

See also `NOTES-surfpool.md` at the repo root.
