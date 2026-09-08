import { useState, type FormEvent } from 'react'
import { decodeAiOracleConfig, pda } from '@kassandra-market/oracles'
import { Card } from '../../ui'
import { buildRequestAiOracleIxs } from '../../../data/actions/challenge'
import { useWriteAction } from '../../../hooks/useWriteAction'
import { ConnectGate } from './ConnectGate'
import { Field, SubmitButton, TextInput } from './formPrimitives'
import { WriteStatusRegion } from './WriteStatusRegion'

/**
 * Permissionless request: CPI MagicBlock solana-gpt-oracle `interact_with_llm`
 * (when `AiOracleConfig.llm_context` is set) so the off-chain GPT oracle later
 * writes this oracle's `AiOracleFeed`.
 */
export function RequestAiOracleForm({
  pubkey,
  refetch,
}: {
  pubkey: string
  refetch: () => void
}) {
  const action = useWriteAction(refetch)
  const [text, setText] = useState(
    `Resolve oracle ${pubkey}. Reply with JSON {"option_index": N} only.`,
  )

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!action.address) return
    void action.run(async () => {
      const configPda = await pda.aiOracleConfig()
      const info = await action.connection.getAccountInfo(configPda.address)
      let llmContext: string | undefined
      if (info?.data) {
        const cfg = decodeAiOracleConfig(info.data)
        if (cfg.enabled) llmContext = cfg.llmContext.toString()
      }
      return buildRequestAiOracleIxs({
        oracle: pubkey,
        payer: action.address!,
        text,
        llmContext,
      })
    })
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="font-serif text-subheading font-light text-platinum">
          Request MagicBlock AI
        </h3>
        <p className="mt-1 font-inter text-[13px] text-silver">
          Ask MagicBlock’s solana-gpt-oracle to answer this oracle. The callback
          writes the attested feed; then apply it onto a proposer.
        </p>
      </div>
      <ConnectGate connected={action.connected}>
        <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
          <Field label="Prompt" hint="Forwarded to interact_with_llm (max 700 bytes).">
            {(ids) => (
              <TextInput
                ids={ids}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            )}
          </Field>
          <div className="flex items-center gap-3">
            <SubmitButton verb="Request AI" status={action.status} />
          </div>
          <WriteStatusRegion status={action.status} successVerb="Requested" />
        </form>
      </ConnectGate>
    </Card>
  )
}
