/**
 * RF4 — the CHALLENGE (open / settle) + AI-CLAIM action layer (pure ix-builders,
 * NO React). The dispute's challenge round runs over EXTERNALLY-COMPOSED MetaDAO
 * v0.4 markets (a binary question, SOL/USDC conditional vaults, two pass/fail
 * AMMs), so — exactly like the SDK challenge builders
 * (`sdk/src/instructions/challenge.ts`) — the SDK does NOT create that market:
 * the caller composes it in its own transactions (the runner / an integrator
 * emits the account set) and passes the pubkeys here. These builders only
 * validate + thread those accounts (plus the challenger + the oracle nonce) into
 * the SDK builders, which derive the Kassandra-owned PDAs internally.
 *
 *   open_challenge   → {@link buildOpenChallengeIxs}   (opens the Market + escrow)
 *   settle_challenge → {@link buildSettleChallengeIxs} (slot-based TWAP verdict)
 *   submit_ai_claim  → {@link buildSubmitAiClaimIxs}   (the AI-claim payload)
 *
 * --- the oracle nonce ---
 * `open_challenge` / `settle_challenge` carry `oracle_nonce: u64 LE` (payload +
 * re-derives the oracle PDA that signs the split/redeem CPIs). It is NOT stored
 * on the Oracle account, so the caller supplies it (the UI recalls it from the
 * nonce store or the pure {@link resolveOracleNonce} scan, exactly like the RF1 /
 * RF2 builders). A missing/invalid nonce throws a typed {@link ValidationError}.
 *
 * --- the AI-claim hashes ---
 * `submit_ai_claim` commits `model_id[32] ++ params_hash[32] ++ io_hash[32] ++
 * option u8` — the runner produces the three 32-byte hashes (the form accepts
 * them as hex, or a pasted runner payload). Each must be exactly 32 bytes and the
 * option in `0..options_count`, else a typed {@link ValidationError}.
 *
 * `buildSubmitAiClaimIxs` is the only builder here that touches SOL-free
 * accounts (no ATA prep): the challenge open/settle move conditional tokens the
 * caller already composed, and submit_ai_claim only writes the claim PDA.
 */
import { Address, type TransactionInstruction } from "@solana/web3.js";
import {
  applyExternalAiClaim,
  openChallenge,
  pda,
  settleChallenge,
  submitAiClaim,
} from "@kassandra-market/oracles";
import { ValidationError, type AddressInput } from "../actions";

/** Coerce an {@link AddressInput} into an `Address`, re-typing a parse failure as a field error. */
function addr(field: string, a: AddressInput): Address {
  if (a instanceof Address) return a;
  try {
    return new Address(a);
  } catch {
    throw new ValidationError(field, `${field} is not a valid base58 address.`);
  }
}

/** Validate + coerce the oracle nonce (u64) the challenge ixs commit to. */
function requireNonce(nonce: bigint | number | undefined): bigint {
  if (nonce === undefined || nonce === null) {
    throw new ValidationError(
      "oracleNonce",
      "The oracle nonce is required to sign this challenge (recall it or resolve it first).",
    );
  }
  let v: bigint;
  try {
    v = typeof nonce === "bigint" ? nonce : BigInt(Math.trunc(nonce));
  } catch {
    throw new ValidationError("oracleNonce", "The oracle nonce must be an integer.");
  }
  if (v < 0n) throw new ValidationError("oracleNonce", "The oracle nonce must be non-negative.");
  return v;
}

/** Require an exactly-32-byte hash, else a typed {@link ValidationError}. */
function requireBytes32(field: string, bytes: Uint8Array): Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    throw new ValidationError(
      field,
      `${field} must be exactly 32 bytes (got ${bytes instanceof Uint8Array ? bytes.length : "non-bytes"}).`,
    );
  }
  return bytes;
}

/** Validate the claimed categorical option (non-negative, optionally in range). */
function requireOption(option: number, optionsCount?: number): number {
  if (!Number.isInteger(option) || option < 0) {
    throw new ValidationError("option", "option must be a non-negative integer.");
  }
  if (optionsCount !== undefined && option >= optionsCount) {
    throw new ValidationError(
      "option",
      `option ${option} is out of range (options_count = ${optionsCount}).`,
    );
  }
  return option;
}

// ---------------------------------------------------------------------------
// open_challenge — opens the Market + USDC escrow against the composed MetaDAO
// market; the program-signed split_tokens CPI runs against the conditional vault.
// ---------------------------------------------------------------------------
export interface BuildOpenChallengeArgs {
  /** Oracle nonce (payload + re-derives the oracle/stake-vault signer PDAs). */
  oracleNonce: bigint | number;
  /** The challenged claim's Proposer PDA (derives ai_claim / market). */
  proposer: AddressInput;
  /** Challenger (signer): pays the Market + escrow rent, funds the USDC escrow. */
  challenger: AddressInput;
  // --- externally-composed MetaDAO market accounts ---
  /** Binary MetaDAO `Question` (resolver == oracle PDA). */
  question: AddressInput;
  /** SOL conditional vault (underlying == oracle.base_mint). */
  baseVault: AddressInput;
  /** USDC conditional vault (underlying == oracle.usdc_mint). */
  usdcVault: AddressInput;
  /** Pass-side AMM (owned by the AMM program). */
  passAmm: AddressInput;
  /** Fail-side AMM. */
  failAmm: AddressInput;
  /** `base_vault.underlying_token_account`. */
  baseVaultUnderlying: AddressInput;
  /** Conditional-SOL mint idx 0 of base_vault (pass). */
  passBaseMint: AddressInput;
  /** Conditional-SOL mint idx 1 of base_vault (fail). */
  failBaseMint: AddressInput;
  /** Oracle-PDA-owned pass-SOL holder token account. */
  oraclePassBase: AddressInput;
  /** Oracle-PDA-owned fail-SOL holder token account. */
  oracleFailBase: AddressInput;
  /** Conditional-vault `#[event_cpi]` event authority PDA. */
  cvEventAuthority: AddressInput;
  /** The futarchy `Dao` (`== protocol.spot_dao`), spot_price source. */
  spotDao: AddressInput;
  /** Canonical USDC mint (`== oracle.usdc_mint`). */
  usdcMint: AddressInput;
  /** Challenger's USDC source token account. */
  challengerUsdcSrc: AddressInput;
  programId?: Address;
}

export async function buildOpenChallengeIxs(
  args: BuildOpenChallengeArgs,
): Promise<TransactionInstruction[]> {
  const nonce = requireNonce(args.oracleNonce);
  const ix = await openChallenge({
    nonce,
    proposer: addr("proposer", args.proposer),
    challenger: addr("challenger", args.challenger),
    question: addr("question", args.question),
    baseVault: addr("baseVault", args.baseVault),
    usdcVault: addr("usdcVault", args.usdcVault),
    passAmm: addr("passAmm", args.passAmm),
    failAmm: addr("failAmm", args.failAmm),
    baseVaultUnderlying: addr("baseVaultUnderlying", args.baseVaultUnderlying),
    passBaseMint: addr("passBaseMint", args.passBaseMint),
    failBaseMint: addr("failBaseMint", args.failBaseMint),
    oraclePassBase: addr("oraclePassBase", args.oraclePassBase),
    oracleFailBase: addr("oracleFailBase", args.oracleFailBase),
    cvEventAuthority: addr("cvEventAuthority", args.cvEventAuthority),
    spotDao: addr("spotDao", args.spotDao),
    usdcMint: addr("usdcMint", args.usdcMint),
    challengerUsdcSrc: addr("challengerUsdcSrc", args.challengerUsdcSrc),
    programId: args.programId,
  });
  return [ix];
}

// ---------------------------------------------------------------------------
// settle_challenge — permissionless; reads the swap-driven AMM TWAP verdict,
// resolves the question, and pays out the bond/escrow. Slot-based gate: only
// after market.twap_end.
// ---------------------------------------------------------------------------
export interface BuildSettleChallengeArgs {
  /** Oracle nonce (payload + re-derives the oracle/stake-vault signer PDAs). */
  oracleNonce: bigint | number;
  /** The challenged claim's AiClaim (`== market.ai_claim`); derives market. */
  aiClaim: AddressInput;
  /** The claim's Proposer PDA (`== market.proposer`). */
  proposer: AddressInput;
  // --- externally-composed MetaDAO market accounts ---
  /** The MetaDAO `Question` (`== market.question`); resolved here. */
  question: AddressInput;
  /** Pass-side AMM (`== market.pass_amm`). */
  passAmm: AddressInput;
  /** Fail-side AMM (`== market.fail_amm`). */
  failAmm: AddressInput;
  /** Conditional-vault `#[event_cpi]` event authority PDA. */
  cvEventAuthority: AddressInput;
  /** SOL conditional vault (`== market.base_vault`). */
  baseVault: AddressInput;
  /** `base_vault.underlying_token_account`. */
  baseVaultUnderlying: AddressInput;
  /** Conditional-SOL mint idx 0 of base_vault (pass). */
  passBaseMint: AddressInput;
  /** Conditional-SOL mint idx 1 of base_vault (fail). */
  failBaseMint: AddressInput;
  /** Oracle-PDA-owned pass-SOL holder (`== market.oracle_pass_base`). */
  oraclePassBase: AddressInput;
  /** Oracle-PDA-owned fail-SOL holder (`== market.oracle_fail_base`). */
  oracleFailBase: AddressInput;
  /** Proposer's USDC payout account (owner == proposer.authority). */
  proposerUsdc: AddressInput;
  /** Challenger's USDC payout account (owner == market.challenger). */
  challengerUsdcDest: AddressInput;
  /** Challenger's SOL payout account (owner == market.challenger). */
  challengerBase: AddressInput;
  programId?: Address;
}

export async function buildSettleChallengeIxs(
  args: BuildSettleChallengeArgs,
): Promise<TransactionInstruction[]> {
  const nonce = requireNonce(args.oracleNonce);
  const ix = await settleChallenge({
    nonce,
    aiClaim: addr("aiClaim", args.aiClaim),
    proposer: addr("proposer", args.proposer),
    question: addr("question", args.question),
    passAmm: addr("passAmm", args.passAmm),
    failAmm: addr("failAmm", args.failAmm),
    cvEventAuthority: addr("cvEventAuthority", args.cvEventAuthority),
    baseVault: addr("baseVault", args.baseVault),
    baseVaultUnderlying: addr("baseVaultUnderlying", args.baseVaultUnderlying),
    passBaseMint: addr("passBaseMint", args.passBaseMint),
    failBaseMint: addr("failBaseMint", args.failBaseMint),
    oraclePassBase: addr("oraclePassBase", args.oraclePassBase),
    oracleFailBase: addr("oracleFailBase", args.oracleFailBase),
    proposerUsdc: addr("proposerUsdc", args.proposerUsdc),
    challengerUsdcDest: addr("challengerUsdcDest", args.challengerUsdcDest),
    challengerBase: addr("challengerBase", args.challengerBase),
    programId: args.programId,
  });
  return [ix];
}

// ---------------------------------------------------------------------------
// submit_ai_claim — a proposer stamps its AI claim (model/params/io hashes +
// option) in the AiClaim phase. Payload: model_id[32] ++ params_hash[32] ++
// io_hash[32] ++ option u8. The submitter must be `proposer.authority`.
// ---------------------------------------------------------------------------
export interface BuildSubmitAiClaimArgs {
  /** The oracle (must be in the AiClaim phase). */
  oracle: AddressInput;
  /**
   * The submitter's Proposer PDA (`proposer.authority == submitter`). Optional —
   * when omitted it is derived from `[b"proposer", oracle, submitter]`, so
   * callers need only pass the oracle + submitter.
   */
  proposer?: AddressInput;
  /** Proposer authority (signer): pays the AiClaim rent. */
  submitter: AddressInput;
  /** 32-byte pinned model id (runner-produced). */
  modelId: Uint8Array;
  /** 32-byte model-params hash (runner-produced). */
  paramsHash: Uint8Array;
  /** 32-byte input/output hash (runner-produced). */
  ioHash: Uint8Array;
  /** The claimed categorical option (< oracle.options_count). */
  option: number;
  /** When supplied, validates `option < optionsCount`. */
  optionsCount?: number;
  programId?: Address;
}

export async function buildSubmitAiClaimIxs(
  args: BuildSubmitAiClaimArgs,
): Promise<TransactionInstruction[]> {
  const modelId = requireBytes32("modelId", args.modelId);
  const paramsHash = requireBytes32("paramsHash", args.paramsHash);
  const ioHash = requireBytes32("ioHash", args.ioHash);
  const option = requireOption(args.option, args.optionsCount);
  const oracle = addr("oracle", args.oracle);
  const submitter = addr("submitter", args.submitter);
  const proposer = args.proposer
    ? addr("proposer", args.proposer)
    : (await pda.proposer(oracle, submitter)).address;
  const ix = await submitAiClaim({
    oracle,
    proposer,
    authority: submitter,
    modelId,
    paramsHash,
    ioHash,
    option,
    programId: args.programId,
  });
  return [ix];
}

// ---------------------------------------------------------------------------
// apply_external_ai_claim — stamps the proposer's AiClaim from the attested feed.
// ---------------------------------------------------------------------------
export interface BuildApplyExternalAiClaimArgs {
  oracle: AddressInput;
  /** Proposer authority (the connected wallet, or a cranked proposer's authority). */
  proposerAuthority: AddressInput;
  /** Fee payer (signer). */
  payer: AddressInput;
  programId?: Address;
}

export async function buildApplyExternalAiClaimIxs(
  args: BuildApplyExternalAiClaimArgs,
): Promise<TransactionInstruction[]> {
  const ix = await applyExternalAiClaim({
    oracle: addr("oracle", args.oracle),
    proposerAuthority: addr("proposerAuthority", args.proposerAuthority),
    payer: addr("payer", args.payer),
    programId: args.programId,
  });
  return [ix];
}

