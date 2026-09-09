/**
 * The batch "create all N outcomes" write action as a STAGED, multi-tx SEQUENCE
 * (pure ix-builders, NO React).
 *
 * A categorical question (`optionsCount > 2`) has one binary sub-market per
 * outcome, each its own `create_market` instruction, all bound to ONE GPT
 * Subject. {@link buildCreateAllSteps} emits `createSubject` on step 0, then one
 * {@link ActivateStep} per outcome. Resume: `create_market` reverts if its
 * market PDA already exists, so each step carries that PDA as `checkAccount`.
 */
import { Address } from "@solana/web3.js";
import { createSubject, flows, pda } from "@kassandra-market/markets";
import type { ActivateStep } from "./activate";
import { dummyLlmContext, randomNonce } from "./create";
import { ensureBaseAta, toAddress, type AddressInput } from "./ata";
import { ValidationError } from "../writeAction";
import type { IndexerReads } from "../../lib/indexer";

export interface BuildCreateAllArgs {
  indexer: IndexerReads;
  /** The subject's `options_count` — one create step is emitted per outcome. */
  optionsCount: number;
  /** Creator authority (the signer): pays rent + seeds each contribution. */
  creator: AddressInput;
  /** Canonical SOL mint (== `config.base_mint`). */
  baseMint: AddressInput;
  /** SOL seeded into each outcome's escrow (raw base units, > 0); charged per outcome. */
  seedAmount: bigint;
  /** Subject PDA nonce. A cryptographically-random u64 when omitted. */
  nonce?: bigint;
  /** Dummy GPT llm_context pubkey. A fresh Keypair pubkey when omitted. */
  llmContext?: AddressInput;
}

export interface CreateAllBuild {
  steps: ActivateStep[];
  nonce: bigint;
  subject: Address;
}

/**
 * Build `createSubject` (step 0) then one `createMarket` step per outcome.
 * The creator's SOL ATA create-ix is prepended to step 0 when absent.
 */
export async function buildCreateAllSteps(args: BuildCreateAllArgs): Promise<CreateAllBuild> {
  const baseMint = toAddress("SOL mint", args.baseMint);
  const creator = toAddress("Creator", args.creator);

  if (!Number.isInteger(args.optionsCount) || args.optionsCount < 2) {
    throw new ValidationError("There must be at least 2 options.");
  }
  if (args.seedAmount <= 0n) {
    throw new ValidationError("Seed amount must be greater than zero.");
  }

  const nonce = args.nonce ?? randomNonce();
  const llmContext =
    args.llmContext !== undefined
      ? toAddress("llmContext", args.llmContext)
      : await dummyLlmContext();
  const subject = (await pda.subject(nonce)).address;

  const { ata, createIx } = await ensureBaseAta(args.indexer, creator, baseMint);

  const subjectIx = await createSubject({
    payer: creator,
    nonce,
    optionsCount: args.optionsCount,
    llmContext,
  });

  const { steps: marketSteps } = await flows.createAllOutcomeMarkets({
    oracle: subject,
    optionsCount: args.optionsCount,
    creator,
    baseMint,
    creatorBaseAta: ata,
    seedAmount: args.seedAmount,
  });

  const subjectStep: ActivateStep = {
    label: "Create subject",
    ixs: createIx ? [createIx, subjectIx] : [subjectIx],
    checkAccount: subject,
  };

  const steps: ActivateStep[] = [
    subjectStep,
    ...marketSteps.map((step) => ({
      label: `Outcome ${step.outcomeIndex}`,
      ixs: [step.instruction],
      checkAccount: step.market,
    })),
  ];

  return { steps, nonce, subject };
}
