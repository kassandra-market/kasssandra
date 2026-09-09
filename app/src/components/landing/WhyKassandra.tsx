import { Card, Reveal, SectionHeader } from '../ui'

const FEATURES: { title: string; body: string }[] = [
  {
    title: 'Prediction markets',
    body: 'Binary and categorical questions on Solana. Seed liquidity, trade the AMM, redeem when GPT resolves.',
  },
  {
    title: 'Resolved by MagicBlock GPT',
    body: 'Each market binds to a markets-owned GPT Subject. MagicBlock GPT settles the outcome on-chain — no optimistic dispute round.',
  },
  {
    title: 'Futarchy-governed',
    body: 'Parameters and the treasury are set by market-based governance through MetaDAO — the protocol tunes itself by what the market decides.',
  },
  {
    title: 'On Solana',
    body: 'Fast settlement, cheap transactions, and a live AMM for every Active market. Create a question in one wallet session.',
  },
]

export default function WhyKassandra() {
  return (
    <section id="why-kassandra" aria-label="Why Kassandra" className="px-6 py-20">
      <div className="mx-auto max-w-[1200px]">
        <Reveal>
          <SectionHeader
            eyebrow="Why Kassandra"
            eyebrowPill
            line1="Markets that settle,"
            line2="not just debate."
            paragraph="Prediction markets on Solana, resolved by MagicBlock GPT, governed by MetaDAO."
          />
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 90} className="h-full">
              <Card className="h-full transition-[transform,border-color] duration-200 hover:-translate-y-1 hover:border-cyan-phosphor/40">
                <h3 className="font-serif text-heading-sm font-light text-platinum">{f.title}</h3>
                <p className="mt-3 font-inter text-body text-silver">{f.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
