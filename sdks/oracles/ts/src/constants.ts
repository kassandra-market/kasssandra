/**
 * Program constants for the Kassandra dispute-core program — the TypeScript
 * mirror of the Rust source of truth. Every value here is pinned against the
 * program and guarded by `test/parity.test.ts` (a mismatch fails CI = drift
 * guard). Sources:
 *
 *   - `programs/oracles/src/instruction.rs` — {@link Ix} discriminants (0..=29)
 *   - `programs/oracles/src/state.rs`       — {@link AccountType} (0..=11)
 *   - `programs/oracles/src/error.rs`       — {@link KassandraError} (0..=42)
 *   - `programs/oracles/tests/state_layout.rs` — {@link ACCOUNT_SIZES}
 *   - `programs/oracles/src/config.rs`      — protocol consts
 *   - `programs/oracles/src/cpi/{metadao,metadao_v06}.rs` — external program IDs
 */
import { Address } from "@solana/web3.js";

/** Kassandra dispute-core program ID (`programs/oracles/src/lib.rs`). */
export const KASSANDRA_PROGRAM_ID = new Address("KassVxvXUEPr5apSr2MqiGva4VFtJXyYLLDFS3f83nY");

/** The Solana System program (`pinocchio_system::ID`), referenced by account-creating instructions. */
export const SYSTEM_PROGRAM_ID = new Address("11111111111111111111111111111111");

/** The SPL Token program (`pinocchio_token::ID`), referenced by stake/bond token CPIs. */
export const TOKEN_PROGRAM_ID = new Address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/**
 * The SPL Associated Token Account program. `sweep_oracle` derives the DAO
 * treasury as `ATA(dao_authority, TOKEN_PROGRAM, base_mint)` under this id
 * (`processor/sweep_oracle.rs::ATA_PROGRAM_ID`).
 */
export const ATA_PROGRAM_ID = new Address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/**
 * Instruction discriminants — the leading byte of `instruction_data`.
 * Mirror of `Ix` in `instruction.rs`. STABLE PUBLIC CONTRACT: never renumbered;
 * new variants are appended.
 */
export enum Ix {
  SubmitFact = 0,
  VoteFact = 1,
  FinalizeFacts = 2,
  SubmitAiClaim = 3,
  OpenChallenge = 4,
  SettleChallenge = 5,
  FinalizeOracle = 6,
  AdvancePhase = 7,
  FinalizeAiClaims = 8,
  InitProtocol = 9,
  CreateOracle = 10,
  Propose = 11,
  FinalizeProposals = 12,
  SetGovernance = 13,
  SetConfig = 14,
  ResolveDeadend = 15,
  SpotPrice = 16,
  ClaimProposer = 17,
  ClaimFact = 18,
  ClaimFactVote = 19,
  CloseAiClaim = 20,
  CloseMarket = 21,
  SweepOracle = 22,
  WriteOracleMeta = 23,
  DelegateOracle = 24,
  CommitOracle = 25,
  UndelegateOracle = 26,
  SetAiOracleConfig = 27,
  RequestAiOracle = 28,
  ApplyExternalAiClaim = 29,
}

/**
 * On-chain account-type discriminator — the FIRST byte of every Pod account
 * (`account_type`, followed by `_pad_hdr[7]`). Mirror of `AccountType` in
 * `state.rs`. `Uninitialized` (0) is what a freshly zeroed account carries.
 */
export enum AccountType {
  Uninitialized = 0,
  Oracle = 1,
  Proposer = 2,
  Fact = 3,
  FactVote = 4,
  AiClaim = 5,
  Market = 6,
  Protocol = 7,
  OracleMeta = 8,
  ErSession = 9,
  AiOracleConfig = 10,
  AiOracleFeed = 11,
}

/**
 * Lifecycle phase of an oracle dispute, stored on-chain as a `u8`.
 * Mirror of `Phase` in `state.rs`. `Created` (0) is reserved/unused (oracles
 * start in `Proposal`); kept for ABI stability.
 */
export enum Phase {
  Created = 0,
  Proposal = 1,
  FactProposal = 2,
  FactVoting = 3,
  AiClaim = 4,
  Challenge = 5,
  FinalRecompute = 6,
  Resolved = 7,
  InvalidDeadend = 8,
}

/**
 * Pinned on-chain ABI sizes (bytes) of the Pod accounts, from
 * `tests/state_layout.rs` (`account_sizes_are_stable`). Each carries an 8-byte
 * header (`account_type: u8` + `_pad_hdr[7]`) at offset 0. The D2 decoders read
 * exactly this many bytes; the parity guard asserts these against the program.
 * `Oracle` (368) and `Protocol` (392) are NOT resized — ER + AI-oracle state
 * lives on companion PDAs.
 */
export const ACCOUNT_SIZES = {
  Protocol: 392,
  Oracle: 368,
  Proposer: 96,
  Fact: 336,
  FactVote: 88,
  AiClaim: 208,
  Market: 416,
  ErSession: 96,
  AiOracleConfig: 48,
  AiOracleFeed: 248,
} as const;

/**
 * Program error codes surfaced to clients as `ProgramError::Custom(u32)`.
 * Mirror of `KassandraError` in `error.rs`. STABLE PUBLIC CONTRACT.
 */
export enum KassandraError {
  NotImplemented = 0,
  WrongPhase = 1,
  WindowClosed = 2,
  WindowNotElapsed = 3,
  Unauthorized = 4,
  InvalidAccount = 5,
  DuplicateFact = 6,
  ZeroStake = 7,
  DuplicateVote = 8,
  IncompleteFactSet = 9,
  AlreadySettled = 10,
  NoDisputeBond = 11,
  DuplicateClaim = 12,
  InvalidOption = 13,
  AlreadyChallenged = 14,
  TwapWindowOpen = 15,
  ChallengesOutstanding = 16,
  AlreadyInitialized = 17,
  InvalidDeadline = 18,
  InvalidOptionsCount = 19,
  DeadlineNotReached = 20,
  ProposalWindowClosed = 21,
  TooManyProposers = 22,
  DuplicateProposer = 23,
  NoProposals = 24,
  GovernanceAlreadySet = 25,
  InvalidConfig = 26,
  VotersOutstanding = 27,
  BadMintAuthority = 28,
  MarketNotSettled = 29,
  EscrowNotEmpty = 30,
  InvalidFutarchyDao = 31,
  DaoAuthorityMismatch = 32,
  SweepGraceNotElapsed = 33,
  GovernanceNotSet = 34,
  InvalidTreasury = 35,
  BelowMinStake = 36,
  AlreadyDelegated = 37,
  NotDelegated = 38,
  StaleAiOracle = 39,
  AiOracleDisabled = 40,
  AiOracleMismatch = 41,
  InvalidAiOracleResponse = 42,
}

/** Human-readable message per {@link KassandraError} (condensed from error.rs docs). */
const ERROR_MESSAGES: Record<KassandraError, string> = {
  [KassandraError.NotImplemented]: "Instruction recognized but its processor is not implemented yet.",
  [KassandraError.WrongPhase]: "The oracle is not in the phase this instruction requires.",
  [KassandraError.WindowClosed]: "The current phase window has already closed (now >= phase_ends_at).",
  [KassandraError.WindowNotElapsed]: "The current phase window has not yet elapsed (now < phase_ends_at).",
  [KassandraError.Unauthorized]: "The signer is not authorized to perform this action.",
  [KassandraError.InvalidAccount]: "An account passed to the instruction is invalid (wrong owner, address, or contents).",
  [KassandraError.DuplicateFact]: "A fact with this content_hash already exists for this oracle.",
  [KassandraError.ZeroStake]: "A stake amount of zero was supplied where a positive stake is required.",
  [KassandraError.DuplicateVote]: "This voter has already voted on this fact (one vote per voter per fact).",
  [KassandraError.IncompleteFactSet]: "finalize_facts was called with an empty account tail (at least one fact/proposer required).",
  [KassandraError.AlreadySettled]: "A fact passed to finalize_facts is already settled (or proposer already slashed).",
  [KassandraError.NoDisputeBond]: "finalize_facts was invoked on an oracle whose dispute_bond_total is zero.",
  [KassandraError.DuplicateClaim]: "An AI claim already exists for this proposer (one claim per proposer).",
  [KassandraError.InvalidOption]: "The claimed option is out of range for this oracle (option >= options_count).",
  [KassandraError.AlreadyChallenged]: "open_challenge was called against a claim that already has an open market.",
  [KassandraError.TwapWindowOpen]: "settle_challenge was called before the market's TWAP window elapsed (now < twap_end).",
  [KassandraError.ChallengesOutstanding]: "finalize_oracle was called while one or more challenge markets are still open.",
  [KassandraError.AlreadyInitialized]: "init_protocol was called on a protocol PDA that is already initialized.",
  [KassandraError.InvalidDeadline]: "create_oracle was called with a deadline in the past (deadline < now).",
  [KassandraError.InvalidOptionsCount]: "Options-count / option-index range violation (options_count < 2, or option >= options_count).",
  [KassandraError.DeadlineNotReached]: "propose was called before the oracle's deadline (now < deadline).",
  [KassandraError.ProposalWindowClosed]: "propose was called after the proposal window closed; finalize_proposals instead.",
  [KassandraError.TooManyProposers]: "propose would push proposer_count past MAX_PROPOSERS.",
  [KassandraError.DuplicateProposer]: "This authority already registered a proposal on this oracle.",
  [KassandraError.NoProposals]: "finalize_proposals was called on an oracle with proposer_count == 0.",
  [KassandraError.GovernanceAlreadySet]: "set_governance was called after the DAO linkage was already recorded by a non-DAO signer.",
  [KassandraError.InvalidConfig]: "set_config was given an out-of-bounds governable parameter.",
  [KassandraError.VotersOutstanding]: "claim_fact was called while the fact still has unclaimed voter stake.",
  [KassandraError.BadMintAuthority]: "The SOL mint's authority is not the program's mint-authority PDA.",
  [KassandraError.MarketNotSettled]: "close_market was called on a Market that has not been settled yet.",
  [KassandraError.EscrowNotEmpty]: "close_market was called while the challenger_usdc_vault escrow still holds USDC.",
  [KassandraError.InvalidFutarchyDao]: "set_governance was given a spot_dao that is not a real futarchy Dao (wrong owner or discriminator).",
  [KassandraError.DaoAuthorityMismatch]: "set_governance dao_authority is not the Squads v4 vault PDA derived for the spot_dao.",
  [KassandraError.SweepGraceNotElapsed]: "sweep_oracle was called before the dust-sweep grace elapsed (now < oracle.phase_ends_at + SWEEP_GRACE).",
  [KassandraError.GovernanceNotSet]: "sweep_oracle was called while the Protocol has no DAO linkage (governance_set == 0); the treasury ATA does not exist yet.",
  [KassandraError.InvalidTreasury]: "sweep_oracle was given a dao_treasury that is not the canonical SOL ATA(dao_authority, base_mint).",
  [KassandraError.BelowMinStake]: "The stake was below the oracle's activity-scaled min_stake floor (0 at genesis / low activity; grows with creation activity).",
  [KassandraError.AlreadyDelegated]: "delegate_oracle was called on an oracle whose ErSession is already delegated.",
  [KassandraError.NotDelegated]: "commit_oracle / undelegate_oracle ran against an ErSession that is not currently delegated.",
  [KassandraError.StaleAiOracle]: "apply_external_ai_claim read an AiOracleFeed older than AiOracleConfig.max_staleness_slots.",
  [KassandraError.AiOracleDisabled]: "The external AI oracle is disabled; use submit_ai_claim instead.",
  [KassandraError.AiOracleMismatch]: "apply_external_ai_claim was given a feed whose oracle pubkey does not match the instruction's oracle.",
  [KassandraError.InvalidAiOracleResponse]: "GPT-oracle callback payload was not a parseable categorical option_index.",
};

/**
 * Decode a `ProgramError::Custom(u32)` code into a friendly name + message.
 * Use on the `Custom(n)` surfaced by a failed transaction's instruction error.
 * Unknown codes return `{ name: "Unknown", ... }`.
 */
export function decodeError(custom: number): { name: string; message: string } {
  const name = KassandraError[custom as KassandraError];
  if (name === undefined) {
    return { name: "Unknown", message: `Unknown Kassandra custom error code ${custom}.` };
  }
  return { name, message: ERROR_MESSAGES[custom as KassandraError] };
}

/**
 * External program IDs the Kassandra challenge/governance flows bind to.
 * Verified against `src/cpi/metadao.rs` (v0.4) and `src/cpi/metadao_v06.rs` (v0.6).
 */
export const EXTERNAL_PROGRAM_IDS = {
  /** MetaDAO conditional-vault (v0.4 AND v0.6 share this id). `metadao.rs::CONDITIONAL_VAULT_ID`. */
  conditionalVault: new Address("VLTX1ishMBbcX3rdBWGssxawAo1Q2X2qxYFYqiGodVg"),
  /** MetaDAO AMM v0.4. `metadao.rs::AMM_ID`. */
  ammV04: new Address("AMMyu265tkBpRW21iGQxKGLaves3gKm2JcMUqfXNSpqD"),
  /** MetaDAO futarchy v0.6. `metadao_v06.rs::FUTARCHY_ID`. */
  futarchyV06: new Address("FUTARELBfJfQ8RDGhg1wdhddq1odMAJUePHFuBYfUxKq"),
  /** Meteora DAMM v2 (cp-amm). `metadao_v06.rs::METEORA_DAMM_V2_ID`. */
  meteoraDammV2: new Address("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"),
  /** Squads v4. `metadao_v06.rs::SQUADS_V4_ID`. */
  squadsV4: new Address("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"),
  /** MagicBlock Delegation Program (`cpi/magicblock.rs::DELEGATION_PROGRAM_ID`). */
  magicblockDelegation: new Address("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"),
  /** MagicBlock Magic Program (`cpi/magicblock.rs::MAGIC_PROGRAM_ID`). */
  magicblockMagic: new Address("Magic11111111111111111111111111111111111111"),
  /** Magic Context account (`cpi/magicblock.rs::MAGIC_CONTEXT_ID`). */
  magicblockContext: new Address("MagicContext1111111111111111111111111111111"),
  /** MagicBlock solana-gpt-oracle (`cpi/gpt_oracle.rs::GPT_ORACLE_PROGRAM_ID`). */
  solanaGptOracle: new Address("LLMrieZMpbJFwN52WgmBNMxYojrpRVYXdC1RCweEbab"),
} as const;

/** MagicBlock solana-gpt-oracle program (`cpi/gpt_oracle.rs`). */
export const GPT_ORACLE_PROGRAM_ID = EXTERNAL_PROGRAM_IDS.solanaGptOracle;

/** 8-byte GPT-oracle callback discriminator (`sha256("global:callback_from_gpt_oracle")[..8]`). */
export const GPT_ORACLE_CALLBACK_DISCRIMINATOR = Uint8Array.of(
  0x3b, 0x24, 0x82, 0x78, 0x4d, 0x6f, 0xac, 0x00,
);

/** `ErSession.status`: account is on the base layer (not delegated). */
export const ER_STATUS_UNDELEGATED = 0;
/** `ErSession.status`: account is delegated to an Ephemeral Rollup validator. */
export const ER_STATUS_DELEGATED = 1;

/** `AiOracleConfig.source`: reserved (legacy generic pusher; unused). */
export const AI_ORACLE_SOURCE_EXTERNAL = 0;
/** `AiOracleConfig.source`: MagicBlock solana-gpt-oracle. */
export const AI_ORACLE_SOURCE_MAGICBLOCK = 1;
/** `AiOracleConfig.source`: Switchboard on-demand (reserved). */
export const AI_ORACLE_SOURCE_SWITCHBOARD = 2;

/** Default MagicBlock commit frequency when `commit_frequency_ms == 0` (30s). */
export const ER_DEFAULT_COMMIT_FREQUENCY_MS = 30_000;

/**
 * Protocol-global config consts the SDK exposes (defaults from `config.rs`;
 * the live values are governable via `set_config` and snapshotted per-oracle).
 */
export const CONFIG = {
  /** Dispute phase window, seconds (`PHASE_WINDOW`). */
  PHASE_WINDOW: 3600n,
  /** Proposal-registration window, seconds (`PROPOSAL_WINDOW`). */
  PROPOSAL_WINDOW: 3600n,
  /** Upper bound on an oracle's proposer set (`MAX_PROPOSERS`). */
  MAX_PROPOSERS: 60,
  /** Fact-quorum supermajority fraction `THRESHOLD_NUM/THRESHOLD_DEN` (2/3). */
  THRESHOLD_NUM: 2n,
  THRESHOLD_DEN: 3n,
  /** Market slash-trigger margin `MARKET_THRESHOLD_NUM/DEN` (1/10). */
  MARKET_THRESHOLD_NUM: 1n,
  MARKET_THRESHOLD_DEN: 10n,
  /** Flip-slash fraction `FLIP_SLASH_NUM/DEN` (1/2). */
  FLIP_SLASH_NUM: 1n,
  FLIP_SLASH_DEN: 2n,
} as const;

/**
 * `Proposer.claim_option` sentinel: no AI claim submitted yet
 * (`state.rs::CLAIM_OPTION_NONE`). MUST be set at proposer creation, not left 0.
 */
export const CLAIM_OPTION_NONE = 0xff;
/** `FactVote.kind`: approve vote (`state.rs::VOTE_APPROVE`). */
export const VOTE_APPROVE = 0;
/** `FactVote.kind`: duplicate vote (`state.rs::VOTE_DUPLICATE`). */
export const VOTE_DUPLICATE = 1;
