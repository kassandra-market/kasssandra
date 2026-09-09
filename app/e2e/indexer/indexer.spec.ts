import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

/**
 * Indexer health + markets API, against the REAL indexer crawling a seeded market.
 */
const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'e2e', 'indexer', '.wallet.json'), 'utf8'),
) as {
  secretKey: number[]
  indexerUrl: string
  market: string
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((secret) => {
    ;(window as unknown as { __E2E_WALLET_SECRET__?: number[] }).__E2E_WALLET_SECRET__ = secret
  }, fixture.secretKey)
})

test('RPC gateway: POST /rpc forwards JSON-RPC to the backend RPC', async ({ request }) => {
  const res = await request.post(`${fixture.indexerUrl}/rpc`, {
    headers: { 'content-type': 'application/json' },
    data: { jsonrpc: '2.0', id: 1, method: 'getHealth' },
  })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { result?: string }
  expect(body.result).toBe('ok')
})

test('indexer API: GET /api/markets includes the seeded market', async ({ request }) => {
  const res = await request.get(`${fixture.indexerUrl}/api/markets`)
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { address?: string; pubkey?: string }[]
  const pubkeys = body.map((m) => m.address ?? m.pubkey)
  expect(pubkeys, 'indexer should list the seeded market').toContain(fixture.market)
})

test('MarketDetail renders the seeded market from the indexer', async ({ page }) => {
  await page.goto(`/markets/${fixture.market}`)
  await expect(page.getByRole('button', { name: /^Connected:/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /prediction market/i })).toBeVisible()
})
