/**
 * Playwright globalSetup for the CANDLE e2e — the full-stack proof of the
 * subscription-driven price chart.
 *
 * Boots surfpool, seeds an ACTIVE market with a live cYES/cNO pool, then runs
 * the real `kassandra-indexer` binary against surfpool + ephemeral Postgres.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { openSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Keypair } from '../../../sdks/markets/ts/test/surfpool/harness/index.ts'
import { bootAndInit } from '../seed.ts'
import { seedOpenSubject } from '../seed-drivers.ts'
import { seedActiveMarket, swapOnPool, type ActiveMarketSeed } from '../seed-market-active.ts'
import { startEphemeralPg, type EphemeralPg } from '../indexer/pg.ts'

const SURFPOOL_PORT = 8964
const WS_PORT = 8965
const INDEXER_PORT = 3113
const WALLET_FILE = join(process.cwd(), 'e2e', 'candles', '.fixture.json')
const INDEXER_BIN = join(process.cwd(), '..', 'target', 'release', 'kassandra-indexer')

interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
}

async function fetchCandles(indexerUrl: string, market: string): Promise<Candle[]> {
  try {
    const res = await fetch(`${indexerUrl}/api/markets/${market}/candles?interval=60&limit=50`)
    if (!res.ok) return []
    return (await res.json()) as Candle[]
  } catch {
    return []
  }
}

async function waitForCandles(
  indexerUrl: string,
  market: string,
  pred: (c: Candle[]) => boolean,
  what: string,
  timeoutMs = 60_000,
): Promise<Candle[]> {
  const deadline = Date.now() + timeoutMs
  let last: Candle[] = []
  while (Date.now() < deadline) {
    last = await fetchCandles(indexerUrl, market)
    if (pred(last)) return last
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`candles never satisfied "${what}" in ${timeoutMs}ms (last: ${JSON.stringify(last)})`)
}

function priceRange(candles: Candle[]): number {
  if (candles.length === 0) return 0
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  return Math.max(...highs) - Math.min(...lows)
}

async function globalSetup(): Promise<() => Promise<void>> {
  const ctx = await bootAndInit(SURFPOOL_PORT, { wsPort: WS_PORT })
  const rpcUrl = `http://127.0.0.1:${SURFPOOL_PORT}`
  const indexerUrl = `http://127.0.0.1:${INDEXER_PORT}`

  const wallet = await Keypair.generate()
  await ctx.harness.airdrop(wallet.publicKey.toString(), 50_000_000_000)

  let subject: Awaited<ReturnType<typeof seedOpenSubject>>
  let seed: ActiveMarketSeed
  try {
    subject = await seedOpenSubject(ctx, 2)
    seed = await seedActiveMarket(ctx, subject.toString())
  } catch (e) {
    await ctx.harness.teardown()
    throw e
  }

  const pg: EphemeralPg = await startEphemeralPg()
  const indexerLog = openSync(join(process.cwd(), 'e2e', 'candles', '.indexer.log'), 'w')
  const indexer: ChildProcess = spawn(INDEXER_BIN, [], {
    env: {
      ...process.env,
      RPC_URL: rpcUrl,
      SOLANA_WS_URL: `ws://127.0.0.1:${WS_PORT}`,
      DATABASE_URL: pg.databaseUrl,
      PORT: String(INDEXER_PORT),
      INDEXER_RECONCILE_MS: '1000',
      RUST_LOG: 'info',
    },
    stdio: ['ignore', indexerLog, indexerLog],
  })

  try {
    await waitForCandles(indexerUrl, seed.market, (c) => c.length >= 1, 'baseline candle', 60_000)

    await swapOnPool(ctx, seed, 'down', 2_000_000_000n)
    await new Promise((r) => setTimeout(r, 1200))
    await swapOnPool(ctx, seed, 'up', 3_000_000_000n)
    await new Promise((r) => setTimeout(r, 1200))
    await swapOnPool(ctx, seed, 'down', 1_000_000_000n)

    const candles = await waitForCandles(
      indexerUrl,
      seed.market,
      (c) => priceRange(c) > 0.001,
      'price movement from live swaps',
      60_000,
    )

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
          candleCount: candles.length,
          priceRange: priceRange(candles),
        },
        null,
        2,
      ),
    )

    console.log(
      `[e2e:candles] market ${seed.market} active; ${candles.length} candle(s), range ${priceRange(
        candles,
      ).toFixed(3)} — indexed via ws subscription`,
    )
  } catch (e) {
    indexer.kill('SIGKILL')
    pg.stop()
    await ctx.harness.teardown()
    throw e
  }

  return async () => {
    indexer.kill('SIGKILL')
    pg.stop()
    await ctx.harness.teardown()
  }
}

export default globalSetup
