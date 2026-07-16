import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Oracle } from '@kassandra-market/oracles'
import { verdictFor } from '../../lib/phaseTimeline'

/** A back-to-list link that preserves the mock query param. */
export function BackLink({ search }: { search: string }) {
  return (
    <Link
      to={{ pathname: '/oracles', search }}
      className="inline-block font-inter text-[14px] text-sepia underline decoration-pebble underline-offset-4 hover:text-lavender-phosphor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sepia/40 focus-visible:ring-offset-2 focus-visible:ring-offset-parchment"
    >
      ← All oracles
    </Link>
  )
}

/** A compact labelled statistic tile. */
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-card border border-pebble bg-pure-card p-4">
      <div className="font-inter text-[11px] uppercase tracking-[0.06em] text-driftwood">{label}</div>
      <div className="mt-1 font-serif text-subheading font-light text-sepia">{value}</div>
    </div>
  )
}

/**
 * A statistic tile with a graphical proportion meter. Reads the raw `value`, then
 * a hairline track filled to `value / total` — turning bare counts (surviving of
 * options, settled of facts) into an at-a-glance bar. `accent` lights the fill
 * aqua for the one figure worth punctuating (e.g. open challenges); the rest stay
 * a quiet bronze. Falls back to a flat empty track when `total` is 0.
 */
export function StatMeter({
  label,
  value,
  total,
  accent = false,
}: {
  label: string
  value: number
  total?: number
  accent?: boolean
}) {
  const pct = total && total > 0 ? Math.min(Math.max(value / total, 0), 1) * 100 : 0
  return (
    <div className="rounded-card border border-pebble bg-pure-card p-4">
      <div className="font-inter text-[11px] uppercase tracking-[0.06em] text-driftwood">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-serif text-subheading font-light tabular-nums text-sepia">{value}</span>
        {total != null ? (
          <span className="font-inter text-[12px] tabular-nums text-driftwood">/ {total}</span>
        ) : null}
      </div>
      {total != null ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-soft-cream">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              accent && value > 0 ? 'bg-chestnut' : 'bg-bronze/70'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        <div className="mt-2 h-1.5" aria-hidden />
      )}
    </div>
  )
}

/**
 * The at-a-glance verdict banner — a calm h2 under the title (NOT a second h1).
 * Resolved reads a confirmed chestnut "Resolved · Option N"; a dead-end reads
 * muted stone; in-flight shows the current phase + a one-line "what's next".
 */
export function VerdictBanner({ oracle }: { oracle: Oracle }) {
  const v = verdictFor(oracle)
  // In-flight stays a quiet bronze stripe — the header PhaseChip already carries
  // the single ember "Challenged" spark, so the banner never doubles it up.
  const accent =
    v.kind === 'resolved'
      ? 'border-l-chestnut'
      : v.kind === 'deadend'
        ? 'border-l-stone'
        : 'border-l-bronze'
  const titleClass =
    v.kind === 'resolved' ? 'text-chestnut' : v.kind === 'deadend' ? 'text-stone' : 'text-sepia'
  return (
    <div
      role="status"
      className={`mt-6 rounded-card border border-pebble border-l-4 ${accent} bg-pure-card py-4 pl-5 pr-4`}
    >
      <h2 className={`font-serif text-subheading font-light ${titleClass}`}>{v.title}</h2>
      <p className="mt-1 font-inter text-[13px] text-bronze">{v.detail}</p>
    </div>
  )
}

/** A section wrapper: a serif-lite heading + optional count, then its content. */
export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mt-14">
      <h2 className="font-serif text-heading-sm font-light text-sepia">
        {title}
        {count != null ? <span className="ml-2 font-inter text-[14px] text-driftwood">({count})</span> : null}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** Definition row for the readable-parameters + accounts blocks. */
export function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-pebble py-2 last:border-b-0">
      <dt className="font-inter text-[13px] text-driftwood">{term}</dt>
      <dd className="font-inter text-[14px] text-sepia">{children}</dd>
    </div>
  )
}
