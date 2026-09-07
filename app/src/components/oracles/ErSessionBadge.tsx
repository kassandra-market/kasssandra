import { ER_STATUS_DELEGATED, type ErSession } from '@kassandra-market/oracles'
import { Chip } from './Chip'

/** Badge showing whether this oracle is delegated to a MagicBlock ephemeral rollup. */
export function ErSessionBadge({ session }: { session?: ErSession }) {
  if (!session) return null
  const delegated = session.status === ER_STATUS_DELEGATED
  return (
    <Chip
      tone={delegated ? 'info' : 'muted'}
      aria-label={delegated ? 'Delegated to ephemeral rollup' : 'On Solana base layer'}
    >
      {delegated ? 'Ephemeral rollup' : 'Base layer'}
    </Chip>
  )
}
