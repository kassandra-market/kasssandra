/**
 * SOL amount parsing for the funding forms (pure, NO React).
 *
 * The forms take a HUMAN-decimal SOL amount (e.g. `1.5`), not raw base units —
 * {@link parseSolAmount} scales it by 10^{@link SOL_DECIMALS} into the `bigint`
 * base-unit value the SDK builders consume, rejecting malformed / over-precise /
 * non-positive input with an inline message. Formatting back to a human string
 * for display lives in `lib/marketView` (`formatSol`).
 */
import { SOL_DECIMALS } from "../lib/marketView";

/** 10^SOL_DECIMALS — the base-unit scale for one whole SOL. */
const KASS_SCALE = 10n ** BigInt(SOL_DECIMALS);

/**
 * Parse a human SOL amount (`"1.5"`, `"1000"`, `".25"`) into raw base units.
 * Returns `{ value }` on success or `{ error }` with a form message:
 *  - empty / non-numeric → prompts a valid amount,
 *  - more than {@link SOL_DECIMALS} fractional digits → too-precise,
 *  - zero / negative → must be greater than zero.
 */
export function parseSolAmount(raw: string): { value?: bigint; error?: string } {
  const t = raw.trim();
  if (t === "") return { error: "Enter a SOL amount." };
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) {
    return { error: "Amount must be a number, e.g. 1.5." };
  }
  const whole = m[1] === "" ? "0" : m[1];
  const frac = m[2] ?? "";
  if (frac.length > SOL_DECIMALS) {
    return { error: `SOL supports at most ${SOL_DECIMALS} decimal places.` };
  }
  const value = BigInt(whole) * KASS_SCALE + BigInt(frac.padEnd(SOL_DECIMALS, "0") || "0");
  if (value <= 0n) return { error: "Amount must be greater than zero." };
  return { value };
}

/**
 * Additive balance gate for `asset` (default SOL): a message when the entered
 * `amount` can't be covered by `balance`, else `undefined`. Selling gates on the
 * held outcome shares, so callers pass e.g. `"YES shares"` there. A `null`
 * balance (disconnected / loading / transient error) never blocks — the on-chain
 * tx is the ultimate guard.
 */
export function balanceGateError(
  amount: bigint | undefined,
  balance: bigint | null,
  asset = "SOL",
): string | undefined {
  if (balance === null) return undefined;
  if (balance === 0n) return `You have no ${asset} — you need ${asset} to participate.`;
  if (amount !== undefined && amount > balance) {
    return `Amount exceeds your ${asset} balance.`;
  }
  return undefined;
}
