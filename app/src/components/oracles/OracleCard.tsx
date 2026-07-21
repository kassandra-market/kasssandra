import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Phase } from '@kassandra-market/oracles'
import { Card } from '../ui'
import { PhaseChip } from './PhaseChip'
import { OracleCardCta } from './OracleCardCta'
import type { OracleMetaView } from '../../hooks/useOracleMeta'
import type { OracleSummary } from '../../data/oracles'
import { RESOLVED_OPTION_NONE, phaseView, relativeDeadline } from '../../lib/oracleView'

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-platinum/40 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss'

/**
 * One oracle with no bound market yet, rendered as a clickable Auros card —
 * shared by the unified `/markets` list. The card's own "go to this oracle"
 * click target is the inner `oracle-card-link`; the management CTA
 * ({@link OracleCardCta}) sits OUTSIDE it as a sibling, since it's itself a
 * link/interactive control and can't validly nest inside another anchor.
 */
export function OracleCard({
  summary,
  search,
  meta,
  enterIndex,
}: {
  summary: OracleSummary
  search: string
  meta?: OracleMetaView
  /** First-load stagger index (undefined = no entrance animation). */
  enterIndex?: number
}) {
  const { pubkey, oracle } = summary
  const stagger = enterIndex !== undefined
  const { label } = phaseView(oracle.phase)
  const resolved = oracle.phase === Phase.Resolved
  const hasResolvedOption = resolved && oracle.resolvedOption !== RESOLVED_OPTION_NONE
  const options = meta?.options ?? []
  const SHOWN = 6

  return (
    <Card
      className={`flex h-full flex-col gap-3 transition-[transform,border-color] duration-200 ease-out has-[a.oracle-card-link:hover]:-translate-y-0.5 has-[a.oracle-card-link:hover]:border-cyan-phosphor/40 motion-reduce:has-[a.oracle-card-link:hover]:translate-y-0${stagger ? ' stagger-in' : ''}`}
      style={
        stagger
          ? ({ '--stagger-delay': `${Math.min(enterIndex, 10) * 40}ms` } as CSSProperties)
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-2">
        <PhaseChip phase={oracle.phase} />
        <span className="font-inter text-[12px] text-silver">
          {relativeDeadline(oracle.deadline)}
        </span>
      </div>

      <Link
        to={{ pathname: `/oracles/${pubkey}`, search }}
        className={`oracle-card-link flex flex-1 flex-col gap-3 rounded-sm ${focusRing}`}
      >
        <h3 className="font-serif text-subheading font-light text-platinum">
          {meta?.subject ?? label}
        </h3>
        {options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {options.slice(0, SHOWN).map((opt, i) => (
              <span
                key={i}
                className="rounded-tag border border-hairline bg-liquid-deep px-2 py-0.5 font-inter text-[12px] text-silver"
              >
                {opt}
              </span>
            ))}
            {options.length > SHOWN && (
              <span className="rounded-tag px-2 py-0.5 font-inter text-[12px] text-silver">
                +{options.length - SHOWN}
              </span>
            )}
          </div>
        )}

        <dl className="mt-auto flex flex-wrap gap-x-5 gap-y-1 font-inter text-[13px] text-silver">
          <div className="flex gap-1">
            <dt className="text-silver">Proposers</dt>
            <dd className="font-medium text-platinum">{oracle.proposerCount}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-silver">Facts</dt>
            <dd className="font-medium text-platinum">{oracle.factCount}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-silver">Options</dt>
            <dd className="font-medium text-platinum">{oracle.optionsCount}</dd>
          </div>
        </dl>

        {resolved ? (
          <p className="font-inter text-[13px] text-aqua">
            {hasResolvedOption
              ? `Resolved · option ${oracle.resolvedOption}`
              : 'Resolved · no valid option'}
          </p>
        ) : null}
      </Link>

      <OracleCardCta oracle={oracle} pubkey={pubkey} search={search} />
    </Card>
  )
}

export default OracleCard
