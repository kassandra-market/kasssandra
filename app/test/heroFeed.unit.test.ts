/**
 * Offline unit tests for `src/lib/heroFeed.ts` — the pure ranking + view-model
 * mapping behind the landing hero's live cards (top-k markets by liquidity).
 */
import { describe, expect, it } from 'vitest'

import type { MarketSummary } from '../src/market/data/markets'
import type { OracleMetaView } from '../src/market/lib/meta'
import { buildHeroCards, metaKeysFor, rankMarkets } from '../src/lib/heroFeed'

function market(pubkey: string, oraclePk: string, liquidity: bigint): MarketSummary {
  return {
    pubkey,
    reserves: null,
    market: { oracle: { toString: () => oraclePk }, totalContributed: liquidity, status: 0 },
  } as unknown as MarketSummary
}

const meta = new Map<string, OracleMetaView>([
  ['mo-1', { subject: 'Will the grant milestone verify on-chain?' }],
])

describe('rankMarkets', () => {
  it('takes the top-k by liquidity, descending', () => {
    const markets = [market('m-sm', 'x', 5n), market('m-big', 'y', 500n)]
    expect(rankMarkets(markets, 1).map((m) => m.pubkey)).toEqual(['m-big'])
  })

  it('does not mutate the input array', () => {
    const markets = [market('a', 'x', 1n), market('b', 'y', 2n)]
    rankMarkets(markets)
    expect(markets.map((m) => m.pubkey)).toEqual(['a', 'b'])
  })
})

describe('metaKeysFor', () => {
  it('collects ranked market subject PDAs, de-duped', () => {
    const markets = [market('m1', 'mo-1', 500n), market('m2', 'mo-1', 100n)]
    expect(metaKeysFor(markets, 3)).toEqual(['mo-1'])
  })
})

describe('buildHeroCards', () => {
  it('maps markets with subject + liquidity metrics', () => {
    const cards = buildHeroCards([market('m1', 'mo-1', 12_000_000_000n)], meta)
    expect(cards.map((c) => c.kind)).toEqual(['market'])
    expect(cards[0]).toMatchObject({
      kind: 'market',
      href: '/markets/m1',
      title: 'Will the grant milestone verify on-chain?',
      metricAccent: '12 SOL',
      metricLabel: 'liquidity',
    })
    expect(cards[0].href).not.toContain('/oracles/')
  })

  it('falls back to the real account id when meta has no subject', () => {
    const cards = buildHeroCards([market('MarketWithNoSubject01xxxxxxxxxxxxxxxxxxxx', 'subj', 1n)], new Map())
    expect(cards[0].title).toMatch(/^Market /)
    expect(cards[0].title).toContain('…')
  })

  it('tags each card with its GPT subject id', () => {
    const cards = buildHeroCards([market('m-1', 'o-1', 1n)], new Map())
    expect(cards[0]).toMatchObject({ kind: 'market', subjectId: 'o-1' })
  })
})
