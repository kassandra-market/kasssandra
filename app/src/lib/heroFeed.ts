/**
 * Pure, side-effect-free selection + mapping for the landing hero's live cards:
 * the top-k markets by liquidity, mapped into a flat {@link HeroCard} view
 * model. No React, no fetching — the Hero component feeds in what `useMarkets()`
 * already loaded, so this stays unit-testable offline.
 */
import type { MarketSummary } from '../market/data/markets'
import type { OracleMetaView } from '../market/lib/meta'
import { formatSol, impliedYesProbability, formatProbability, statusLabel, statusTone, truncateMiddle } from '../market/lib/marketView'

/** Chip tone set spanning the market status tones. */
export type HeroTone = 'neutral' | 'info' | 'accent' | 'ember' | 'confirmed' | 'muted'

/** Flat view model for one hero constellation card. */
export interface HeroCard {
  /** Stable React key (the market PDA). */
  id: string
  kind: 'market'
  /** The GPT Subject PDA (`market.oracle`). */
  subjectId: string
  /** Route to the market detail. */
  href: string
  /** Optional client-side title, or a truncated pubkey fallback. */
  title: string
  /** Status label for the chip. */
  status: string
  tone: HeroTone
  /** The highlighted figure (YES probability, or liquidity). */
  metricAccent: string
  /** The muted trailing text after the accent. */
  metricLabel: string
}

/** Default number of markets to feature. */
export const HERO_K = 6

function descBig(a: bigint, b: bigint): number {
  return a < b ? 1 : a > b ? -1 : 0
}

/** Top-k markets by total liquidity contributed, descending. */
export function rankMarkets(markets: readonly MarketSummary[], k = HERO_K): MarketSummary[] {
  return [...markets]
    .sort((a, b) => descBig(a.market.totalContributed, b.market.totalContributed))
    .slice(0, k)
}

/** The subject PDAs whose labels we might want for the featured cards. */
export function metaKeysFor(markets: readonly MarketSummary[], k = HERO_K): string[] {
  return [...new Set(rankMarkets(markets, k).map((m) => m.market.oracle.toString()))]
}

function marketCard(m: MarketSummary, meta: Map<string, OracleMetaView>): HeroCard {
  const prob = formatProbability(impliedYesProbability(m.reserves))
  const liquidity = `${formatSol(m.market.totalContributed)} SOL`
  const hasProb = prob !== '—'
  const subjectKey = m.market.oracle.toString()
  return {
    id: m.pubkey,
    kind: 'market',
    subjectId: subjectKey,
    href: `/markets/${m.pubkey}`,
    title: meta.get(subjectKey)?.subject?.trim() || `Market ${truncateMiddle(m.pubkey)}`,
    status: statusLabel(m.market.status),
    tone: statusTone(m.market.status) as HeroTone,
    metricAccent: hasProb ? `YES ${prob}` : liquidity,
    metricLabel: hasProb ? `· ${liquidity} liq.` : 'liquidity',
  }
}

/**
 * Build the live hero cards from loaded markets. Empty in, empty out —
 * the Hero component shows skeletons while the first fetch is in flight.
 */
export function buildHeroCards(
  markets: readonly MarketSummary[],
  meta: Map<string, OracleMetaView> = new Map(),
  k = HERO_K,
): HeroCard[] {
  return rankMarkets(markets, k).map((m) => marketCard(m, meta))
}
