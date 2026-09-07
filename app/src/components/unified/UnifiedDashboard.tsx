/**
 * The unified `/markets` dashboard strip + filter toolbar — the combined-list
 * counterpart of `oracles/DashboardStats.tsx`, spanning both bare oracles and
 * bound market groups. Pure presentation over the already-fetched + merged
 * data; no fetching here.
 */
import { formatSol } from '../../lib/oracleView'
import type { CombinedStats } from '../../lib/unifiedList'
import type { UnifiedCounts, UnifiedFilter, UnifiedSort } from '../../lib/unifiedList'

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-platinum/40 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss'

/** One monetary figure: a scaled-SOL serif value over an Inter label. */
function MoneyTile({ amount, label }: { amount: bigint; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-serif text-heading-sm font-light leading-none tabular-nums text-platinum">
        {formatSol(amount)}
      </span>
      <span className="font-inter text-[12px] text-silver">{label}</span>
    </div>
  )
}

/**
 * The combined stats strip. The headline "Capital at stake" sums the oracle
 * bond economics (still-contestable oracles) and every loaded market's TVL —
 * both raw SOL, just two different economics riding on the same token — then
 * breaks that down into four tiles: the oracle bond pool, dispute bonds, and
 * stake, plus market TVL.
 */
export function UnifiedStats({ stats }: { stats: CombinedStats }) {
  const headline = stats.bondsAtRisk + stats.marketTvl
  return (
    <section
      aria-label="Capital at stake"
      className="mt-10 rounded-card border border-hairline bg-liquid-kelp px-6 py-5"
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="font-inter text-[12px] uppercase tracking-wide text-silver">
            Capital at stake
          </span>
          <span className="font-serif text-heading font-light leading-none tabular-nums text-lavender-phosphor">
            {formatSol(headline)}
          </span>
          <span className="font-inter text-[12px] text-silver">SOL · oracles + markets</span>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <MoneyTile amount={stats.bondPoolActive} label="Bond pool" />
          <MoneyTile amount={stats.disputeBondsActive} label="Dispute bonds" />
          <MoneyTile amount={stats.stakedActive} label="Staked" />
          <MoneyTile amount={stats.marketTvl} label="Market TVL" />
        </div>
      </div>
    </section>
  )
}

// --- filter + sort toolbar ---------------------------------------------------

const FILTERS: { value: UnifiedFilter; label: string; countKey: keyof UnifiedCounts; dot: string }[] = [
  { value: 'all', label: 'All', countKey: 'total', dot: 'bg-silver' },
  { value: 'proposal', label: 'Proposal', countKey: 'proposal', dot: 'bg-silver' },
  { value: 'inDispute', label: 'In dispute', countKey: 'inDispute', dot: 'bg-cyan-phosphor' },
  { value: 'aiClaim', label: 'AI claim', countKey: 'aiClaim', dot: 'bg-lavender-phosphor' },
  { value: 'challenge', label: 'Challenged', countKey: 'challenge', dot: 'bg-coral' },
  { value: 'funding', label: 'Funding', countKey: 'funding', dot: 'bg-cyan-phosphor' },
  { value: 'active', label: 'Active', countKey: 'active', dot: 'bg-coral' },
  { value: 'resolved', label: 'Resolved', countKey: 'resolved', dot: 'bg-aqua' },
  { value: 'closed', label: 'Closed', countKey: 'closed', dot: 'bg-silver-dim' },
]

const SORTS: { value: UnifiedSort; label: string }[] = [
  { value: 'value', label: 'Value at stake' },
  { value: 'stage', label: 'Stage' },
]

/** A single toggle button (filter chip or sort option) with `aria-pressed`. */
function ToggleChip({
  active,
  label,
  onClick,
  dot,
  count,
}: {
  active: boolean
  label: string
  onClick: () => void
  dot?: string
  count?: number
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-tag border px-3 py-2 font-inter text-[13px] font-medium transition-colors ${focusRing} ${
        active
          ? 'border-platinum/30 bg-liquid-deep text-platinum'
          : 'border-hairline bg-transparent text-silver hover:border-silver hover:text-platinum'
      }`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />}
      <span>{label}</span>
      {count !== undefined && <span className="tabular-nums text-[12px] text-silver">{count}</span>}
    </button>
  )
}

export interface UnifiedFiltersProps {
  search: string
  onSearch: (value: string) => void
  filter: UnifiedFilter
  onFilter: (value: UnifiedFilter) => void
  sort: UnifiedSort
  onSort: (value: UnifiedSort) => void
  /** Per-stage counts — shown on the filter chips. */
  counts: UnifiedCounts
  /** Count shown after filtering (for the "showing N" a11y hint). */
  shown: number
}

/**
 * The accessible browse toolbar: a text search, the stage filter chips (real
 * `aria-pressed` toggle buttons carrying each stage's count + a subtle color
 * hint shared with the phase/status chips), and a sort control. All three
 * compose — the page applies search → filter → sort in that order.
 */
export function UnifiedFilters({
  search,
  onSearch,
  filter,
  onFilter,
  sort,
  onSort,
  counts,
  shown,
}: UnifiedFiltersProps) {
  return (
    <div className="mt-8 flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2">
          <span className="sr-only">Search markets and oracles</span>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search by question, phase, status, or address…"
            className={`w-full rounded-button border border-hairline bg-liquid-kelp px-3 py-2 font-inter text-[14px] text-platinum placeholder:text-silver sm:w-72 ${focusRing}`}
          />
        </label>

        <div className="flex items-center gap-2" role="group" aria-label="Sort">
          <span className="font-inter text-[12px] text-silver">Sort</span>
          {SORTS.map(({ value, label }) => (
            <ToggleChip key={value} active={sort === value} label={label} onClick={() => onSort(value)} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by stage">
        {FILTERS.map(({ value, label, countKey, dot }) => (
          <ToggleChip
            key={value}
            active={filter === value}
            label={label}
            dot={dot}
            count={counts[countKey]}
            onClick={() => onFilter(value)}
          />
        ))}
        <span className="ml-auto font-inter text-[12px] text-silver" aria-live="polite">
          {shown} shown
        </span>
      </div>
    </div>
  )
}
