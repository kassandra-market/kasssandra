import { Card, SectionHeader } from '../ui'

const FEATURES: { title: string; body: string }[] = [
  {
    title: 'Economic security',
    body: 'Proposer, fact, and vote bonds put capital behind every claim. Stakers settle disputes, wrong answers are slashed, and the accounting stays conservation-safe.',
  },
  {
    title: 'AI-assisted, verifiable',
    body: 'A pinned model reruns over the agreed facts and commits its hashes on-chain — so a challenger can independently reproduce the verdict, not just trust it.',
  },
  {
    title: 'Futarchy-governed',
    body: 'Parameters and the treasury are set by market-based governance through MetaDAO — the protocol tunes itself by what the market decides, not by decree.',
  },
  {
    title: 'Optimistic by default',
    body: 'Most answers resolve uncontested and cheap. Only genuine disputes escalate to the AI rerun and the challenge markets, where the stakes are real.',
  },
]

/**
 * "Why Kassandra" — a centered SectionHeader over a 2-col grid of flat feature
 * cards (Feature Side Card pattern): serif heading, bronze body, hairline edge.
 * Collapses to a single column on mobile.
 */
export default function WhyKassandra() {
  return (
    <section id="why-kassandra" aria-label="Why Kassandra" className="px-6 py-20">
      <div className="mx-auto max-w-[1200px]">
        <SectionHeader
          eyebrow="Why Kassandra"
          eyebrowPill
          line1="Credible answers,"
          line2="not just confident ones."
          paragraph="Bonds, an open-source resolver, and market-based governance combine into an oracle you can audit end to end."
        />

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2">
          {FEATURES.map((f) => (
            <Card key={f.title} className="h-full">
              <h3 className="font-serif text-heading-sm font-light text-sepia">{f.title}</h3>
              <p className="mt-3 font-inter text-body text-bronze">{f.body}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
