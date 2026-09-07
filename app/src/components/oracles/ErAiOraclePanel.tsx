import { Card } from '../ui'
import type { AiOracleFeed, ErSession } from '@kassandra-market/oracles'
import { ER_STATUS_DELEGATED } from '@kassandra-market/oracles'
import { Truncated } from './Truncated'

/** Overview panel: ER session + latest attested AI feed. */
export function ErAiOraclePanel({
  session,
  feed,
}: {
  session?: { pubkey: string; session: ErSession }
  feed?: { pubkey: string; feed: AiOracleFeed }
}) {
  if (!session && !feed) return null
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {session ? (
        <Card>
          <h3 className="font-serif text-subheading font-light text-platinum">
            Ephemeral rollup
          </h3>
          <p className="mt-1 font-inter text-[13px] text-silver">
            {session.session.status === ER_STATUS_DELEGATED
              ? 'This oracle is delegated to a MagicBlock ER validator. Interactive phases run on the rollup until undelegate.'
              : 'This oracle has an ER session but is currently on the Solana base layer.'}
          </p>
          <dl className="mt-3 space-y-1 font-inter text-[13px] text-silver">
            <div className="flex justify-between gap-4">
              <dt>Commit cadence</dt>
              <dd className="tabular-nums text-platinum">
                {session.session.commitFrequencyMs} ms
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Last commit slot</dt>
              <dd className="tabular-nums text-platinum">
                {session.session.lastCommitSlot.toString()}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt>Validator</dt>
              <dd>
                <Truncated value={session.session.validator.toString()} label="ER validator" />
              </dd>
            </div>
          </dl>
        </Card>
      ) : null}
      {feed ? (
        <Card>
          <h3 className="font-serif text-subheading font-light text-platinum">
            External AI feed
          </h3>
          <p className="mt-1 font-inter text-[13px] text-silver">
            Latest attested categorical answer written by the configured pusher.
            Apply it onto a proposer during the AI-claim round.
          </p>
          <dl className="mt-3 space-y-1 font-inter text-[13px] text-silver">
            <div className="flex justify-between gap-4">
              <dt>Option</dt>
              <dd className="tabular-nums text-platinum">{feed.feed.option}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Slot</dt>
              <dd className="tabular-nums text-platinum">{feed.feed.slot.toString()}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt>Pushed by</dt>
              <dd>
                <Truncated value={feed.feed.updatedBy.toString()} label="feed pusher" />
              </dd>
            </div>
          </dl>
        </Card>
      ) : null}
    </div>
  )
}
