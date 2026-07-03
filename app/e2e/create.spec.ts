import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { getAccountData, poll } from './onchain'

/**
 * Browser E2E: create a brand-new oracle through the `/oracles/new` page with the
 * funded e2e wallet. On a confirmed create the app navigates to the new oracle's
 * detail page; we assert both the navigation and that the Oracle account exists
 * on-chain.
 */
const wallet = JSON.parse(readFileSync(join(process.cwd(), 'e2e', '.wallet.json'), 'utf8')) as {
  secretKey: number[]
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((secret) => {
    ;(window as unknown as { __E2E_WALLET_SECRET__?: number[] }).__E2E_WALLET_SECRET__ = secret
  }, wallet.secretKey)
})

test('createOracle: open a new oracle from the create page', async ({ page }) => {
  await page.goto('/oracles/new')
  await expect(page.getByRole('button', { name: /^Connected:/ })).toBeVisible()

  await page.getByPlaceholder(/SpaceX Starship/).fill('Did the E2E create flow land on-chain?')
  // A far-future deadline so it is past the (seeding-advanced) surfpool clock.
  await page.locator('input[type="datetime-local"]').fill('2027-06-01T00:00')

  await page.getByRole('button', { name: 'Create oracle' }).click()

  // On a confirmed create the app routes to the new oracle's detail page.
  await page.waitForURL(/\/oracles\/[1-9A-HJ-NP-Za-km-z]{32,44}$/, { timeout: 40_000 })
  const address = page.url().split('/').pop()!
  await poll(() => getAccountData(address), (data) => data !== null)
})
