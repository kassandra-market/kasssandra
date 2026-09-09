import { SectionHeader } from '../components/ui'
import { CreateMarketForm } from '../components/markets/actions/CreateMarketForm'

/**
 * Create-market page: stand up a GPT Subject and bind a prediction market to it
 * via {@link CreateMarketForm}.
 */
export default function CreateMarket() {
  return (
    <main className="mx-auto max-w-[1200px] px-6 py-20">
      <SectionHeader
        as="h1"
        eyebrow="Create"
        line1="New market"
        paragraph="Open a prediction market resolved by MagicBlock GPT. A binary market is one question with two outcomes; a categorical question shares one subject across N outcome markets."
      />
      <div className="mx-auto mt-16 max-w-[640px]">
        <CreateMarketForm />
      </div>
    </main>
  )
}
