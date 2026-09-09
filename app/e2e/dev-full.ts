/**
 * `make dev` — the FULL production-like local stack, in ONE command.
 *
 * Boots and wires three services against a local, pre-seeded chain:
 *
 *   surfpool  local Solana node: deploys the market program + seeds markets
 *   indexer   the REAL `kassandra-indexer` binary crawling surfpool → read API,
 *             backed by an auto-managed EPHEMERAL Postgres
 *   app       the Vite app in PRODUCTION-LIKE mode: the REAL wallet-adapter
 *
 * Each service streams to `logs/<service>.log`. Ctrl-C tears the whole thing down.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

import bs58 from 'bs58'

import { bootAndInit, fundOwnerAta } from './seed.ts'
import { seedMarkets, type ActiveMarketSeed } from './seed-market.ts'
import { startEphemeralPg, type EphemeralPg } from './indexer/pg.ts'
import {
  APP_PORT,
  INDEXER_BIN,
  INDEXER_PORT,
  LOGS,
  ROOT,
  WALLET_FILE,
  appUrl,
  indexerUrl,
  rpcUrl,
  wsUrl,
} from './dev/env.ts'
import { log, openLog, runTeardowns, teardowns } from './dev/teardown.ts'
import { loadDevWallet } from './dev/wallet.ts'
import { seedActivePriceHistory, waitForIndexer } from './dev/indexer.ts'

async function main(): Promise<void> {
  mkdirSync(LOGS, { recursive: true })

  log('[dev] booting surfpool + deploying the market program…')
  const ctx = await bootAndInit(SURFPOOL_PORT, { wsPort: SURFPOOL_PORT + 1 })
  teardowns.push(() => ctx.harness.teardown())

  const { wallet, fromFile: walletFromFile } = await loadDevWallet()
  log(
    `[dev] funding the dev wallet ${wallet.publicKey.toString()} ` +
      `(${walletFromFile ? 'your local CLI keypair' : 'generated'}) — 50 SOL + SOL ATA`,
  )
  await ctx.harness.airdrop(wallet.publicKey.toString(), 50_000_000_000)
  await fundOwnerAta(ctx, wallet.publicKey.toString(), 10n ** 15n)

  log('[dev] seeding demo markets…')
  let markets: Record<string, unknown> | null = null
  let activeSeed: ActiveMarketSeed | null = null
  try {
    const res = await seedMarkets(ctx, (m) => log(`[dev]   · ${m}`))
    markets = res.seeded
    activeSeed = res.active
  } catch (e) {
    log(`[dev] ⚠ market seeding failed: ${(e as Error).message}`)
  }

  writeFileSync(
    WALLET_FILE,
    JSON.stringify(
      {
        secretKey: Array.from(wallet.secretKey as Uint8Array),
        publicKey: wallet.publicKey.toString(),
        rpcUrl,
        baseMint: ctx.baseMint.publicKey.toString(),
        markets,
      },
      null,
      2,
    ),
  )

  log('[dev] starting ephemeral Postgres + indexer…')
  const pg: EphemeralPg = await startEphemeralPg()
  teardowns.push(() => pg.stop())
  const indexerLog = openLog('indexer')
  const indexer: ChildProcess = spawn(INDEXER_BIN, [], {
    env: {
      ...process.env,
      RPC_URL: rpcUrl,
      DATABASE_URL: pg.databaseUrl,
      PORT: String(INDEXER_PORT),
      COMMITMENT: 'confirmed',
      POLL_INTERVAL_MS: '1000',
      PROMOTE_INTERVAL_MS: '2000',
      SOLANA_WS_URL: wsUrl,
      INDEXER_RECONCILE_MS: '1000',
      RUST_LOG: 'info',
    },
    stdio: ['ignore', indexerLog, indexerLog],
  })
  teardowns.push(() => indexer.kill('SIGKILL'))
  await waitForIndexer(5)

  if (activeSeed) {
    try {
      await seedActivePriceHistory(ctx, activeSeed)
      log('[dev] seeded price history on the active market (candlestick chart populated)')
    } catch (e) {
      log(`[dev] ⚠ price-history seeding skipped: ${(e as Error).message}`)
    }
  }

  const fundedWallet = process.env.WALLET === 'funded'
  log(`[dev] starting the app (${fundedWallet ? 'funded auto-connect' : 'real'} wallet)…`)
  const appLog = openLog('app')
  const app: ChildProcess = spawn('pnpm', ['--filter', 'app', 'dev', '--', '--port', String(APP_PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      VITE_RPC_URL: rpcUrl,
      VITE_INDEXER_URL: indexerUrl,
      VITE_CLUSTER: 'localnet',
      VITE_E2E: fundedWallet ? '1' : '',
      VITE_E2E_WALLET_SECRET: fundedWallet
        ? JSON.stringify(Array.from(wallet.secretKey as Uint8Array))
        : '',
      VITE_MOCK: '',
    },
    stdio: ['ignore', appLog, appLog],
    detached: true,
  })
  teardowns.push(() => {
    try {
      if (app.pid) process.kill(-app.pid, 'SIGKILL')
    } catch {
      app.kill('SIGKILL')
    }
  })

  const walletBlock = walletFromFile
    ? `      ── connect your wallet in the browser ─────────────────────────────
      The app uses the REAL wallet-adapter. This stack funded your LOCAL
      Solana CLI wallet (~/.config/solana/id.json) — connect it in the
      browser and point a custom network at ${rpcUrl}:

        address:          ${wallet.publicKey.toString()}   (funded: SOL)`
    : `      ── connect a wallet in the browser ────────────────────────────────
      The app uses the REAL wallet-adapter. No local Solana CLI keypair was
      found, so import this generated, pre-funded dev keypair into
      Phantom/Solflare and point a custom network at ${rpcUrl}:

        secret (base58):  ${bs58.encode(wallet.secretKey as Uint8Array)}
        address:          ${wallet.publicKey.toString()}   (funded: SOL)`
  log(`
[dev] ✅ production-like local stack is UP
      app       ${appUrl}          (logs/app.log)
      surfpool  ${rpcUrl}     (RPC)
      indexer   ${indexerUrl}     (logs/indexer.log)
      postgres  ${pg.databaseUrl}  (ephemeral — removed on exit)
      markets   ${markets ? Object.keys(markets).join(', ') : '(none)'}

${walletBlock}

      Ctrl-C to stop everything (services killed, temp Postgres removed).
`)

  const shutdown = async (sig: string) => {
    await runTeardowns(sig)
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  await new Promise<never>(() => {})
}

main().catch(async (e) => {
  console.error('[dev] failed:', e)
  await runTeardowns('boot failed')
  process.exit(1)
})
