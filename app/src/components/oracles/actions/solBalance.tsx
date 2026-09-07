/**
 * A quiet SOL-balance line for the staking forms (propose / submit-fact /
 * vote-fact). The additive submit gate lives in `./amount` (`balanceGateError`);
 * this is display-only.
 */
import { formatSol } from '../../../lib/oracleView'

/**
 * A quiet driftwood/bronze line under the amount input: "Your SOL: {n}" (scaled
 * to whole SOL — NOT ember). Shows a subtle "checking balance…" while the first
 * fetch is in flight; renders nothing when the balance is unknown and not loading
 * (disconnected / transient error).
 */
export function SolBalanceLine({
  balance,
  loading,
}: {
  balance: bigint | null
  loading: boolean
}) {
  if (balance === null) {
    if (loading) {
      return <p className="-mt-1 font-inter text-[12px] text-silver">Checking balance…</p>
    }
    return null
  }
  return (
    <p className="-mt-1 font-inter text-[12px] text-silver">
      Your SOL: <span className="text-silver">{formatSol(balance)}</span>
    </p>
  )
}
