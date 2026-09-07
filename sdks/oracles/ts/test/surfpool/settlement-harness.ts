/**
 * Shared harness/drivers for the surfpool SETTLEMENT-TAIL E2E suites
 * (`settlement-e2e.test.ts` + `settlement2-e2e.test.ts`).
 *
 * Everything here is a pure MOVE out of the original single test file: the
 * gating const, the `Fixture` shape, the `setupFixture` beforeAll body, the
 * reward-math mirrors, the seed helpers, and the real-instruction drivers over
 * RPC. Bodies are unchanged; only `export` was added and the fixture setup was
 * lifted into an exported function so both suites can share it.
 */
import { Address, Keypair, Transaction, type TransactionInstruction } from "@solana/web3.js";

import { decodeOracle } from "../../src/accounts/index.js";
import { TOKEN_PROGRAM_ID } from "../../src/constants.js";
import { futarchy } from "../../src/index.js";
import { createOracle, initProtocol, propose, setGovernance } from "../../src/instructions/index.js";
import * as pda from "../../src/pda.js";

import {
  SurfpoolHarness,
  mintBytes,
  surfpoolReady,
  toHex,
  tokenAccountAmount,
  tokenAccountBytes,
} from "./harness.js";

export const ENABLED = process.env.KASSANDRA_E2E === "1" && surfpoolReady();

export const FUTARCHY_ID = futarchy.FUTARCHY_ID;
/** 30-day sweep grace (config.rs SWEEP_GRACE = 30·24·60·60). */
export const SWEEP_GRACE = 30n * 24n * 60n * 60n;

export interface Fixture {
  harness: SurfpoolHarness;
  payer: Keypair;
  baseMint: Keypair;
  usdcMint: Keypair;
  daoAuthority: Address;
  treasury: Address;
}

/**
 * Boot a standalone simnet + seed the governance/treasury preconditions and
 * drive the REAL init_protocol / set_governance. Returns the shared Fixture.
 */
export async function setupFixture(port: number): Promise<Fixture> {
  // Dedicated port (8930) so it never collides with smoke (8899) / lifecycle
  // (8901) / challenge (8920).
  const harness = await SurfpoolHarness.start({ port });
  const payer = await Keypair.generate();
  await harness.airdrop(payer.publicKey.toString(), 1_000_000_000_000);

  const mintAuth = await pda.mintAuthority();
  const baseMint = await Keypair.generate();
  const usdcMint = await Keypair.generate();
  await harness.setAccount(baseMint.publicKey.toString(), {
    lamports: 1_000_000_000,
    owner: TOKEN_PROGRAM_ID.toString(),
    executable: false,
    data: toHex(mintBytes(mintAuth.address.toBytes(), 10n ** 18n, 9)),
  });
  await harness.setAccount(usdcMint.publicKey.toString(), {
    lamports: 1_000_000_000,
    owner: TOKEN_PROGRAM_ID.toString(),
    executable: false,
    data: toHex(mintBytes(payer.publicKey.toBytes(), 0n, 6)),
  });

  // --- governance handoff (SEEDED spot_dao, REAL set_governance) ------------
  // set_governance validates: spot_dao owned by the futarchy program + carries
  // the Dao Anchor discriminator, and dao_authority == the Squads v4 vault PDA
  // derived for it. Fabricate the futarchy-owned Dao account (no CPI — only an
  // owner + disc + PDA check), then drive the REAL set_governance.
  const spotDao = (await Keypair.generate()).publicKey;
  const daoBlob = new Uint8Array(256);
  daoBlob.set(futarchy.ACCOUNT_DISC.dao, 0);
  await harness.setAccount(spotDao.toString(), {
    lamports: 5_000_000,
    owner: FUTARCHY_ID.toString(),
    executable: false,
    data: toHex(daoBlob),
  });
  const multisig = (await futarchy.pda.squadsMultisig(spotDao)).address;
  const daoAuthority = (await futarchy.pda.squadsVault(multisig, 0)).address;

  const f: Fixture = { harness, payer, baseMint, usdcMint, daoAuthority, treasury: daoAuthority };

  await sendIx(f, await initProtocol({
    admin: payer.publicKey,
    baseMint: baseMint.publicKey,
    usdcMint: usdcMint.publicKey,
  }));
  await sendIx(f, await setGovernance({ authority: payer.publicKey, daoAuthority, spotDao }));

  // Fabricate the DAO treasury ATA(dao_authority, base_mint) so the sweep
  // Transfer has a live destination (the program validates the exact address).
  const treasury = (await pda.associatedTokenAccount(daoAuthority, baseMint.publicKey)).address;
  await harness.setAccount(treasury.toString(), {
    lamports: 5_000_000,
    owner: TOKEN_PROGRAM_ID.toString(),
    executable: false,
    data: toHex(tokenAccountBytes(baseMint.publicKey.toBytes(), daoAuthority.toBytes(), 0n)),
  });
  f.treasury = treasury;
  return f;
}

// ---------------------------------------------------------------------------
// Reward math (mirrors programs/oracles/src/reward.rs — floor, u128-safe via
// bigint) + the ceil rejected-fact voter slash (claims.rs::slash_amount).
// ---------------------------------------------------------------------------

export function rewardBuckets(pool: bigint, pw: bigint, fw: bigint, tcp: bigint, taf: bigint): [bigint, bigint] {
  if (taf === 0n) return [pool, 0n];
  if (tcp === 0n) return [0n, pool];
  const denom = pw + fw;
  if (denom === 0n) return [pool, 0n];
  return [(pool * pw) / denom, (pool * fw) / denom];
}

export function proposerReward(bond: bigint, bucket: bigint, tcp: bigint): bigint {
  return tcp === 0n ? 0n : (bond * bucket) / tcp;
}

export function factReward(stake: bigint, bucket: bigint, taf: bigint): bigint {
  return taf === 0n ? 0n : (stake * bucket) / taf;
}

/** `ceil(value·num/den)` — the per-voter rejected-fact slash. */
export function ceilSlash(value: bigint, num: bigint, den: bigint): bigint {
  return den === 0n ? 0n : (value * num + den - 1n) / den;
}

// ---------------------------------------------------------------------------
// SEED helpers (documented above) + real-instruction drivers over RPC.
// ---------------------------------------------------------------------------

/** Minimal settled `Market` bytes (416) — the fields close_market validates. */
export function marketBytes(oracle: Address, challenger: Address, escrow: Address): Uint8Array {
  const d = new Uint8Array(416);
  d[0] = 6; // AccountType.Market
  d.set(oracle.toBytes(), 8); // oracle @8
  d.set(challenger.toBytes(), 104); // challenger @104
  d.set(escrow.toBytes(), 360); // challenger_usdc_vault @360
  d[408] = 1; // settled @408
  return d;
}

export async function sendIx(f: Fixture, ix: TransactionInstruction, signers: Keypair[] = []): Promise<void> {
  const conn = f.harness.connection;
  const tx = new Transaction();
  tx.feePayer = f.payer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.add(ix);
  await tx.sign(f.payer, ...signers);
  const sig = await conn.sendRawTransaction(await tx.serialize(), { skipPreflight: false });
  await f.harness.confirmSignature(sig);
}

export async function fetchAccount(f: Fixture, address: Address, timeoutMs = 20_000): Promise<Uint8Array> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await f.harness.connection.getAccountInfo(address);
    if (info && info.data.length > 0) return info.data;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`account ${address} did not appear within ${timeoutMs}ms`);
}

/** True once an account is closed (reaped: absent or zero-length). */
export async function isClosed(f: Fixture, address: Address): Promise<boolean> {
  const info = await f.harness.connection.getAccountInfo(address);
  return info === null || info.data.length === 0;
}

export async function tokenBalance(f: Fixture, address: Address): Promise<bigint> {
  return tokenAccountAmount(await fetchAccount(f, address));
}

export async function fundSigner(f: Fixture): Promise<Keypair> {
  const kp = await Keypair.generate();
  await f.harness.airdrop(kp.publicKey.toString(), 2_000_000_000);
  return kp;
}

export async function fundBase(f: Fixture, owner: Address, amount: bigint): Promise<Address> {
  const acct = await Keypair.generate();
  await f.harness.setAccount(acct.publicKey.toString(), {
    lamports: 5_000_000,
    owner: TOKEN_PROGRAM_ID.toString(),
    executable: false,
    data: toHex(tokenAccountBytes(f.baseMint.publicKey.toBytes(), owner.toBytes(), amount)),
  });
  return acct.publicKey;
}

export async function createOracleReal(f: Fixture, nonce: bigint, optionsCount: number): Promise<void> {
  const creatorBase = await fundBase(f, f.payer.publicKey, 10n ** 15n);
  const nowUnix = await f.harness.clockUnixTimestamp();
  await sendIx(f, await createOracle({
    nonce, optionsCount,
    deadline: nowUnix + 1_000n, twapWindow: 600n,
    creator: f.payer.publicKey, creatorBaseToken: creatorBase,
    baseMint: f.baseMint.publicKey, usdcMint: f.usdcMint.publicKey,
  }));
}

export async function openProposals(f: Fixture, oracle: Address): Promise<void> {
  const o = decodeOracle(await fetchAccount(f, oracle));
  await f.harness.advanceToUnix(o.deadline + 60n);
}

export async function advancePastPhaseEnd(f: Fixture, oracle: Address): Promise<void> {
  const o = decodeOracle(await fetchAccount(f, oracle));
  await f.harness.advanceToUnix(o.phaseEndsAt + 120n);
}

export async function proposeRealWithAuthority(
  f: Fixture, oracle: Address, option: number, bond: bigint,
): Promise<{ authority: Keypair; proposer: Address }> {
  const authority = await fundSigner(f);
  const authorityBase = await fundBase(f, authority.publicKey, bond * 10n);
  await sendIx(f, await propose({ oracle, authority: authority.publicKey, authorityBase, option, bond }), [authority]);
  const proposer = (await pda.proposer(oracle, authority.publicKey)).address;
  return { authority, proposer };
}
