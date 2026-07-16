/**
 * Render coverage for the market-detail TAB STRUCTURE. The data hook is mocked to
 * return a ready Active market, and we assert (via `renderToStaticMarkup`) the
 * grouped tab bar: an Active market exposes a Trade tab AND a Liquidity tab
 * (the Liquidity tab must be present for Active markets, not just Funding), plus
 * the always-on Overview / Manage / Details. Only the default Overview panel
 * renders its body (the gauge), so the heavy action panels stay dormant.
 */
import { vi } from 'vitest'
import { MarketStatus } from '@kassandra-market/markets'
import { Phase } from '@kassandra-market/oracles'

const PUB = 'Market11111111111111111111111111111111111111'

const activeDetail = {
  pubkey: PUB,
  market: {
    status: MarketStatus.Active,
    outcomeIndex: 0,
    settled: false,
    openContributions: 0,
    totalContributed: 500_000_000n,
    minLiquidity: 1_000_000_000n,
    feeBps: 100,
    feeCollected: false,
    oracle: { toString: () => 'Orac1e1111111111111111111111111111111111111' },
  },
  oracle: { optionsCount: 2, phase: Phase.Challenge, resolvedOption: -1 },
  reserves: { base: 640_000_000n, quote: 360_000_000n },
  contributions: [],
}

vi.mock('../src/market/hooks/useMarketDetail', () => ({
  useMarketDetail: () => ({
    data: activeDetail,
    loading: false,
    error: undefined,
    refetch: () => {},
    refetchAfterWrite: () => {},
  }),
  useConfig: () => ({ data: undefined, loading: false, error: undefined, refetch: () => {} }),
}))

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import MarketDetail from '../src/pages/MarketDetail'

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/markets/${PUB}`]}>
      <Routes>
        <Route path="/markets/:pubkey" element={<MarketDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MarketDetail tabs', () => {
  it('exposes Trade + Liquidity tabs for an Active market', () => {
    const html = render()
    for (const label of ['Overview', 'Trade', 'Liquidity', 'Manage', 'Details']) {
      expect(html).toMatch(new RegExp(`role="tab"[^>]*>(?:(?!</button>).)*${label}`))
    }
  })

  it('renders the probability gauge in the default Overview panel', () => {
    const html = render()
    expect(html).toContain('implied YES')
    // Inactive panels stay dormant — the Trade panel body is not rendered.
    expect(html).not.toContain('role="tabpanel" id="panel-trade"')
  })
})
