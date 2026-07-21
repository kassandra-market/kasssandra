/**
 * Enable mock mode. `VITE_MOCK=1` at build time forces it; in a DEV build a
 * `?mock` query param also flips it into fixtures for offline preview. The
 * query-param path is DEV-ONLY: a production build must never be switchable into
 * fake data (fixtures under the real origin are a confusion/phishing lever), so
 * `import.meta.env.DEV` gates it — Vite folds that to `false` in prod and
 * dead-code-eliminates the branch.
 */
export function isMockMode(): boolean {
  if (import.meta.env.VITE_MOCK === '1') return true
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return new URLSearchParams(window.location.search).has('mock')
  }
  return false
}

/**
 * E2E mode (`VITE_E2E=1`, or `?e2e` in a DEV build): swap in the REAL-SIGNING e2e
 * wallet (`lib/e2eWallet`) driven by a Playwright-injected funded keypair,
 * against the LIVE cluster connection. Distinct from mock mode — nothing is
 * faked; the write path signs + sends + confirms on the local validator. The
 * `?e2e` query-param path is DEV-ONLY (gated on `import.meta.env.DEV`) so a
 * production build can never be flipped into the real-signing e2e wallet by URL.
 */
export function isE2eMode(): boolean {
  if (import.meta.env.VITE_E2E === '1') return true
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return new URLSearchParams(window.location.search).has('e2e')
  }
  return false
}
