/**
 * The add-liquidity write ACTION (pure ix-builder, NO React).
 *
 * Deposits KASS into an already-`Active` market's live cYES/cNO AMM, minting
 * pooled LP into the Market-PDA-owned `lp_vault` (claimable pro-rata on the
 * gross-LP basis alongside the original funders). The program splits the KASS 1:1
 * into cYES/cNO, adds the ratio-limited amounts to the pool, and returns the
 * heavy-side remainder to the depositor's cYES/cNO ATA.
 *
 * {@link buildAddLiquidityIxs} reconstructs the composed {@link flows.MarketRefs}
 * from the decoded Market (via {@link marketRefs}) and hands the live reserves +
 * LP supply to the SDK `flows.addLiquidityInstructions`, which computes the
 * balanced `quoteAmount`/`maxBaseAmount`/`minLpTokens` and prepends the idempotent
 * cYES/cNO/KASS ATA creates. A raised compute budget is prepended for the two CPIs.
 */
import { type TransactionInstruction } from "@solana/web3.js";
import { flows, type Market } from "@kassandra-market/markets";
import type { AmmReserves } from "../markets";
import { marketRefs } from "./marketRefs";
import { setComputeUnitLimitIx } from "./compute";
import { ValidationError } from "../writeAction";
import { toAddress, type AddressInput } from "./ata";

/** Compute budget for add_liquidity (split_tokens + add_liquidity + ATA creates). */
export const ADD_LIQUIDITY_COMPUTE_UNITS = 600_000;

export interface BuildAddLiquidityArgs {
  /** The Active Market PDA (base58 or Address). */
  market: AddressInput;
  /** The decoded Market account (carries the composed MetaDAO bindings + `lpTotal`). */
  marketAccount: Market;
  /** The market's live cYES/cNO pool reserves (base = cYES, quote = cNO). */
  reserves: AmmReserves;
  /** The depositor authority (the signer). */
  contributor: AddressInput;
  /** KASS to deposit (raw base units, > 0). */
  amount: bigint;
  /** Slippage tolerance on minted LP, in bps (default 100 = 1%). */
  slippageBps?: number;
}

/** Estimated LP the deposit will mint + the balanced split the flow computed. */
export interface AddLiquidityEstimate {
  quoteAmount: bigint;
  maxBaseAmount: bigint;
  minLpTokens: bigint;
  expectedLp: bigint;
}

/**
 * Assemble the add-liquidity instruction list: `[computeBudget, …ataCreates,
 * addLiquidity]`. Returns the instructions plus the flow's estimate (so a preview
 * can show deployed-vs-returned). Throws a typed {@link ValidationError} on a
 * non-positive amount.
 */
export async function buildAddLiquidityIxs(
  args: BuildAddLiquidityArgs,
): Promise<{ ixs: TransactionInstruction[]; estimate: AddLiquidityEstimate }> {
  if (args.amount <= 0n) {
    throw new ValidationError("Amount must be greater than zero.");
  }
  const refs = await marketRefs(args.market, args.marketAccount);
  const result = await flows.addLiquidityInstructions({
    refs,
    depositor: toAddress("Depositor", args.contributor),
    amount: args.amount,
    baseReserve: args.reserves.base,
    quoteReserve: args.reserves.quote,
    lpSupply: args.marketAccount.lpTotal,
    slippageBps: args.slippageBps,
  });
  return {
    ixs: [setComputeUnitLimitIx(ADD_LIQUIDITY_COMPUTE_UNITS), ...result.instructions],
    estimate: {
      quoteAmount: result.quoteAmount,
      maxBaseAmount: result.maxBaseAmount,
      minLpTokens: result.minLpTokens,
      expectedLp: result.expectedLp,
    },
  };
}
