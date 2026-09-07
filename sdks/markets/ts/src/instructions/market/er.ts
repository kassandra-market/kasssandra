/**
 * Ephemeral-rollup session builders (Ix 12–14): delegate / commit / undelegate.
 *
 * Short form writes only Kassandra's per-market `ErSession` companion PDA.
 */
import { Address, TransactionInstruction } from "@solana/web3.js";

import { Ix, MARKET_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "../../constants.js";
import * as pda from "../../pda.js";
import type { AddressInput } from "../../pda.js";
import { addr, pubkeyBytes, ro, u32LE, w, withDisc } from "../payload.js";

const ZERO32 = new Uint8Array(32);

// ---------------------------------------------------------------------------
// DelegateMarket (Ix=12) — processor/er.rs
// Accounts (short): 0 market(w) 1 er_session(w) 2 payer(signer,w) 3 system(ro).
// Payload (36): commit_frequency_ms u32 LE ++ validator [32].
// ---------------------------------------------------------------------------
export interface DelegateMarketArgs {
  market: AddressInput;
  payer: AddressInput;
  commitFrequencyMs?: number;
  validator?: AddressInput;
  programId?: Address;
}

export async function delegateMarket(args: DelegateMarketArgs): Promise<TransactionInstruction> {
  const programId = args.programId ?? MARKET_PROGRAM_ID;
  const market = addr(args.market);
  const session = await pda.erSession(market, programId);
  const validator = args.validator ? pubkeyBytes(args.validator) : ZERO32;
  return new TransactionInstruction({
    programId,
    keys: [w(market), w(session.address), w(addr(args.payer), true), ro(SYSTEM_PROGRAM_ID)],
    data: withDisc(Ix.DelegateMarket, u32LE(args.commitFrequencyMs ?? 0), validator),
  });
}

// ---------------------------------------------------------------------------
// CommitMarket (Ix=13). Accounts: 0 market(w) 1 er_session(w). Payload: empty.
// ---------------------------------------------------------------------------
export interface CommitMarketArgs {
  market: AddressInput;
  programId?: Address;
}

export async function commitMarket(args: CommitMarketArgs): Promise<TransactionInstruction> {
  const programId = args.programId ?? MARKET_PROGRAM_ID;
  const market = addr(args.market);
  const session = await pda.erSession(market, programId);
  return new TransactionInstruction({
    programId,
    keys: [w(market), w(session.address)],
    data: withDisc(Ix.CommitMarket),
  });
}

// ---------------------------------------------------------------------------
// UndelegateMarket (Ix=14). Accounts: 0 market(w) 1 er_session(w). Payload: empty.
// ---------------------------------------------------------------------------
export interface UndelegateMarketArgs {
  market: AddressInput;
  programId?: Address;
}

export async function undelegateMarket(args: UndelegateMarketArgs): Promise<TransactionInstruction> {
  const programId = args.programId ?? MARKET_PROGRAM_ID;
  const market = addr(args.market);
  const session = await pda.erSession(market, programId);
  return new TransactionInstruction({
    programId,
    keys: [w(market), w(session.address)],
    data: withDisc(Ix.UndelegateMarket),
  });
}
