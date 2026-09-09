/**
 * The `/markets` dashboard strip + filter toolbar. Pure presentation over
 * already-fetched market groups; no fetching here.
 */
import { formatSol } from '../../market/lib/marketView'
import type { MarketCounts, MarketFilter, MarketSort, MarketStats } from '../../market/lib/marketList'

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-platinum/40 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss'

const FILTERS: { value: MarketFilter; label: string; countKey: keyof MarketCounts; dot: string }[] = [
  { value: 'all', label: 'All', countKey: 'total', dot: 'bg-silver' },
  { value: 'funding', label: 'Funding', countKey: 'funding', dot: 'bg-cyan-phosphor' },
  { value: 'active', label: 'Active', countKey: 'active', dot: 'bg-coral' },
  { value: 'resolved', label: 'Resolved', countKey: 'resolved', dot: 'bg-aqua' },
  { value: 'closed', label: 'Closed', countKey: 'closed', dot: 'bg-silver-dim' },
]

const SORTS: { value: MarketSort; label: string }[] = [
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

/**
 * The stats strip. Headline is every loaded market's TVL (SOL seeded into escrow).
 */
export function UnifiedStats({ stats }: { stats: MarketStats }) {
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
            {formatSol(stats.marketTvl)}
          </span>
          <span className="font-inter text-[12px] text-silver">SOL · market TVL</span>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-serif text-heading-sm font-light leading-none tabular-nums text-platinum">
              {formatSol(stats.marketTvl)}
            </span>
            <span className="font-inter text-[12px] text-silver">Market TVL</span>
          </div>
        </div>
      </div>
    </section>
  )
}

export interface UnifiedFiltersProps {
  search: string
  onSearch: (value: string) => void
  filter: MarketFilter
  onFilter: (value: MarketFilter) => void
  sort: MarketSort
  onSort: (value: MarketSort) => void
  /** Per-stage counts — shown on the filter chips. */
  counts: MarketCounts
  /** Count shown after filtering (for the "showing N" a11y hint). */
  shown: number
}

/**
 * The accessible browse toolbar: a text search, the stage filter chips, and a
 * sort control. All three compose — the page applies search → filter → sort.
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
          <span className="sr-only">Search markets</span>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search by status or address…"
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
