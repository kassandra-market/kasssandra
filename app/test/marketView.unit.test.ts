/**
 * Offline unit tests for `src/market/lib/marketView.ts` — the pure market
 * presentation + funding/AMM math: status label/tone, `Funding` exit gating,
 * funding progress (clamped, bigint-true `funded`), implied YES probability from
 * pool reserves, and probability/KASS formatting. No React / chain.
 */
import { MarketStatus } from '@kassandra-market/markets'
import { describe, expect, it } from 'vitest'

import type { AmmReserves } from '../src/market/data/markets'
import {
  contributorLp,
  detailView,
  firstBoundMarketPubkey,
  formatKass,
  formatProbability,
  fundingActions,
  fundingProgress,
  impliedYesProbability,
  poolValueKass,
  statusLabel,
  statusTone,
} from '../src/market/lib/marketView'
import type { MarketSummary } from '../src/market/data/markets'

const reserves = (base: bigint, quote: bigint): AmmReserves =>
  ({ base, quote }) as unknown as AmmReserves

describe('statusLabel / statusTone', () => {
  it('labels every status', () => {
    expect(statusLabel(MarketStatus.Funding)).toBe('Funding')
    expect(statusLabel(MarketStatus.Active)).toBe('Active')
    expect(statusLabel(MarketStatus.Resolved)).toBe('Resolved')
    expect(statusLabel(MarketStatus.Void)).toBe('Void')
    expect(statusLabel(MarketStatus.Cancelled)).toBe('Cancelled')
    expect(statusLabel(99 as MarketStatus)).toBe('Unknown')
  })

  it('reserves the ember tone for the live (Active) market', () => {
    expect(statusTone(MarketStatus.Active)).toBe('ember')
    expect(statusTone(MarketStatus.Resolved)).toBe('confirmed')
    expect(statusTone(MarketStatus.Funding)).toBe('info')
    expect(statusTone(MarketStatus.Void)).toBe('muted')
    expect(statusTone(MarketStatus.Cancelled)).toBe('muted')
    expect(statusTone(99 as MarketStatus)).toBe('neutral')
  })
})

describe('fundingActions', () => {
  it('activate needs funded + a live oracle; cancel is the only terminal-oracle exit', () => {
    expect(fundingActions(true, false)).toEqual({ canActivate: true, canCancel: false })
    expect(fundingActions(false, false)).toEqual({ canActivate: false, canCancel: false })
    // Terminal oracle: cancel-only even when fully funded (contributions not stranded).
    expect(fundingActions(true, true)).toEqual({ canActivate: false, canCancel: true })
    expect(fundingActions(false, true)).toEqual({ canActivate: false, canCancel: true })
  })
})

describe('fundingProgress', () => {
  it('reports fully funded when the floor is zero/absent', () => {
    expect(fundingProgress({ totalContributed: 0n, minLiquidity: 0n })).toEqual({
      pct: 1,
      funded: true,
    })
  })

  it('is funded on a true bigint compare (>= floor)', () => {
    expect(fundingProgress({ totalContributed: 100n, minLiquidity: 100n })).toEqual({
      pct: 1,
      funded: true,
    })
    expect(fundingProgress({ totalContributed: 150n, minLiquidity: 100n })).toEqual({
      pct: 1,
      funded: true,
    })
  })

  it('reports a clamped 0..1 ratio below the floor', () => {
    expect(fundingProgress({ totalContributed: 25n, minLiquidity: 100n })).toEqual({
      pct: 0.25,
      funded: false,
    })
    expect(fundingProgress({ totalContributed: 0n, minLiquidity: 100n })).toEqual({
      pct: 0,
      funded: false,
    })
  })
})

describe('impliedYesProbability', () => {
  it('is null when reserves are absent or the pool is empty', () => {
    expect(impliedYesProbability(null)).toBeNull()
    expect(impliedYesProbability(undefined)).toBeNull()
    expect(impliedYesProbability(reserves(0n, 0n))).toBeNull()
  })

  it('is quote / (base + quote) — a large YES reserve → low probability', () => {
    expect(impliedYesProbability(reserves(1n, 1n))).toBe(0.5)
    expect(impliedYesProbability(reserves(3n, 1n))).toBe(0.25) // cheap YES → 25%
    expect(impliedYesProbability(reserves(1n, 3n))).toBe(0.75)
  })
})

describe('formatProbability', () => {
  it('renders whole-percent, or an em-dash for null/NaN', () => {
    expect(formatProbability(0.634)).toBe('63%')
    expect(formatProbability(0)).toBe('0%')
    expect(formatProbability(1)).toBe('100%')
    expect(formatProbability(null)).toBe('—')
    expect(formatProbability(Number.NaN)).toBe('—')
  })
})

describe('formatKass (market)', () => {
  it('scales, groups, and trims trailing fraction zeros', () => {
    expect(formatKass(0n)).toBe('0')
    expect(formatKass(1_000_000_000n)).toBe('1')
    expect(formatKass(1_234_500_000_000n)).toBe('1,234.5')
    expect(formatKass(-1_500_000_000n)).toBe('-1.5')
  })
})

describe('detailView — market-detail render precedence', () => {
  const A = { pubkey: 'MktAAA' }

  it('stays ready during a background refetch of the CURRENT market (loading=true)', () => {
    // The Active-market 15s poll flips the async loading flag true while keeping
    // the data. The page must keep rendering the detail (not blank to the
    // skeleton), so the mounted TradePanel — and its in-progress form fields —
    // survives the refresh. This is the regression the whole change guards.
    expect(detailView('MktAAA', A, true, undefined)).toBe('ready')
  })

  it('shows the skeleton on the first load (no data yet)', () => {
    expect(detailView('MktAAA', undefined, true, undefined)).toBe('loading')
  })

  it('shows the skeleton — not stale data — when navigating to a different market', () => {
    // data is still the previously-viewed market while the new one loads.
    expect(detailView('MktBBB', A, true, undefined)).toBe('loading')
  })

  it('surfaces an error only when there is no data to show', () => {
    expect(detailView('MktAAA', undefined, false, new Error('boom'))).toBe('error')
    // An error mid-refetch while holding current data keeps showing the data.
    expect(detailView('MktAAA', A, false, new Error('boom'))).toBe('ready')
  })

  it('is empty when there is nothing to show and nothing in flight', () => {
    expect(detailView(undefined, undefined, false, undefined)).toBe('empty')
  })
})

const KASS = 1_000_000_000n // one whole KASS in base units

describe('poolValueKass — mark-to-market pool value', () => {
  it('marks a 50/50 pool to its complete-set value', () => {
    // 100 cYES + 100 cNO at 50/50 = 100 complete sets = 100 KASS.
    expect(poolValueKass(reserves(100n * KASS, 100n * KASS))).toBe(100n * KASS)
  })

  it('adds the excess side at its probability weight when skewed', () => {
    // 200 cYES + 100 cNO: 100 complete sets (100 KASS) + 100 excess cYES each
    // worth P(YES)=100/300 → 133.333… KASS (floored to base units).
    expect(poolValueKass(reserves(200n * KASS, 100n * KASS))).toBe(133_333_333_333n)
  })

  it('is null for absent reserves or an empty pool', () => {
    expect(poolValueKass(null)).toBeNull()
    expect(poolValueKass(reserves(0n, 0n))).toBeNull()
  })
})

describe('contributorLp — a contributor gross LP position', () => {
  const market = { activationLp: 500n * KASS, activationContributed: 1_000n * KASS }

  it('gives a pure funder their pro-rata activation LP', () => {
    // 1000 of 1000 funded → all 500 activation LP.
    expect(contributorLp({ amount: 1_000n * KASS, lateLp: 0n }, market)).toBe(500n * KASS)
  })

  it('gives a pure late LP exactly what they added', () => {
    expect(contributorLp({ amount: 0n, lateLp: 300n * KASS }, market)).toBe(300n * KASS)
  })

  it('sums funding-derived and late LP for a both-cohort contributor', () => {
    // 200/1000 of activation → 100 LP, plus 100 late LP = 200 LP.
    expect(contributorLp({ amount: 200n * KASS, lateLp: 100n * KASS }, market)).toBe(200n * KASS)
  })

  it('has no funding-derived LP before activation (activationContributed 0)', () => {
    const pre = { activationLp: 0n, activationContributed: 0n }
    expect(contributorLp({ amount: 500n * KASS, lateLp: 0n }, pre)).toBe(0n)
  })
})

describe('firstBoundMarketPubkey — oracle → its prediction sub-market', () => {
  const sub = (pubkey: string, oracle: string, outcomeIndex: number): MarketSummary =>
    ({ pubkey, reserves: null, market: { oracle: { toString: () => oracle }, outcomeIndex } }) as unknown as MarketSummary

  it('returns the lowest-outcome sub-market bound to the oracle', () => {
    const markets = [
      sub('MktY', 'OracA', 1),
      sub('MktX', 'OracA', 0),
      sub('MktOther', 'OracB', 0),
    ]
    expect(firstBoundMarketPubkey(markets, 'OracA')).toBe('MktX') // outcome 0 wins
  })

  it('is undefined when no market binds to the oracle', () => {
    expect(firstBoundMarketPubkey([sub('M', 'OracB', 0)], 'OracA')).toBeUndefined()
    expect(firstBoundMarketPubkey([], 'OracA')).toBeUndefined()
  })
})
