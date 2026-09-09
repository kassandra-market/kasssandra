/**
 * Playwright globalSetup — spins up surfpool and seeds prediction markets
 * (Funding / Active / resolved categorical) plus a funded browser wallet.
 *
 * Writes the funded keypair + the seeded market map to `e2e/.wallet.json`.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { bootAndInit, fundOwnerAta } from './seed.ts'
import { seedMarkets } from './seed-market.ts'
import { Keypair } from '../../sdks/markets/ts/test/surfpool/harness/index.ts'

const PORT = 8899
const WALLET_FILE = join(process.cwd(), 'e2e', '.wallet.json')

async function globalSetup(): Promise<() => Promise<void>> {
  const ctx = await bootAndInit(PORT)
  const rpcUrl = `http://127.0.0.1:${PORT}`

  const wallet = await Keypair.generate()
  await ctx.harness.airdrop(wallet.publicKey.toString(), 50_000_000_000)
  await fundOwnerAta(ctx, wallet.publicKey.toString(), 10n ** 15n)

  const { seeded, active } = await seedMarkets(ctx)

  writeFileSync(
    WALLET_FILE,
    JSON.stringify(
      {
        secretKey: Array.from(wallet.secretKey as Uint8Array),
        publicKey: wallet.publicKey.toString(),
        rpcUrl,
        baseMint: ctx.baseMint.publicKey.toString(),
        markets: seeded,
        activeMarket: active?.market ?? null,
      },
      null,
      2,
    ),
  )

  // eslint-disable-next-line no-console
  console.log(
    `[e2e] surfpool ${rpcUrl}; wallet ${wallet.publicKey.toString()}; markets: ${Object.keys(seeded).join(', ')}`,
  )

  return async () => {
    await ctx.harness.teardown()
  }
}

export default globalSetup
