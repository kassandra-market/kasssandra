/**
 * E2E-mode detection. Gated ON in the Playwright browser suite (the Vite dev
 * server is started with `VITE_E2E=1`) or ad-hoc via a `?e2e` query param in a
 * DEV build, so {@link AppProviders} can swap the real WalletProvider for the
 * injected real-signing {@link E2eWalletProvider}. The `?e2e` path is DEV-ONLY
 * (`import.meta.env.DEV`, folded to `false` + eliminated in prod) so a production
 * build can never be flipped into the real-signing e2e wallet by URL.
 */
export function isE2eMode(): boolean {
  if (import.meta.env.VITE_E2E === '1') return true
  return (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('e2e')
  )
}
