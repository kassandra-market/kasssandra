/**
 * Core seeding primitives for the browser E2E: the {@link SeedCtx}, boot/init,
 * tx sending, account fetch/fund, and fabricated GPT Subject accounts owned
 * by the markets program.
 *
 * IMPORTANT: every pubkey handed to an `@kassandra-market/markets` builder is
 * passed as a base58 STRING (`.toString()`), never a web3.js `Address` object
 * from a foreign copy — under Playwright's loader the app and the SDK can
 * resolve separate copies of `@solana/web3.js`, so a foreign `Address` fails
 * the SDK's `instanceof` check. Keypairs used with the harness come from the
 * harness's web3.js re-export.
 */
import type { TransactionInstruction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, initConfig, pda } from '@kassandra-market/markets'
import {
  Address,
  Keypair,
  MarketSurfpoolHarness,
} from '../../sdks/markets/ts/test/surfpool/harness/index.ts'
import { toHex } from '../../sdks/markets/ts/test/surfpool/harness/encoding.ts'
import { mintBytes, tokenAccountBytes } from '../../sdks/markets/ts/test/spl-layout.ts'

export const MIN_LIQUIDITY = 1_000_000_000n // 1 SOL (9 decimals) funding floor
export const FEE_BPS = 100 // 1%

export interface SeedCtx {
  harness: MarketSurfpoolHarness
  payer: Keypair
  baseMint: Keypair
  /** Canonical SOL ATA of the payer (create-market / fee destination). */
  payerBaseAta: string
}

/** Boot surfpool, deploy the market program, mint SOL, and init Config. */
export async function bootAndInit(
  port: number,
  harnessOpts: Record<string, unknown> = {},
): Promise<SeedCtx> {
  const harness = await MarketSurfpoolHarness.start({ port, ...harnessOpts })
  const payer = await Keypair.generate()
  await harness.airdrop(payer.publicKey.toString(), 1_000_000_000_000)

  const baseMint = await Keypair.generate()
  await harness.setAccount(baseMint.publicKey.toString(), {
    lamports: 1_000_000_000,
    owner: TOKEN_PROGRAM_ID.toString(),
    executable: false,
    data: toHex(mintBytes(payer.publicKey.toBytes(), 10n ** 18n, 9)),
  })

  await harness.setUpgradeAuthority(payer.publicKey)

  const payerBase = (await pda.associatedTokenAccount(payer.publicKey.toString(), baseMint.publicKey.toString()))
    .address
  await harness.setAccount(payerBase.toString(), {
    lamports: 5_000_000,
    owner: TOKEN_PROGRAM_ID.toString(),
    executable: false,
    data: toHex(tokenAccountBytes(baseMint.publicKey.toBytes(), payer.publicKey.toBytes(), 10n ** 15n)),
  })

  const ctx: SeedCtx = { harness, payer, baseMint, payerBaseAta: payerBase.toString() }
  await sendIx(
    ctx,
    await initConfig({
      payer: payer.publicKey.toString(),
      baseMint: baseMint.publicKey.toString(),
      authority: payer.publicKey.toString(),
      minLiquidity: MIN_LIQUIDITY,
      feeBps: FEE_BPS,
      feeDestination: payerBase.toString(),
    }),
  )
  return ctx
}

/** Send one ix signed by the payer (+ extra signers). */
export async function sendIx(
  ctx: SeedCtx,
  ix: TransactionInstruction,
  signers: Keypair[] = [],
): Promise<void> {
  await sendIxs(ctx, [ix], signers)
}

/** Send several ixs in ONE tx signed by the payer (+ extra signers). */
export async function sendIxs(
  ctx: SeedCtx,
  ixs: TransactionInstruction[],
  signers: Keypair[] = [],
  computeUnits?: number,
): Promise<void> {
  await ctx.harness.sendIx(ctx.payer, ixs, signers, computeUnits)
}

export async function fetchAccount(ctx: SeedCtx, address: Address | string): Promise<Uint8Array> {
  const key = typeof address === 'string' ? new Address(address) : address
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const info = await ctx.harness.connection.getAccountInfo(key)
    if (info && info.data.length > 0) return info.data
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`account ${address} did not appear`)
}

/** Fabricate a SOL token account owned by `owner` (base58) holding `amount`. */
export async function fundBase(ctx: SeedCtx, owner: string, amount: bigint): Promise<string> {
  const ownerBytes = new Address(owner).toBytes()
  const acct = await Keypair.generate()
  await ctx.harness.setAccount(acct.publicKey.toString(), {
    lamports: 5_000_000,
    owner: TOKEN_PROGRAM_ID.toString(),
    executable: false,
    data: toHex(tokenAccountBytes(ctx.baseMint.publicKey.toBytes(), ownerBytes, amount)),
  })
  return acct.publicKey.toString()
}

/** Fund the canonical SOL ATA of `owner` (base58). */
export async function fundOwnerAta(ctx: SeedCtx, owner: string, amount: bigint): Promise<string> {
  const ata = (await pda.associatedTokenAccount(owner, ctx.baseMint.publicKey.toString())).address
  await ctx.harness.setAccount(ata.toString(), {
    lamports: 5_000_000,
    owner: TOKEN_PROGRAM_ID.toString(),
    executable: false,
    data: toHex(
      tokenAccountBytes(ctx.baseMint.publicKey.toBytes(), new Address(owner).toBytes(), amount),
    ),
  })
  return ata.toString()
}
