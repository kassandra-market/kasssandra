import { useState, type FormEvent } from 'react'
import type { Address } from '@solana/web3.js'
import { VOTE_APPROVE, VOTE_DUPLICATE } from '@kassandra-market/oracles'
import { buildVoteFactIxs } from '../../../data/actions'
import { useWriteAction } from '../../../hooks/useWriteAction'
import { ConnectGate } from './ConnectGate'
import { Field, SubmitButton, TextInput } from './formPrimitives'
import { WriteStatusRegion } from './WriteStatusRegion'
import { parseAmount, balanceGateError } from './amount'
import { useSolBalance } from '../../../hooks/useSolBalance'
import { SolBalanceLine } from './solBalance'

/**
 * Per-fact voting control (FactVoting phase only): Approve or flag Duplicate +
 * an escrowed SOL stake. Wraps WF1 `buildVoteFactIxs`. Rendered inside each
 * fact card so the vote is anchored to the fact it concerns.
 */
export function VoteControl({
  oracle,
  baseMint,
  factPubkey,
  refetch,
}: {
  oracle: string
  baseMint: Address
  factPubkey: string
  refetch: () => void
}) {
  const { balance, loading: balanceLoading, refetch: refetchBalance } = useSolBalance(
    String(baseMint),
  )
  const action = useWriteAction(() => {
    refetch()
    refetchBalance()
  })
  const [kind, setKind] = useState<number>(VOTE_APPROVE)
  const [stake, setStake] = useState('')
  const [stakeError, setStakeError] = useState<string | undefined>()
  const balanceError = balanceGateError(parseAmount(stake).value, balance, 'stake')

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = parseAmount(stake)
    if (parsed.error) {
      setStakeError(parsed.error)
      return
    }
    setStakeError(undefined)
    void action.run(() =>
      buildVoteFactIxs({
        connection: action.connection,
        oracle,
        baseMint,
        fact: factPubkey,
        voter: action.address!,
        kind,
        stake: parsed.value!,
      }),
    )
  }

  const choiceClass = (active: boolean) =>
    `flex-1 rounded-tag border px-3 py-1.5 font-inter text-[13px] ${
      active ? 'border-aqua bg-liquid-deep text-aqua' : 'border-hairline bg-liquid-kelp text-silver'
    } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-platinum/40 focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss`

  return (
    <div className="mt-1 border-t border-hairline pt-3">
      <ConnectGate connected={action.connected}>
        <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
          <div className="flex gap-2" role="radiogroup" aria-label="Vote on this fact">
            <button
              type="button"
              role="radio"
              aria-checked={kind === VOTE_APPROVE}
              onClick={() => setKind(VOTE_APPROVE)}
              className={choiceClass(kind === VOTE_APPROVE)}
            >
              Approve
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={kind === VOTE_DUPLICATE}
              onClick={() => setKind(VOTE_DUPLICATE)}
              className={choiceClass(kind === VOTE_DUPLICATE)}
            >
              Duplicate
            </button>
          </div>
          <Field label="Stake (SOL)" error={stakeError ?? balanceError}>
            {(ids) => (
              <TextInput
                ids={ids}
                inputMode="decimal"
                placeholder="e.g. 1"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
              />
            )}
          </Field>
          <SolBalanceLine balance={balance} loading={balanceLoading} />
          <div>
            <SubmitButton verb="Cast vote" status={action.status} disabled={Boolean(balanceError)} />
          </div>
          <WriteStatusRegion status={action.status} successVerb="Voted" />
        </form>
      </ConnectGate>
    </div>
  )
}

export default VoteControl
