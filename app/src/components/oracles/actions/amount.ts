import { KASS_DECIMALS, formatKass } from '../../../lib/oracleView'

/**
 * Parse a human token amount (`"1.5"`, `"1000"`, `".25"`) into raw base units,
 * scaling by `decimals` (default KASS's 9 — the bond/stake forms). USDC amounts
 * (the challenge trade/compose forms) pass `decimals = 6`. Returns the `bigint`
 * base-unit value or an inline error message for the form.
 */
export function parseAmount(
  raw: string,
  decimals: number = KASS_DECIMALS,
): { value?: bigint; error?: string } {
  const t = raw.trim()
  if (t === '') return { error: 'Enter an amount.' }
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t)
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) {
    return { error: 'Amount must be a number, e.g. 1.5.' }
  }
  const whole = m[1] === '' ? '0' : m[1]
  const frac = m[2] ?? ''
  if (frac.length > decimals) {
    return { error: `At most ${decimals} decimal places.` }
  }
  const scale = 10n ** BigInt(decimals)
  const value = BigInt(whole) * scale + BigInt(frac.padEnd(decimals, '0') || '0')
  if (value <= 0n) return { error: 'Amount must be greater than zero.' }
  return { value }
}

/**
 * The additive KASS-balance gate message when the entered `amount` can't be
 * covered by `balance`, or `undefined` when it's coverable / unknown. The
 * on-chain tx is the ultimate guard, so an unknown balance never blocks.
 *
 * - `balance === null` (disconnected / loading / transient error) → `undefined`.
 * - `balance === 0n` → the "no KASS" message (any positive stake exceeds it).
 * - `amount > balance` → the "exceeds your KASS balance" message.
 */
export function balanceGateError(
  amount: bigint | undefined,
  balance: bigint | null,
  verb: 'bond' | 'stake',
): string | undefined {
  if (balance === null) return undefined
  if (balance === 0n) return `You have no KASS — you need KASS to ${verb}.`
  if (amount !== undefined && amount > balance) {
    return `Amount exceeds your KASS balance (${formatKass(balance)}).`
  }
  return undefined
}
