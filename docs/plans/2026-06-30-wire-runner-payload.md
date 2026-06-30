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

## Execution note
After each task: `cd sdk && pnpm typecheck && pnpm test` green (+ `just build` for the .so before W2's litesvm test), commit. The PARITY GUARD (W1) is the core value — it makes runner↔SDK encoding drift a hard failure. W2 is the end-to-end proof. Append a W1/W2 delta here.
