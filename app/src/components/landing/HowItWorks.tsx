import { Card, EyebrowTag, Reveal, SectionHeader, TriggerPreviewCard } from '../ui'

const STEPS: { step: string; title: string; body: string }[] = [
  {
    step: '01',
    title: 'Create',
    body: 'Stand up a GPT Subject and bind a binary or categorical prediction market to it. Seed the funding pool in the same transaction.',
  },
  {
    step: '02',
    title: 'Fund',
    body: 'Anyone can contribute SOL until the market hits its liquidity floor. At the floor, anyone can activate and compose the cYES/cNO pool.',
  },
  {
    step: '03',
    title: 'Trade',
    body: 'Once Active, the AMM prices YES against NO. Buy or sell shares; implied probability is the live market estimate.',
  },
  {
    step: '04',
    title: 'GPT resolves',
    body: 'MagicBlock GPT settles the subject. Winning shares redeem 1 SOL; the market closes after claims.',
  },
]

/**
 * "How it works" — create → fund → trade → GPT resolves.
 */
export default function HowItWorks() {
  return (
    <section id="how-it-works" aria-label="How it works" className="px-6 py-20">
      <div className="mx-auto max-w-[1200px]">
        <Reveal>
          <SectionHeader
            eyebrow="How it works"
            eyebrowPill
            line1="A prediction market"
            line2="with a mind."
            paragraph="Create a market, fund it to the floor, trade the live AMM, and let MagicBlock GPT resolve the question on-chain."
          />
        </Reveal>
        <ol className="mt-16 grid list-none grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.step} delay={i * 90} className="h-full">
              <Card className="h-full transition-[transform,border-color] duration-200 hover:-translate-y-1 hover:border-cyan-phosphor/40">
                <EyebrowTag>{`Step ${s.step}`}</EyebrowTag>
                <h3 className="mt-3 font-serif text-heading-sm font-light text-platinum">{s.title}</h3>
                <p className="mt-2 font-inter text-body text-silver">{s.body}</p>
              </Card>
            </Reveal>
          ))}
        </ol>

        <Reveal className="mx-auto mt-10 max-w-[520px]" delay={120}>
          <TriggerPreviewCard
            whenLabel="When"
            condition="MagicBlock GPT settles the subject while"
            variable="subject.status == Resolved"
            actionLabel="+ Redeem · winning shares pay 1 SOL"
          />
        </Reveal>
      </div>
    </section>
  )
}
