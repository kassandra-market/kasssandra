/**
 * GPT Subject builders (Ix 15 CreateSubject, Ix 16 RequestAi).
 */
import { Address, TransactionInstruction } from "@solana/web3.js";

import { Ix, MARKET_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "../../constants.js";
import * as pda from "../../pda.js";
import type { AddressInput } from "../../pda.js";
import { addr, pubkeyBytes, ro, u32LE, u64LE, u8, w, withDisc } from "../payload.js";

export interface CreateSubjectArgs {
  payer: AddressInput;
  nonce: bigint | number;
  optionsCount: number;
  llmContext: AddressInput;
  programId?: Address;
}

export async function createSubject(args: CreateSubjectArgs): Promise<TransactionInstruction> {
  const programId = args.programId ?? MARKET_PROGRAM_ID;
  const subject = await pda.subject(args.nonce, programId);
  return new TransactionInstruction({
    programId,
    keys: [w(addr(args.payer), true), w(subject.address), ro(SYSTEM_PROGRAM_ID)],
    data: withDisc(
      Ix.CreateSubject,
      u64LE(args.nonce),
      u8(args.optionsCount),
      pubkeyBytes(args.llmContext),
    ),
  });
}

export interface RequestAiArgs {
  subject: AddressInput;
  payer: AddressInput;
  text: string | Uint8Array;
  programId?: Address;
}

export async function requestAi(args: RequestAiArgs): Promise<TransactionInstruction> {
  const programId = args.programId ?? MARKET_PROGRAM_ID;
  const text = typeof args.text === "string" ? new TextEncoder().encode(args.text) : args.text;
  return new TransactionInstruction({
    programId,
    keys: [ro(addr(args.subject)), w(addr(args.payer), true), ro(SYSTEM_PROGRAM_ID)],
    data: withDisc(Ix.RequestAi, u32LE(text.length), text),
  });
}
