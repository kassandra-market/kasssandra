import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

/**
 * Browser E2E for the MARKETS product. UI-shell + routing smoke: the Markets
 * pages render, `/oracles` redirects, the list degrades gracefully with no
 * indexer, and the create-market form mounts for the connected wallet.
 */
const wallet = JSON.parse(
  readFileSync(join(process.cwd(), 'e2e', '.wallet.json'), 'utf8'),
) as { secretKey: number[]; publicKey: string }

test.beforeEach(async ({ page }) => {
  await page.addInitScript((secret) => {
    ;(window as unknown as { __E2E_WALLET_SECRET__?: number[] }).__E2E_WALLET_SECRET__ = secret
  }, wallet.secretKey)
})

test('the Markets tab routes from /oracles (redirect) and the list renders', async ({ page }) => {
  await page.goto('/oracles')

  await expect(page).toHaveURL(/\/markets$/)

  await expect(page.getByRole('heading', { name: /every market/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /create a market/i }).first()).toBeVisible()

  await expect(
    page
      .getByText(/could not load the market list/i)
      .or(page.getByText(/nothing found yet/i))
      .or(page.getByLabel('Search markets'))
      .or(page.getByLabel('Capital at stake'))
      .first(),
  ).toBeVisible()

  const connected = page.getByRole('button', { name: /^Connected:/ })
  await expect(connected).toBeVisible()
  await expect(connected).toContainText(wallet.publicKey.slice(0, 4))
})

test('the create-market page renders its form for a connected wallet', async ({ page }) => {
  await page.goto('/markets/new')

  await expect(page.getByText('New market')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Connected:/ })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: /market type/i })).toBeVisible()
  await expect(page.getByLabel(/seed/i).first()).toBeVisible()
})
