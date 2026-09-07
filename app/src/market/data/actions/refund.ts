/**
 * The refund write ACTION (pure ix-builder, NO React).
 *
 * {@link buildRefundIxs} returns a contributor's stake from a Cancelled market.
 * It is PERMISSIONLESS; the refund destination is the contributor's SOL ATA, so
 * we derive it and PREPEND an idempotent create-ATA ix when absent (a contributor
 * whose ATA was since closed still gets paid), then append the SDK `refund` ix.
 */
import { TransactionInstruction } from "@solana/web3.js";
import { refund } from "@kassandra-market/markets";
import type { IndexerReads } from "../../lib/indexer";
import { ensureBaseAta, toAddress, type AddressInput } from "./ata";

export interface BuildRefundArgs {
  indexer: IndexerReads;
  /** The Cancelled market. */
  market: AddressInput;
  /** Canonical SOL mint (== `market.base_mint`). */
  baseMint: AddressInput;
  /** The contributor being refunded (seeds the Contribution PDA + refund dest). */
  contributor: AddressInput;
}

/**
 * Assemble the refund instruction list: an optional idempotent create-ATA (when
 * the contributor's SOL ATA is absent) followed by the `refund` ix.
 */
export async function buildRefundIxs(
  args: BuildRefundArgs,
): Promise<TransactionInstruction[]> {
  const market = toAddress("Market", args.market);
  const baseMint = toAddress("SOL mint", args.baseMint);
  const contributor = toAddress("Contributor", args.contributor);

  const { ata, createIx } = await ensureBaseAta(args.indexer, contributor, baseMint);

  const ix = await refund({
    market,
    contributor,
    contributorBaseAta: ata,
  });

  return createIx ? [createIx, ix] : [ix];
}
