import type { FormEvent } from 'react'
import type { AiOracleFeed } from '@kassandra-market/oracles'
import { Card } from '../../ui'
import { buildApplyExternalAiClaimIxs } from '../../../data/actions/challenge'
import { useWriteAction } from '../../../hooks/useWriteAction'
import { ConnectGate } from './ConnectGate'
import { SubmitButton } from './formPrimitives'
import { WriteStatusRegion } from './WriteStatusRegion'

/**
 * Permissionless crank: apply the attested `AiOracleFeed` onto the connected
 * wallet's proposer (creates that proposer's `AiClaim` from the feed). Shown
 * next to the in-house `SubmitAiClaimForm` when the external feed exists.
 */
export function ApplyExternalAiClaimForm({
  pubkey,
  feed,
  refetch,
}: {
  pubkey: string
  feed?: { pubkey: string; feed: AiOracleFeed }
  refetch: () => void
}) {
  const action = useWriteAction(refetch)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!action.address) return
    void action.run(async () =>
      buildApplyExternalAiClaimIxs({
        oracle: pubkey,
        proposerAuthority: action.address!,
        payer: action.address!,
      }),
    )
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="font-serif text-subheading font-light text-platinum">
          Apply external AI claim
        </h3>
        <p className="mt-1 font-inter text-[13px] text-silver">
          Stamp this proposer’s on-chain claim from the MagicBlock GPT-oracle feed
          {feed ? ` (option ${feed.feed.option})` : ''}. Requires the external AI
          oracle to be enabled and the feed to be fresh.
        </p>
        <p className="mt-1 font-inter text-[12px] text-silver">
          The connected wallet must be a proposer on this oracle; it also pays the
          claim-PDA rent. Request the MagicBlock answer first if the feed is empty.
        </p>
      </div>
      <ConnectGate connected={action.connected}>
        <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
          <div className="flex items-center gap-3">
            <SubmitButton verb="Apply feed" status={action.status} />
          </div>
          <WriteStatusRegion status={action.status} successVerb="Applied" />
        </form>
      </ConnectGate>
    </Card>
  )
}
