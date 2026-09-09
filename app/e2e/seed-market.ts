/**
 * Market seeding for `make dev` / Playwright — Config is already initialized by
 * {@link bootAndInit}. This module fabricates GPT Subject PDAs owned by the
 * market program and creates demo markets against them.
 */
import { Address } from '../../sdks/markets/ts/test/surfpool/harness/index.ts'

import {
  TOKEN_PROGRAM_ID,
  MarketStatus,
  createMarket,
  flows,
  metadao,
  pda as marketPda,
} from '@kassandra-market/markets'

import { toHex } from '../../sdks/markets/ts/test/surfpool/harness/encoding.ts'
import { tokenAccountBytes } from '../../sdks/markets/ts/test/spl-layout.ts'
import { MIN_LIQUIDITY, sendIx, sendIxs, type SeedCtx } from './seed.ts'
import { resolveSubject, seedOpenSubject } from './seed-drivers.ts'

type MarketRefs = flows.MarketRefs

export { MIN_LIQUIDITY }
const BELOW_FLOOR = 100_000_000n // a partially-funded (Funding) seed

/**
 * A step logger. `make dev` passes one to narrate each seeding action; the
 * Playwright global-setups omit it (defaulting to a no-op) so test output stays
 * quiet.
 */
export type StepLog = (msg: string) => void
const noopLog: StepLog = () => {}

/**
 * Config + the payer SOL ATA are created by {@link bootAndInit}. Returns the
 * payer's SOL ATA (base58).
 */
export async function deployAndInitMarket(ctx: SeedCtx, _log: StepLog = noopLog): Promise<string> {
  return ctx.payerBaseAta
}

/** Compute-unit limits for the MetaDAO composition / activation / trade CPIs. */
const COMPOSE_CU = 400_000
const ACTIVATE_CU = 1_400_000
const TRADE_CU = 400_000

/** A stood-up active market: its address, compose refs, and the payer's cYES/cNO ATAs. */
export interface ActiveMarketSeed {
  market: string
  refs: MarketRefs
  /** The payer's cYES / cNO ATAs (a swap inventory when created with `split`). */
  cyesAta: Address
  cnoAta: Address
}

/** Options for {@link createAndActivateMarket}. */
export interface CreateActiveMarketOpts {
  /** The subject outcome this sub-market binds to (default 0). */
  outcomeIndex?: number
  /** SOL to seed the market with (default {@link MIN_LIQUIDITY} = the floor). */
  seedAmount?: bigint
  /**
   * When true, fabricate the payer's cYES/cNO ATAs and split 5 SOL of each leg to
   * them — a trading inventory for the candle e2e's swaps. `make dev` doesn't need
   * it (users split/swap through the UI against the seeded pool).
   */
  split?: boolean
}

/**
 * Create a market on `oracle` (a markets-owned GPT Subject) funded to
 * `seedAmount`, compose its MetaDAO question/vault/AMM, and activate it —
 * leaving it **Active**. Assumes Config is initialized (see {@link bootAndInit}),
 * and that `oracle` is non-terminal (activation requires an Open subject).
 */
export async function createAndActivateMarket(
  ctx: SeedCtx,
  oracle: string,
  payerBase: string,
  opts: CreateActiveMarketOpts = {},
  log: StepLog = noopLog,
): Promise<ActiveMarketSeed> {
  const outcomeIndex = opts.outcomeIndex ?? 0
  const seedAmount = opts.seedAmount ?? MIN_LIQUIDITY
  const h = ctx.harness
  const payer = ctx.payer.publicKey.toString()
  const baseMint = ctx.baseMint.publicKey.toString()

  const market = (await marketPda.market(oracle, outcomeIndex)).address.toString()
  log(`creating market ${market} (outcome ${outcomeIndex}) funded to the floor`)
  await sendIx(
    ctx,
    await createMarket({
      creator: payer,
      oracle,
      baseMint,
      creatorBaseAta: payerBase,
      seedAmount,
      outcomeIndex,
    }),
  )

  log('composing the MetaDAO question / conditional vault / AMM')
  const { instructions: composeIxs, refs } = await flows.composeMarketInstructions({
    market,
    oracle,
    baseMint,
    payer,
  })
  await sendIxs(ctx, composeIxs.slice(0, 1), [], COMPOSE_CU)
  await sendIxs(ctx, composeIxs.slice(1, 2), [], COMPOSE_CU)
  await sendIxs(ctx, composeIxs.slice(2, 3), [], COMPOSE_CU)
  log('activating the market → live cYES/cNO pool')
  await sendIxs(ctx, [await flows.activateInstruction({ refs, payer })], [], ACTIVATE_CU)

  const cyesAta = (await marketPda.associatedTokenAccount(payer, refs.yesMint.toString())).address
  const cnoAta = (await marketPda.associatedTokenAccount(payer, refs.noMint.toString())).address
  if (opts.split) {
    log('splitting SOL into a cYES + cNO trading inventory')
    for (const [ata, mint] of [
      [cyesAta, refs.yesMint],
      [cnoAta, refs.noMint],
    ] as const) {
      await h.setAccount(ata.toString(), {
        lamports: 5_000_000,
        owner: TOKEN_PROGRAM_ID.toString(),
        executable: false,
        data: toHex(tokenAccountBytes(mint.toBytes(), ctx.payer.publicKey.toBytes(), 0n)),
      })
    }
    await sendIxs(
      ctx,
      [
        await metadao.splitTokens({
          question: refs.question,
          vault: refs.vault,
          vaultUnderlyingAta: refs.vaultUnderlyingAta,
          authority: payer,
          userUnderlyingAta: payerBase,
          conditionalMints: [refs.yesMint, refs.noMint],
          userConditionalAtas: [cyesAta, cnoAta],
          amount: 5_000_000_000n,
        }),
      ],
      [],
      TRADE_CU,
    )
  }

  const info = await h.connection.getAccountInfo(new Address(market))
  if (!info || info.data[154] !== MarketStatus.Active) {
    throw new Error(`market ${market} did not reach Active after activate (status=${info?.data[154]})`)
  }
  return { market, refs, cyesAta, cnoAta }
}

/**
 * Fabricate Subjects and pre-create demo markets. Returns the created market
 * addresses for the wallet fixture.
 */
export async function seedMarkets(
  ctx: SeedCtx,
  log: StepLog = noopLog,
): Promise<{ seeded: Record<string, unknown>; active: ActiveMarketSeed | null }> {
  const payer = ctx.payer.publicKey.toString()
  const baseMint = ctx.baseMint.publicKey.toString()
  const payerBase = ctx.payerBaseAta

  const createOne = async (oracle: string, outcomeIndex: number, seedAmount: bigint) => {
    const market = (await marketPda.market(oracle, outcomeIndex)).address.toString()
    log(`creating market ${market} (outcome ${outcomeIndex}, Funding stage)`)
    await sendIx(
      ctx,
      await createMarket({
        creator: payer,
        oracle,
        baseMint,
        creatorBaseAta: payerBase,
        seedAmount,
        outcomeIndex,
      }),
    )
    return market
  }

  const seeded: Record<string, unknown> = {
    baseMint,
    config: (await marketPda.config()).address.toString(),
  }

  log('creating a categorical spread of 3 Funding sub-markets')
  const categoricalSubject = await seedOpenSubject(ctx, 3)
  const categorical: string[] = []
  for (let i = 0; i < 3; i++) categorical.push(await createOne(categoricalSubject.toString(), i, BELOW_FLOOR))
  seeded.categoricalSubject = categoricalSubject.toString()
  seeded.categoricalMarkets = categorical

  let active: ActiveMarketSeed | null = null
  log('creating + activating a tradable market (outcome 0)')
  try {
    const liveSubject = await seedOpenSubject(ctx, 2)
    active = await createAndActivateMarket(
      ctx,
      liveSubject.toString(),
      payerBase,
      { outcomeIndex: 0, split: true },
      log,
    )
    seeded.activeMarket = active.market
    seeded.activeSubject = liveSubject.toString()
  } catch (e) {
    console.warn(`[dev] ⚠ market activation failed, seeding a funded market instead: ${(e as Error).message}`)
    const fallback = await seedOpenSubject(ctx, 2)
    seeded.fundedMarket = await createOne(fallback.toString(), 0, MIN_LIQUIDITY)
  }

  log('creating a floor-funded, activatable market (outcome 0)')
  const activatableSubject = await seedOpenSubject(ctx, 2)
  seeded.activatableMarket = await createOne(activatableSubject.toString(), 0, MIN_LIQUIDITY)
  seeded.activatableSubject = activatableSubject.toString()

  try {
    log('activating all 3 outcome legs of a categorical subject, then resolving it')
    const resolvedSubject = await seedOpenSubject(ctx, 3)
    const legs: string[] = []
    for (let i = 0; i < 3; i++) {
      const leg = await createAndActivateMarket(ctx, resolvedSubject.toString(), payerBase, { outcomeIndex: i }, log)
      legs.push(leg.market)
    }
    await resolveSubject(ctx, resolvedSubject, 0)
    seeded.resolvedCategoricalSubject = resolvedSubject.toString()
    seeded.resolvedCategoricalMarkets = legs
  } catch (e) {
    console.warn(`[dev] ⚠ resolved-categorical seed failed (earlier markets still stand): ${(e as Error).message}`)
  }

  return { seeded, active }
}
