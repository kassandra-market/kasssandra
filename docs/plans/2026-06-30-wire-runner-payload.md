# Wire the Runner Payload → SDK submitAiClaim — Plan

> **For Claude:** REQUIRED SUB-SKILL: subagent-driven-development (per-task implement + review).

**Goal:** Bridge the Rust runner's `run` output to the TypeScript SDK's `submitAiClaim` builder so a proposer can turn a runner result into the actual on-chain `submit_ai_claim` instruction — with a byte-parity guard that the SDK's encoding reproduces the runner's exact 97-byte payload, and a litesvm proof that the real program accepts it.

**Architecture:** A small SDK bridge function (`submitAiClaimFromRunner`) that parses the runner's `RunOutput` JSON (`model_id_hex`/`params_hash_hex`/`io_hash_hex` + `option_index` + `submit_ai_claim_payload_hex` + optional `claim_pda_seeds`), builds the SDK `submitAiClaim` `TransactionInstruction`, and ASSERTS the built instruction's 97-byte payload region equals the runner's `submit_ai_claim_payload_hex` (catches any disc/order/width drift between the two implementations). Proven against the real program via litesvm.

**Tech Stack:** TypeScript (the merged `sdk/` — `@solana/web3.js@3.0.0-rc.2`, `litesvm`, vitest). The Rust runner + the on-chain program are READ-ONLY here (do NOT modify them; if a genuine mismatch surfaces, STOP and report).

## Source-of-truth shapes (verified on master)
- Runner `RunOutput` (`runner/src/cli.rs`): `{ option_index: u8, model_id_hex, params_hash_hex, io_hash_hex, submit_ai_claim_payload_hex (97 bytes), resolved_model_id, claim_pda_seeds?: { seed_prefix:"claim", oracle: <b58>, proposer: <b58> } }`. Emitted as JSON by `run`.
- SDK `submitAiClaim(args)` (`sdk/src/instructions/dispute.ts`): args `{ oracle, proposer, authority, modelId:32B, paramsHash:32B, ioHash:32B, option:u8, programId? }`; data = `[Ix.SubmitAiClaim, modelId[32], paramsHash[32], ioHash[32], option]` (1+97=98 bytes); accounts `[oracle(w), proposer(w), aiClaim(w)=PDA[b"claim",oracle,proposer], authority(w,signer), system(ro)]`. SDK has `decodeAiClaim` (reads model_id/params_hash/io_hash/option/authority).
- The runner's `submit_ai_claim_payload_hex` is exactly the 98-byte instruction's data WITHOUT the leading disc byte (i.e. `data[1..98]`).

## Tasks

### W1 — The bridge + byte-parity (SDK)
- Add `submitAiClaimFromRunner(runOutput, { oracle, proposer, authority, programId? })` to the SDK (e.g. `sdk/src/runner-bridge.ts`, exported from the barrel). It:
  - Accepts the runner's `RunOutput` (a typed interface mirroring the Rust struct — define it) either as a parsed object or a JSON string.
  - Hex-decodes `model_id_hex`/`params_hash_hex`/`io_hash_hex` to `Uint8Array(32)` each (validate 32-byte width; clear error otherwise) + reads `option_index`.
  - Calls `submitAiClaim({ oracle, proposer, authority, modelId, paramsHash, ioHash, option, programId })` → the `TransactionInstruction`.
  - **PARITY GUARD:** asserts `instruction.data.slice(1, 98)` (the 97 payload bytes after the disc) equals hex-decode(`submit_ai_claim_payload_hex`) — throw a clear error on mismatch (this is the runner↔SDK encoding drift guard). Also assert `data[0] === Ix.SubmitAiClaim` and `data.length === 98`.
  - OPTIONAL cross-check: if `claim_pda_seeds` is present, assert its `oracle`/`proposer` match the passed `oracle`/`proposer` (and thus the derived aiClaim PDA) — clear error on mismatch.
  - Returns the verified instruction (ready to sign/send).
- **Generate a REAL runner fixture** (don't hand-fabricate): run the runner CLI once — `cargo run -p kassandra-runner -- run --mock --config <sample>` (or pipe a sample config to stdin) — capture the emitted JSON, and commit it as a test fixture (`sdk/test/fixtures/runner-output.json`). Document the sample config used. (If running the Rust binary from the SDK build is awkward, generate it once manually + commit the JSON; the fixture is the runner's genuine output, not a TS-authored guess.)
- Unit tests (vitest): feed the fixture through `submitAiClaimFromRunner` with sample oracle/proposer/authority addresses → assert the instruction's data == `[disc, ...payload_hex bytes]` (parity holds), the accounts are in the right order/roles with the aiClaim PDA derived from [b"claim",oracle,proposer], and that a TAMPERED fixture (flip a hash byte so `payload_hex` no longer matches the structured fields) makes the parity guard THROW. Typecheck + the existing SDK suite stay green.
- Commit `feat(sdk): submitAiClaimFromRunner bridge + runner-payload byte parity`.

### W2 — litesvm end-to-end proof (real program accepts the wired instruction)
- A litesvm test (`sdk/test/runner-bridge-e2e.test.ts`) that loads the real `target/deploy/kassandra_program.so` and drives `submit_ai_claim` built via `submitAiClaimFromRunner` from the runner fixture against the program:
  - Establish the precondition: an Oracle in the phase/state where `submit_ai_claim` is accepted (READ `programs/kassandra/src/processor/submit_ai_claim.rs` for the exact phase + account preconditions — e.g. the AI-claim submission phase after facts finalized, the proposer registered). Use whichever is tractable offline: drive the real dispute flow via the SDK builders up to that phase, OR `setAccount`-seed the Oracle + Proposer in the required phase/state (mirroring how the program's Rust tests seed oracles) + fund the authority. Document which approach + why.
  - Build `submit_ai_claim` via the bridge from the fixture (with the seeded oracle nonce / proposer / authority), submit via the litesvm interop bridge, and assert the program ACCEPTS it (TransactionMetadata, not Failed).
  - Fetch the resulting `AiClaim` account, `decodeAiClaim` it, and assert `model_id`/`params_hash`/`io_hash`/`option` equal the runner fixture's values (the runner's metadata is now on-chain, byte-for-byte). Assert the AiClaim PDA == [b"claim", oracle, proposer].
  - This proves the full path: runner output → SDK bridge → real program → on-chain AiClaim matching the runner.
- Keep the suite green + offline (no API key, no cluster). Commit `test(sdk): litesvm proof — runner payload submitted via submitAiClaim`.

## Out of scope (deferred)
- Live-cluster submission (funded wallet, RPC, real MetaDAO accounts existing on devnet/surfpool) — the bridge returns a ready-to-sign instruction; signing+sending to a real cluster is a separate later step.
- Driving the full dispute pipeline in the SDK if W2 seeds the precondition instead (note it as covered-by-the-Rust-suite).
- Any change to the runner or the program (read-only).

## W1 delta (done)

- **Bridge:** `sdk/src/runner-bridge.ts` — `submitAiClaimFromRunner(runOutput | json, { oracle, proposer, authority, programId? })` + the `RunnerOutput` interface (mirrors `RunOutput`). Exported from the barrel (`sdk/src/index.ts`). Accepts a parsed object or a JSON string; hex-decodes the three hashes (32-byte width validated), builds `submitAiClaim`, then the **parity guard**: asserts `data.length === 98`, `data[0] === Ix.SubmitAiClaim`, and `data.slice(1, 98)` byte-equals `hex(submit_ai_claim_payload_hex)` (97 bytes) — throwing a specific error naming the first differing byte on drift. If `claim_pda_seeds` is present, asserts `seed_prefix === "claim"` and its oracle/proposer (base58, normalized via `Address`) equal the passed ones.
- **Genuine fixture:** built the runner (`cargo build -p kassandra-runner`) and captured real output:
  - Config `sdk/test/fixtures/runner-config.json`: 2 options (Yes/No), **zero agreed facts** (so no live HTTP fetch needed), oracle/proposer base58 set (so `claim_pda_seeds` is emitted).
  - Command: `./target/debug/kassandra-runner run --mock --config sdk/test/fixtures/runner-config.json > sdk/test/fixtures/runner-output.json`. The `--mock` provider is deterministic (option 0), so the fixture is reproducible. Output is genuine Rust encoding (not TS-authored), so the parity test isn't circular.
- **Tests:** `sdk/test/runner-bridge.test.ts` (6, all green): (a) `data == [Ix.SubmitAiClaim, ...payload_hex]` parity holds against the genuine fixture; JSON-string input accepted; (b) account order/roles with aiClaim PDA `[b"claim", oracle, proposer]`; (c) a tampered `model_id_hex` byte makes the parity guard THROW; (d) wrong-width hash hex throws; (e) `claim_pda_seeds` oracle mismatch throws.
- **Verification:** `pnpm typecheck` clean; `pnpm test` 71 passed (8 files, incl. the existing litesvm suite after `cargo build-sbf` produced `target/deploy/kassandra_program.so`). Scope held — no W2 litesvm e2e.

## W2 delta (done)

- **Test:** `sdk/test/runner-bridge-e2e.test.ts` — loads the real
  `target/deploy/kassandra_program.so` and drives ONE genuine path:
  `runner-output.json` → `submitAiClaimFromRunner` → `toLiteSvmTransaction` →
  the real program → on-chain `AiClaim` decoded by `decodeAiClaim`.
- **Verified precondition (`processor/submit_ai_claim.rs`):** oracle is a
  program-owned `Oracle` in `Phase::AiClaim` with the window open
  (`now < phase_ends_at`); proposer is a program-owned `Proposer` with
  `proposer.oracle == oracle` and `proposer.authority == the signer`, NOT
  disqualified; `option < oracle.options_count` (fixture's `0 < 2`); the AiClaim
  PDA `[b"claim", oracle, proposer]` is empty (created here). The processor does
  NOT re-derive the Oracle/Proposer addresses (those PDA derivations are enforced
  only at create/propose), so seeding at arbitrary program-owned addresses is
  accepted.
- **Seeding (vs. live):** seeded the Oracle + Proposer bytes directly via
  `svm.setAccount` (program-owned; layout per `state.rs` / the SDK decoder
  offsets, mirroring the Rust harness `seed_disputed_oracle` + `set_phase`):
  Oracle `account_type=1`, `phase=AiClaim`, `options_count=2`,
  `phase_ends_at=now+100000`, `proposer_count=surviving_count=1`; Proposer
  `account_type=2`, `oracle`=the oracle, `authority`=a funded signer keypair,
  `claim_option=CLAIM_OPTION_NONE`, not disqualified. Seeded at the EXACT
  addresses the fixture's `claim_pda_seeds` names (`GuBhyNi5…` / `84yVtd…`) so
  the bridge's PDA cross-check passes and the AiClaim PDA is the runner's.
  Driving the full create→propose×2→finalize→facts→…→AiClaim pipeline live is
  COVERED BY THE RUST SUITE; this test isolates the runner→bridge→program→
  AiClaim leg.
- **Acceptance:** the REAL program ACCEPTED the bridge-built instruction
  (`TransactionMetadata`, not `FailedTransactionMetadata` — the test throws and
  surfaces the program error on any rejection, so it cannot be a masked pass).
- **AiClaim match:** the created `AiClaim` PDA decodes at 208 bytes with
  `model_id`/`params_hash`/`io_hash` (hex) and `option` (0) byte-identical to the
  fixture, `oracle`/`proposer` == the seeded accounts, and `authority` == the
  submit-time signer.
- **Verification:** `pnpm typecheck` clean; `pnpm test` 72 passed (9 files, incl.
  the new e2e). Offline — no API key, no cluster. No runner/program change.

## wire-runner: covered vs deferred

- **Covered:** runner `RunOutput` JSON → SDK `submitAiClaimFromRunner` bridge
  (W1, with the 97-byte byte-parity guard + PDA cross-check) → the real
  on-chain program accepting `submit_ai_claim` → the resulting `AiClaim`
  byte-matching the runner's metadata (W2, litesvm). The upstream dispute
  pipeline that lands an oracle in `Phase::AiClaim` is covered by the program's
  own Rust test suite (seeded here rather than re-driven).
- **Deferred:** live-cluster submission (funded wallet, RPC, real MetaDAO
  accounts on devnet/surfpool). The bridge returns a ready-to-sign instruction;
  signing+sending to a real cluster is a later step.

## Execution note
After each task: `cd sdk && pnpm typecheck && pnpm test` green (+ `just build` for the .so before W2's litesvm test), commit. The PARITY GUARD (W1) is the core value — it makes runner↔SDK encoding drift a hard failure. W2 is the end-to-end proof. Append a W1/W2 delta here.
