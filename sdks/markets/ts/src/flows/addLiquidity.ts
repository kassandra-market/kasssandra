/**
 * High-level `add_liquidity` (Ix 11) flow — deposit KASS into an already-`Active`
 * market's live cYES/cNO AMM, receiving pooled LP claimable pro-rata (gross-LP
 * basis) alongside the funders.
 *
 * The program splits the KASS 1:1 into cYES/cNO and adds the ratio-limited amounts
 * to the pool, returning the heavy-side remainder to the depositor's cYES/cNO ATA.
 * This flow (1) prepends idempotent creates for the depositor's cYES/cNO/KASS ATAs
 * and (2) computes the `quoteAmount`/`maxBaseAmount`/`minLpTokens` hints from the
 * live pool reserves (base = cYES, quote = cNO), leaving a small base headroom for
 * the AMM's round-up and a slippage floor on the minted LP.
 */
import { type TransactionInstruction } from "@solana/web3.js";

import { EXTERNAL_PROGRAM_IDS } from "../constants.js";
import { addLiquidity as buildAddLiquidity } from "../instructions/market/index.js";
import type { AddressInput } from "../pda.js";
import { ensureConditionalAtasInstructions } from "./atas.js";
import type { MarketRefs } from "./compose.js";

export interface AddLiquidityFlowParams {
  /** Composed refs for the Active market (from `marketRefsFromAccount`). */
  refs: MarketRefs;
  /** The depositor wallet (signer + rent payer + ATA owner). */
  depositor: AddressInput;
  /** KASS to deposit (raw base units, > 0). */
  amount: bigint;
  /** Live cYES (base) pool reserve — the `ammVaultBase` token balance. */
  baseReserve: bigint;
  /** Live cNO (quote) pool reserve — the `ammVaultQuote` token balance. */
  quoteReserve: bigint;
  /** LP-mint total supply (== `market.lpTotal`, since the market holds all LP). */
  lpSupply: bigint;
  /** Slippage tolerance on the minted LP, in bps (default 100 = 1%). */
  slippageBps?: number;
}

export interface AddLiquidityFlowResult {
  /** ATA-creation prepends + the `add_liquidity` instruction, in order. */
  instructions: TransactionInstruction[];
  /** The cNO amount deposited in full. */
  quoteAmount: bigint;
  /** The cYES cap passed to the AMM. */
  maxBaseAmount: bigint;
  /** The slippage floor on minted LP. */
  minLpTokens: bigint;
  /** The estimated LP that will be minted (pre-slippage). */
  expectedLp: bigint;
}

/**
 * Build the ordered instruction list to add `amount` KASS of liquidity. A raised
 * compute budget is needed (the split + add_liquidity CPIs), so callers should
 * prepend a `SetComputeUnitLimit`. The depositor signs.
 */
export async function addLiquidityInstructions(
  params: AddLiquidityFlowParams,
): Promise<AddLiquidityFlowResult> {
  const { refs, depositor, amount, baseReserve, quoteReserve, lpSupply } = params;
  const slippageBps = BigInt(params.slippageBps ?? 100);

  // Deposit cNO (quote) fully where possible; cYES (base) is ratio-derived by the
  // AMM and must stay within `amount`. Leave 2 units of base headroom for the AMM's
  // round-up. `baseReserve == 0` means an untraded pool (any ratio) → deposit all.
  let quoteAmount =
    baseReserve === 0n
      ? amount
      : min(amount, (amount * quoteReserve) / baseReserve) - 2n;
  if (quoteAmount < 0n) quoteAmount = 0n;
  const maxBaseAmount = amount;

  // Estimated LP minted for depositing `quoteAmount` cNO into `quoteReserve`; the
  // slippage floor is a fraction of it (>= 1, since the AMM rejects a zero floor).
  const expectedLp = quoteReserve > 0n ? (quoteAmount * lpSupply) / quoteReserve : 0n;
  const floor = (expectedLp * (10_000n - slippageBps)) / 10_000n;
  const minLpTokens = floor > 0n ? floor : 1n;

  const atas = await ensureConditionalAtasInstructions({
    refs,
    user: depositor,
    includeKass: true,
  });

  const ix = await buildAddLiquidity({
    market: refs.market,
    oracle: refs.oracle,
    depositor,
    kassMint: refs.kassMint,
    question: refs.question,
    vault: refs.vault,
    vaultUnderlyingAta: refs.vaultUnderlyingAta,
    yesMint: refs.yesMint,
    noMint: refs.noMint,
    amm: refs.amm,
    lpMint: refs.lpMint,
    ammVaultBase: refs.ammVaultBase,
    ammVaultQuote: refs.ammVaultQuote,
    cvEventAuthority: refs.cvEventAuthority,
    ammEventAuthority: refs.ammEventAuthority,
    amount,
    quoteAmount,
    maxBaseAmount,
    minLpTokens,
    cvProgram: EXTERNAL_PROGRAM_IDS.conditionalVault,
    ammProgram: EXTERNAL_PROGRAM_IDS.ammV04,
  });

  return {
    instructions: [...atas.instructions, ix],
    quoteAmount,
    maxBaseAmount,
    minLpTokens,
    expectedLp,
  };
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
