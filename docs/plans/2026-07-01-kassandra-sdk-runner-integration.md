# SDK/Runner Integration Deferrals — Design + Plan

> **For Claude:** REQUIRED SUB-SKILL: subagent-driven-development (per-task implement + review).

**Goal:** Close the last three integration deferrals: (I1) drive the 6 settlement builders through the real program in a surfpool E2E; (I2) add a v0-tx + Address-Lookup-Table path so near-cap (~60) proposer-set finalizes fit; (I3) give the runner an on-chain RPC fetch (Oracle/Fact accounts) paired with an off-chain prompt-text-by-hash source. NO on-chain program change (all three are SDK/runner/test).

**Context (from investigation, file:line).** The dispute/challenge/finalize builders are ALREADY driven through the real program via the surfpool RPC E2E (`sdk/test/surfpool/{lifecycle,challenge-market}-e2e.test.ts`). The genuine residuals are these three items. web3.js@3.0.0-rc.2 DOES export `AddressLookupTableProgram/AddressLookupTableAccount/VersionedTransaction/MessageV0/compileToV0Message` (confirmed in the installed bundle; NOTES-api.md never exercised them). The runner shares `kassandra-program` so `Oracle/Proposer/Fact` are `Pod`-decodable from raw bytes with zero new decode code; it has NO Solana RPC crate today (reqwest-only). Only `prompt_hash` (not interpretation text) is on chain → on-chain fetch MUST be paired with an off-chain prompt source keyed by prompt_hash.

## Tasks

### I1 — Settlement E2E arm on surfpool (the 6 claim/close/sweep builders)
- Add a gated (`KASSANDRA_E2E=1`) surfpool E2E (extend `sdk/test/surfpool/lifecycle-e2e.test.ts` or a sibling `settlement-e2e.test.ts`) that drives the SETTLEMENT builders through the REAL program over RPC, end-to-end: a full lifecycle to `Resolved` (reuse the lifecycle dispute→AI-claim arm), then EVERY staker claims + closes: `claimProposer` (correct→bond+reward, wrong→bond, disqualified→0), `claimFact` (agreed→stake+reward, rejected→0), `claimFactVote` (agreed-approve→stake+reward, rejected-approve→stake−slash), `closeAiClaim`, `closeMarket` (if a challenge ran), then `sweepOracle` after the grace (use the clock/slot advance — NOTE the surfpool slot-vs-timestamp finding: sweep gate is `now >= phase_ends_at + SWEEP_GRACE` which is TIMESTAMP-based, so `advanceToUnix`/timeTravel works; the 30-day grace needs a big time jump). Decode over RPC + assert: each entitlement, all per-staker accounts closed, the vault swept + Oracle/stake_vault closed, KASS conservation. Prefer driving REAL instructions; seed where a precondition is impractical (document). 
- Also drive an `InvalidDeadend` arm → resolve/settle → sweep (the dead-end burns already merged; assert the vault drains + sweep closes).
- Keep the default `pnpm test` offline + green; gated. Commit `test(e2e): settlement builders (claim/close/sweep) end-to-end on surfpool`.

### I2 — v0-tx + Address Lookup Table path for large finalizes (SDK)
- Add an SDK helper (e.g. `sdk/src/v0.ts` or extend the interop) to send a finalize instruction as a VERSIONED tx over an ALT when the proposer set is large: `AddressLookupTableProgram.createLookupTable` + `extendLookupTable` (chunked extends) to publish an ALT holding the proposer PDAs (+ the oracle/program/mints as needed), wait for it to be slot-confirmed, then `compileToV0Message([lookupTableAccount])` → `VersionedTransaction` → sign + send. Apply to `finalizeProposals` + `finalizeOracle` (the FULL-set, one-shot finalizes that overflow a legacy tx at ~60 proposers). Provide a clear API (a `sendFinalizeViaAlt(...)` or an option on a send helper) + document that near-cap oracles require it (ALT setup is 2+ txs + a slot wait, live-cluster only).
- **Prove it on surfpool** (gated): create an oracle with a LARGE proposer set (near MAX_PROPOSERS=60 — or the largest that's tractable to fund/propose on the fork; document the count), drive it to the finalize, and finalize via the v0+ALT path → assert it SUCCEEDS where a legacy tx would overflow (and, if cheap, assert the legacy path throws the size error at that count, to demonstrate the need). Update `NOTES-api.md` with the v0/ALT API. Also add the v0 analog of the litesvm bridge if needed (or note ALT is live-cluster-only, not litesvm — the surfpool proof is the coverage).
- Unit-test what's unit-testable offline (the v0 message compiles with an ALT account; the ALT-key packing). Update the SDK README's "known limitation" → now supported via the v0/ALT path. Keep default `pnpm test` green. Commit `feat(sdk): v0-tx + Address Lookup Table path for near-cap finalizes`.

### I3 — Runner on-chain RPC fetch + off-chain prompt source
- Add an RPC layer to the runner (`runner/src/`): a `fetch_oracle_config(rpc_url, oracle_pubkey)` (or by nonce) that (a) RPC `getAccountInfo` (base64) for the Oracle account → `bytemuck`-decode via the shared `kassandra_program::state::Oracle` → `options_count`, `deadline`, `prompt_hash`, the fact set (fetch the agreed `Fact` accounts → `content_hash` + `uri`; determine how to enumerate the oracle's facts — by the Fact PDA scheme / getProgramAccounts filter, document), and (b) resolve the interpretation TEXT from an OFF-CHAIN prompt source keyed by `prompt_hash` (a local file/registry: given a prompt-text file, assert `sha256(text) == prompt_hash` — REJECT on mismatch, mirroring the fact content_hash verification). Build the runner's `RunnerConfig` from (a)+(b) so `run` can take `--oracle <pubkey> --rpc-url <url> --prompt-file <path>` instead of the full explicit config.
- Use JSON-RPC `getAccountInfo` via the existing reqwest (no heavy solana-client dep) — the Pod decode is free via the shared crate. If enumerating the fact set from chain needs `getProgramAccounts` with a memcmp filter, implement it (or, if the Oracle doesn't index its facts and enumeration is impractical, document that the fact list is still supplied explicitly + only the Oracle-level fields are fetched — a partial fetch is acceptable if enumeration is genuinely blocked; report it).
- NO runner-side submission (the SDK bridge covers it — out of scope).
- Tests: a mock RPC (serve a canned `getAccountInfo` base64 of a real Oracle/Fact byte layout) → assert the runner decodes the config correctly; the prompt-by-hash source verifies `sha256(text)==prompt_hash` (match passes, mismatch rejected). Offline (the runner's cargo suite). Update `runner/README.md` (the new `--oracle/--rpc-url/--prompt-file` mode + the prompt-hash requirement). Commit `feat(runner): on-chain oracle/fact RPC fetch + off-chain prompt-by-hash source`.

## Out of scope / deferred
- On-chain program changes (none — all SDK/runner/test).
- Runner-side transaction submission (the SDK bridge covers it).
- Meteora DAMM v2 spot-path builders (undeterminable zero-copy offsets — stays deferred).
- A litesvm mirror of the settlement flow (surfpool E2E is the coverage; skip per decision).

## Delta log

### I3 — Runner on-chain RPC fetch + off-chain prompt source (done)
- **New module `runner/src/rpc.rs`** — a minimal Solana JSON-RPC layer over the
  existing `reqwest` (no `solana-client`/`solana-sdk`). A `JsonRpc` trait
  (`call(method, params) -> result`) with the real `HttpJsonRpc` (POSTs the
  `{jsonrpc,id,method,params}` envelope, surfaces JSON-RPC `error` objects) and a
  no-network `MockRpc` (canned `method -> result`, mirrors `MockFactFetcher`) so
  the whole decode path is OFFLINE-testable.
- **`fetch_oracle`** — `getAccountInfo` (base64) → validate owner ==
  `kassandra_program::ID` + `AccountType::Oracle` tag + length → decode via the
  SHARED `kassandra_program::state::Oracle` Pod struct (`pod_read_unaligned`,
  zero new decode code). `null` value → `AccountNotFound`.
- **Fact enumeration via `getProgramAccounts`** (chosen over the documented
  fallback — enumeration was tractable): a `Fact` PDA is `[b"fact", oracle,
  content_hash]` so it can't be derived without the hashes; instead a filter of
  `dataSize == Fact::LEN (336)` + `memcmp` on the `Fact.oracle` field (offset 8,
  tied to `offset_of!(Fact, oracle)` with a compile-time assert; `memcmp bytes`
  are base58 = the RPC default) pulls this oracle's `Fact` accounts, each decoded
  via the shared `Fact` struct and kept iff `agreed`. `content_hash` + UTF-8
  `uri[..uri_len]` returned, sorted by `content_hash`.
- **Off-chain prompt-by-hash source** — `verify_prompt_hash(text, &prompt_hash)`
  asserts `sha256(text) == oracle.prompt_hash` and REJECTS a mismatch
  (`PromptHashMismatch`). Confirmed the derivation: the program stores
  `prompt_hash` as an OPAQUE caller-supplied 32-byte value (never hashes anything
  — `create_oracle.rs` copies `payload[8..40]` verbatim, exactly like
  `content_hash`), so the derivation is the off-chain convention `prompt_hash =
  sha256(interpretation_text_utf8)` (plain SHA-256, no framing) mirrored from
  `fetch.rs`.
- **CLI** — `CommonArgs` gains `--oracle/--rpc-url/--prompt-file`;
  `build_config_from_chain(rpc, oracle_pubkey, prompt_text)` assembles the
  `RunnerConfig` (options_count/facts from chain, interpretation from the
  verified prompt file) and a `resolve_config` dispatches explicit-vs-on-chain
  (mutually exclusive; `--oracle` requires the other two). Both `run`/`verify`
  use it; the existing explicit-config path is unchanged. NO runner submission.
- **Deps added:** `bytemuck` (Pod decode), `bs58` (owner/pubkey), `base64`
  (account-data decode) — all small, pure-Rust.
- **Tests (offline):** `rpc.rs` — oracle decode of shared Pod fields; rejects
  wrong owner / wrong tag / not-found; fact enumeration decodes + filters agreed
  (+ empty); prompt-hash match passes, mismatch rejected. `cli.rs` — end-to-end
  `build_config_from_chain` via `MockRpc` (Oracle+Fact Pod bytes → config → runs
  the pipeline through the mock provider) + prompt-mismatch rejection. `cargo
  test -p kassandra-runner` 78 lib + 5 e2e + 1 smoke green; `cargo clippy -D
  warnings` + `cargo fmt` clean. `runner/README.md` updated (on-chain mode +
  prompt-hash requirement; replaced the "No on-chain RPC fetch" limitation).

## Execution note
Independent tasks — can be reviewed/committed separately. I1 + I2 are gated surfpool E2E (spawn a fork/validator); I3 is runner + mock-RPC (offline). Keep the default `pnpm test` (102) + the runner `cargo test` offline + green. NOTE the surfpool slot-vs-timestamp finding: I1's sweep gate + the phase windows are timestamp-based (advanceToUnix works); I2's ALT needs slot-confirmation (a live cluster — surfpool). Append an I1/I2/I3 delta log here.

## I1 delta log — DONE (2026-07-01): `sdk/test/surfpool/settlement-e2e.test.ts`
Gated (`KASSANDRA_E2E=1`) surfpool E2E driving all 6 SETTLEMENT builders through the REAL program over RPC, in a standalone simnet (settlement touches no MetaDAO). Two arms, both green (`KASSANDRA_E2E=1 pnpm exec vitest run test/surfpool/settlement-e2e.test.ts` → 2 passed, ~21s):

- **RESOLVED arm** — real dispute (create → propose×3 options 0/1/1 → finalize_proposals → submit_fact×2 [one AGREED, one REJECTED] → advance_phase → vote_fact×2 → finalize_facts → submit_ai_claim×3 claims 0/0/1 → finalize_ai_claims → finalize_oracle → Resolved(0)). Then every staker claims + closes over RPC:
  - `claimFactVote`: agreed-approve → `stake + fact_reward`; rejected-approve → `stake − ceil(stake·num/den)`.
  - `claimFact`: agreed → `stake + fact_reward`; rejected → `0` (forfeit). VotersOutstanding ordering respected (votes first, submitter last).
  - `claimProposer` matrix: correct+no-flip → `bond + reward`; correct+flip → `bond − flip_slash + reward`; surviving-but-wrong → `bond` (no reward). All three rows asserted exercised.
  - `closeAiClaim` ×3 (rent → authority; open→closed asserted).
  - `closeMarket` — SEEDED settled Market + empty escrow via `surfnet_setAccount`, REAL `close_market` driven over RPC → Market + escrow closed, both rents → challenger.
  - `sweepOracle` after the REAL 30-day grace (`advanceToUnix(phase_ends_at + SWEEP_GRACE + 1)`) → residual dust → treasury ATA, stake_vault + Oracle CLOSED.
  - Conservation: `Σ payouts + residual dust == vault_initial` (dust < 8, floor/ceil rounding only).
- **INVALID-DEADEND arm** — real dispute driven to a plurality tie (claims 0/1) → InvalidDeadend (`reward_pool == 0`). Claims return non-slashed principal (full bonds/stakes, no rewards), `closeAiClaim` each, conservation `Σ payouts + dust == vault_initial`, then `sweepOracle` after grace drains + closes the vault/oracle.

**Real vs seeded:** every settlement builder + the dispute core is REAL over RPC; seeded (documented in the file header): the SPL mints/token accounts, the governance handoff's `kass_dao` account (fabricated futarchy-owned + Dao disc so the REAL `set_governance` validates — no futarchy program is deployed in a standalone simnet, and `set_governance` does no CPI, only owner/disc/PDA checks), the treasury ATA, and `close_market`'s settled-Market/escrow bytes. The disqualified-proposer claim row (→ 0) needs a real `settle_challenge` disqualify (forked AMMs) and stays covered by `challenge-market-e2e` (asserts `slashed_amount == bond − kass_fee`) + Rust `settlement_e2e`; the duplicate-dominant fact rows stay covered by Rust `settlement_e2e` tests 6-7.

**No SDK↔program mismatch:** all 6 builders were accepted by the real program and their on-chain entitlement/close/sweep effects matched the reimplemented `reward.rs` math. Default `pnpm test` stays 102 offline.

## I2 delta log — DONE (2026-07-01): `sdk/src/v0.ts` + tests

**New module `sdk/src/v0.ts`** (barrel-exported) — a v0-tx + Address Lookup Table
path removing the legacy near-cap-finalize overflow. Uses the CLASSIC web3.js
v3 ALT/v0 API confirmed against the installed `lib/index.d.ts` (NOT guessed):
`AddressLookupTableProgram.createLookupTable` (async → `[ix, address]`) +
`extendLookupTable` (sync, CHUNKED at `DEFAULT_EXTEND_CHUNK = 30`), poll
`connection.getAddressLookupTable` until active (all addresses present AND
`getSlot() > lastExtendedSlot`), then
`new TransactionMessage(...).compileToV0Message([alt])` →
`new VersionedTransaction(msg)` → `.sign([...])` (async) → `.serialize()` (sync,
unlike the legacy async serialize) → `sendRawTransaction`. Public API:
`compileV0Message` (pure/offline), `createProposerAlt`, `sendV0`, and the
one-shot `sendFinalizeViaAlt({ connection, payer, instruction, lookupAddresses,
prependInstructions?, signers?, confirm? })`. No program change.

**Overflow arithmetic:** `finalize*` inline the full proposer set (32 B/key), so
a legacy compiled message exceeds the 1232-byte packet (`PACKET_DATA_SIZE`) at
~28 proposers; a near-cap set (`MAX_PROPOSERS = 60`) overflows outright. The v0
message references the read-only proposers via `addressTableLookups`
(readonlyIndexes) — 1 byte each.

**Offline unit test `test/v0.test.ts`** (default suite, hermetic): builds a
40-proposer `finalizeOracle`; asserts (1) the legacy compiled message > 1232 B,
(2) `compileV0Message` with a MOCK `AddressLookupTableAccount` yields a
`version === 0` message with one `addressTableLookups` entry whose 40
`readonlyIndexes` resolve back to the exact proposer PDAs, (3) the v0 message
fits the packet and is smaller than legacy.

**Surfpool proof `test/surfpool/v0-alt-e2e.test.ts`** (gated `KASSANDRA_E2E=1`,
`clock` block-production + `slotTimeMs: 10` so the ALT activates). Standalone
simnet: init_protocol → create oracle → propose × **40** (same option,
uncontested) → advance. FIRST asserts the LEGACY `finalize_proposals` tx over
the 40-proposer set THROWS on serialize (packet overflow) and leaves the oracle
in `Proposal`. THEN `sendFinalizeViaAlt` (with a `setComputeUnitLimit(600k)`
prepend — 40-proposer finalize exceeds the 200k CU default) publishes the ALT +
sends the v0 finalize → oracle decodes to `Resolved` with the agreed option; the
ALT holds all 40 addresses. Count 40 is documented: past the ~28 overflow
threshold, under MAX_PROPOSERS = 60, reliably fundable/proposable on the simnet.
Run: `KASSANDRA_E2E=1 pnpm exec vitest run test/surfpool/v0-alt-e2e.test.ts` →
1 passed (~48s).

**Docs:** `NOTES-api.md` gains a "v0 transactions + Address Lookup Tables" section
(exact symbols/signatures + the 2-txs-and-a-slot-wait + live-cluster-only
caveat); `README.md`'s "Legacy transactions only" known-limitation flipped to
SUPPORTED-via-`src/v0.ts` with the caveat + layout entry. Default `pnpm test`
now 104 offline (102 + 2); `pnpm typecheck` clean. Untouched: the I1 settlement
test, the I3 runner files, and the on-chain program.
