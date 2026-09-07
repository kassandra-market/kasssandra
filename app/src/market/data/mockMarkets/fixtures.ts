/**
 * Hand-authored fixture DTOs for the Markets flow's offline preview — the market
 * analogue of `src/data/mockOracles/fixtures.ts`. Every DTO here is consumed by
 * the REAL mapper functions in `../markets.ts` (`mapMarketDto`, `mapConfigDto`,
 * `mapContributionDto`), so every pubkey must be a genuinely valid base58-encoded
 * 32-byte address (round-trips through `new Address(...)`, exactly like a live
 * indexer response) and every u64 field a base-10 string.
 *
 * Unlike the oracle fixtures (whose pubkey-shaped strings are only ever
 * stringified, never fed to `new Address(...)`), these pubkeys ARE constructed
 * into real `Address`es by the market data layer — so `fixturePubkey` below
 * builds them from real bytes through the real codec rather than hand-typing a
 * base58-look-alike string (most hand-typed look-alikes are the wrong decoded
 * byte length and throw).
 *
 * Covers, across `MOCK_MARKET_PUBKEYS` — every `MarketStatus` (Funding under
 * floor, Funding past floor/"funded", Active, Resolved, Void, Cancelled), for
 * BOTH a lone binary market and a 3-outcome categorical GROUP (`HAND_FIXTURES`,
 * hand-authored — each tells a specific, curated story), plus two 9-outcome
 * categorical groups (`makeCat9*Fixtures`, generated — mostly-repetitive
 * boilerplate at that scale, parameterized just enough to vary realistically):
 *
 * Binary (own oracle each):
 *   - `Funding`, under its 500,000 SOL floor
 *   - `Funding`, PAST its floor ("funded", awaiting activation) — the market
 *     list card's "Launch market" CTA instead of a stake input
 *   - `Active`, live, populated cYES/cNO reserves for the trade UI + price chart
 *   - `Resolved`, YES won (resolvedOption 0 == outcomeIndex 0)
 *   - `Resolved`, NO won (resolvedOption 1 != outcomeIndex 0) — the
 *     complementary resolution direction
 *   - `Void` (`InvalidDeadend` AFTER activation — both legs redeem)
 *   - `Cancelled` (`InvalidDeadend` BEFORE activation — refund path)
 *
 * 3-outcome categorical (one shared oracle per group, `optionsCount = 3`,
 * `groupByOracle` collapses each into one `OracleGroup`; `isCategorical` is
 * true since `optionsCount > 2`):
 *   - every leg `Funding`, under floor
 *   - every leg `Funding`, PAST floor ("funded", awaiting activation)
 *   - every leg `Active`, oracle unresolved (no winner at all yet)
 *   - a resolved group with a realistic "resolution pending" straggler: 2 legs
 *     `Resolved` (1 winner, 1 loser), 1 leg still `Active` (its own
 *     `resolve_market` crank hasn't run)
 *   - every leg `Void` (activated, then the oracle dead-ended)
 *   - every leg `Cancelled` (never activated, the oracle dead-ended first)
 *
 * 9-outcome categorical (`optionsCount = 9` — the "large group" case: does the
 * list card / group liquidity panel / categorical detail page hold up at N=9,
 * not just N=3?):
 *   - every leg `Funding`, staggered under-floor amounts
 *   - resolved to one winner, 7 losers, 1 still-`Active` pending straggler —
 *     the same "resolution pending" realism as the 3-outcome version, at scale
 */
import { Address } from "@solana/web3.js";
import type { CandleDto, ConfigDto, ContributionDto, MarketDetailDto, MarketDto, OracleDto, ReservesDto } from "../../lib/indexer";

// --- deterministic fixture addresses ------------------------------------------

/** FNV-1a (32-bit) — a small, deterministic, dependency-free string hash. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A deterministic, genuinely-valid 32-byte pubkey derived from a short label.
 * Every byte comes from re-hashing `label:index:prevHash`, then the 32 raw bytes
 * are encoded through the real `Address` codec — so the result is a real base58
 * pubkey (unlike a hand-typed look-alike, which is very likely the wrong decoded
 * byte length or contains an invalid base58 character).
 */
function fixturePubkey(label: string): string {
  const bytes = new Uint8Array(32);
  let h = fnv1a(label);
  for (let i = 0; i < 32; i++) {
    h = fnv1a(`${label}:${i}:${h}`);
    bytes[i] = h & 0xff;
  }
  return new Address(bytes).toBase58();
}

/** The all-zero pubkey (`system program`) — the on-chain sentinel for the
 * MetaDAO composition fields (`question`/`vault`/`yesMint`/…) before `activate`. */
const ZERO = "11111111111111111111111111111111";

const BASE_MINT = fixturePubkey("base-mint");

/** SOL has 9 decimals; base units from a whole-SOL count. */
const SCALE = 10n ** 9n;
const base = (whole: number): string => (BigInt(whole) * SCALE).toString();

// --- oracles (one per standalone market, one shared by the categorical group) -

const O_FUNDING = fixturePubkey("oracle-funding");
const O_FUNDED = fixturePubkey("oracle-funded");
const O_ACTIVE = fixturePubkey("oracle-active");
const O_RESOLVED = fixturePubkey("oracle-resolved");
const O_RESOLVED_NO = fixturePubkey("oracle-resolved-no");
const O_VOID = fixturePubkey("oracle-void");
const O_CANCELLED = fixturePubkey("oracle-cancelled");
const O_CATEGORICAL = fixturePubkey("oracle-categorical");
const O_CATEGORICAL_FUNDING = fixturePubkey("oracle-categorical-funding");
const O_CATEGORICAL_FUNDED = fixturePubkey("oracle-categorical-funded");
const O_CATEGORICAL_ACTIVE = fixturePubkey("oracle-categorical-active");
const O_CATEGORICAL_VOID = fixturePubkey("oracle-categorical-void");
const O_CATEGORICAL_CANCELLED = fixturePubkey("oracle-categorical-cancelled");
const O_CAT9_FUNDING = fixturePubkey("oracle-cat9-funding");
const O_CAT9_RESOLVED = fixturePubkey("oracle-cat9-resolved");

const ORACLES: Record<string, OracleDto> = {
  [O_FUNDING]: { optionsCount: 2, phase: 1 /* Proposal */, resolvedOption: 0 },
  // At its floor but not yet activated — exercises the market list card's
  // "Launch market" CTA (a Funding market past `minLiquidity` skips the stake
  // input entirely and offers a one-click activate instead).
  [O_FUNDED]: { optionsCount: 2, phase: 1 /* Proposal */, resolvedOption: 0 },
  [O_ACTIVE]: { optionsCount: 2, phase: 3 /* FactVoting */, resolvedOption: 0 },
  [O_RESOLVED]: { optionsCount: 2, phase: 7 /* Resolved */, resolvedOption: 0 /* YES (outcomeIndex 0) won */ },
  // The complementary binary resolution: resolvedOption 1 != outcomeIndex 0, so
  // NO wins (the only binary Resolved fixture above pays YES — this one pays NO).
  [O_RESOLVED_NO]: { optionsCount: 2, phase: 7 /* Resolved */, resolvedOption: 1 /* NO won */ },
  [O_VOID]: { optionsCount: 2, phase: 8 /* InvalidDeadend */, resolvedOption: 0xff },
  [O_CANCELLED]: { optionsCount: 2, phase: 8 /* InvalidDeadend */, resolvedOption: 0xff },
  // Resolved with option 2 winning — CAT_2 pays YES, CAT_0/CAT_1 pay NO. CAT_1's
  // own `resolve_market` crank hasn't run yet (its `status` is still `Active`),
  // a realistic "resolution pending" categorical state.
  [O_CATEGORICAL]: { optionsCount: 3, phase: 7 /* Resolved */, resolvedOption: 2 },
  // A categorical group still pre-activation — every outcome Funding, none has
  // met its own floor yet. Exercises the single cumulative funding bar + the
  // group-only deposit action (no per-outcome contribute form) on a group that
  // hasn't started resolving at all yet.
  [O_CATEGORICAL_FUNDING]: { optionsCount: 3, phase: 1 /* Proposal */, resolvedOption: 0 },
  // A categorical group where every outcome is past its OWN floor but none has
  // been activated yet — the categorical analogue of O_FUNDED, exercising the
  // group's "Launch market" affordance per outcome.
  [O_CATEGORICAL_FUNDED]: { optionsCount: 3, phase: 1 /* Proposal */, resolvedOption: 0 },
  // A categorical group with every outcome activated and trading, oracle still
  // unresolved — the categorical analogue of O_ACTIVE (no winner yet at all).
  [O_CATEGORICAL_ACTIVE]: { optionsCount: 3, phase: 3 /* FactVoting */, resolvedOption: 0 },
  // A categorical group whose oracle dead-ended AFTER activation — every leg
  // Void (both cYES/cNO redeem), the categorical analogue of O_VOID.
  [O_CATEGORICAL_VOID]: { optionsCount: 3, phase: 8 /* InvalidDeadend */, resolvedOption: 0xff },
  // A categorical group whose oracle dead-ended BEFORE any leg activated —
  // every leg Cancelled (refund path), the categorical analogue of O_CANCELLED.
  [O_CATEGORICAL_CANCELLED]: { optionsCount: 3, phase: 8 /* InvalidDeadend */, resolvedOption: 0xff },
  // A 9-outcome group, every leg still Funding — the "large categorical" case,
  // scaled up from the 3-outcome O_CATEGORICAL_FUNDING.
  [O_CAT9_FUNDING]: { optionsCount: 9, phase: 1 /* Proposal */, resolvedOption: 0 },
  // A 9-outcome group, resolved to option 4 — 8 legs settled (1 winner + 7
  // losers), 1 leg's own `resolve_market` crank still pending (mirrors
  // O_CATEGORICAL's "resolution pending" realism, at 9-outcome scale).
  [O_CAT9_RESOLVED]: { optionsCount: 9, phase: 7 /* Resolved */, resolvedOption: 4 },
};

// --- markets -------------------------------------------------------------------

interface MarketFixture {
  dto: MarketDto;
  oracle: OracleDto;
  reserves: ReservesDto | null;
  contributions: ContributionDto[];
}

/** Full-shape `MarketDto` with sensible pre-activation defaults; callers override. */
function makeMarket(label: string, over: Partial<MarketDto> & Pick<MarketDto, "address" | "oracle" | "status" | "statusLabel">): MarketDto {
  const base: MarketDto = {
    address: over.address,
    status: over.status,
    statusLabel: over.statusLabel,
    oracle: over.oracle,
    creator: fixturePubkey(`${label}-creator`),
    baseMint: BASE_MINT,
    escrowVault: fixturePubkey(`${label}-escrow`),
    minLiquidity: base(500_000),
    totalContributed: base(0),
    openContributions: 1,
    bump: 253,
    escrowBump: 252,
    outcomeIndex: 0,
    feeBps: 250,
    feeCollected: 0,
    settled: 0,
    question: ZERO,
    vault: ZERO,
    yesMint: ZERO,
    noMint: ZERO,
    amm: ZERO,
    lpMint: ZERO,
    lpVault: ZERO,
    lpTotal: base(0),
    activationLp: base(0),
    activationContributed: base(0),
    grossLpTotal: base(0),
    slot: "1000",
  };
  return { ...base, ...over };
}

/** A single deterministic `ContributionDto` for `market`, from `contributor`. */
function makeContribution(
  market: string,
  label: string,
  amountWhole: number,
  opts: { claimed?: boolean; lateLpWhole?: number; slot?: string } = {},
): ContributionDto {
  return {
    market,
    contributor: fixturePubkey(`${label}-contributor`),
    amount: base(amountWhole),
    claimed: opts.claimed ?? false,
    bump: 254,
    lateLp: base(opts.lateLpWhole ?? 0),
    slot: opts.slot ?? "1000",
  };
}

const MKT_FUNDING = fixturePubkey("market-funding-binary");
const MKT_FUNDED = fixturePubkey("market-funded-binary");
const MKT_ACTIVE = fixturePubkey("market-active-binary");
const MKT_RESOLVED = fixturePubkey("market-resolved-binary");
const MKT_VOID = fixturePubkey("market-void-binary");
const MKT_CANCELLED = fixturePubkey("market-cancelled-binary");
const MKT_CAT_0 = fixturePubkey("market-categorical-outcome-0");
const MKT_CAT_1 = fixturePubkey("market-categorical-outcome-1");
const MKT_CAT_2 = fixturePubkey("market-categorical-outcome-2");
const MKT_CAT_FUNDING_0 = fixturePubkey("market-categorical-funding-outcome-0");
const MKT_CAT_FUNDING_1 = fixturePubkey("market-categorical-funding-outcome-1");
const MKT_CAT_FUNDING_2 = fixturePubkey("market-categorical-funding-outcome-2");
const MKT_RESOLVED_NO = fixturePubkey("market-resolved-no-binary");
const MKT_CAT_FUNDED_0 = fixturePubkey("market-categorical-funded-outcome-0");
const MKT_CAT_FUNDED_1 = fixturePubkey("market-categorical-funded-outcome-1");
const MKT_CAT_FUNDED_2 = fixturePubkey("market-categorical-funded-outcome-2");
const MKT_CAT_ACTIVE_0 = fixturePubkey("market-categorical-active-outcome-0");
const MKT_CAT_ACTIVE_1 = fixturePubkey("market-categorical-active-outcome-1");
const MKT_CAT_ACTIVE_2 = fixturePubkey("market-categorical-active-outcome-2");
const MKT_CAT_VOID_0 = fixturePubkey("market-categorical-void-outcome-0");
const MKT_CAT_VOID_1 = fixturePubkey("market-categorical-void-outcome-1");
const MKT_CAT_VOID_2 = fixturePubkey("market-categorical-void-outcome-2");
const MKT_CAT_CANCELLED_0 = fixturePubkey("market-categorical-cancelled-outcome-0");
const MKT_CAT_CANCELLED_1 = fixturePubkey("market-categorical-cancelled-outcome-1");
const MKT_CAT_CANCELLED_2 = fixturePubkey("market-categorical-cancelled-outcome-2");

const HAND_FIXTURES: MarketFixture[] = [
  {
    // Pre-activation, partially funded — below its 500,000 SOL floor.
    dto: makeMarket("funding", {
      address: MKT_FUNDING,
      oracle: O_FUNDING,
      status: 0 /* Funding */,
      statusLabel: "Funding",
      totalContributed: base(235_000),
      openContributions: 2,
      slot: "1001",
    }),
    oracle: ORACLES[O_FUNDING],
    reserves: null,
    contributions: [
      makeContribution(MKT_FUNDING, "funding-a", 150_000, { slot: "1001" }),
      makeContribution(MKT_FUNDING, "funding-b", 85_000, { slot: "1000" }),
    ],
  },
  {
    // Pre-activation, PAST its 500,000 SOL floor — funded but not yet
    // activated. `MarketCard`'s footer offers a one-click launch here instead
    // of a stake input.
    dto: makeMarket("funded", {
      address: MKT_FUNDED,
      oracle: O_FUNDED,
      status: 0 /* Funding */,
      statusLabel: "Funding",
      totalContributed: base(650_000),
      openContributions: 2,
      slot: "1003",
    }),
    oracle: ORACLES[O_FUNDED],
    reserves: null,
    contributions: [
      makeContribution(MKT_FUNDED, "funded-a", 400_000, { slot: "1003" }),
      makeContribution(MKT_FUNDED, "funded-b", 250_000, { slot: "1002" }),
    ],
  },
  {
    // Fully activated + trading live — populated cYES/cNO reserves for the
    // trade UI + price chart (implied YES ≈ 40%).
    dto: makeMarket("active", {
      address: MKT_ACTIVE,
      oracle: O_ACTIVE,
      status: 1 /* Active */,
      statusLabel: "Active",
      totalContributed: base(620_000),
      openContributions: 2,
      question: fixturePubkey("active-question"),
      vault: fixturePubkey("active-vault"),
      yesMint: fixturePubkey("active-yes-mint"),
      noMint: fixturePubkey("active-no-mint"),
      amm: fixturePubkey("active-amm"),
      lpMint: fixturePubkey("active-lp-mint"),
      lpVault: fixturePubkey("active-lp-vault"),
      lpTotal: base(640_000),
      activationLp: base(620_000),
      activationContributed: base(620_000),
      grossLpTotal: base(640_000),
      slot: "1010",
    }),
    oracle: ORACLES[O_ACTIVE],
    reserves: { base: base(600_000), quote: base(400_000) },
    contributions: [
      makeContribution(MKT_ACTIVE, "active-a", 420_000, { slot: "1005" }),
      makeContribution(MKT_ACTIVE, "active-b", 200_000, { lateLpWhole: 20_000, slot: "1010" }),
    ],
  },
  {
    // Terminal + resolved — YES won (resolvedOption 0 == outcomeIndex 0).
    dto: makeMarket("resolved", {
      address: MKT_RESOLVED,
      oracle: O_RESOLVED,
      status: 2 /* Resolved */,
      statusLabel: "Resolved",
      totalContributed: base(500_000),
      openContributions: 1,
      feeCollected: 1,
      settled: 1,
      question: fixturePubkey("resolved-question"),
      vault: fixturePubkey("resolved-vault"),
      yesMint: fixturePubkey("resolved-yes-mint"),
      noMint: fixturePubkey("resolved-no-mint"),
      amm: fixturePubkey("resolved-amm"),
      lpMint: fixturePubkey("resolved-lp-mint"),
      lpVault: fixturePubkey("resolved-lp-vault"),
      lpTotal: base(500_000),
      activationLp: base(500_000),
      activationContributed: base(500_000),
      grossLpTotal: base(500_000),
      slot: "1020",
    }),
    oracle: ORACLES[O_RESOLVED],
    reserves: null,
    contributions: [
      makeContribution(MKT_RESOLVED, "resolved-a", 300_000, { claimed: true, slot: "1015" }),
      makeContribution(MKT_RESOLVED, "resolved-b", 200_000, { claimed: false, slot: "1020" }),
    ],
  },
  {
    // Terminal + resolved — NO won (resolvedOption 1 != outcomeIndex 0), the
    // complementary case to MKT_RESOLVED (which pays YES).
    dto: makeMarket("resolved-no", {
      address: MKT_RESOLVED_NO,
      oracle: O_RESOLVED_NO,
      status: 2 /* Resolved */,
      statusLabel: "Resolved",
      totalContributed: base(540_000),
      openContributions: 1,
      feeCollected: 1,
      settled: 1,
      question: fixturePubkey("resolved-no-question"),
      vault: fixturePubkey("resolved-no-vault"),
      yesMint: fixturePubkey("resolved-no-yes-mint"),
      noMint: fixturePubkey("resolved-no-no-mint"),
      amm: fixturePubkey("resolved-no-amm"),
      lpMint: fixturePubkey("resolved-no-lp-mint"),
      lpVault: fixturePubkey("resolved-no-lp-vault"),
      lpTotal: base(540_000),
      activationLp: base(540_000),
      activationContributed: base(540_000),
      grossLpTotal: base(540_000),
      slot: "1021",
    }),
    oracle: ORACLES[O_RESOLVED_NO],
    reserves: null,
    contributions: [
      makeContribution(MKT_RESOLVED_NO, "resolved-no-a", 340_000, { claimed: false, slot: "1016" }),
      makeContribution(MKT_RESOLVED_NO, "resolved-no-b", 200_000, { claimed: true, slot: "1021" }),
    ],
  },
  {
    // Terminal via a dead-end oracle — every leg pays (both cYES and cNO redeem).
    dto: makeMarket("void", {
      address: MKT_VOID,
      oracle: O_VOID,
      status: 3 /* Void */,
      statusLabel: "Void",
      totalContributed: base(480_000),
      openContributions: 1,
      feeBps: 0,
      feeCollected: 1, // `feeBps == 0` ⇒ stamped directly by `resolve_market`.
      settled: 1,
      question: fixturePubkey("void-question"),
      vault: fixturePubkey("void-vault"),
      yesMint: fixturePubkey("void-yes-mint"),
      noMint: fixturePubkey("void-no-mint"),
      amm: fixturePubkey("void-amm"),
      lpMint: fixturePubkey("void-lp-mint"),
      lpVault: fixturePubkey("void-lp-vault"),
      lpTotal: base(480_000),
      activationLp: base(480_000),
      activationContributed: base(480_000),
      grossLpTotal: base(480_000),
      slot: "1030",
    }),
    oracle: ORACLES[O_VOID],
    reserves: null,
    contributions: [makeContribution(MKT_VOID, "void-a", 480_000, { claimed: false, slot: "1025" })],
  },
  {
    // Never activated — cancelled once its oracle dead-ended; refunds pending.
    dto: makeMarket("cancelled", {
      address: MKT_CANCELLED,
      oracle: O_CANCELLED,
      status: 4 /* Cancelled */,
      statusLabel: "Cancelled",
      totalContributed: base(150_000),
      openContributions: 2,
      slot: "1004",
    }),
    oracle: ORACLES[O_CANCELLED],
    reserves: null,
    contributions: [
      makeContribution(MKT_CANCELLED, "cancelled-a", 100_000, { claimed: false, slot: "1002" }),
      makeContribution(MKT_CANCELLED, "cancelled-b", 50_000, { claimed: true, slot: "1004" }),
    ],
  },
  {
    // Categorical outcome 0/3 — already resolved (loses to option 2).
    dto: makeMarket("cat0", {
      address: MKT_CAT_0,
      oracle: O_CATEGORICAL,
      status: 2 /* Resolved */,
      statusLabel: "Resolved",
      outcomeIndex: 0,
      totalContributed: base(300_000),
      openContributions: 1,
      feeCollected: 1,
      settled: 1,
      question: fixturePubkey("cat0-question"),
      vault: fixturePubkey("cat0-vault"),
      yesMint: fixturePubkey("cat0-yes-mint"),
      noMint: fixturePubkey("cat0-no-mint"),
      amm: fixturePubkey("cat0-amm"),
      lpMint: fixturePubkey("cat0-lp-mint"),
      lpVault: fixturePubkey("cat0-lp-vault"),
      lpTotal: base(300_000),
      activationLp: base(300_000),
      activationContributed: base(300_000),
      grossLpTotal: base(300_000),
      slot: "1040",
    }),
    oracle: ORACLES[O_CATEGORICAL],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_0, "cat0-a", 300_000, { claimed: true, slot: "1035" })],
  },
  {
    // Categorical outcome 1/3 — oracle terminal, but this sub-market's own
    // `resolve_market` crank hasn't run yet: still `Active`, still trading.
    dto: makeMarket("cat1", {
      address: MKT_CAT_1,
      oracle: O_CATEGORICAL,
      status: 1 /* Active */,
      statusLabel: "Active",
      outcomeIndex: 1,
      totalContributed: base(250_000),
      openContributions: 1,
      question: fixturePubkey("cat1-question"),
      vault: fixturePubkey("cat1-vault"),
      yesMint: fixturePubkey("cat1-yes-mint"),
      noMint: fixturePubkey("cat1-no-mint"),
      amm: fixturePubkey("cat1-amm"),
      lpMint: fixturePubkey("cat1-lp-mint"),
      lpVault: fixturePubkey("cat1-lp-vault"),
      lpTotal: base(250_000),
      activationLp: base(250_000),
      activationContributed: base(250_000),
      grossLpTotal: base(250_000),
      slot: "1036",
    }),
    oracle: ORACLES[O_CATEGORICAL],
    reserves: { base: base(350_000), quote: base(150_000) },
    contributions: [makeContribution(MKT_CAT_1, "cat1-a", 250_000, { slot: "1033" })],
  },
  {
    // Categorical outcome 2/3 — the winner (resolvedOption == 2 == outcomeIndex).
    dto: makeMarket("cat2", {
      address: MKT_CAT_2,
      oracle: O_CATEGORICAL,
      status: 2 /* Resolved */,
      statusLabel: "Resolved",
      outcomeIndex: 2,
      totalContributed: base(200_000),
      openContributions: 1,
      feeCollected: 1,
      settled: 1,
      question: fixturePubkey("cat2-question"),
      vault: fixturePubkey("cat2-vault"),
      yesMint: fixturePubkey("cat2-yes-mint"),
      noMint: fixturePubkey("cat2-no-mint"),
      amm: fixturePubkey("cat2-amm"),
      lpMint: fixturePubkey("cat2-lp-mint"),
      lpVault: fixturePubkey("cat2-lp-vault"),
      lpTotal: base(200_000),
      activationLp: base(200_000),
      activationContributed: base(200_000),
      grossLpTotal: base(200_000),
      slot: "1041",
    }),
    oracle: ORACLES[O_CATEGORICAL],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_2, "cat2-a", 200_000, { claimed: false, slot: "1038" })],
  },
  {
    // Funding categorical outcome 0/3 — barely started.
    dto: makeMarket("cat-funding-0", {
      address: MKT_CAT_FUNDING_0,
      oracle: O_CATEGORICAL_FUNDING,
      status: 0 /* Funding */,
      statusLabel: "Funding",
      outcomeIndex: 0,
      totalContributed: base(5_000),
      openContributions: 1,
      slot: "1050",
    }),
    oracle: ORACLES[O_CATEGORICAL_FUNDING],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_FUNDING_0, "cat-funding-0-a", 5_000, { slot: "1050" })],
  },
  {
    // Funding categorical outcome 1/3 — partially funded, still under floor.
    dto: makeMarket("cat-funding-1", {
      address: MKT_CAT_FUNDING_1,
      oracle: O_CATEGORICAL_FUNDING,
      status: 0 /* Funding */,
      statusLabel: "Funding",
      outcomeIndex: 1,
      totalContributed: base(80_000),
      openContributions: 1,
      slot: "1051",
    }),
    oracle: ORACLES[O_CATEGORICAL_FUNDING],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_FUNDING_1, "cat-funding-1-a", 80_000, { slot: "1051" })],
  },
  {
    // Funding categorical outcome 2/3 — partially funded, still under floor.
    dto: makeMarket("cat-funding-2", {
      address: MKT_CAT_FUNDING_2,
      oracle: O_CATEGORICAL_FUNDING,
      status: 0 /* Funding */,
      statusLabel: "Funding",
      outcomeIndex: 2,
      totalContributed: base(120_000),
      openContributions: 1,
      slot: "1052",
    }),
    oracle: ORACLES[O_CATEGORICAL_FUNDING],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_FUNDING_2, "cat-funding-2-a", 120_000, { slot: "1052" })],
  },
  {
    // Funded categorical outcome 0/3 — past its own 500,000 SOL floor,
    // awaiting activation (the categorical analogue of MKT_FUNDED).
    dto: makeMarket("cat-funded-0", {
      address: MKT_CAT_FUNDED_0,
      oracle: O_CATEGORICAL_FUNDED,
      status: 0 /* Funding */,
      statusLabel: "Funding",
      outcomeIndex: 0,
      totalContributed: base(560_000),
      openContributions: 1,
      slot: "1060",
    }),
    oracle: ORACLES[O_CATEGORICAL_FUNDED],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_FUNDED_0, "cat-funded-0-a", 560_000, { slot: "1060" })],
  },
  {
    // Funded categorical outcome 1/3 — past its own floor.
    dto: makeMarket("cat-funded-1", {
      address: MKT_CAT_FUNDED_1,
      oracle: O_CATEGORICAL_FUNDED,
      status: 0 /* Funding */,
      statusLabel: "Funding",
      outcomeIndex: 1,
      totalContributed: base(510_000),
      openContributions: 1,
      slot: "1061",
    }),
    oracle: ORACLES[O_CATEGORICAL_FUNDED],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_FUNDED_1, "cat-funded-1-a", 510_000, { slot: "1061" })],
  },
  {
    // Funded categorical outcome 2/3 — past its own floor.
    dto: makeMarket("cat-funded-2", {
      address: MKT_CAT_FUNDED_2,
      oracle: O_CATEGORICAL_FUNDED,
      status: 0 /* Funding */,
      statusLabel: "Funding",
      outcomeIndex: 2,
      totalContributed: base(700_000),
      openContributions: 1,
      slot: "1062",
    }),
    oracle: ORACLES[O_CATEGORICAL_FUNDED],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_FUNDED_2, "cat-funded-2-a", 700_000, { slot: "1062" })],
  },
  {
    // Active categorical outcome 0/3 — activated, trading, oracle unresolved
    // (the categorical analogue of MKT_ACTIVE — no winner determined at all yet,
    // unlike O_CATEGORICAL which already has a resolvedOption).
    dto: makeMarket("cat-active-0", {
      address: MKT_CAT_ACTIVE_0,
      oracle: O_CATEGORICAL_ACTIVE,
      status: 1 /* Active */,
      statusLabel: "Active",
      outcomeIndex: 0,
      totalContributed: base(520_000),
      openContributions: 1,
      question: fixturePubkey("cat-active-0-question"),
      vault: fixturePubkey("cat-active-0-vault"),
      yesMint: fixturePubkey("cat-active-0-yes-mint"),
      noMint: fixturePubkey("cat-active-0-no-mint"),
      amm: fixturePubkey("cat-active-0-amm"),
      lpMint: fixturePubkey("cat-active-0-lp-mint"),
      lpVault: fixturePubkey("cat-active-0-lp-vault"),
      lpTotal: base(520_000),
      activationLp: base(520_000),
      activationContributed: base(520_000),
      grossLpTotal: base(520_000),
      slot: "1070",
    }),
    oracle: ORACLES[O_CATEGORICAL_ACTIVE],
    reserves: { base: base(300_000), quote: base(220_000) },
    contributions: [makeContribution(MKT_CAT_ACTIVE_0, "cat-active-0-a", 520_000, { slot: "1070" })],
  },
  {
    // Active categorical outcome 1/3.
    dto: makeMarket("cat-active-1", {
      address: MKT_CAT_ACTIVE_1,
      oracle: O_CATEGORICAL_ACTIVE,
      status: 1 /* Active */,
      statusLabel: "Active",
      outcomeIndex: 1,
      totalContributed: base(500_000),
      openContributions: 1,
      question: fixturePubkey("cat-active-1-question"),
      vault: fixturePubkey("cat-active-1-vault"),
      yesMint: fixturePubkey("cat-active-1-yes-mint"),
      noMint: fixturePubkey("cat-active-1-no-mint"),
      amm: fixturePubkey("cat-active-1-amm"),
      lpMint: fixturePubkey("cat-active-1-lp-mint"),
      lpVault: fixturePubkey("cat-active-1-lp-vault"),
      lpTotal: base(500_000),
      activationLp: base(500_000),
      activationContributed: base(500_000),
      grossLpTotal: base(500_000),
      slot: "1071",
    }),
    oracle: ORACLES[O_CATEGORICAL_ACTIVE],
    reserves: { base: base(180_000), quote: base(320_000) },
    contributions: [makeContribution(MKT_CAT_ACTIVE_1, "cat-active-1-a", 500_000, { slot: "1071" })],
  },
  {
    // Active categorical outcome 2/3.
    dto: makeMarket("cat-active-2", {
      address: MKT_CAT_ACTIVE_2,
      oracle: O_CATEGORICAL_ACTIVE,
      status: 1 /* Active */,
      statusLabel: "Active",
      outcomeIndex: 2,
      totalContributed: base(540_000),
      openContributions: 1,
      question: fixturePubkey("cat-active-2-question"),
      vault: fixturePubkey("cat-active-2-vault"),
      yesMint: fixturePubkey("cat-active-2-yes-mint"),
      noMint: fixturePubkey("cat-active-2-no-mint"),
      amm: fixturePubkey("cat-active-2-amm"),
      lpMint: fixturePubkey("cat-active-2-lp-mint"),
      lpVault: fixturePubkey("cat-active-2-lp-vault"),
      lpTotal: base(540_000),
      activationLp: base(540_000),
      activationContributed: base(540_000),
      grossLpTotal: base(540_000),
      slot: "1072",
    }),
    oracle: ORACLES[O_CATEGORICAL_ACTIVE],
    reserves: { base: base(260_000), quote: base(280_000) },
    contributions: [makeContribution(MKT_CAT_ACTIVE_2, "cat-active-2-a", 540_000, { slot: "1072" })],
  },
  {
    // Void categorical outcome 0/3 — activated, then the oracle dead-ended:
    // every leg pays (both cYES/cNO redeem), the categorical analogue of MKT_VOID.
    dto: makeMarket("cat-void-0", {
      address: MKT_CAT_VOID_0,
      oracle: O_CATEGORICAL_VOID,
      status: 3 /* Void */,
      statusLabel: "Void",
      outcomeIndex: 0,
      totalContributed: base(510_000),
      openContributions: 1,
      feeBps: 0,
      feeCollected: 1,
      settled: 1,
      question: fixturePubkey("cat-void-0-question"),
      vault: fixturePubkey("cat-void-0-vault"),
      yesMint: fixturePubkey("cat-void-0-yes-mint"),
      noMint: fixturePubkey("cat-void-0-no-mint"),
      amm: fixturePubkey("cat-void-0-amm"),
      lpMint: fixturePubkey("cat-void-0-lp-mint"),
      lpVault: fixturePubkey("cat-void-0-lp-vault"),
      lpTotal: base(510_000),
      activationLp: base(510_000),
      activationContributed: base(510_000),
      grossLpTotal: base(510_000),
      slot: "1080",
    }),
    oracle: ORACLES[O_CATEGORICAL_VOID],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_VOID_0, "cat-void-0-a", 510_000, { slot: "1075" })],
  },
  {
    // Void categorical outcome 1/3.
    dto: makeMarket("cat-void-1", {
      address: MKT_CAT_VOID_1,
      oracle: O_CATEGORICAL_VOID,
      status: 3 /* Void */,
      statusLabel: "Void",
      outcomeIndex: 1,
      totalContributed: base(505_000),
      openContributions: 1,
      feeBps: 0,
      feeCollected: 1,
      settled: 1,
      question: fixturePubkey("cat-void-1-question"),
      vault: fixturePubkey("cat-void-1-vault"),
      yesMint: fixturePubkey("cat-void-1-yes-mint"),
      noMint: fixturePubkey("cat-void-1-no-mint"),
      amm: fixturePubkey("cat-void-1-amm"),
      lpMint: fixturePubkey("cat-void-1-lp-mint"),
      lpVault: fixturePubkey("cat-void-1-lp-vault"),
      lpTotal: base(505_000),
      activationLp: base(505_000),
      activationContributed: base(505_000),
      grossLpTotal: base(505_000),
      slot: "1081",
    }),
    oracle: ORACLES[O_CATEGORICAL_VOID],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_VOID_1, "cat-void-1-a", 505_000, { slot: "1076" })],
  },
  {
    // Void categorical outcome 2/3.
    dto: makeMarket("cat-void-2", {
      address: MKT_CAT_VOID_2,
      oracle: O_CATEGORICAL_VOID,
      status: 3 /* Void */,
      statusLabel: "Void",
      outcomeIndex: 2,
      totalContributed: base(515_000),
      openContributions: 1,
      feeBps: 0,
      feeCollected: 1,
      settled: 1,
      question: fixturePubkey("cat-void-2-question"),
      vault: fixturePubkey("cat-void-2-vault"),
      yesMint: fixturePubkey("cat-void-2-yes-mint"),
      noMint: fixturePubkey("cat-void-2-no-mint"),
      amm: fixturePubkey("cat-void-2-amm"),
      lpMint: fixturePubkey("cat-void-2-lp-mint"),
      lpVault: fixturePubkey("cat-void-2-lp-vault"),
      lpTotal: base(515_000),
      activationLp: base(515_000),
      activationContributed: base(515_000),
      grossLpTotal: base(515_000),
      slot: "1082",
    }),
    oracle: ORACLES[O_CATEGORICAL_VOID],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_VOID_2, "cat-void-2-a", 515_000, { slot: "1077" })],
  },
  {
    // Cancelled categorical outcome 0/3 — never activated, cancelled once the
    // oracle dead-ended; refunds pending (the categorical analogue of
    // MKT_CANCELLED).
    dto: makeMarket("cat-cancelled-0", {
      address: MKT_CAT_CANCELLED_0,
      oracle: O_CATEGORICAL_CANCELLED,
      status: 4 /* Cancelled */,
      statusLabel: "Cancelled",
      outcomeIndex: 0,
      totalContributed: base(60_000),
      openContributions: 1,
      slot: "1090",
    }),
    oracle: ORACLES[O_CATEGORICAL_CANCELLED],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_CANCELLED_0, "cat-cancelled-0-a", 60_000, { claimed: false, slot: "1090" })],
  },
  {
    // Cancelled categorical outcome 1/3.
    dto: makeMarket("cat-cancelled-1", {
      address: MKT_CAT_CANCELLED_1,
      oracle: O_CATEGORICAL_CANCELLED,
      status: 4 /* Cancelled */,
      statusLabel: "Cancelled",
      outcomeIndex: 1,
      totalContributed: base(45_000),
      openContributions: 1,
      slot: "1091",
    }),
    oracle: ORACLES[O_CATEGORICAL_CANCELLED],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_CANCELLED_1, "cat-cancelled-1-a", 45_000, { claimed: false, slot: "1091" })],
  },
  {
    // Cancelled categorical outcome 2/3.
    dto: makeMarket("cat-cancelled-2", {
      address: MKT_CAT_CANCELLED_2,
      oracle: O_CATEGORICAL_CANCELLED,
      status: 4 /* Cancelled */,
      statusLabel: "Cancelled",
      outcomeIndex: 2,
      totalContributed: base(70_000),
      openContributions: 1,
      slot: "1092",
    }),
    oracle: ORACLES[O_CATEGORICAL_CANCELLED],
    reserves: null,
    contributions: [makeContribution(MKT_CAT_CANCELLED_2, "cat-cancelled-2-a", 70_000, { claimed: true, slot: "1092" })],
  },
];

// --- large (9-option) categorical groups ----------------------------------
//
// Hand-writing 9 outcomes each would be almost entirely repetitive boilerplate
// (unlike the 2/3-outcome groups above, each of which tells a specific,
// curated story) — generated instead, parameterized just enough to vary
// realistically across outcomes (staggered funding amounts, distinct reserve
// splits, one still-Active straggler post-resolution).

/** A 9-outcome group, every leg still Funding, staggered under-floor amounts
 *  (10,000 .. 330,000 of a 500,000 floor) — the large-scale analogue of
 *  O_CATEGORICAL_FUNDING. */
function makeCat9FundingFixtures(): MarketFixture[] {
  return Array.from({ length: 9 }, (_, i) => {
    const address = fixturePubkey(`market-cat9-funding-outcome-${i}`);
    const contributedWhole = 10_000 + i * 40_000; // 10k, 50k, 90k, ... 330k
    const slot = String(1100 + i);
    return {
      dto: makeMarket(`cat9-funding-${i}`, {
        address,
        oracle: O_CAT9_FUNDING,
        status: 0 /* Funding */,
        statusLabel: "Funding",
        outcomeIndex: i,
        totalContributed: base(contributedWhole),
        openContributions: 1,
        slot,
      }),
      oracle: ORACLES[O_CAT9_FUNDING],
      reserves: null,
      contributions: [makeContribution(address, `cat9-funding-${i}-a`, contributedWhole, { slot })],
    };
  });
}

/** A 9-outcome group resolved to option 4: outcomes 0-3 and 5-8 Resolved
 *  (losers), outcome 4 Resolved (the winner), EXCEPT outcome 7 — its own
 *  `resolve_market` crank hasn't run yet, so it's still `Active` — the
 *  large-scale analogue of O_CATEGORICAL's "resolution pending" realism. */
function makeCat9ResolvedFixtures(): MarketFixture[] {
  const PENDING = 7;
  return Array.from({ length: 9 }, (_, i) => {
    const address = fixturePubkey(`market-cat9-resolved-outcome-${i}`);
    const contributedWhole = 400_000 + i * 15_000; // mild spread, 400k..520k
    const slot = String(1200 + i);
    const pending = i === PENDING;
    return {
      dto: makeMarket(`cat9-resolved-${i}`, {
        address,
        oracle: O_CAT9_RESOLVED,
        status: pending ? 1 /* Active */ : 2 /* Resolved */,
        statusLabel: pending ? "Active" : "Resolved",
        outcomeIndex: i,
        totalContributed: base(contributedWhole),
        openContributions: 1,
        feeCollected: pending ? 0 : 1,
        settled: pending ? 0 : 1,
        question: fixturePubkey(`cat9-resolved-${i}-question`),
        vault: fixturePubkey(`cat9-resolved-${i}-vault`),
        yesMint: fixturePubkey(`cat9-resolved-${i}-yes-mint`),
        noMint: fixturePubkey(`cat9-resolved-${i}-no-mint`),
        amm: fixturePubkey(`cat9-resolved-${i}-amm`),
        lpMint: fixturePubkey(`cat9-resolved-${i}-lp-mint`),
        lpVault: fixturePubkey(`cat9-resolved-${i}-lp-vault`),
        lpTotal: base(contributedWhole),
        activationLp: base(contributedWhole),
        activationContributed: base(contributedWhole),
        grossLpTotal: base(contributedWhole),
        slot,
      }),
      oracle: ORACLES[O_CAT9_RESOLVED],
      // Only the still-Active straggler carries live reserves — a Resolved leg
      // has none (mirrors MKT_CAT_2 / cat0/cat2 above).
      reserves: pending ? { base: base(240_000), quote: base(260_000) } : null,
      contributions: [makeContribution(address, `cat9-resolved-${i}-a`, contributedWhole, { slot })],
    };
  });
}

const FIXTURES: MarketFixture[] = [
  ...HAND_FIXTURES,
  ...makeCat9FundingFixtures(),
  ...makeCat9ResolvedFixtures(),
];

const BY_PUBKEY = new Map<string, MarketFixture>(FIXTURES.map((f) => [f.dto.address, f]));

/** Every fixture market's pubkey, in fixture-declaration order. */
export const MOCK_MARKET_PUBKEYS: string[] = FIXTURES.map((f) => f.dto.address);

/** Every fixture `MarketDto` (the `GET /api/markets` mock). */
export function mockMarketDtos(): MarketDto[] {
  return FIXTURES.map((f) => f.dto);
}

/** The `GET /api/markets/{pubkey}` mock — `null` for an unknown pubkey (mirrors a 404). */
export function mockMarketDetailFor(pubkey: string): MarketDetailDto | null {
  const fixture = BY_PUBKEY.get(pubkey);
  if (!fixture) return null;
  return {
    market: fixture.dto,
    contributions: fixture.contributions,
    oracle: fixture.oracle,
    reserves: fixture.reserves,
  };
}

// --- candles ---------------------------------------------------------------

/**
 * `mulberry32` — a tiny, dependency-free, deterministic PRNG (given the same
 * 32-bit seed it always produces the same sequence). No `Math.random`.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed anchor for candle timestamps — NOT wall-clock time, so output is reproducible. */
const CANDLE_EPOCH = 1_700_000_000;

/**
 * A deterministic synthetic OHLC series of implied YES probability, mean-
 * reverting around 0.5. Same `(pubkey, intervalSecs, limit)` always produces the
 * same candles' VALUES — seeded by a hash of the inputs, not the wall clock or
 * `Math.random`. `limit` candles spaced `intervalSecs` apart, oldest first.
 *
 * Timestamps are anchored to `nowSecs` when given: the last candle lands on the
 * `intervalSecs`-aligned bucket at/before `nowSecs`, walking backwards `limit`
 * candles from there. When `nowSecs` is omitted, timestamps fall back to the
 * fixed, non-wall-clock `CANDLE_EPOCH` anchor so callers that need fully
 * reproducible output (e.g. unit tests) keep getting it. Either way the OHLC
 * values themselves are the same deterministic random walk — only the time
 * axis moves.
 */
export function mockCandlesFor(pubkey: string, intervalSecs: number, limit: number, nowSecs?: number): CandleDto[] {
  const rand = mulberry32(fnv1a(`${pubkey}:${intervalSecs}`));
  const lastBucket = nowSecs === undefined ? CANDLE_EPOCH + (limit - 1) * intervalSecs : Math.floor(nowSecs / intervalSecs) * intervalSecs;
  const startBucket = lastBucket - (limit - 1) * intervalSecs;
  const candles: CandleDto[] = [];
  let price = 0.5;
  for (let i = 0; i < limit; i++) {
    const open = price;
    const drift = (rand() - 0.5) * 0.04 + (0.5 - open) * 0.02; // gentle mean reversion
    const close = Math.min(0.98, Math.max(0.02, open + drift));
    const wickUp = rand() * 0.01;
    const wickDown = rand() * 0.01;
    const high = Math.min(0.99, Math.max(open, close) + wickUp);
    const low = Math.max(0.01, Math.min(open, close) - wickDown);
    candles.push({ time: startBucket + i * intervalSecs, open, high, low, close });
    price = close;
  }
  return candles;
}

// --- config ------------------------------------------------------------------

/** The `GET /api/config` mock — the program `Config` singleton. The
 *  activity-scaled min-liquidity ramp is DISABLED (`minLiquidityMax ==
 *  minLiquidity`) — the mock harness doesn't need a live demand signal. */
export function mockConfigDto(): ConfigDto {
  const minLiquidity = base(500_000);
  return {
    address: fixturePubkey("config"),
    authority: fixturePubkey("futarchy-authority"),
    baseMint: BASE_MINT,
    minLiquidity,
    bump: 254,
    feeBps: 250,
    feeDestination: fixturePubkey("fee-destination"),
    marketCreationEma: "0",
    lastMarketCreationUnix: "0",
    minLiquidityEmaThreshold: "15000000000",
    minLiquidityEmaCap: "1443000000000",
    minLiquidityMax: minLiquidity,
    slot: "999",
  };
}
