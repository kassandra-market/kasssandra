import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Oracle } from '@kassandra-market/oracles'
import { isActionReady, nextOracleAction } from '../../lib/oracleCardAction'
import { windowLabel } from '../../lib/oracleView'

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-platinum/40 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss'

const ctaBaseClass =
  'inline-flex items-center justify-center gap-1.5 self-start rounded-button border px-3 py-1.5 font-inter text-[12px]'

/** `search` (e.g. `?mock`) with `tab` merged in, preserving every other param. */
function withTab(search: string, tab: string): string {
  const params = new URLSearchParams(search)
  params.set('tab', tab)
  return `?${params.toString()}`
}

/**
 * The oracle-list card's stage-appropriate management CTA: the next action for
 * `oracle`'s current phase (see `lib/oracleCardAction.ts`), rendered as a link
 * into the relevant detail-page tab when its on-chain window is open — or a
 * disabled, greyed-out control with a live countdown when it isn't yet.
 *
 * Deliberately navigational, never an inline write here: a card only has the
 * LIST-level `Oracle` fields (no per-wallet participation, no proposer/fact
 * PDA tails), so it can say "propose an outcome" but not safely claim "you
 * haven't already" — the detail page's own Manage/Facts tab has the full
 * picture and does the real write.
 */
export function OracleCardCta({ oracle, pubkey, search }: { oracle: Oracle; pubkey: string; search: string }) {
  const [nowSec, setNowSec] = useState(() => BigInt(Math.floor(Date.now() / 1000)))
  useEffect(() => {
    // Coarse tick (matches `OracleDetail`'s own polling cadence) — the
    // countdown text only ever shows coarse units (d/h/m/s), so a per-second
    // timer would repaint far more often than the label could ever change.
    const id = setInterval(() => setNowSec(BigInt(Math.floor(Date.now() / 1000))), 15_000)
    return () => clearInterval(id)
  }, [])

  const action = nextOracleAction(oracle, nowSec)
  if (!action) return null
  const ready = isActionReady(action, nowSec)

  if (!ready) {
    return (
      <span
        aria-disabled="true"
        title={`Opens in ${windowLabel(action.readyAt! - nowSec)}`}
        className={`${ctaBaseClass} cursor-not-allowed border-hairline/60 text-silver-dim`}
      >
        {action.label}
        <span className="tabular-nums text-silver-dim">· {windowLabel(action.readyAt! - nowSec)}</span>
      </span>
    )
  }

  return (
    <Link
      to={{ pathname: `/oracles/${pubkey}`, search: withTab(search, action.tab) }}
      onClick={(e) => e.stopPropagation()}
      className={`${ctaBaseClass} border-hairline bg-liquid-deep text-platinum transition-colors hover:border-cyan-phosphor/40 hover:text-coral ${focusRing}`}
    >
      {action.label}
      <span aria-hidden="true">→</span>
    </Link>
  )
}

export default OracleCardCta
