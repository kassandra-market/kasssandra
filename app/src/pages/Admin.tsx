import { useState, type FormEvent } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import { Card } from '../components/ui'
import { Field, SubmitButton, TextInput } from '../components/oracles/actions/formPrimitives'
import { WriteStatusRegion } from '../components/oracles/actions/WriteStatusRegion'
import { ConnectGate } from '../components/oracles/actions/ConnectGate'
import { useWriteAction } from '../hooks/useWriteAction'
import {
  buildSpotPriceIxs,
  buildResolveDeadendIxs,
  buildSetConfigIxs,
  buildSetGovernanceIxs,
} from '../data/actions/admin'

function useParam(name: string): string {
  return typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get(name) ?? '')
}

/**
 * The /admin page — the DAO / governance ops the participant flows don't expose:
 * set_governance, set_config, resolve_deadend, spot_price. Each is gated on-chain
 * (admin / DAO authority = the connected wallet). Deliberately minimal: these are
 * operator actions, driven from the connected wallet.
 */
export default function Admin() {
  const { publicKey } = useWallet()
  const authority = publicKey?.toBase58() ?? ''

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <h1 className="font-serif text-heading font-medium text-platinum">Admin · governance</h1>
      <ConnectGate connected={Boolean(publicKey)}>
        <SetGovernance authority={authority} />
        <SetConfig authority={authority} />
        <ResolveDeadend authority={authority} />
        <SpotPrice />
      </ConnectGate>
    </section>
  )
}

function SetGovernance({ authority }: { authority: string }) {
  const action = useWriteAction()
  const [spotDao, setSpotDao] = useState(useParam('spotDao'))
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void action.run(() => buildSetGovernanceIxs({ authority, spotDao }))
  }
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="font-serif text-subheading text-platinum">Set governance</h3>
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <Field label="SOL DAO address">
          {(ids) => (
            <TextInput ids={ids} placeholder="Dao PDA (base58)" value={spotDao} onChange={(e) => setSpotDao(e.target.value)} />
          )}
        </Field>
        <SubmitButton verb="Set governance" status={action.status} />
        <WriteStatusRegion status={action.status} successVerb="Governance set" />
      </form>
    </Card>
  )
}

function SetConfig({ authority }: { authority: string }) {
  const action = useWriteAction()
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void action.run(() => buildSetConfigIxs({ authority }))
  }
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="font-serif text-subheading text-platinum">Set config</h3>
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <p className="font-inter text-[13px] text-silver-mist">Applies the baseline governable params.</p>
        <SubmitButton verb="Set config" status={action.status} />
        <WriteStatusRegion status={action.status} successVerb="Configured" />
      </form>
    </Card>
  )
}

function ResolveDeadend({ authority }: { authority: string }) {
  const action = useWriteAction()
  const [oracle, setOracle] = useState(useParam('oracle'))
  const [option, setOption] = useState(useParam('option') || '0')
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void action.run(() => buildResolveDeadendIxs({ oracle, authority, option: Number(option) }))
  }
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="font-serif text-subheading text-platinum">Resolve dead-end</h3>
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <Field label="Oracle address">
          {(ids) => (
            <TextInput ids={ids} placeholder="Oracle PDA (base58)" value={oracle} onChange={(e) => setOracle(e.target.value)} />
          )}
        </Field>
        <Field label="Resolved option">
          {(ids) => (
            <TextInput ids={ids} inputMode="numeric" placeholder="0" value={option} onChange={(e) => setOption(e.target.value)} />
          )}
        </Field>
        <SubmitButton verb="Resolve dead-end" status={action.status} />
        <WriteStatusRegion status={action.status} successVerb="Resolved" />
      </form>
    </Card>
  )
}

function SpotPrice() {
  const action = useWriteAction()
  const [spotDao, setSpotDao] = useState(useParam('spotDao'))
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void action.run(() => buildSpotPriceIxs({ spotDao }))
  }
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="font-serif text-subheading text-platinum">Read SOL price</h3>
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <Field label="SOL DAO address">
          {(ids) => (
            <TextInput ids={ids} placeholder="Dao PDA (base58)" value={spotDao} onChange={(e) => setSpotDao(e.target.value)} />
          )}
        </Field>
        <SubmitButton verb="Read SOL price" status={action.status} />
        <WriteStatusRegion status={action.status} successVerb="Price read" />
      </form>
    </Card>
  )
}
