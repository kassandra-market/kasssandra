import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

/**
 * Visual capture pass — walks every remaining route + key interaction state
 * and saves full-page PNGs to `e2e/screenshots/`.
 */
const wallet = JSON.parse(readFileSync(join(process.cwd(), 'e2e', '.wallet.json'), 'utf8')) as {
  secretKey: number[]
  markets?: { activeMarket?: string }
  activeMarket?: string | null
}
const OUT = join(process.cwd(), 'e2e', 'screenshots')

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true })
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript((secret) => {
    ;(window as unknown as { __E2E_WALLET_SECRET__?: number[] }).__E2E_WALLET_SECRET__ = secret
  }, wallet.secretKey)
})

async function connected(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /^Connected:/ })).toBeVisible()
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => {})
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true })
}

test('capture: routes + interaction states', async ({ page }) => {
  await page.goto('/')
  await connected(page)
  await shot(page, '01-landing')

  await page.goto('/markets')
  await connected(page)
  await shot(page, '02-markets-list')

  await page.goto('/markets/new')
  await connected(page)
  await shot(page, '03-create-empty')

  await page.getByRole('button', { name: /Create market/i }).click()
  await page.waitForTimeout(300)
  await shot(page, '04-create-validation-errors')

  const market =
    wallet.activeMarket ??
    (typeof wallet.markets?.activeMarket === 'string' ? wallet.markets.activeMarket : undefined)
  if (market) {
    await page.goto(`/markets/${market}`)
    await connected(page)
    await shot(page, '05-market-detail')
  }

  await page.goto('/styleguide')
  await shot(page, '06-styleguide')
})
