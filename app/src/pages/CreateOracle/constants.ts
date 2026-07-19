export const selectClass =
  'w-full rounded-tag border border-hairline bg-liquid-kelp px-3 py-2 font-inter text-[14px] ' +
  'text-platinum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-platinum/40 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss'

export const textareaClass =
  'w-full rounded-tag border border-hairline bg-liquid-kelp px-3 py-2 font-inter text-[14px] ' +
  'text-platinum placeholder:text-silver focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-platinum/40 focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss ' +
  'aria-[invalid=true]:border-coral/60'

// Valid-base58 KASS/USDC placeholders for the offline `?mock` render (no protocol
// on-chain) — chosen so the client-side address validation passes and the
// submitting/success states are drivable via `?mock&wallet=connected`.
export const MOCK_KASS = 'So11111111111111111111111111111111111111112'
export const MOCK_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
