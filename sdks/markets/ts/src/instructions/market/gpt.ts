/**
 * GPT Subject builders (Ix 15 CreateSubject, Ix 16 RequestAi).
 */
import { Address, TransactionInstruction } from "@solana/web3.js";

import { GPT_ORACLE_PROGRAM_ID, Ix, MARKET_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "../../constants.js";
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
  /** When set, remaining accounts for the GPT-oracle CPI are appended. */
  llmContext?: AddressInput;
  programId?: Address;
}

export async function requestAi(args: RequestAiArgs): Promise<TransactionInstruction> {
  const programId = args.programId ?? MARKET_PROGRAM_ID;
  const payer = addr(args.payer);
  const text = typeof args.text === "string" ? new TextEncoder().encode(args.text) : args.text;
  const keys = [ro(addr(args.subject)), w(payer, true), ro(SYSTEM_PROGRAM_ID)];
  if (args.llmContext !== undefined) {
    const llmContext = addr(args.llmContext);
    const interaction = await pda.gptOracleInteraction(payer, llmContext);
    keys.push(ro(GPT_ORACLE_PROGRAM_ID));
    keys.push(w(interaction.address));
    keys.push(ro(llmContext));
  }
  return new TransactionInstruction({
    programId,
    keys,
    data: withDisc(Ix.RequestAi, u32LE(text.length), text),
  });
}
