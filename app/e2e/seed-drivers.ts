/**
 * Subject helpers for the browser E2E: fabricate markets-owned GPT Subject
 * PDAs (the `Market.oracle` resolution source) at Open or Resolved status.
 *
 * IMPORTANT: every pubkey handed to an `@kassandra-market/markets` builder is
 * passed as a base58 STRING (`.toString()`), never a foreign `Address`.
 */
import { Phase } from '@kassandra-market/markets'
import type { Address } from '../../sdks/markets/ts/test/surfpool/harness/index.ts'
import type { SeedCtx } from './seed-core.ts'

export async function seedOpenSubject(ctx: SeedCtx, optionsCount = 2): Promise<Address> {
  return ctx.harness.seedOracle({ optionsCount, phase: Phase.Open })
}

export async function seedResolvedSubject(
  ctx: SeedCtx,
  resolvedOption: number,
  optionsCount = 2,
): Promise<Address> {
  return ctx.harness.seedOracle({
    optionsCount,
    phase: Phase.Resolved,
    resolvedOption,
  })
}

/** Re-seed an existing Subject to Resolved with the winning option. */
export async function resolveSubject(
  ctx: SeedCtx,
  subject: Address,
  resolvedOption: number,
): Promise<void> {
  await ctx.harness.setOracleResolved(subject, resolvedOption)
}
