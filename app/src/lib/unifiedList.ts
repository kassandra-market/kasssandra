/**
 * Pure, side-effect-free merge of the oracle list and the market list into ONE
 * browsable set — the `/markets` unified list's data model. An oracle is
 * represented EXACTLY ONCE: as a `market` entry (its {@link OracleGroup}) once
 * it has ≥1 bound prediction market, else as a bare `oracle` entry. No React,
 * no fetching — the page composes this over the already-fetched
 * `useOracles()` + `useMarkets()` results.
 */
import { MarketStatus } from '@kassandra-market/markets'
import type { OracleSummary } from '../data/oracles'
import type { MarketSummary, OracleGroup } from '../market/data/markets'
import { groupStatus, statusLabel } from '../market/lib/marketView'
import { deriveStats, oracleBonds, phaseGroup, type OracleStats } from './oracleStats'
import { phaseView } from './oracleView'

export type UnifiedEntry =
  | { kind: 'oracle'; summary: OracleSummary }
  | { kind: 'market'; group: OracleGroup }

/**
 * A coarse lifecycle stage spanning BOTH state machines: the first four mirror
 * `PhaseGroup` for an oracle with no market yet; the last four are a market
 * group's collapsed {@link groupStatus} once one exists (which supersedes the
 * oracle's own phase as the entry's headline state — the market is what's
 * actionable from here on).
 */
export type UnifiedStage =
  | 'proposal'
  | 'inDispute'
  | 'aiClaim'
  | 'challenge'
  | 'funding'
  | 'active'
  | 'resolved'
  | 'closed'

/** A filter selection: any single {@link UnifiedStage} shown as a chip, or `all`. */
export type UnifiedFilter = 'all' | UnifiedStage

/** How the grid is ordered: biggest capital-at-stake first, or lifecycle order. */
export type UnifiedSort = 'value' | 'stage'

/** Lifecycle order for the `stage` sort — earliest-opened to terminal. */
const STAGE_ORDER: UnifiedStage[] = [
  'proposal',
  'inDispute',
  'aiClaim',
  'challenge',
  'funding',
  'active',
  'resolved',
  'closed',
]

/** The base58 oracle pubkey an entry is keyed on — stable across both kinds. */
export function entryOracleKey(entry: UnifiedEntry): string {
  return entry.kind === 'oracle' ? entry.summary.pubkey : entry.group.oracle
}

/** Map an entry to its {@link UnifiedStage}. */
export function stageOf(entry: UnifiedEntry): UnifiedStage {
  if (entry.kind === 'oracle') {
    const group = phaseGroup(entry.summary.oracle.phase)
    return group === 'invalidDeadend' ? 'closed' : group
  }
  switch (groupStatus(entry.group.markets)) {
    case MarketStatus.Funding:
      return 'funding'
    case MarketStatus.Active:
      return 'active'
    case MarketStatus.Resolved:
      return 'resolved'
    default:
      // Void, Cancelled.
      return 'closed'
  }
}

/**
 * Capital-at-stake, for the "biggest first" sort: an oracle-only entry's bond
 * economics ({@link oracleBonds}), or a market group's total contributed (TVL,
 * summed across its sub-markets). Different economics, same "how much is
 * riding on this" intent — both raw KASS base units.
 */
export function valueOf(entry: UnifiedEntry): bigint {
  if (entry.kind === 'oracle') return oracleBonds(entry.summary.oracle)
  return entry.group.markets.reduce((sum, m) => sum + m.market.totalContributed, 0n)
}

/**
 * Merge an oracle list and a market-group list into one entry per oracle:
 * every {@link OracleGroup} becomes a `market` entry; every oracle NOT backing
 * one of those groups becomes a bare `oracle` entry. Market entries lead (the
 * more "resolved into product" state), oracle-only entries follow.
 */
export function buildUnifiedEntries(
  oracles: OracleSummary[],
  groups: OracleGroup[],
): UnifiedEntry[] {
  const withMarket = new Set(groups.map((g) => g.oracle))
  const marketEntries: UnifiedEntry[] = groups.map((group) => ({ kind: 'market', group }))
  const oracleEntries: UnifiedEntry[] = oracles
    .filter((o) => !withMarket.has(o.pubkey))
    .map((summary) => ({ kind: 'oracle', summary }))
  return [...marketEntries, ...oracleEntries]
}

/** Counts per {@link UnifiedStage} plus a grand total — powers the filter chips. */
export interface UnifiedCounts {
  proposal: number
  inDispute: number
  aiClaim: number
  challenge: number
  funding: number
  active: number
  resolved: number
  closed: number
  total: number
}

/** Derive per-stage counts from the full (pre-search, pre-filter) entry set. */
export function deriveUnifiedCounts(entries: UnifiedEntry[]): UnifiedCounts {
  const counts: UnifiedCounts = {
    proposal: 0,
    inDispute: 0,
    aiClaim: 0,
    challenge: 0,
    funding: 0,
    active: 0,
    resolved: 0,
    closed: 0,
    total: 0,
  }
  for (const entry of entries) {
    counts[stageOf(entry)] += 1
    counts.total += 1
  }
  return counts
}

/** Keep only the entries in a given stage; `all` is the identity. Pure. */
export function filterByStage(entries: UnifiedEntry[], filter: UnifiedFilter): UnifiedEntry[] {
  if (filter === 'all') return entries.slice()
  return entries.filter((e) => stageOf(e) === filter)
}

function cmpValueDesc(a: UnifiedEntry, b: UnifiedEntry): number {
  const va = valueOf(a)
  const vb = valueOf(b)
  return vb > va ? 1 : vb < va ? -1 : 0
}

function cmpStage(a: UnifiedEntry, b: UnifiedEntry): number {
  const diff = STAGE_ORDER.indexOf(stageOf(a)) - STAGE_ORDER.indexOf(stageOf(b))
  return diff !== 0 ? diff : cmpValueDesc(a, b)
}

/** Order entries by the chosen key. Pure — returns a new array. */
export function sortUnified(entries: UnifiedEntry[], by: UnifiedSort): UnifiedEntry[] {
  const out = entries.slice()
  out.sort(by === 'stage' ? cmpStage : cmpValueDesc)
  return out
}

/**
 * Case-insensitive text match against an entry's stage label, on-chain subject
 * (when loaded), and its address(es) — the oracle pubkey, plus every
 * sub-market pubkey for a market entry.
 */
export function matchesUnifiedQuery(entry: UnifiedEntry, query: string, subject?: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  const haystack =
    entry.kind === 'oracle'
      ? `${phaseView(entry.summary.oracle.phase).label} ${subject ?? ''} ${entry.summary.pubkey}`
      : `${statusLabel(groupStatus(entry.group.markets))} ${subject ?? ''} ${entry.group.oracle} ${entry.group.markets
          .map((m) => m.pubkey)
          .join(' ')}`
  return haystack.toLowerCase().includes(q)
}

/** The dashboard headline + breakdown, spanning both oracle bonds and market TVL. */
export interface CombinedStats extends OracleStats {
  /** Sum of `totalContributed` across every loaded market, any status. */
  marketTvl: bigint
}

/**
 * Derive the combined stats strip from the FULL (unfiltered) oracle + market
 * datasets — oracle bond economics ({@link deriveStats}) plus market TVL. The
 * headline ("value at stake") is `bondsAtRisk + marketTvl`, computed by the
 * caller from these two fields (kept separate here since they're genuinely
 * different economics, not because the token differs).
 */
export function deriveCombinedStats(
  oracles: OracleSummary[],
  markets: MarketSummary[],
): CombinedStats {
  const oracleStats = deriveStats(oracles)
  const marketTvl = markets.reduce((sum, m) => sum + m.market.totalContributed, 0n)
  return { ...oracleStats, marketTvl }
}
