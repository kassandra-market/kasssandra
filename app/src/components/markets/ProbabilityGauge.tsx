/**
 * A semicircle implied-probability gauge (chart-lib-free SVG) for an Active
 * market: an ember arc sweeps left→right in proportion to the YES share, with the
 * big YES% read in the well and NO% quietly beneath. `null` (empty/absent pool)
 * renders a calm placeholder so the tab never collapses. The value is real text
 * too (never colour-only). `pathLength={100}` normalizes the arc so the fill is
 * simply `${yesPct} 100` regardless of the geometric arc length.
 */
export function ProbabilityGauge({ probability }: { probability: number | null }) {
  if (probability === null) {
    return (
      <div className="flex h-[132px] flex-col items-center justify-center gap-1 text-center">
        <span className="font-serif text-subheading font-light text-driftwood">—</span>
        <span className="font-inter text-[12px] text-driftwood">Live price unavailable</span>
      </div>
    )
  }
  const yesPct = Math.round(probability * 100)
  const noPct = 100 - yesPct
  // Arc geometry: a 180° sweep, radius 80, centre (100,100).
  const arc = 'M 20 100 A 80 80 0 0 1 180 100'
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-[200px]">
        <svg viewBox="0 0 200 108" className="w-full" aria-hidden>
          <path
            d={arc}
            fill="none"
            strokeWidth={12}
            strokeLinecap="round"
            style={{ stroke: 'var(--color-soft-cream)' }}
          />
          <path
            d={arc}
            fill="none"
            strokeWidth={12}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${yesPct} 100`}
            style={{ stroke: 'var(--color-ember-orange)', transition: 'stroke-dasharray 0.5s cubic-bezier(0.2,0,0,1)' }}
          />
        </svg>
        {/* Centred read-out sitting in the arc well. */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span className="font-serif text-heading-sm font-light tabular-nums text-ember-orange">
            {yesPct}%
          </span>
          <span className="font-inter text-[11px] uppercase tracking-[0.06em] text-driftwood">
            implied YES
          </span>
        </div>
      </div>
      <div
        className="mt-1 flex w-[200px] items-baseline justify-between font-inter text-[12px]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={yesPct}
        aria-label="Implied YES probability"
      >
        <span className="font-medium text-ember-orange">YES {yesPct}%</span>
        <span className="text-driftwood">NO {noPct}%</span>
      </div>
    </div>
  )
}

export default ProbabilityGauge
