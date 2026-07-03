import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { oracleAt, patchProtocol, poll, protocolAt } from './onchain'

/**
 * Browser E2E for the DAO / governance ops the participant flows never expose —
 * driven from the new /admin page: set_governance, set_config, resolve_deadend,
 * kass_price.
 *
 * Each op is gated on-chain by Protocol.admin / Protocol.dao_authority — a real
 * hand-off routes through a Squads v4 vault PDA no test keypair can sign, so each
 * test first fabricates the exact Protocol governance field it needs (admin or
 * dao_authority = the connected wallet) via surfnet_setAccount, then drives the
 * real instruction through the app and asserts the PERSISTENT on-chain effect.
 */
const wallet = JSON.parse(readFileSync(join(process.cwd(), 'e2e', '.wallet.json'), 'utf8')) as {
  secretKey: number[]
  publicKey: string
  protocol: string
  kassDao: string
  oracles: Record<string, { address: string }>
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((secret) => {
    ;(window as unknown as { __E2E_WALLET_SECRET__?: number[] }).__E2E_WALLET_SECRET__ = secret
  }, wallet.secretKey)
})

test('setGovernance: admin hands the DAO linkage to the wallet', async ({ page }) => {
  // Pre-handoff state: admin = wallet, governance not yet set.
  await patchProtocol(wallet.protocol, { admin: wallet.publicKey, governanceSet: false })
  await page.goto(`/admin?kassDao=${wallet.kassDao}`)
  await expect(page.getByRole('button', { name: /^Connected:/ })).toBeVisible()
  await page.getByRole('button', { name: /Set governance/i }).click()
  // On-chain: governance_set flips 0 → 1 and kass_dao is recorded.
  const p = await poll(() => protocolAt(wallet.protocol), (x) => x.governanceSet === true)
  expect(p.kassDao.toString()).toBe(wallet.kassDao)
})

test('setConfig: DAO authority overwrites the governable params', async ({ page }) => {
  await patchProtocol(wallet.protocol, { daoAuthority: wallet.publicKey })
  await page.goto('/admin')
  await expect(page.getByRole('button', { name: /^Connected:/ })).toBeVisible()
  await page.getByRole('button', { name: /Set config/i }).click()
  // On-chain: phase_window becomes the baseline config's distinct 7201.
  await poll(() => protocolAt(wallet.protocol), (x) => Number(x.phaseWindow) === 7201)
})

test('resolveDeadend: DAO authority resolves a dead-ended oracle', async ({ page }) => {
  await patchProtocol(wallet.protocol, { daoAuthority: wallet.publicKey })
  const o = wallet.oracles.deadend
  await page.goto(`/admin?oracle=${o.address}&option=0`)
  await expect(page.getByRole('button', { name: /^Connected:/ })).toBeVisible()
  await page.getByRole('button', { name: /Resolve dead-end/i }).click()
  // On-chain: InvalidDeadend(8) → Resolved(7).
  await poll(() => oracleAt(o.address), (x) => x.phaseRaw === 7)
})

test('kassPrice: reads the KASS spot TWAP from the futarchy DAO', async ({ page }) => {
  // Permissionless read — ensure Protocol.kass_dao points at the fabricated DAO.
  await patchProtocol(wallet.protocol, { kassDao: wallet.kassDao })
  await page.goto(`/admin?kassDao=${wallet.kassDao}`)
  await expect(page.getByRole('button', { name: /^Connected:/ })).toBeVisible()
  await page.getByRole('button', { name: /Read KASS price/i }).click()
  // No state change — assert the persistent success line (the page does not refetch).
  await expect(page.getByText(/Price read ·/)).toBeVisible({ timeout: 30_000 })
})
