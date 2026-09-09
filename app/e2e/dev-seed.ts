/**
 * Boot a local surfpool, deploy the market program, and seed demo markets for
 * INTERACTIVE development — then hold the validator alive (Ctrl-C to stop).
 * This is `make chain`: a persistent seeded local chain you can browse in the
 * app dev server (`make app-local`).
 *
 * Writes `e2e/.wallet.json` (the funded wallet + market map) so the app in
 * VITE_E2E mode drives the funded keypair.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Keypair } from '../../sdks/markets/ts/test/surfpool/harness/index.ts'
import { bootAndInit, fundOwnerAta } from './seed.ts'
import { seedMarkets } from './seed-market.ts'

const PORT = Number(process.env.SURFPOOL_PORT ?? 8899)
const WALLET_FILE = join(process.cwd(), 'e2e', '.wallet.json')

async function main(): Promise<void> {
  console.log('[dev] booting surfpool + deploying the market program…')
  const ctx = await bootAndInit(PORT)
  const rpcUrl = `http://127.0.0.1:${PORT}`

  const wallet = await Keypair.generate()
  await ctx.harness.airdrop(wallet.publicKey.toString(), 50_000_000_000)
  await fundOwnerAta(ctx, wallet.publicKey.toString(), 10n ** 15n)

  console.log('[dev] seeding demo markets…')
  const { seeded } = await seedMarkets(ctx, (m) => console.log(`[dev]   · ${m}`))

  writeFileSync(
    WALLET_FILE,
    JSON.stringify(
      {
        secretKey: Array.from(wallet.secretKey as Uint8Array),
        publicKey: wallet.publicKey.toString(),
        rpcUrl,
        baseMint: ctx.baseMint.publicKey.toString(),
        markets: seeded,
      },
      null,
      2,
    ),
  )

  console.log(`
[dev] ✅ local chain ready
      surfpool:  ${rpcUrl}
      wallet:    ${wallet.publicKey.toString()} (funded SOL)
      markets:   ${Object.keys(seeded).join(', ')}
      fixture:   ${WALLET_FILE}

      Now run the app against it:  make app-local
      (or in another shell:        VITE_RPC_URL=${rpcUrl} VITE_E2E=1 pnpm --filter app dev)

      Ctrl-C to stop the chain.
`)

  const shutdown = async () => {
    console.log('\n[dev] tearing down surfpool…')
    await ctx.harness.teardown()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  await new Promise<never>(() => {})
}

main().catch((e) => {
  console.error('[dev] failed:', e)
  process.exit(1)
})
