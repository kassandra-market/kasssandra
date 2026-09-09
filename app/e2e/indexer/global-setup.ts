/**
 * Playwright globalSetup for the INDEXER e2e.
 *
 * Boots surfpool, seeds a prediction market, then runs the actual
 * `kassandra-indexer` binary against surfpool's RPC + an ephemeral Postgres.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Keypair } from '../../../sdks/markets/ts/test/surfpool/harness/index.ts'
import { bootAndInit } from '../seed.ts'
import { seedOpenSubject } from '../seed-drivers.ts'
import { seedActiveMarket } from '../seed-market-active.ts'
import { startEphemeralPg, type EphemeralPg } from './pg.ts'

const SURFPOOL_PORT = 8960
const INDEXER_PORT = 3111
const PG_PORT = 5599
const WALLET_FILE = join(process.cwd(), 'e2e', 'indexer', '.wallet.json')
const INDEXER_BIN = join(process.cwd(), '..', 'target', 'release', 'kassandra-indexer')

async function waitForIndexedMarket(
  url: string,
  market: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${url}/health`)
      if (health.ok) {
        const res = await fetch(`${url}/api/markets`)
        if (res.ok) {
          const body = (await res.json()) as { address?: string; pubkey?: string }[]
          last = JSON.stringify(body.map((m) => m.address ?? m.pubkey))
          if (body.some((m) => (m.address ?? m.pubkey) === market)) return
        }
      }
    } catch {
      /* indexer still starting */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`indexer did not list market ${market} in ${timeoutMs}ms (last: ${last})`)
}

async function globalSetup(): Promise<() => Promise<void>> {
  const ctx = await bootAndInit(SURFPOOL_PORT)
  const rpcUrl = `http://127.0.0.1:${SURFPOOL_PORT}`
  const indexerUrl = `http://127.0.0.1:${INDEXER_PORT}`

  const wallet = await Keypair.generate()
  await ctx.harness.airdrop(wallet.publicKey.toString(), 50_000_000_000)

  const subject = await seedOpenSubject(ctx, 2)
  const seed = await seedActiveMarket(ctx, subject.toString())

  const pg: EphemeralPg = await startEphemeralPg(PG_PORT)
  const indexer: ChildProcess = spawn(INDEXER_BIN, [], {
    env: {
      ...process.env,
      RPC_URL: rpcUrl,
      DATABASE_URL: pg.databaseUrl,
      PORT: String(INDEXER_PORT),
      INDEXER_RECONCILE_MS: '1000',
      RUST_LOG: 'info',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })

  await waitForIndexedMarket(indexerUrl, seed.market)

  writeFileSync(
    WALLET_FILE,
    JSON.stringify(
      {
        secretKey: Array.from(wallet.secretKey as Uint8Array),
        publicKey: wallet.publicKey.toString(),
        rpcUrl,
        indexerUrl,
        market: seed.market,
        subject: subject.toString(),
      },
      null,
      2,
    ),
  )

  console.log(
    `[e2e:indexer] surfpool ${rpcUrl}; indexer ${indexerUrl}; market ${seed.market} seeded + indexed`,
  )

  return async () => {
    indexer.kill('SIGKILL')
    pg.stop()
    await ctx.harness.teardown()
  }
}

export default globalSetup
