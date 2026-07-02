/**
 * A tiny localStorage-backed map from an Oracle PDA → its creation `nonce`.
 *
 * The Oracle account does NOT store its own nonce, yet `finalize_facts` /
 * `finalize_oracle` need it (it seeds the oracle PDA the program re-derives for
 * the signer). The read layer therefore can't supply it, and
 * {@link resolveOracleNonce} can only recover *small* nonces by a bounded PDA
 * scan. Oracles created through this app use a full-range random nonce (to avoid
 * PDA collisions), which the scan can't reach — so we remember the nonce at
 * create time here and let the finalize UI recall it before scanning.
 *
 * Scope: per-browser (localStorage). Covers the common case — cranking an oracle
 * you created on this device. For a third-party random-nonce oracle you only
 * browsed, the scan fallback still handles small nonces; a manual-nonce entry is
 * a possible future add. (The clean long-term fix — surfacing the nonce on-chain
 * — is a program change, out of scope for the dApp.)
 */

const KEY = 'kassandra:oracle-nonce'

function readMap(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** Persist an oracle's creation nonce (called on a confirmed create). */
export function rememberNonce(oracle: string, nonce: bigint): void {
  if (typeof localStorage === 'undefined') return
  try {
    const map = readMap()
    map[oracle] = nonce.toString()
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // Best-effort — a full/blocked localStorage just falls back to the scan.
  }
}

/** Recall a remembered nonce for an oracle PDA, or `null` if none is stored. */
export function recallNonce(oracle: string): bigint | null {
  const stored = readMap()[oracle]
  if (stored === undefined) return null
  try {
    return BigInt(stored)
  } catch {
    return null
  }
}
