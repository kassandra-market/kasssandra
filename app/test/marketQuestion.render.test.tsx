/**
 * Render coverage for surfacing the human-readable QUESTION + option labels
 * (on-chain oracle metadata) across the market surfaces, with a graceful
 * pubkey/index fallback when metadata is absent:
 *   - MarketCard: subject title + "Pays YES on <label>" (else short pubkey).
 *   - CategoricalCard: subject title + option-label rows.
 *   - MarketDetail header: the question as h1 + the bound option label in words.
 */
import { vi } from 'vitest'
import { MarketStatus } from '@kassandra-market/markets'
import { Phase } from '@kassandra-market/oracles'

const ORACLE = 'Orac1e1111111111111111111111111111111111111'
const META = { subject: 'Will it rain in Paris on Bastille Day?', options: ['Rain', 'No rain'] }

// MarketDetail reads the question via useOracleMeta — mock it to a ready map.
vi.mock('../src/hooks/useOracleMeta', () => ({
  useOracleMeta: () => new Map([[ORACLE, META]]),
}))

// CategoricalCard's FundGroupCta (rendered whenever any outcome is Funding)
// reaches for indexer/wallet-modal context this structural test doesn't
// provide — stub its hooks/ConnectGate to a disconnected pass-through,
// matching the convention used for TradePanel's own tests.
vi.mock('../src/market/hooks/useActionSequence', () => ({
  useActionSequence: () => ({
    statuses: [],
    busy: false,
    connected: false,
    address: null,
    allDone: false,
    run: async () => {},
  }),
}))
vi.mock('../src/market/hooks/useKassBalance', () => ({
  useKassBalance: () => ({ balance: null, loading: false, refetch: () => {} }),
}))
vi.mock('../src/market/lib/indexer', async (importOriginal) => ({
  ...(await importOriginal()),
  useIndexer: () => ({}),
}))
vi.mock('../src/components/markets/actions/ConnectGate', () => ({
  ConnectGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const PUB0 = 'Market00000000000000000000000000000000000000'
const detail = {
  pubkey: PUB0,
  market: {
    status: MarketStatus.Active,
    outcomeIndex: 0,
    settled: false,
    openContributions: 0,
    totalContributed: 5n,
    minLiquidity: 10n,
    feeBps: 0,
    feeCollected: false,
    oracle: { toString: () => ORACLE },
  },
  oracle: { optionsCount: 2, phase: Phase.Challenge, resolvedOption: -1 },
  reserves: { base: 6n, quote: 4n },
  contributions: [],
}

vi.mock('../src/market/hooks/useMarketDetail', () => ({
  useMarketDetail: () => ({
    data: detail,
    loading: false,
    error: undefined,
    refetch: () => {},
    refetchAfterWrite: () => {},
  }),
  useConfig: () => ({ data: undefined, loading: false, error: undefined, refetch: () => {} }),
}))
vi.mock('../src/market/hooks/useOracleGroup', () => ({
  useOracleGroup: () => ({
    siblings: [],
    isGroup: false,
    funding: [],
    active: [],
    claimable: [],
    depositable: [],
    loading: false,
    refetch: () => {},
  }),
}))

// The MarketDetail default tab is Trade; stub the trade surface (it needs wallet +
// indexer context) so the header-focused render doesn't crash.
vi.mock('../src/components/markets/actions/TradePanel', () => ({
  TradePanel: () => null,
}))
// GroupTradePanel now renders the real PriceChart behind the legend, which
// needs an IndexerProvider this lightweight structural test doesn't provide.
vi.mock('../src/components/markets/PriceChart', () => ({
  PriceChart: () => null,
}))

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { MarketCard } from '../src/components/markets/MarketCard'
import { CategoricalCard } from '../src/components/markets/CategoricalCard'
import MarketDetail from '../src/pages/MarketDetail'

function inRouter(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
}

function summary(outcomeIndex: number, pubkey: string) {
  return {
    pubkey,
    market: {
      status: MarketStatus.Active,
      outcomeIndex,
      oracle: { toString: () => ORACLE },
      kassMint: { toString: () => 'KassMint11111111111111111111111111111111' },
      totalContributed: 5n,
      minLiquidity: 10n,
    },
    reserves: { base: 6n, quote: 4n },
  } as never
}

describe('MarketCard question/label', () => {
  it('leads with the question — no restated "Pays YES on <outcome>" line', () => {
    const html = inRouter(<MarketCard summary={summary(1, PUB0)} meta={META} />)
    expect(html).toContain('Will it rain in Paris on Bastille Day?')
    // The title is the question (a serif h3), not the mono pubkey truncation.
    expect(html).toMatch(/<h3[^>]*font-serif[^>]*>Will it rain/)
    expect(html).not.toMatch(/<h3[^>]*font-mono/)
    // The old "Pays YES on <option label>" line is gone entirely.
    expect(html).not.toContain('Pays')
    expect(html).not.toContain('No rain')
  })

  it('degrades to the short pubkey without metadata', () => {
    const html = inRouter(<MarketCard summary={summary(1, PUB0)} />)
    expect(html).toMatch(/Market0000/) // truncated pubkey title
    expect(html).toMatch(/<h3[^>]*font-mono/)
  })
})

describe('CategoricalCard question/labels', () => {
  it('titles by the question and labels each outcome row', () => {
    const group = {
      oracle: ORACLE,
      optionsCount: 2,
      markets: [summary(0, 'Ma0'), summary(1, 'Ma1')],
    } as never
    const html = inRouter(<CategoricalCard group={group} meta={META} />)
    expect(html).toContain('Will it rain in Paris on Bastille Day?')
    expect(html).toContain('Rain')
    expect(html).toContain('No rain')
  })

  it('shows exactly ONE status for the whole group, never one per outcome row', () => {
    // Sub-markets transition status independently on-chain — one Active,
    // others still Funding here — but the card must present as ONE market,
    // not reveal that these are N independently-staged markets.
    const group = {
      oracle: ORACLE,
      optionsCount: 3,
      markets: [
        { ...summary(0, 'Ma0'), market: { ...summary(0, 'Ma0').market, status: MarketStatus.Funding } },
        { ...summary(1, 'Ma1'), market: { ...summary(1, 'Ma1').market, status: MarketStatus.Active } },
        { ...summary(2, 'Ma2'), market: { ...summary(2, 'Ma2').market, status: MarketStatus.Funding } },
      ],
    } as never
    const html = inRouter(<CategoricalCard group={group} meta={META} />)
    const statusChips = (html.match(/aria-label="Status:/g) ?? []).length
    expect(statusChips).toBe(1)
    // The overall status must be Active — the group is tradable since at
    // least one outcome is, not "mostly Funding".
    expect(html).toContain('aria-label="Status: Active"')
  })

  it('does not show a "Categorical · N outcomes" badge next to the status', () => {
    const group = {
      oracle: ORACLE,
      optionsCount: 3,
      markets: [summary(0, 'Ma0'), summary(1, 'Ma1'), summary(2, 'Ma2')],
    } as never
    const html = inRouter(<CategoricalCard group={group} meta={META} />)
    expect(html).not.toContain('Categorical')
    expect(html).not.toContain('outcomes</span>')
  })

  it("puts the option list in a scrollable, height-capped container", () => {
    const group = {
      oracle: ORACLE,
      optionsCount: 2,
      markets: [summary(0, 'Ma0'), summary(1, 'Ma1')],
    } as never
    const html = inRouter(<CategoricalCard group={group} meta={META} />)
    expect(html).toMatch(/<ul class="[^"]*max-h-64[^"]*overflow-y-auto[^"]*"/)
  })

  it('outcome-row probabilities are normalized across the group in odds-space, not each raw independent price', () => {
    // summary(outcomeIndex, pubkey) always uses reserves { base: 6n, quote: 4n }
    // (60% raw) per the existing helper — override two entries' reserves so
    // there's something genuine to rescale.
    const rich = (outcomeIndex: number, pubkey: string, reserves: { base: bigint; quote: bigint }) => ({
      ...summary(outcomeIndex, pubkey),
      reserves,
    })
    const group = {
      oracle: ORACLE,
      optionsCount: 2,
      markets: [
        rich(0, 'Ma0', { base: 3_000_000n, quote: 7_000_000n }), // 70%
        rich(1, 'Ma1', { base: 6_000_000n, quote: 4_000_000n }), // 40%
      ],
    } as never
    const html = inRouter(<CategoricalCard group={group} meta={META} />)
    // Odds-space (normalizeOddsAcrossGroup): odds = 0.7/0.3 ≈ 2.333 and
    // 0.4/0.6 ≈ 0.667, summing to 3 → 2.333/3 ≈ 78%, 0.667/3 ≈ 22%.
    expect(html).toContain('78%')
    expect(html).toContain('22%')
    expect(html).not.toContain('70%')
    expect(html).not.toContain('40%')
  })
})

describe('MarketDetail header question', () => {
  it('renders the question as the title and the bound label in the binding text', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[`/markets/${PUB0}`]}>
        <Routes>
          <Route path="/markets/:pubkey" element={<MarketDetail />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(html).toMatch(/<h1[^>]*>Will it rain in Paris on Bastille Day\?<\/h1>/)
    // The outcome this market pays YES on is named in words (options[0] = "Rain").
    expect(html).toContain('“Rain”')
  })
})
