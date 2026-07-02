import { groupDigits } from '../../../lib/oracleView'

/**
 * Parse a KASS amount typed as a whole number of base units (raw, unscaled —
 * matching how the detail view shows bond/stake). Returns the `bigint` value or
 * an inline error message for the form.
 */
export function parseAmount(raw: string): { value?: bigint; error?: string } {
  const t = raw.trim()
  if (t === '') return { error: 'Enter a KASS amount.' }
  if (!/^\d+$/.test(t)) return { error: 'Amount must be a whole number of KASS base units.' }
  const value = BigInt(t)
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
    return `Amount exceeds your KASS balance (${groupDigits(balance)}).`
  }
  return undefined
}
