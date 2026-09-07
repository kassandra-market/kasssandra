/**
 * ER + external AI-oracle instruction-builder byte/meta tests.
 */
import { Address } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { Ix, SYSTEM_PROGRAM_ID } from "../src/constants.js";
import * as pda from "../src/pda.js";
import {
  applyExternalAiClaim,
  commitOracle,
  delegateOracle,
  pushAiOracleFeed,
  setAiOracleConfig,
  undelegateOracle,
} from "../src/instructions/index.js";
import {
  ADMIN,
  AUTHORITY,
  ORACLE,
  bytesOf,
  leU64,
  metaTriples,
} from "./helpers/instructions-lifecycle.js";

function leU32(v: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return Array.from(b);
}

describe("ER + AI-oracle instruction builders", () => {
  it("delegateOracle: 44-byte payload + 4 accounts", async () => {
    const nonce = 7n;
    const freq = 30_000;
    const validator = new Uint8Array(32);
    const ix = await delegateOracle({
      oracle: ORACLE,
      payer: ADMIN,
      nonce,
      commitFrequencyMs: freq,
    });
    const session = await pda.erSession(ORACLE);
    expect(ix.data).toEqual(bytesOf(Ix.DelegateOracle, [...leU64(nonce), ...leU32(freq), ...validator]));
    expect(metaTriples(ix.keys)).toEqual([
      [ORACLE, false, true],
      [session.address.toString(), false, true],
      [ADMIN, true, true],
      [SYSTEM_PROGRAM_ID.toString(), false, false],
    ]);
  });

  it("commitOracle / undelegateOracle: empty payload", async () => {
    const session = await pda.erSession(ORACLE);
    const commit = await commitOracle({ oracle: ORACLE });
    const undelegate = await undelegateOracle({ oracle: ORACLE });
    expect(commit.data).toEqual(bytesOf(Ix.CommitOracle));
    expect(undelegate.data).toEqual(bytesOf(Ix.UndelegateOracle));
    expect(metaTriples(commit.keys)).toEqual([
      [ORACLE, false, true],
      [session.address.toString(), false, true],
    ]);
  });

  it("setAiOracleConfig: 42-byte payload", async () => {
    const ix = await setAiOracleConfig({
      authority: ADMIN,
      pusher: AUTHORITY,
      maxStalenessSlots: 64n,
      source: 0,
      enabled: true,
    });
    const protocol = await pda.protocol();
    const config = await pda.aiOracleConfig();
    const pusherBytes = new Address(AUTHORITY).toBytes();
    expect(ix.data[0]).toBe(Ix.SetAiOracleConfig);
    expect(ix.data.length).toBe(1 + 42);
    expect(Array.from(ix.data.slice(1, 33))).toEqual(Array.from(pusherBytes));
    expect(metaTriples(ix.keys)).toEqual([
      [protocol.address.toString(), false, true],
      [config.address.toString(), false, true],
      [ADMIN, true, true],
      [SYSTEM_PROGRAM_ID.toString(), false, false],
    ]);
  });

  it("pushAiOracleFeed: 161-byte payload", async () => {
    const modelId = new Uint8Array(32).fill(0xaa);
    const paramsHash = new Uint8Array(32).fill(0xbb);
    const ioHash = new Uint8Array(32).fill(0xcc);
    const attestation = new Uint8Array(64).fill(0xdd);
    const ix = await pushAiOracleFeed({
      oracle: ORACLE,
      authority: AUTHORITY,
      option: 1,
      modelId,
      paramsHash,
      ioHash,
      attestation,
    });
    expect(ix.data[0]).toBe(Ix.PushAiOracleFeed);
    expect(ix.data.length).toBe(1 + 161);
    expect(ix.data[1]).toBe(1);
    const config = await pda.aiOracleConfig();
    const feed = await pda.aiOracleFeed(ORACLE);
    expect(ix.keys[0].pubkey.toString()).toBe(config.address.toString());
    expect(ix.keys[2].pubkey.toString()).toBe(feed.address.toString());
  });

  it("applyExternalAiClaim: empty payload, 7 accounts", async () => {
    const ix = await applyExternalAiClaim({
      oracle: ORACLE,
      proposerAuthority: AUTHORITY,
      payer: ADMIN,
    });
    const proposer = await pda.proposer(ORACLE, AUTHORITY);
    const claim = await pda.aiClaim(ORACLE, proposer.address);
    expect(ix.data).toEqual(bytesOf(Ix.ApplyExternalAiClaim));
    expect(ix.keys.length).toBe(7);
    expect(ix.keys[1].pubkey.toString()).toBe(proposer.address.toString());
    expect(ix.keys[2].pubkey.toString()).toBe(claim.address.toString());
    expect(ix.keys[5].isSigner).toBe(true);
  });
});
