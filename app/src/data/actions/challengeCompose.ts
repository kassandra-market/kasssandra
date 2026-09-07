/**
 * CU3 — CLIENT-SIDE challenge-market COMPOSITION (pure ix-builders, NO React).
 *
 * A challenge round trades over an externally-composed MetaDAO v0.4 market. RF4's
 * {@link buildOpenChallengeIxs} only THREADS an already-composed account set into
 * `open_challenge` (the runner used to emit it as pasted JSON). CU3 removes the
 * paste: it COMPOSES that whole market client-side, mirroring the SDK
 * challenge-market E2E's REAL bits (`composeQuestion` / `composeVault` /
 * `buildPool`) — the production equivalents of the E2E's `surfnet_setAccount`
 * cheatcodes:
 *
 *   - the E2E's `fabricateTokenAccountMint(passKass, oracle, 0)` (an oracle-owned
 *     holder) → an idempotent ATA-create of the ORACLE PDA's conditional-SOL
 *     ATA (`oraclePassKass = ATA(oracle, passBaseMint)`);
 *   - the E2E's `setTokenAccountAt(userBase, …, reserve*4)` (a fabricated
 *     conditional-token balance to seed the pools) → the challenger funds its OWN
 *     SOL/USDC, then `split_tokens` mints EQUAL pass+fail conditional tokens
 *     from that underlying into the challenger's conditional-token ATAs, which
 *     `add_liquidity` then seeds the pools with.
 *
 * The whole choreography FAR exceeds one transaction, so this returns an ORDERED
 * list of {@link ComposeStep}s — each a labelled ix-group that fits a single tx —
 * for the UI to send as a SEQUENCE of `sendAndConfirm` calls with per-step status
 * and resume-from-failure. The steps, in order:
 *
 *   1. "Create question"        initialize_question (binary, resolver == oracle)
 *   2. "Create SOL vault"      initialize_conditional_vault (SOL underlying)
 *   3. "Create USDC vault"      initialize_conditional_vault (USDC underlying)
 *   4. "Fund + split"           create the challenger's SOL/USDC + conditional +
 *                               oracle-holder ATAs, then split SOL & USDC into
 *                               pass/fail conditional tokens to seed the pools
 *   5. "Seed pass pool"         create_amm(pass) + add_liquidity(pass)
 *   6. "Seed fail pool"         create_amm(fail) + add_liquidity(fail)
 *   7. "Open challenge"         open_challenge (RF4 builder, fed the composed set)
 *
 * The twap_initial_observation / decimals / seed-liquidity math mirrors
 * `buildPool` EXACTLY: `twap_initial_observation = quoteReserve · 1e12 /
 * baseReserve`, `twap_max_observation_change_per_update = (2^64−1) · 1e12`
 * (single-crank folds the price with no clamp), `twap_start_delay_slots = 0`, and
 * `add_liquidity(quote_amount = quoteReserve, max_base_amount = baseReserve)`.
 *
 * NO core / SDK change: every ix comes from the SDK `futarchy` / `ammV04`
 * builders + RF4's `buildOpenChallengeIxs`; only PDAs/ATAs are derived here.
 */
import type { TransactionInstruction } from "@solana/web3.js";
import {
  associatedTokenAccount,
  ammV04,
  futarchy,
  pda,
} from "@kassandra-market/oracles";

import { ValidationError } from "../actions";
import { conditionalTokenMint } from "./challengeTrade";
import { buildOpenChallengeIxs } from "./challenge";
import {
  DEFAULT_BASE_RESERVE,
  DEFAULT_QUESTION_ID,
  DEFAULT_QUOTE_RESERVE,
  MAX_OBSERVATION_CHANGE,
  twapInitialObservation,
} from "./challengeCompose/constants";
import { addr, createAtaIdempotentIx, toBig } from "./challengeCompose/helpers";
import type { BuildComposeArgs, ComposeStep, ComposedMarket } from "./challengeCompose/types";

export {
  PRICE_SCALE,
  MAX_OBSERVATION_CHANGE,
  DEFAULT_BASE_RESERVE,
  DEFAULT_QUOTE_RESERVE,
  DEFAULT_QUESTION_ID,
  twapInitialObservation,
} from "./challengeCompose/constants";
export type { BuildComposeArgs, ComposeStep, ComposedMarket } from "./challengeCompose/types";

/**
 * Compose the FULL MetaDAO v0.4 challenge market client-side + open the challenge,
 * as an ORDERED sequence of single-tx {@link ComposeStep}s. Returns the steps to
 * send in order plus the {@link ComposedMarket} account set.
 *
 * The seed math mirrors `buildPool` verbatim: each pool opens at
 * `twap_initial_observation = quoteReserve·1e12/baseReserve`, with
 * `twap_max_observation_change_per_update = (2^64−1)·1e12` and
 * `twap_start_delay_slots = 0`; `add_liquidity(quote_amount = quoteReserve,
 * max_base_amount = baseReserve)`. Because `split_tokens` mints EQUAL pass+fail
 * conditional tokens from one underlying, the challenger splits `baseReserve`
 * SOL (→ baseReserve pass-SOL + baseReserve fail-SOL) and `quoteReserve` USDC
 * (→ quoteReserve pass-USDC + quoteReserve fail-USDC) to seed BOTH pools.
 */
export async function buildComposeAndOpenChallengeIxs(
  args: BuildComposeArgs,
): Promise<{ steps: ComposeStep[]; composed: ComposedMarket }> {
  const nonce =
    typeof args.oracleNonce === "bigint" ? args.oracleNonce : BigInt(Math.trunc(args.oracleNonce ?? -1));
  if (nonce < 0n) {
    throw new ValidationError("oracleNonce", "The oracle nonce is required to compose this market.");
  }
  const challenger = addr("challenger", args.challenger);
  const baseMint = addr("baseMint", args.baseMint);
  const usdcMint = addr("usdcMint", args.usdcMint);
  const questionId = args.questionId ?? DEFAULT_QUESTION_ID;
  if (!(questionId instanceof Uint8Array) || questionId.length !== 32) {
    throw new ValidationError("questionId", "questionId must be exactly 32 bytes.");
  }
  const baseReserve = toBig("baseReserve", args.baseReserve ?? DEFAULT_BASE_RESERVE);
  const quoteReserve = toBig("quoteReserve", args.quoteReserve ?? DEFAULT_QUOTE_RESERVE);

  // ── PDA / account derivations (all deterministic; no cheatcodes) ──
  const oracle = (await pda.oracle(nonce, args.programId)).address;
  const question = (await futarchy.pda.question(questionId, oracle, 2)).address;

  const baseVault = (await futarchy.pda.conditionalVault(question, baseMint)).address;
  const usdcVault = (await futarchy.pda.conditionalVault(question, usdcMint)).address;
  const [
    passBaseMint,
    failBaseMint,
    passUsdcMint,
    failUsdcMint,
  ] = await Promise.all([
    conditionalTokenMint(baseVault, 0),
    conditionalTokenMint(baseVault, 1),
    conditionalTokenMint(usdcVault, 0),
    conditionalTokenMint(usdcVault, 1),
  ]);
  const [baseVaultUnderlying, usdcVaultUnderlying] = await Promise.all([
    associatedTokenAccount(baseVault, baseMint).then((p) => p.address),
    associatedTokenAccount(usdcVault, usdcMint).then((p) => p.address),
  ]);

  // Pool PDAs (base = conditional-SOL, quote = conditional-USDC, per buildPool).
  const [passAmm, failAmm] = await Promise.all([
    ammV04.pda.amm(passBaseMint, passUsdcMint).then((p) => p.address),
    ammV04.pda.amm(failBaseMint, failUsdcMint).then((p) => p.address),
  ]);

  // Oracle-PDA-owned pass/fail conditional-SOL holder ATAs (the split_tokens
  // destinations open_challenge mints into). PRODUCTION equivalent of the E2E's
  // `fabricateTokenAccountMint(passKass, oracle, 0)`.
  const [oraclePassKass, oracleFailKass] = await Promise.all([
    associatedTokenAccount(oracle, passBaseMint).then((p) => p.address),
    associatedTokenAccount(oracle, failBaseMint).then((p) => p.address),
  ]);

  // The challenger's own token accounts.
  const [
    challengerKass,
    challengerUsdcSrc,
    challengerPassKass,
    challengerFailKass,
    challengerPassUsdc,
    challengerFailUsdc,
  ] = await Promise.all([
    associatedTokenAccount(challenger, baseMint).then((p) => p.address),
    associatedTokenAccount(challenger, usdcMint).then((p) => p.address),
    associatedTokenAccount(challenger, passBaseMint).then((p) => p.address),
    associatedTokenAccount(challenger, failBaseMint).then((p) => p.address),
    associatedTokenAccount(challenger, passUsdcMint).then((p) => p.address),
    associatedTokenAccount(challenger, failUsdcMint).then((p) => p.address),
  ]);

  const composed: ComposedMarket = {
    oracle,
    question,
    baseVault,
    usdcVault,
    baseVaultUnderlying,
    usdcVaultUnderlying,
    passBaseMint,
    failBaseMint,
    passUsdcMint,
    failUsdcMint,
    passAmm,
    failAmm,
    oraclePassKass,
    oracleFailKass,
    challengerUsdcSrc,
  };

  // ── Step 1: create the binary question (resolver == oracle) ──
  const questionIx = await futarchy.initializeQuestion({
    questionId,
    oracle,
    numOutcomes: 2,
    payer: challenger,
  });

  // ── Step 2/3: the SOL + USDC conditional vaults (each creates the vault +
  // its two pass/fail conditional-token mints). ──
  const baseVaultIx = await futarchy.initializeConditionalVault({
    question,
    underlyingMint: baseMint,
    payer: challenger,
    numOutcomes: 2,
  });
  const usdcVaultIx = await futarchy.initializeConditionalVault({
    question,
    underlyingMint: usdcMint,
    payer: challenger,
    numOutcomes: 2,
  });

  // ── Step 4: create the challenger's + oracle-holder ATAs, then split the
  // challenger's SOL/USDC into pass/fail conditional tokens to seed the pools. ──
  const fundSplitIxs: TransactionInstruction[] = [];
  // Oracle-owned pass/fail SOL holders (idempotent; the split_tokens targets).
  fundSplitIxs.push(createAtaIdempotentIx(challenger, oraclePassKass, oracle, passBaseMint));
  fundSplitIxs.push(createAtaIdempotentIx(challenger, oracleFailKass, oracle, failBaseMint));
  // The challenger's conditional-token ATAs (split destinations + add_liquidity sources).
  fundSplitIxs.push(createAtaIdempotentIx(challenger, challengerPassKass, challenger, passBaseMint));
  fundSplitIxs.push(createAtaIdempotentIx(challenger, challengerFailKass, challenger, failBaseMint));
  fundSplitIxs.push(createAtaIdempotentIx(challenger, challengerPassUsdc, challenger, passUsdcMint));
  fundSplitIxs.push(createAtaIdempotentIx(challenger, challengerFailUsdc, challenger, failUsdcMint));

  // split SOL → baseReserve pass-SOL + baseReserve fail-SOL.
  fundSplitIxs.push(
    await futarchy.splitTokens({
      question,
      vault: baseVault,
      vaultUnderlying: baseVaultUnderlying,
      authority: challenger,
      userUnderlying: challengerKass,
      conditionalMints: [passBaseMint, failBaseMint],
      userConditionalAccounts: [challengerPassKass, challengerFailKass],
      amount: baseReserve,
    }),
  );
  // split USDC → quoteReserve pass-USDC + quoteReserve fail-USDC.
  fundSplitIxs.push(
    await futarchy.splitTokens({
      question,
      vault: usdcVault,
      vaultUnderlying: usdcVaultUnderlying,
      authority: challenger,
      userUnderlying: challengerUsdcSrc,
      conditionalMints: [passUsdcMint, failUsdcMint],
      userConditionalAccounts: [challengerPassUsdc, challengerFailUsdc],
      amount: quoteReserve,
    }),
  );

  const initialObs = twapInitialObservation(baseReserve, quoteReserve);

  // The pools' LP mints + the challenger's LP ATAs — `add_liquidity` mints LP to
  // the payer's LP ATA but does NOT create it (the E2E's `setTokenAccountAt(userLp
  // …, 0)` cheatcode); production idempotent-creates it before add_liquidity.
  const [passLpMint, failLpMint] = await Promise.all([
    ammV04.pda.lpMint(passAmm).then((p) => p.address),
    ammV04.pda.lpMint(failAmm).then((p) => p.address),
  ]);
  const [challengerPassLp, challengerFailLp] = await Promise.all([
    associatedTokenAccount(challenger, passLpMint).then((p) => p.address),
    associatedTokenAccount(challenger, failLpMint).then((p) => p.address),
  ]);

  // ── Step 5/6: create + seed the pass / fail pools. ──
  const passPoolIxs = [
    await ammV04.createAmm({
      payer: challenger,
      baseMint: passBaseMint,
      quoteMint: passUsdcMint,
      twapInitialObservation: initialObs,
      twapMaxObservationChangePerUpdate: MAX_OBSERVATION_CHANGE,
      twapStartDelaySlots: 0n,
    }),
    createAtaIdempotentIx(challenger, challengerPassLp, challenger, passLpMint),
    await ammV04.addLiquidity({
      payer: challenger,
      baseMint: passBaseMint,
      quoteMint: passUsdcMint,
      quoteAmount: quoteReserve,
      maxBaseAmount: baseReserve,
      minLpTokens: 0n,
    }),
  ];
  const failPoolIxs = [
    await ammV04.createAmm({
      payer: challenger,
      baseMint: failBaseMint,
      quoteMint: failUsdcMint,
      twapInitialObservation: initialObs,
      twapMaxObservationChangePerUpdate: MAX_OBSERVATION_CHANGE,
      twapStartDelaySlots: 0n,
    }),
    createAtaIdempotentIx(challenger, challengerFailLp, challenger, failLpMint),
    await ammV04.addLiquidity({
      payer: challenger,
      baseMint: failBaseMint,
      quoteMint: failUsdcMint,
      quoteAmount: quoteReserve,
      maxBaseAmount: baseReserve,
      minLpTokens: 0n,
    }),
  ];

  // ── Step 7: open the challenge over the composed market (RF4 builder). ──
  const cvEventAuthority = (await futarchy.pda.vaultEventAuthority()).address;
  const openIxs = await buildOpenChallengeIxs({
    oracleNonce: nonce,
    proposer: args.proposer,
    challenger,
    question,
    baseVault,
    usdcVault,
    passAmm,
    failAmm,
    baseVaultUnderlying,
    passBaseMint,
    failBaseMint,
    oraclePassKass,
    oracleFailKass,
    cvEventAuthority,
    spotDao: args.spotDao,
    usdcMint,
    challengerUsdcSrc,
    programId: args.programId,
  });

  const steps: ComposeStep[] = [
    { id: "question", label: "Create question", ixs: [questionIx], computeUnits: 400_000 },
    { id: "base-vault", label: "Create SOL vault", ixs: [baseVaultIx], computeUnits: 400_000 },
    { id: "usdc-vault", label: "Create USDC vault", ixs: [usdcVaultIx], computeUnits: 400_000 },
    { id: "fund-split", label: "Fund + split conditional tokens", ixs: fundSplitIxs, computeUnits: 600_000 },
    { id: "pass-pool", label: "Seed pass pool", ixs: passPoolIxs, computeUnits: 1_400_000 },
    { id: "fail-pool", label: "Seed fail pool", ixs: failPoolIxs, computeUnits: 1_400_000 },
    { id: "open", label: "Open challenge", ixs: openIxs, computeUnits: 1_400_000 },
  ];

  return { steps, composed };
}
