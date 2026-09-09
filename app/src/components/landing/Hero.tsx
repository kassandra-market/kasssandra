import { useMemo, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Button, Reveal } from '../ui'
import { usePointerField } from '../../hooks/usePointerField'
import { useMarkets } from '../../market/hooks/useMarkets'
import { buildHeroCards, type HeroCard, type HeroTone } from '../../lib/heroFeed'

/** Desktop scatter slot: absolute placement + parallax drift depth (foreground = larger). */
const POSITIONS: { pos: string; depth: number }[] = [
  { pos: 'lg:top-[24px] lg:left-0', depth: 12 },
  { pos: 'lg:top-[8px] lg:right-[16px]', depth: 7 },
  { pos: 'lg:top-[286px] lg:left-0', depth: 9 },
  { pos: 'lg:top-[300px] lg:right-0', depth: 13 },
  { pos: 'lg:bottom-[8px] lg:left-[96px]', depth: 6 },
  { pos: 'lg:bottom-[28px] lg:right-[120px]', depth: 10 },
]

/** Chip color per tone — subtle Auros hairlines, ember reserved for the Active moment. */
const TONE_CLASSES: Record<HeroTone, string> = {
  neutral: 'border-hairline text-silver-mist',
  info: 'border-cyan-phosphor/30 text-cyan-phosphor',
  accent: 'border-lavender-phosphor/30 text-lavender-phosphor',
  ember: 'border-coral/40 text-coral',
  confirmed: 'border-aqua/40 text-aqua',
  muted: 'border-hairline text-silver-dim',
}

/** A loading placeholder in a scatter slot — shown only while live data is still fetching. */
function SkeletonCard({ index }: { index: number }) {
  const slot = POSITIONS[index]
  return (
    <div className={'w-full lg:absolute lg:w-[248px] ' + slot.pos} aria-hidden="true">
      <div className="drift" style={{ '--drift-depth': `${slot.depth}px` } as CSSProperties}>
        <div className="animate-pulse rounded-card border border-hairline bg-liquid-kelp p-4 motion-reduce:animate-none">
          <div className="flex items-center justify-between gap-2">
            <div className="h-2.5 w-14 rounded bg-white/10" />
            <div className="h-4 w-16 rounded-tag bg-white/10" />
          </div>
          <div className="mt-4 h-3 w-full rounded bg-white/10" />
          <div className="mt-2 h-3 w-2/3 rounded bg-white/10" />
          <div className="mt-3 h-3 w-1/2 rounded bg-white/10" />
        </div>
      </div>
    </div>
  )
}

function ConstellationCard({ card, index }: { card: HeroCard; index: number }) {
  const slot = POSITIONS[index]
  return (
    <Reveal className={'w-full lg:absolute lg:w-[248px] ' + slot.pos} delay={index * 90} data-slot={index}>
      <div className="drift" style={{ '--drift-depth': `${slot.depth}px` } as CSSProperties}>
        <Link
          to={card.href}
          className="group block rounded-card border border-hairline bg-liquid-kelp p-4 transition-[transform,border-color] duration-200 hover:-translate-y-1 hover:border-cyan-phosphor/40 focus-visible:outline-none focus-visible:border-cyan-phosphor/60"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="label-eyebrow font-inter text-[11px] text-silver-mist">{card.kind}</span>
            <span
              className={
                'rounded-tag border px-2 py-0.5 font-inter text-[10px] font-medium uppercase tracking-[0.08em] ' +
                TONE_CLASSES[card.tone]
              }
            >
              {card.status}
            </span>
          </div>
          <p className="mt-3 line-clamp-2 font-inter text-[14px] leading-snug text-liquid-mist">
            {card.title}
          </p>
          <p className="mt-2 font-inter text-[13px] font-medium tabular-nums text-silver">
            <span className="text-lavender-phosphor">{card.metricAccent}</span> {card.metricLabel}
          </p>
        </Link>
      </div>
    </Reveal>
  )
}

/**
 * Hero — the signature Auros constellation, backed by live prediction markets
 * (top markets by liquidity). A bioluminescent orb tracks the cursor and each
 * card drifts toward it at its own depth. While the first fetch is in flight,
 * loading skeletons fill the slots. Desktop: cards are absolutely scattered
 * around the headline; mobile: a stacked grid.
 */
export default function Hero() {
  const fieldRef = usePointerField<HTMLElement>()
  const { data: markets, loading: marketsLoading } = useMarkets()

  const cards = useMemo(() => buildHeroCards(markets ?? []).slice(0, 6), [markets])
  const showSkeletons = cards.length === 0 && marketsLoading

  return (
    <section
      id="top"
      ref={fieldRef}
      aria-labelledby="hero-heading"
      className="relative overflow-hidden px-6 pt-16 pb-8 lg:pt-20"
    >
      <div aria-hidden="true" className="cursor-orb pointer-events-none absolute inset-0 z-0" />

      <div className="relative z-10 mx-auto max-w-[1200px] lg:min-h-[680px]">
        <div className="relative z-10 mx-auto flex max-w-[680px] flex-col items-center text-center lg:absolute lg:inset-0 lg:justify-center">
          <div className="drift" style={{ '--drift-depth': '-4px' } as CSSProperties}>
            <h1
              id="hero-heading"
              className="font-serif font-light text-platinum text-[clamp(3rem,8vw,4rem)] leading-[1] tracking-[-0.03em]"
            >
              <span className="block">Markets,</span>
              <span className="block italic text-silver">resolved.</span>
            </h1>
            <p className="mt-6 max-w-[520px] font-inter text-[17px] leading-relaxed text-silver">
              Kassandra is a prediction-market protocol on Solana. Trade on binary and
              categorical questions; MagicBlock GPT settles the outcome.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Button variant="PrimaryChestnut">Read the docs</Button>
              <Button
                variant="GhostOutline"
                onClick={() =>
                  document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })
                }
              >
                See how it works
              </Button>
            </div>
          </div>
        </div>

        <div
          aria-label="Featured live markets"
          aria-busy={showSkeletons}
          className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:mt-0 lg:block"
        >
          {cards.length > 0
            ? cards.map((card, i) => <ConstellationCard key={card.id} card={card} index={i} />)
            : showSkeletons
              ? POSITIONS.map((_, i) => <SkeletonCard key={i} index={i} />)
              : null}
        </div>
      </div>
    </section>
  )
}
