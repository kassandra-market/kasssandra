/**
 * Gated surfpool E2E: tracked MagicBlock GPT-oracle ELF + real `llm_oracle`
 * keeper against a local mock OpenRouter (no live API).
 *
 *   deploy test-identity `solana_gpt_oracle.so` on an `--offline` surfpool
 *     → initialize + create_llm_context
 *     → CreateSubject
 *     → RequestAi (CPI interact_with_llm)
 *     → llm_oracle + mock OpenRouter → callback_from_llm
 *     → Subject.resolved_option stamped
 *
 * GATING: `KASSANDRA_MARKET_E2E=1`, surfpool, markets `.so`, the GPT fixture,
 * and `LLM_ORACLE_BIN`. Distinct port from lifecycle: RPC 8932 / WS 8933.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair, TransactionInstruction, type Address } from "@solana/web3.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decodeMarketOracle, Phase } from "../../src/accounts/oracle.js";
import { GPT_ORACLE_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "../../src/constants.js";
import { concatBytes, createSubject, requestAi, ro, u32LE, w } from "../../src/instructions/index.js";
import * as pda from "../../src/pda.js";

import { MarketSurfpoolHarness, surfpoolReady } from "./harness/index.js";
import { MockOpenRouter } from "./mock-openrouter.js";

const here = dirname(fileURLToPath(import.meta.url));
const GPT_SO_PATH = resolve(here, "../../../../../programs/markets/tests/fixtures/solana_gpt_oracle.so");

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

const ENABLED = surfpoolReady() && existsSync(GPT_SO_PATH) && llmOracleBin() !== null;

interface Fixture {
  harness: MarketSurfpoolHarness;
  payer: Keypair;
  llmContext: Address;
}

describe.skipIf(!ENABLED)("surfpool GPT oracle + llm_oracle (mock OpenRouter)", () => {
  let f: Fixture;
  let mock: MockOpenRouter;
  let keeper: ChildProcess | undefined;
  let harness: MarketSurfpoolHarness | undefined;

  beforeAll(async () => {
    const sp = await MarketSurfpoolHarness.start({ port: 8932, wsPort: 8933, offline: true });
    harness = sp;
    await sp.deployElf(GPT_ORACLE_PROGRAM_ID.toString(), GPT_SO_PATH);

    const payer = await Keypair.generate();
    const identity = await Keypair.fromSecretKey(TEST_IDENTITY_SECRET);
    await sp.airdrop(payer.publicKey.toString(), 1_000_000_000_000);
    await sp.airdrop(identity.publicKey.toString(), 2_000_000_000);

    const gptIdentity = await pda.gptOracleIdentity();
    const counter = await pda.gptOracleCounter();
    const llmContext = (await pda.gptOracleContext(0)).address;

    await sp.sendIx(payer, [
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
    ]);

    const contextBytes = new TextEncoder().encode('Reply with JSON {"option_index": N}.');
    await sp.sendIx(payer, [
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
    ]);

    expect(identity.publicKey.toString()).toBe("tEsT3eV6RFCWs1BZ7AXTzasHqTtMnMLCB2tjQ42TDXD");

    f = { harness: sp, payer, llmContext };
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

  it("CreateSubject → RequestAi → llm_oracle(mock) stamps resolved_option", async () => {
    const nonce = 1n;
    const aiOption = 1;
    const subject = (await pda.subject(nonce)).address;

    await f.harness.sendIx(f.payer, [
      await createSubject({
        payer: f.payer.publicKey,
        nonce,
        optionsCount: 2,
        llmContext: f.llmContext,
      }),
    ]);

    let s = decodeMarketOracle(await f.harness.waitForAccount(subject));
    expect(s.optionsCount).toBe(2);
    expect(s.phase).toBe(Phase.Open);
    expect(s.resolvedOption).toBe(0xff);

    await f.harness.sendIx(
      f.payer,
      [
        await requestAi({
          subject,
          payer: f.payer.publicKey,
          text: "resolve",
          llmContext: f.llmContext,
        }),
      ],
      [],
      400_000,
    );

    keeper = spawnLlmOracle(f, mock);
    await waitForResolvedOption(f, subject, aiOption);

    expect(mock.requests.length).toBeGreaterThan(0);
    s = decodeMarketOracle(await f.harness.waitForAccount(subject));
    expect(s.phase).toBe(Phase.Resolved);
    expect(s.resolvedOption).toBe(aiOption);
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

const keeperLogsRef: string[] = [];

async function waitForResolvedOption(f: Fixture, subject: Address, option: number): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const decoded = decodeMarketOracle(await f.harness.waitForAccount(subject, 2_000));
      if (decoded.resolvedOption === option) return;
    } catch {
      // subject may briefly be missing between polls
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `Subject.resolved_option did not become ${option} within 60s.\nllm_oracle logs:\n${keeperLogsRef.join("")}`,
  );
}
