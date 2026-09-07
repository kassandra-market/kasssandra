/**
 * Offline unit tests for `src/market/data/amount.ts` — human-decimal SOL parsing
 * into raw base units (scale 10^9, rejecting malformed / over-precise / non-positive
 * input) and the additive balance gate. Pure, no React / chain.
 */
import { describe, expect, it } from 'vitest'

import { balanceGateError, parseSolAmount } from '../src/market/data/amount'

describe('parseSolAmount', () => {
  it('scales human decimals into base units (10^9)', () => {
    expect(parseSolAmount('1')).toEqual({ value: 1_000_000_000n })
    expect(parseSolAmount('1.5')).toEqual({ value: 1_500_000_000n })
    expect(parseSolAmount('.25')).toEqual({ value: 250_000_000n }) // leading dot
    expect(parseSolAmount('1000')).toEqual({ value: 1_000_000_000_000n })
    expect(parseSolAmount('  2  ')).toEqual({ value: 2_000_000_000n }) // trimmed
    expect(parseSolAmount('0.123456789')).toEqual({ value: 123_456_789n }) // max precision
  })

  it('rejects empty / non-numeric input', () => {
    expect(parseSolAmount('').error).toMatch(/enter a base amount/i)
    expect(parseSolAmount('   ').error).toMatch(/enter a base amount/i)
    expect(parseSolAmount('abc').error).toMatch(/must be a number/i)
    expect(parseSolAmount('-1').error).toMatch(/must be a number/i) // sign not allowed
    expect(parseSolAmount('1e9').error).toMatch(/must be a number/i)
  })

  it('rejects more than 9 fractional digits', () => {
    expect(parseSolAmount('1.1234567890').error).toMatch(/at most 9 decimal/i)
  })

  it('rejects zero / effectively-zero amounts', () => {
    expect(parseSolAmount('0').error).toMatch(/greater than zero/i)
    expect(parseSolAmount('0.0').error).toMatch(/greater than zero/i)
    expect(parseSolAmount('0.000000000').error).toMatch(/greater than zero/i)
  })
})

describe('balanceGateError', () => {
  it('never blocks on a null balance (disconnected / loading)', () => {
    expect(balanceGateError(5n, null)).toBeUndefined()
    expect(balanceGateError(undefined, null)).toBeUndefined()
  })

  it('blocks a zero balance outright', () => {
    expect(balanceGateError(undefined, 0n)).toMatch(/no base/i)
    expect(balanceGateError(1n, 0n)).toMatch(/no base/i)
  })

  it('blocks only when the amount exceeds the balance', () => {
    expect(balanceGateError(150n, 100n)).toMatch(/exceeds your base balance/i)
    expect(balanceGateError(100n, 100n)).toBeUndefined() // equal is fine
    expect(balanceGateError(50n, 100n)).toBeUndefined()
    expect(balanceGateError(undefined, 100n)).toBeUndefined() // nothing entered yet
  })
})
