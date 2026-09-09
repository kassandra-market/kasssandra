/**
 * The create-market write ACTION (pure ix-builder, NO React).
 *
 * {@link buildCreateMarketIxs} first creates a markets-owned GPT Subject PDA
 * (`createSubject`) then binds a binary prediction sub-market to it
 * (`createMarket`, `oracle` = the Subject). YES = the subject resolves to
 * `outcomeIndex` (binary markets use `0`). A unique nonce seeds the Subject PDA;
 * `llmContext` is a dummy pubkey from a fresh Keypair (no MagicBlock context
 * is required to stand the market up).
 */
import { Address, Keypair, TransactionInstruction } from "@solana/web3.js";
import { createMarket, createSubject, pda } from "@kassandra-market/markets";
import type { IndexerReads } from "../../lib/indexer";
import { ValidationError } from "../writeAction";
import { ensureBaseAta, toAddress, type AddressInput } from "./ata";

export interface BuildCreateMarketArgs {
  indexer: IndexerReads;
  /** Canonical SOL mint (== `config.base_mint`). */
  baseMint: AddressInput;
  /** Creator authority (the signer): pays rent + seeds the first contribution. */
  creator: AddressInput;
  /** SOL seeded into escrow as the creator's contribution (raw base units, > 0). */
  seedAmount: bigint;
  /**
   * Subject `options_count`. Binary markets use `2`. A categorical question
   * shares one Subject across N sub-markets (`optionsCount === N`).
   */
  optionsCount?: number;
  /**
   * The subject outcome this sub-market binds to. Binary markets use `0`.
   * Defaults to `0`.
   */
  outcomeIndex?: number;
  /** Subject PDA nonce. A cryptographically-random u64 when omitted. */
  nonce?: bigint;
  /** Dummy GPT llm_context pubkey. A fresh Keypair pubkey when omitted. */
  llmContext?: AddressInput;
}

/** The create-market build: ixs plus the derived Subject / market PDAs. */
export interface CreateMarketBuild {
  ixs: TransactionInstruction[];
  nonce: bigint;
  subject: Address;
  market: Address;
}

/** A cryptographically-random u64 nonce (seeds the Subject PDA). */
export function randomNonce(): bigint {
  const buf = new BigUint64Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

/** A throwaway pubkey used as the Subject's `llm_context`. */
export async function dummyLlmContext(): Promise<Address> {
  return (await Keypair.generate()).publicKey;
}

/**
 * Assemble `createSubject` then `createMarket`, prepending an idempotent
 * create-ATA when the creator's SOL ATA is absent.
 */
export async function buildCreateMarketIxs(
  args: BuildCreateMarketArgs,
): Promise<CreateMarketBuild> {
  const baseMint = toAddress("SOL mint", args.baseMint);
  const creator = toAddress("Creator", args.creator);

  if (args.seedAmount <= 0n) {
    throw new ValidationError("Seed amount must be greater than zero.");
  }
  const optionsCount = args.optionsCount ?? 2;
  if (!Number.isInteger(optionsCount) || optionsCount < 2) {
    throw new ValidationError("There must be at least 2 options.");
  }
  const outcomeIndex = args.outcomeIndex ?? 0;
  if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0) {
    throw new ValidationError("Outcome index must be a non-negative whole number.");
  }
  if (outcomeIndex >= optionsCount) {
    throw new ValidationError(`Outcome must be between 0 and ${optionsCount - 1}.`);
  }

  const nonce = args.nonce ?? randomNonce();
  const llmContext =
    args.llmContext !== undefined
      ? toAddress("llmContext", args.llmContext)
      : await dummyLlmContext();
  const subject = (await pda.subject(nonce)).address;
  const market = (await pda.market(subject, outcomeIndex)).address;

  const { ata, createIx } = await ensureBaseAta(args.indexer, creator, baseMint);

  const subjectIx = await createSubject({
    payer: creator,
    nonce,
    optionsCount,
    llmContext,
  });
  const marketIx = await createMarket({
    creator,
    oracle: subject,
    baseMint,
    creatorBaseAta: ata,
    seedAmount: args.seedAmount,
    outcomeIndex,
  });

  const ixs = createIx ? [createIx, subjectIx, marketIx] : [subjectIx, marketIx];
  return { ixs, nonce, subject, market };
}
