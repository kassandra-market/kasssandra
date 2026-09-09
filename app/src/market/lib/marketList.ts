/**
 * Pure, side-effect-free browse helpers for the `/markets` list. Filters,
 * sorts, and stats are over market groups only (no oracle-dispute stages).
 */
import { MarketStatus } from '@kassandra-market/markets'
import type { MarketSummary, OracleGroup } from '../data/markets'
import { groupStatus, statusLabel } from './marketView'

/** Lifecycle stages shown as filter chips. */
export type MarketFilter = 'all' | 'funding' | 'active' | 'resolved' | 'closed'

/** How the grid is ordered: biggest TVL first, or lifecycle order. */
export type MarketSort = 'value' | 'stage'

const STAGE_ORDER: Exclude<MarketFilter, 'all'>[] = ['funding', 'active', 'resolved', 'closed']

/** Map a market group to its collapsed browse stage. */
export function stageOf(group: OracleGroup): Exclude<MarketFilter, 'all'> {
  switch (groupStatus(group.markets)) {
    case MarketStatus.Funding:
      return 'funding'
    case MarketStatus.Active:
      return 'active'
    case MarketStatus.Resolved:
      return 'resolved'
    default:
      return 'closed'
  }
}

/** Sum of `totalContributed` across a group's sub-markets. */
export function valueOf(group: OracleGroup): bigint {
  return group.markets.reduce((sum, m) => sum + m.market.totalContributed, 0n)
}

export interface MarketCounts {
  funding: number
  active: number
  resolved: number
  closed: number
  total: number
}

/** Per-stage counts from the full (pre-search, pre-filter) group set. */
export function deriveMarketCounts(groups: OracleGroup[]): MarketCounts {
  const counts: MarketCounts = { funding: 0, active: 0, resolved: 0, closed: 0, total: 0 }
  for (const group of groups) {
    counts[stageOf(group)] += 1
    counts.total += 1
  }
  return counts
}

export interface MarketStats {
  /** Sum of `totalContributed` across every loaded market, any status. */
  marketTvl: bigint
}

export function deriveMarketStats(markets: MarketSummary[]): MarketStats {
  return {
    marketTvl: markets.reduce((sum, m) => sum + m.market.totalContributed, 0n),
  }
}

export function filterByStage(groups: OracleGroup[], filter: MarketFilter): OracleGroup[] {
  if (filter === 'all') return groups.slice()
  return groups.filter((g) => stageOf(g) === filter)
}

function cmpValueDesc(a: OracleGroup, b: OracleGroup): number {
  const va = valueOf(a)
  const vb = valueOf(b)
  return vb > va ? 1 : vb < va ? -1 : 0
}

function cmpStage(a: OracleGroup, b: OracleGroup): number {
  const diff = STAGE_ORDER.indexOf(stageOf(a)) - STAGE_ORDER.indexOf(stageOf(b))
  return diff !== 0 ? diff : cmpValueDesc(a, b)
}

export function sortMarkets(groups: OracleGroup[], by: MarketSort): OracleGroup[] {
  const out = groups.slice()
  out.sort(by === 'stage' ? cmpStage : cmpValueDesc)
  return out
}

/** Case-insensitive match against status, optional subject, and addresses. */
export function matchesMarketQuery(group: OracleGroup, query: string, subject?: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  const haystack = `${statusLabel(groupStatus(group.markets))} ${subject ?? ''} ${group.oracle} ${group.markets
    .map((m) => m.pubkey)
    .join(' ')}`
  return haystack.toLowerCase().includes(q)
}
