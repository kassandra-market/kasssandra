import type { Market, Oracle } from '@kassandra-market/oracles'
import {
  PRICE_SCALE,
  instantaneousPrice,
  marginProgress,
  twapPrice,
  type AmmV04,
} from '../../data/ammV04'
import { useMarketAmms } from '../../hooks/useMarketAmms'
import { formatUnits, formatUsdc, relativeDeadline } from '../../lib/oracleView'
import { Chip } from './Chip'

/**
 * The progress at which the FAIL TWAP is treated as "near" the disqualify margin
 * and the single ember accent lights up (the one Auros punctuation moment for
 * this panel). `>= 1` means it has cleared the margin (would disqualify).
 */
const NEAR_MARGIN = 0.85

/** Format a PRICE_SCALE-scaled TWAP (1e12) as a human decimal price string. */
function formatTwap(scaled: bigint): string {
  return (Number(scaled) / Number(PRICE_SCALE)).toFixed(4)
}

/** Format a decimals-aware spot ratio for display. */
function formatSpot(price: number | null): string {
  return price === null ? '—' : price.toFixed(4)
}

/** One pool's prices + reserves (labelled, decimals-aware). */
function PoolColumn({ label, amm }: { label: string; amm: AmmV04 | null }) {
  const spot = amm ? instantaneousPrice(amm) : null
  const twap = amm ? twapPrice(amm) : null
  return (
    <div className="rounded-card border border-hairline bg-liquid-kelp p-4">
      <div className="font-inter text-[11px] uppercase tracking-[0.06em] text-silver">{label}</div>
      {amm ? (
        <>
          <dl className="mt-2 flex flex-col gap-1.5 font-inter text-[13px]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-silver">Spot price</dt>
              <dd className="tabular-nums text-platinum">{formatSpot(spot)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-silver">TWAP</dt>
              <dd className="tabular-nums text-platinum">
                {twap === null ? (
                  <span className="text-silver">TWAP forming…</span>
                ) : (
                  formatTwap(twap)
                )}
              </dd>
            </div>
          </dl>
          <div className="mt-3 border-t border-hairline pt-2 font-inter text-[12px]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-silver">Base reserve</span>
              <span className="tabular-nums text-silver">
                {formatUnits(amm.baseAmount, amm.baseDecimals)}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="text-silver">Quote reserve</span>
              <span className="tabular-nums text-silver">
                {formatUnits(amm.quoteAmount, amm.quoteDecimals)}
              </span>
            </div>
          </div>
        </>
      ) : (
        <p className="mt-2 font-inter text-[13px] text-silver">Pool not readable.</p>
      )}
    </div>
  )
}

/**
 * The live challenge-market visualization (read-only, CU1) — rendered inside the
 * detail's Challenge-market section when a Market exists, ENRICHING the existing
 * market card. Shows the pass vs fail spot price + TWAP, a flat Auros
 * TWAP→margin progress bar (how close FAIL is to clearing the disqualify margin
 * over PASS — the ONE ember accent lights when near/over), a countdown to the
 * TWAP window close, the challenger's escrowed USDC, and each pool's decimals-
 * scaled reserves. Chart-lib-free (divs + tokens). Degrades gracefully: pre-start-delay
 * TWAP reads "forming…", a settled market shows a calm settled note, and a
 * disconnected/mock viewer still sees the read view.
 */
export function ChallengeMarketPanel({ market, oracle }: { market: Market; oracle: Oracle }) {
  const { pass, fail, loading } = useMarketAmms(market)

  const passTwap = pass ? twapPrice(pass) : null
  const failTwap = fail ? twapPrice(fail) : null
  const progress = marginProgress(
    failTwap,
    passTwap,
    oracle.marketThresholdNum,
    oracle.marketThresholdDen,
  )
  const twapReady = passTwap !== null && failTwap !== null
  const near = twapReady && progress >= NEAR_MARGIN
  const over = twapReady && progress >= 1
  const fillPct = Math.min(Math.max(progress, 0), 1) * 100

  return (
    <div className="mt-4 rounded-card border border-hairline bg-liquid-deep p-5">
      {/* The single ember punctuation moment for this panel is the margin bar
          below; the header chip stays quiet (settled / countdown) so there is
          exactly ONE ember accent on screen. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-serif text-subheading font-light text-platinum">Live market</span>
        {market.settled ? (
          <Chip tone="confirmed">Settled</Chip>
        ) : (
          <Chip>{relativeDeadline(market.twapEnd).replace('ends', 'settles')}</Chip>
        )}
      </div>

      {/* Pass vs fail prices + reserves */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PoolColumn label="Pass pool" amm={pass} />
        <PoolColumn label="Fail pool" amm={fail} />
      </div>

      {/* TWAP → disqualify-margin progress (fail vs pass). */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-inter text-[12px] text-silver">
            Fail-vs-pass TWAP · disqualify margin{' '}
            {oracle.marketThresholdNum.toString()}/{oracle.marketThresholdDen.toString()}
          </span>
          <span
            className={`font-inter text-[12px] tabular-nums ${near ? 'text-coral' : 'text-platinum'}`}
          >
            {twapReady ? `${Math.round(progress * 100)}%` : '—'}
          </span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-liquid-kelp">
          <div
            className={`h-full rounded-full ${near ? 'bg-coral' : 'bg-silver'}`}
            style={{ width: `${twapReady ? fillPct : 0}%` }}
          />
        </div>
        <p className="mt-1 font-inter text-[11px] text-silver">
          {!twapReady
            ? 'TWAP forming — the time-weighted price is not yet meaningful (pre start-delay).'
            : over
              ? 'The fail TWAP has cleared the margin over pass — settling would disqualify the proposer.'
              : 'How close the fail TWAP is to exceeding pass by the disqualify margin.'}
        </p>
      </div>

      {/* Countdown + challenger position */}
      <dl className="mt-5 grid grid-cols-1 gap-3 border-t border-hairline pt-4 sm:grid-cols-2">
        <div>
          <dt className="font-inter text-[11px] uppercase tracking-[0.06em] text-silver">
            TWAP window
          </dt>
          <dd className="mt-0.5 font-inter text-[14px] text-platinum">
            {market.twapEnd <= BigInt(Math.floor(Date.now() / 1000))
              ? 'Window closed'
              : relativeDeadline(market.twapEnd).replace('ends in', 'settles in')}
          </dd>
        </div>
        <div>
          <dt className="font-inter text-[11px] uppercase tracking-[0.06em] text-silver">
            Challenger USDC
          </dt>
          <dd className="mt-0.5 font-inter text-[14px] tabular-nums text-platinum">
            {formatUsdc(market.challengerUsdc)} USDC
          </dd>
        </div>
      </dl>

      {loading && !pass && !fail ? (
        <p className="mt-3 font-inter text-[12px] text-silver" role="status">
          Reading the pools…
        </p>
      ) : null}
    </div>
  )
}

export default ChallengeMarketPanel
