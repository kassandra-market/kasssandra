/**
 * Gated surfpool E2E: the tracked MagicBlock GPT-oracle ELF + real `llm_oracle`
 * keeper against a local mock OpenRouter (no live API).
 *
 *   deploy test-identity `solana_gpt_oracle.so` on an `--offline` surfpool
 *     → initialize + create_llm_context
 *     → SetAiOracleConfig
 *     → dispute to AiClaim
 *     → RequestAiOracle (CPI interact_with_llm)
 *     → llm_oracle + mock OpenRouter → callback_from_llm
 *     → ApplyExternalAiClaim
 *
 * GATING: `KASSANDRA_E2E=1`, surfpool, Kassandra `.so`, the GPT fixture, and
 * `LLM_ORACLE_BIN` (built by `scripts/vendor-solana-gpt-oracle.sh --llm-oracle-only`).
 * Distinct port from lifecycle (8901): RPC 8932 / WS 8933.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ComputeBudgetProgram,
  Keypair,
  Transaction,
  TransactionInstruction,
  type Address,
} from "@solana/web3.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decodeAiClaim, decodeAiOracleFeed, decodeOracle } from "../../src/accounts/index.js";
import {
  GPT_ORACLE_PROGRAM_ID,
  Phase,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  VOTE_APPROVE,
} from "../../src/constants.js";
import {
  advancePhase,
  applyExternalAiClaim,
  concatBytes,
  createOracle,
  finalizeFacts,
  finalizeProposals,
  initProtocol,
  propose,
  requestAiOracle,
  ro,
  setAiOracleConfig,
  submitFact,
  u32LE,
  voteFact,
  w,
} from "../../src/instructions/index.js";
import * as pda from "../../src/pda.js";

import {
  SurfpoolHarness,
  mintBytes,
  surfpoolReady,
  toHex,
  tokenAccountBytes,
} from "./harness.js";
import { MockOpenRouter } from "./mock-openrouter.js";

const here = dirname(fileURLToPath(import.meta.url));
const GPT_SO_PATH = resolve(
  here,
  "../../../../../programs/oracles/tests/fixtures/solana_gpt_oracle.so",
);

/** MagicBlock public test oracle (64-byte secret). Pubkey `tEsT3eV6…`. */
const TEST_IDENTITY_SECRET = Uint8Array.from([
  251, 62, 129, 184, 107, 49, 62, 184, 1, 147, 178, 128, 185, 157, 247, 92, 56, 158, 145, 53, 51,
  226, 202, 96, 178, 248, 195, 133, 133, 237, 237, 146, 13, 32, 77, 204, 244, 56, 166, 172, 66, 113,
  150, 218, 112, 42, 110, 181, 98, 158, 222, 194, 130, 93, 175, 100, 190, 106, 9, 69, 156, 80, 96,
  72,
]);

/** Base58 secret `llm_oracle` reads from `IDENTITY`. */
const TEST_IDENTITY_B58 =
  "62LxqpAW6SWhp7iKBjCQneapn1w6btAhW7xHeREWSpPzw3xZbHCfAFesSR4R76ejQXCLWrndn37cKCCLFvx6Swps";

const GPT_INITIALIZE = Uint8Array.of(0xaf, 0xaf, 0x6d, 0x1f, 0x0d, 0x98, 0x9b, 0xed);
const GPT_CREATE_LLM_CONTEXT = Uint8Array.of(0xe0, 0x6d, 0x04, 0xad, 0xbf, 0x19, 0x2a, 0xa2);

function llmOracleBin(): string | null {
  const p = process.env.LLM_ORACLE_BIN;
  return p && existsSync(p) ? p : null;
}

const ENABLED =
  process.env.KASSANDRA_E2E === "1" &&
  surfpoolReady() &&
  existsSync(GPT_SO_PATH) &&
  llmOracleBin() !== null;

interface Fixture {
  harness: SurfpoolHarness;
  payer: Keypair;
  baseMint: Keypair;
  usdcMint: Keypair;
  llmContext: Address;
}

describe.skipIf(!ENABLED)("surfpool GPT oracle + llm_oracle (mock OpenRouter)", () => {
  let f: Fixture;
  let mock: MockOpenRouter;
  let keeper: ChildProcess | undefined;
  let harness: SurfpoolHarness | undefined;

  beforeAll(async () => {
    const sp = await SurfpoolHarness.start({ port: 8932, wsPort: 8933, offline: true });
    harness = sp;
    await sp.deployElf(GPT_ORACLE_PROGRAM_ID.toString(), GPT_SO_PATH);

    const payer = await Keypair.generate();
    const identity = await Keypair.fromSecretKey(TEST_IDENTITY_SECRET);
    await sp.airdrop(payer.publicKey.toString(), 1_000_000_000_000);
    await sp.airdrop(identity.publicKey.toString(), 2_000_000_000);

    const mintAuth = await pda.mintAuthority();
    const baseMint = await Keypair.generate();
    const usdcMint = await Keypair.generate();
    await sp.setAccount(baseMint.publicKey.toString(), {
      lamports: 1_000_000_000,
      owner: TOKEN_PROGRAM_ID.toString(),
      executable: false,
      data: toHex(mintBytes(mintAuth.address.toBytes(), 10n ** 18n, 9)),
    });
    await sp.setAccount(usdcMint.publicKey.toString(), {
      lamports: 1_000_000_000,
      owner: TOKEN_PROGRAM_ID.toString(),
      executable: false,
      data: toHex(mintBytes(payer.publicKey.toBytes(), 0n, 6)),
    });

    await sendIx(
      sp,
      payer,
      await initProtocol({
        admin: payer.publicKey,
        baseMint: baseMint.publicKey,
        usdcMint: usdcMint.publicKey,
      }),
    );

    const gptIdentity = await pda.gptOracleIdentity();
    const counter = await pda.gptOracleCounter();
    const llmContext = (await pda.gptOracleContext(0)).address;

    await sendIx(
      sp,
      payer,
      new TransactionInstruction({
        programId: GPT_ORACLE_PROGRAM_ID,
        keys: [
          w(payer.publicKey, true),
          w(gptIdentity.address),
          w(counter.address),
          ro(SYSTEM_PROGRAM_ID),
        ],
        data: GPT_INITIALIZE,
      }),
    );

    const contextText = 'Reply with JSON {"option_index": N}.';
    const enc = new TextEncoder();
    const contextBytes = enc.encode(contextText);
    await sendIx(
      sp,
      payer,
      new TransactionInstruction({
        programId: GPT_ORACLE_PROGRAM_ID,
        keys: [
          w(payer.publicKey, true),
          w(counter.address),
          w(llmContext),
          ro(SYSTEM_PROGRAM_ID),
        ],
        data: concatBytes([GPT_CREATE_LLM_CONTEXT, u32LE(contextBytes.length), contextBytes]),
      }),
    );

    await sendIx(
      sp,
      payer,
      await setAiOracleConfig({
        authority: payer.publicKey,
        llmContext,
        maxStalenessSlots: 10_000n,
        source: 1,
        enabled: true,
      }),
    );

    expect(identity.publicKey.toString()).toBe("tEsT3eV6RFCWs1BZ7AXTzasHqTtMnMLCB2tjQ42TDXD");

    f = { harness: sp, payer, baseMint, usdcMint, llmContext };
    mock = await MockOpenRouter.start();
    mock.setOption(1);
  }, 90_000);

  afterAll(async () => {
    if (keeper && keeper.exitCode === null) {
      keeper.kill("SIGKILL");
    }
    await mock?.stop();
    await harness?.teardown();
  });

  it("requestAiOracle → llm_oracle(mock) → applyExternalAiClaim", async () => {
    const nonce = 1n;
    const oracle = (await pda.oracle(nonce)).address;
    const bond = 1_000n;
    const aiOption = 1;

    await createOracleReal(f, nonce, 2);
    await openProposals(f, oracle);

    const authorities: Keypair[] = [];
    const proposerPdas: Address[] = [];
    for (const option of [0, 1]) {
      const { authority, proposer } = await proposeRealWithAuthority(f, oracle, option, bond);
      authorities.push(authority);
      proposerPdas.push(proposer);
    }

    await advancePastPhaseEnd(f, oracle);
    await sendIx(f.harness, f.payer, await finalizeProposals({ oracle, proposers: proposerPdas }));

    const contentHash = new Uint8Array(32).fill(0x07);
    const submitter = await Keypair.generate();
    await f.harness.airdrop(submitter.publicKey.toString(), 2_000_000_000);
    const submitterBase = await fundBase(f, submitter.publicKey, 1_000_000n);
    await sendIx(
      f.harness,
      f.payer,
      await submitFact({
        oracle,
        submitter: submitter.publicKey,
        submitterBase,
        contentHash,
        stake: 100n,
        uri: "ipfs://fact",
      }),
      [submitter],
    );
    const fact = (await pda.fact(oracle, contentHash)).address;

    await advancePastPhaseEnd(f, oracle);
    await sendIx(f.harness, f.payer, await advancePhase({ oracle }));

    const voter = await Keypair.generate();
    await f.harness.airdrop(voter.publicKey.toString(), 2_000_000_000);
    const voterBase = await fundBase(f, voter.publicKey, 10_000n);
    await sendIx(
      f.harness,
      f.payer,
      await voteFact({
        oracle,
        fact,
        voter: voter.publicKey,
        voterBase,
        kind: VOTE_APPROVE,
        stake: 2_000n,
      }),
      [voter],
    );

    await advancePastPhaseEnd(f, oracle);
    await sendIx(
      f.harness,
      f.payer,
      await finalizeFacts({ nonce, baseMint: f.baseMint.publicKey, tail: [fact] }),
    );
    let o = decodeOracle(await fetchAccount(f, oracle));
    expect(o.phase).toBe(Phase.AiClaim);

    await sendIx(
      f.harness,
      f.payer,
      await requestAiOracle({
        oracle,
        payer: f.payer.publicKey,
        text: "resolve",
        llmContext: f.llmContext,
      }),
      [],
      400_000,
    );

    const feedPda = (await pda.aiOracleFeed(oracle)).address;
    let pending = decodeAiOracleFeed(await fetchAccount(f, feedPda));
    expect(pending.option).toBe(0xff);

    keeper = spawnLlmOracle(f, mock);
    await waitForFeedOption(f, feedPda, aiOption);

    expect(mock.requests.length).toBeGreaterThan(0);

    for (const authority of authorities) {
      await sendIx(
        f.harness,
        f.payer,
        await applyExternalAiClaim({
          oracle,
          proposerAuthority: authority.publicKey.toString(),
          payer: f.payer.publicKey.toString(),
        }),
      );
    }

    const claimPda = (await pda.aiClaim(oracle, proposerPdas[0])).address;
    const claim = decodeAiClaim(await fetchAccount(f, claimPda));
    expect(claim.option).toBe(aiOption);
  }, 180_000);
});

function spawnLlmOracle(f: Fixture, mock: MockOpenRouter): ChildProcess {
  const bin = llmOracleBin()!;
  const child = spawn(bin, [], {
    env: {
      ...process.env,
      IDENTITY: TEST_IDENTITY_B58,
      RPC_URL: f.harness.rpcUrl,
      WEBSOCKET_URL: f.harness.wsUrl ?? "ws://127.0.0.1:8933",
      OPENROUTER_API_KEY: "sk-mock-openrouter",
      OPENROUTER_API_URL: mock.completionsUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const onData = (buf: Buffer) => {
    keeperLogsRef.push(buf.toString());
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  return child;
}

/** Mutable log sink so `spawnLlmOracle` can append after `keeperLogs` is closed over. */
const keeperLogsRef: string[] = [];

async function waitForFeedOption(f: Fixture, feed: Address, option: number): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const decoded = decodeAiOracleFeed(await fetchAccount(f, feed, 2_000));
      if (decoded.option === option) return;
    } catch {
      // feed may briefly be missing between polls
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `AiOracleFeed.option did not become ${option} within 60s.\nllm_oracle logs:\n${keeperLogsRef.join("")}`,
  );
}

async function sendIx(
  harness: SurfpoolHarness,
  payer: Keypair,
  ix: TransactionInstruction,
  signers: Keypair[] = [],
  computeUnits = 300_000,
): Promise<void> {
  const conn = harness.connection;
  const tx = new Transaction();
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  tx.add(ix);
  await tx.sign(payer, ...signers);
  const sig = await conn.sendRawTransaction(await tx.serialize(), { skipPreflight: false });
  await harness.confirmSignature(sig);
}

async function fetchAccount(f: Fixture, address: Address, timeoutMs = 15_000): Promise<Uint8Array> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await f.harness.connection.getAccountInfo(address);
    if (info && info.data.length > 0) return info.data;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`account ${address} did not appear within ${timeoutMs}ms`);
}

async function fundBase(f: Fixture, owner: Address, amount: bigint): Promise<Address> {
  const acct = await Keypair.generate();
  await f.harness.setAccount(acct.publicKey.toString(), {
    lamports: 5_000_000,
    owner: TOKEN_PROGRAM_ID.toString(),
    executable: false,
    data: toHex(tokenAccountBytes(f.baseMint.publicKey.toBytes(), owner.toBytes(), amount)),
  });
  return acct.publicKey;
}

async function createOracleReal(f: Fixture, nonce: bigint, optionsCount: number): Promise<void> {
  const creatorBase = await fundBase(f, f.payer.publicKey, 10n ** 15n);
  const nowUnix = await f.harness.clockUnixTimestamp();
  await sendIx(
    f.harness,
    f.payer,
    await createOracle({
      nonce,
      optionsCount,
      deadline: nowUnix + 1_000n,
      twapWindow: 600n,
      creator: f.payer.publicKey,
      creatorBaseToken: creatorBase,
      baseMint: f.baseMint.publicKey,
      usdcMint: f.usdcMint.publicKey,
    }),
  );
}

async function openProposals(f: Fixture, oracle: Address): Promise<void> {
  const o = decodeOracle(await fetchAccount(f, oracle));
  await f.harness.advanceToUnix(o.deadline + 60n);
}

async function advancePastPhaseEnd(f: Fixture, oracle: Address): Promise<void> {
  const o = decodeOracle(await fetchAccount(f, oracle));
  await f.harness.advanceToUnix(o.phaseEndsAt + 120n);
}

async function proposeRealWithAuthority(
  f: Fixture,
  oracle: Address,
  option: number,
  bond: bigint,
): Promise<{ authority: Keypair; proposer: Address }> {
  const authority = await Keypair.generate();
  await f.harness.airdrop(authority.publicKey.toString(), 2_000_000_000);
  const authorityBase = await fundBase(f, authority.publicKey, bond * 10n);
  await sendIx(
    f.harness,
    f.payer,
    await propose({ oracle, authority: authority.publicKey, authorityBase, option, bond }),
    [authority],
  );
  const proposer = (await pda.proposer(oracle, authority.publicKey)).address;
  return { authority, proposer };
}
