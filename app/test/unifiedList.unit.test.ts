/**
 * Offline unit tests for the unified oracle+market list model
 * (`src/lib/unifiedList.ts`): merging an oracle list and a market-group list
 * into one entry per oracle, its stage classification, the value/stage sorts,
 * the stage filter, the combined search, and the combined stats. Pure, no
 * chain / React — fixtures are minimal decoded-shaped objects.
 */
import { MarketStatus } from '@kassandra-market/markets'
import { Phase } from '@kassandra-market/oracles'
import type { Oracle } from '@kassandra-market/oracles'
import { describe, expect, it } from 'vitest'
import type { OracleSummary } from '../src/data/oracles'
import type { MarketSummary, OracleGroup } from '../src/market/data/markets'
import {
  buildUnifiedEntries,
  deriveCombinedStats,
  deriveUnifiedCounts,
  entryOracleKey,
  filterByStage,
  matchesUnifiedQuery,
  sortUnified,
  stageOf,
  valueOf,
  type UnifiedEntry,
} from '../src/lib/unifiedList'

// --- minimal fixture builders --------------------------------------------

const ZERO = 0n
function makeOracle(over: Partial<Oracle>): Oracle {
  const base = {
    accountType: 1,
    deadline: ZERO,
    phaseEndsAt: ZERO,
    twapWindow: ZERO,
    optionsCount: 2,
    phaseRaw: Phase.Proposal,
    phase: Phase.Proposal,
    proposerCount: 0,
    survivingCount: 0,
    factCount: 0,
    totalOracleStake: ZERO,
    bondPool: ZERO,
    disputeBondTotal: ZERO,
    settledCount: 0,
    aiFinalizedCount: 0,
    bump: 254,
    resolvedOption: 0xff,
    openChallengeCount: 0,
    thresholdNum: 2n,
    thresholdDen: 3n,
    marketThresholdNum: 1n,
    marketThresholdDen: 10n,
    flipSlashNum: 1n,
    flipSlashDen: 2n,
    phaseWindow: 3600n,
    proposalWindow: 3600n,
    factVoteSlashNum: 1n,
    factVoteSlashDen: 2n,
    rewardProposerWeight: 1n,
    rewardFactWeight: 1n,
    challengeFailUsdcFeeNum: 1n,
    challengeFailUsdcFeeDen: 100n,
    challengeSuccessBaseFeeNum: 1n,
    challengeSuccessBaseFeeDen: 100n,
    totalCorrectProposerStake: ZERO,
    totalApprovedFactStake: ZERO,
    rewardPool: ZERO,
    rewardEmission: ZERO,
  } as unknown as Oracle
  return { ...base, ...over }
}

const oracleEntry = (pubkey: string, over: Partial<Oracle>): UnifiedEntry => ({
  kind: 'oracle',
  summary: { pubkey, oracle: makeOracle(over) },
})

const marketSummary = (
  oracle: string,
  outcomeIndex: number,
  status: MarketStatus,
  totalContributed: bigint,
  pubkey = `${oracle}-${outcomeIndex}`,
): MarketSummary =>
  ({
    pubkey,
    market: { oracle: { toString: () => oracle }, outcomeIndex, status, totalContributed },
    reserves: null,
    oracleOptionsCount: null,
  }) as unknown as MarketSummary

const marketEntry = (group: Partial<OracleGroup> & { oracle: string; markets: MarketSummary[] }): UnifiedEntry => ({
  kind: 'market',
  group: { optionsCount: null, ...group },
})

describe('stageOf', () => {
  it('maps a bare oracle by its coarse phase group, folding dead-end into closed', () => {
    expect(stageOf(oracleEntry('a', { phase: Phase.Proposal }))).toBe('proposal')
    expect(stageOf(oracleEntry('b', { phase: Phase.FactVoting }))).toBe('inDispute')
    expect(stageOf(oracleEntry('c', { phase: Phase.AiClaim }))).toBe('aiClaim')
    expect(stageOf(oracleEntry('d', { phase: Phase.Challenge }))).toBe('challenge')
    expect(stageOf(oracleEntry('e', { phase: Phase.Resolved }))).toBe('resolved')
    expect(stageOf(oracleEntry('f', { phase: Phase.InvalidDeadend }))).toBe('closed')
  })

  it('maps a market group by its collapsed groupStatus, overriding the oracle phase', () => {
    expect(
      stageOf(marketEntry({ oracle: 'o', markets: [marketSummary('o', 0, MarketStatus.Funding, 1n)] })),
    ).toBe('funding')
    expect(
      stageOf(marketEntry({ oracle: 'o', markets: [marketSummary('o', 0, MarketStatus.Active, 1n)] })),
    ).toBe('active')
    expect(
      stageOf(marketEntry({ oracle: 'o', markets: [marketSummary('o', 0, MarketStatus.Resolved, 1n)] })),
    ).toBe('resolved')
    expect(
      stageOf(marketEntry({ oracle: 'o', markets: [marketSummary('o', 0, MarketStatus.Void, 1n)] })),
    ).toBe('closed')
    expect(
      stageOf(marketEntry({ oracle: 'o', markets: [marketSummary('o', 0, MarketStatus.Cancelled, 1n)] })),
    ).toBe('closed')
  })
})

describe('valueOf', () => {
  it('sums bond economics for a bare oracle', () => {
    const entry = oracleEntry('a', { bondPool: 2n, disputeBondTotal: 20n, totalOracleStake: 1n })
    expect(valueOf(entry)).toBe(23n)
  })

  it('sums totalContributed across a market group’s sub-markets', () => {
    const entry = marketEntry({
      oracle: 'o',
      markets: [
        marketSummary('o', 0, MarketStatus.Funding, 5n),
        marketSummary('o', 1, MarketStatus.Funding, 7n),
      ],
    })
    expect(valueOf(entry)).toBe(12n)
  })
})

describe('buildUnifiedEntries', () => {
  it('represents an oracle with a bound market ONLY as its market entry, never both', () => {
    const oracles: OracleSummary[] = [
      { pubkey: 'has-market', oracle: makeOracle({ phase: Phase.Proposal }) },
      { pubkey: 'orphan', oracle: makeOracle({ phase: Phase.Challenge }) },
    ]
    const groups: OracleGroup[] = [
      { oracle: 'has-market', optionsCount: 2, markets: [marketSummary('has-market', 0, MarketStatus.Active, 1n)] },
    ]
    const entries = buildUnifiedEntries(oracles, groups)
    expect(entries).toHaveLength(2)
    expect(entries.map(entryOracleKey)).toEqual(['has-market', 'orphan'])
    expect(entries[0].kind).toBe('market')
    expect(entries[1].kind).toBe('oracle')
  })

  it('is empty for no oracles and no markets', () => {
    expect(buildUnifiedEntries([], [])).toEqual([])
  })
})

describe('deriveUnifiedCounts / filterByStage', () => {
  const entries: UnifiedEntry[] = [
    oracleEntry('p', { phase: Phase.Proposal }),
    oracleEntry('ch', { phase: Phase.Challenge }),
    marketEntry({ oracle: 'f', markets: [marketSummary('f', 0, MarketStatus.Funding, 1n)] }),
    marketEntry({ oracle: 'a', markets: [marketSummary('a', 0, MarketStatus.Active, 1n)] }),
    marketEntry({ oracle: 'r', markets: [marketSummary('r', 0, MarketStatus.Resolved, 1n)] }),
  ]

  it('counts every entry into exactly one stage bucket, plus the total', () => {
    const counts = deriveUnifiedCounts(entries)
    expect(counts).toEqual({
      proposal: 1,
      inDispute: 0,
      aiClaim: 0,
      challenge: 1,
      funding: 1,
      active: 1,
      resolved: 1,
      closed: 0,
      total: 5,
    })
  })

  it('`all` is the identity (new array)', () => {
    const out = filterByStage(entries, 'all')
    expect(out).toHaveLength(entries.length)
    expect(out).not.toBe(entries)
  })

  it('keeps only entries in the selected stage, oracle or market alike', () => {
    expect(filterByStage(entries, 'challenge').map(entryOracleKey)).toEqual(['ch'])
    expect(filterByStage(entries, 'active').map(entryOracleKey)).toEqual(['a'])
  })
})

describe('sortUnified', () => {
  const entries: UnifiedEntry[] = [
    oracleEntry('low', { bondPool: 5n }),
    marketEntry({ oracle: 'high', markets: [marketSummary('high', 0, MarketStatus.Active, 100n)] }),
    oracleEntry('mid', { bondPool: 50n }),
  ]

  it('orders by value descending without mutating the input', () => {
    const out = sortUnified(entries, 'value')
    expect(out.map(entryOracleKey)).toEqual(['high', 'mid', 'low'])
    expect(out).not.toBe(entries)
    expect(entries[0]).toBe(entries[0]) // input order unchanged
    expect(entryOracleKey(entries[0])).toBe('low')
  })

  it('orders by lifecycle stage, breaking ties by value', () => {
    const staged: UnifiedEntry[] = [
      marketEntry({ oracle: 'active-hi', markets: [marketSummary('active-hi', 0, MarketStatus.Active, 10n)] }),
      oracleEntry('proposal', { phase: Phase.Proposal, bondPool: 1n }),
      marketEntry({ oracle: 'funding-lo', markets: [marketSummary('funding-lo', 0, MarketStatus.Funding, 1n)] }),
    ]
    const out = sortUnified(staged, 'stage')
    expect(out.map(entryOracleKey)).toEqual(['proposal', 'funding-lo', 'active-hi'])
  })
})

describe('matchesUnifiedQuery', () => {
  it('matches an oracle entry by its phase label, subject, or address', () => {
    const entry = oracleEntry('AbcOracle', { phase: Phase.Challenge })
    expect(matchesUnifiedQuery(entry, '', undefined)).toBe(true)
    expect(matchesUnifiedQuery(entry, 'challenged', undefined)).toBe(true)
    expect(matchesUnifiedQuery(entry, 'abcoracle', undefined)).toBe(true)
    expect(matchesUnifiedQuery(entry, 'will it rain', 'Will it rain tomorrow?')).toBe(true)
    expect(matchesUnifiedQuery(entry, 'nope', 'Will it rain tomorrow?')).toBe(false)
  })

  it('matches a market entry by its status label, subject, oracle address, or any sub-market address', () => {
    const entry = marketEntry({
      oracle: 'OraKey',
      markets: [marketSummary('OraKey', 0, MarketStatus.Active, 1n, 'SubMarketOne')],
    })
    expect(matchesUnifiedQuery(entry, 'active', undefined)).toBe(true)
    expect(matchesUnifiedQuery(entry, 'orakey', undefined)).toBe(true)
    expect(matchesUnifiedQuery(entry, 'submarketone', undefined)).toBe(true)
    expect(matchesUnifiedQuery(entry, 'weather', 'Weather forecast')).toBe(true)
  })
})

describe('deriveCombinedStats', () => {
  it('combines the oracle bond stats with a market TVL sum', () => {
    const oracles: OracleSummary[] = [
      { pubkey: 'a', oracle: makeOracle({ phase: Phase.Challenge, bondPool: 10n }) },
    ]
    const markets: MarketSummary[] = [
      marketSummary('a', 0, MarketStatus.Active, 4n),
      marketSummary('b', 0, MarketStatus.Resolved, 6n),
    ]
    const stats = deriveCombinedStats(oracles, markets)
    expect(stats.bondsAtRisk).toBe(10n)
    expect(stats.marketTvl).toBe(10n)
  })

  it('is safe on empty input', () => {
    const stats = deriveCombinedStats([], [])
    expect(stats.bondsAtRisk).toBe(0n)
    expect(stats.marketTvl).toBe(0n)
  })
})
