/**
 * W2 — litesvm proof: Ix 3 `submit_ai_claim` is retired.
 *
 * A GENUINE runner payload, wired through the SDK bridge, is REJECTED by the
 * REAL program with `SubmitAiClaimRetired` (43). MagicBlock GPT is the only AI
 * source; stamp proposers via `apply_external_ai_claim`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { address, lamports } from "@solana/kit";
import { Address, Keypair, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { beforeAll, describe, expect, it } from "vitest";

import { AccountType, ACCOUNT_SIZES, CLAIM_OPTION_NONE, KASSANDRA_PROGRAM_ID, Phase } from "../src/constants.js";
import { toLiteSvmTransaction } from "../src/litesvm-interop.js";
import { submitAiClaimFromRunner, type RunnerOutput } from "../src/runner-bridge.js";

const PROGRAM_ID = KASSANDRA_PROGRAM_ID.toString();

const here = dirname(fileURLToPath(import.meta.url));
const SO_PATH = resolve(here, "../../../../target/deploy/kassandra_oracles_program.so");
const FIXTURE_PATH = resolve(here, "fixtures/runner-output.json");

/** Write a program-owned account into litesvm at `key` holding `data`. */
function putProgramAccount(svm: LiteSVM, key: Address, data: Uint8Array): void {
  svm.setAccount({
    address: address(key.toString()),
    data,
    executable: false,
    lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(data.length))),
    programAddress: address(PROGRAM_ID),
    space: BigInt(data.length),
  });
}

/**
 * Fabricate the 392-byte `Oracle` Pod bytes (state.rs layout, offsets per the
 * SDK `decodeOracle`) in `Phase::AiClaim` with `options_count` options and the
 * phase window open until `phaseEndsAt`. Mirrors the Rust harness seeding: only
 * the fields `submit_ai_claim` reads need be meaningful; the rest stay zeroed.
 */
function oracleBytes(opts: {
  optionsCount: number;
  phaseEndsAt: bigint;
  proposerCount: number;
}): Uint8Array {
  const data = new Uint8Array(ACCOUNT_SIZES.Oracle);
  const dv = new DataView(data.buffer);
  data[0] = AccountType.Oracle; // account_type @0
  // creator/base_mint/usdc_mint/stake_vault (@8/@40/@72/@104) — unread here, left zero.
  dv.setBigInt64(136, 0n, true); // deadline — unread by submit_ai_claim
  dv.setBigInt64(144, opts.phaseEndsAt, true); // phase_ends_at — require_before_end gate
  dv.setBigInt64(152, 600n, true); // twap_window
  data[160] = opts.optionsCount; // options_count @160
  data[161] = Phase.AiClaim; // phase @161
  dv.setUint16(162, opts.proposerCount, true); // proposer_count @162
  dv.setUint16(164, opts.proposerCount, true); // surviving_count @164
  return data;
}

/**
 * Fabricate the 96-byte `Proposer` Pod bytes (state.rs layout, offsets per the
 * SDK `decodeProposer`) bound to `oracle` and controlled by `authority`, with
 * `claim_option == CLAIM_OPTION_NONE` and NOT disqualified — exactly what
 * `submit_ai_claim` requires of a fresh, locked-in proposer.
 */
function proposerBytes(opts: {
  oracle: Address;
  authority: Address;
  originalOption: number;
}): Uint8Array {
  const data = new Uint8Array(ACCOUNT_SIZES.Proposer);
  const dv = new DataView(data.buffer);
  data[0] = AccountType.Proposer; // account_type @0
  data.set(opts.oracle.toBytes(), 8); // oracle @8
  data.set(opts.authority.toBytes(), 40); // authority @40
  dv.setBigUint64(72, 0n, true); // bond @72 — unread by submit_ai_claim
  data[80] = opts.originalOption; // original_option @80
  data[81] = CLAIM_OPTION_NONE; // claim_option @81 (no claim yet)
  // disqualified/slashed/flipped/ai_finalized (@82..@86) — all 0 (zeroed).
  return data;
}

describe("W2 litesvm proof — genuine runner payload rejected as SubmitAiClaimRetired", () => {
  beforeAll(() => {
    if (!existsSync(SO_PATH)) {
      throw new Error(
        `Missing program artifact at ${SO_PATH}. Run \`just build\` from the repo root first.`,
      );
    }
  });

  it("seeds AiClaim-phase oracle+proposer; the bridge-built Ix 3 is rejected as retired", async () => {
    const fixture: RunnerOutput = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    expect(fixture.claim_pda_seeds).toBeDefined();
    const oracle = new Address(fixture.claim_pda_seeds!.oracle);
    const proposer = new Address(fixture.claim_pda_seeds!.proposer);

    const svm = new LiteSVM();
    svm.addProgramFromFile(address(PROGRAM_ID), SO_PATH);

    // Fee payer + the proposer's human authority (signs submit_ai_claim, funds
    // the AiClaim rent). authority must equal proposer.authority.
    const payer = await Keypair.generate();
    svm.airdrop(payer.address, lamports(100_000_000_000n));
    const authority = await Keypair.generate();
    svm.airdrop(authority.address, lamports(10_000_000_000n));

    // --- Seed the precondition directly (covered-by-the-Rust-suite upstream) ---
    const baseUnix = svm.getClock().unixTimestamp;
    putProgramAccount(
      svm,
      oracle,
      oracleBytes({ optionsCount: 2, phaseEndsAt: baseUnix + 100_000n, proposerCount: 1 }),
    );
    putProgramAccount(
      svm,
      proposer,
      proposerBytes({ oracle, authority: authority.publicKey, originalOption: 0 }),
    );

    // --- Build via the bridge (parity guard + PDA cross-check run here) --------
    const ix: TransactionInstruction = await submitAiClaimFromRunner(fixture, {
      oracle,
      proposer,
      authority: authority.publicKey,
    });

    // --- Sign, bridge, submit to the REAL program -----------------------------
    const tx = new Transaction();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(ix);
    await tx.sign(payer, authority);
    const result = svm.sendTransaction(await toLiteSvmTransaction(tx));

    if (!(result instanceof FailedTransactionMetadata)) {
      throw new Error("expected SubmitAiClaimRetired; Ix 3 was accepted");
    }
    expect(String(result)).toMatch(/43/);
  });
});
