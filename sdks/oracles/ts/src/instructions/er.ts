/**
 * Ephemeral-rollup session builders (Ix 24–26): delegate / commit / undelegate.
 *
 * Short form writes only Kassandra's `ErSession` companion PDA. Production
 * MagicBlock CPI remaining-accounts are appended by the caller when present.
 */
import { Address, TransactionInstruction } from "@solana/web3.js";

import { Ix, KASSANDRA_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "../constants.js";
import * as pda from "../pda.js";
import type { AddressInput } from "../pda.js";
import { addr, pubkeyBytes, ro, u32LE, u64LE, w, withDisc } from "./payload.js";

const ZERO32 = new Uint8Array(32);

// ---------------------------------------------------------------------------
// DelegateOracle (Ix=24) — processor/delegate_oracle.rs
// Accounts (short): 0 oracle(w) 1 er_session(w) 2 payer(signer,w) 3 system(ro).
// Payload (44): nonce u64 LE ++ commit_frequency_ms u32 LE ++ validator [32].
// `commit_frequency_ms == 0` → MagicBlock default 30s; validator all-zero → none.
// ---------------------------------------------------------------------------
export interface DelegateOracleArgs {
  oracle: AddressInput;
  payer: AddressInput;
  /** Oracle PDA nonce (u64), same as CreateOracle. */
  nonce: bigint | number;
  /** Commit cadence in ms. `0` (default) lets the program stamp 30_000. */
  commitFrequencyMs?: number;
  /** ER validator pubkey. Omitted / all-zero → Magic Router default. */
  validator?: AddressInput;
  programId?: Address;
}

export async function delegateOracle(args: DelegateOracleArgs): Promise<TransactionInstruction> {
  const programId = args.programId ?? KASSANDRA_PROGRAM_ID;
  const oracle = addr(args.oracle);
  const session = await pda.erSession(oracle, programId);
  const validator = args.validator ? pubkeyBytes(args.validator) : ZERO32;
  const data = withDisc(
    Ix.DelegateOracle,
    u64LE(args.nonce),
    u32LE(args.commitFrequencyMs ?? 0),
    validator,
  );
  return new TransactionInstruction({
    programId,
    keys: [w(oracle), w(session.address), w(addr(args.payer), true), ro(SYSTEM_PROGRAM_ID)],
    data,
  });
}

// ---------------------------------------------------------------------------
// CommitOracle (Ix=25) — processor/commit_oracle.rs
// Accounts: 0 oracle(w) 1 er_session(w). Payload: empty.
// ---------------------------------------------------------------------------
export interface CommitOracleArgs {
  oracle: AddressInput;
  programId?: Address;
}

export async function commitOracle(args: CommitOracleArgs): Promise<TransactionInstruction> {
  const programId = args.programId ?? KASSANDRA_PROGRAM_ID;
  const oracle = addr(args.oracle);
  const session = await pda.erSession(oracle, programId);
  return new TransactionInstruction({
    programId,
    keys: [w(oracle), w(session.address)],
    data: withDisc(Ix.CommitOracle),
  });
}

// ---------------------------------------------------------------------------
// UndelegateOracle (Ix=26) — processor/undelegate_oracle.rs
// Accounts: 0 oracle(w) 1 er_session(w). Payload: empty.
// ---------------------------------------------------------------------------
export interface UndelegateOracleArgs {
  oracle: AddressInput;
  programId?: Address;
}

export async function undelegateOracle(args: UndelegateOracleArgs): Promise<TransactionInstruction> {
  const programId = args.programId ?? KASSANDRA_PROGRAM_ID;
  const oracle = addr(args.oracle);
  const session = await pda.erSession(oracle, programId);
  return new TransactionInstruction({
    programId,
    keys: [w(oracle), w(session.address)],
    data: withDisc(Ix.UndelegateOracle),
  });
}
