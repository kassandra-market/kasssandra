import { Card, EyebrowTag } from '../ui'

const FLANK: { title: string; body: string }[] = [
  {
    title: 'Futarchy governance',
    body: 'MetaDAO markets set parameters and steer the treasury.',
  },
  {
    title: 'Challenge markets',
    body: 'Disputes become markets where honest capital is rewarded.',
  },
  {
    title: 'Bonds & slashing',
    body: 'Every claim is backed; wrong answers lose their bond.',
  },
  {
    title: 'Verifiable verdicts',
    body: 'Pinned model + committed hashes — reproduce it yourself.',
  },
]

function FlankCard({ title, body }: { title: string; body: string }) {
  return (
    <Card className="h-full">
      <h3 className="font-serif text-subheading font-light text-sepia">{title}</h3>
      <p className="mt-2 font-inter text-body text-bronze">{body}</p>
    </Card>
  )
}

/**
 * Trust / credibility — the Centered Portrait Panel pattern. A tall 16px-radius
 * centerpiece carries the ONE gradient permitted by the guide (a warm orange-red
 * ambient) with a white role overlay near the bottom that fades into parchment.
 * Flanked by two stacked feature cards on each side; on mobile everything
 * collapses to a single column with the portrait first.
 */
export default function TrustPanel() {
  return (
    <section aria-labelledby="trust-heading" className="px-6 py-20">
      <div className="mx-auto max-w-[1200px]">
        <h2 id="trust-heading" className="sr-only">
          Trust and credibility
        </h2>
        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[1fr_minmax(320px,380px)_1fr]">
          {/* Left flank (stacked) — appears after the portrait on mobile via order. */}
          <div className="order-2 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:order-1 lg:grid-cols-1">
            <FlankCard {...FLANK[0]} />
            <FlankCard {...FLANK[1]} />
          </div>

          {/* Centerpiece portrait panel — the ONE allowed card gradient. */}
          <div className="order-1 lg:order-2">
            <div
              role="img"
              aria-label="The open-source resolver — anyone can run it"
              className="relative flex min-h-[440px] flex-col justify-between overflow-hidden rounded-card p-8 pb-16 lg:min-h-[520px]"
              style={{
                background:
                  'radial-gradient(120% 90% at 30% 15%, #ff7a3d 0%, #f65726 34%, #7a2f10 72%, #3e2407 100%)',
              }}
            >
              <div className="relative z-10">
                <EyebrowTag className="!text-peach-glow">Open source</EyebrowTag>
                <p className="mt-4 max-w-[16ch] font-serif text-heading-sm font-light leading-tight text-white">
                  Reproducible by anyone, trusted by no one.
                </p>
              </div>

              <div className="relative z-10">
                <p className="font-inter text-[15px] font-medium text-white">
                  The open-source resolver
                </p>
                <p className="mt-1 font-inter text-[13px] text-white/75">
                  Rerun the pinned model over the agreed facts and check the committed hashes
                  yourself.
                </p>
              </div>

              {/* Soft bottom fade merging into the parchment canvas. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-12"
                style={{
                  background: 'linear-gradient(to top, #fdf6ee 0%, rgba(253,246,238,0) 100%)',
                }}
              />
            </div>
          </div>

          {/* Right flank (stacked). */}
          <div className="order-3 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-1">
            <FlankCard {...FLANK[2]} />
            <FlankCard {...FLANK[3]} />
          </div>
        </div>
      </div>
    </section>
  )
}
