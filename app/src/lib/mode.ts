/**
 * Mock / e2e mode flags. `VITE_MOCK=1` at build time forces fixtures; in a DEV
 * build a `?mock` query param also flips into fixtures for offline preview. The
 * query-param path is DEV-ONLY: a production build must never be switchable into
 * fake data, so `import.meta.env.DEV` gates it.
 */
export function isMockMode(): boolean {
  if (import.meta.env.VITE_MOCK === '1') return true
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return new URLSearchParams(window.location.search).has('mock')
  }
  return false
}

/**
 * E2E mode (`VITE_E2E=1`, or `?e2e` in a DEV build): swap in the real-signing e2e
 * wallet driven by a Playwright-injected funded keypair, against the live cluster
 * connection. Distinct from mock mode — nothing is faked.
 */
export function isE2eMode(): boolean {
  if (import.meta.env.VITE_E2E === '1') return true
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return new URLSearchParams(window.location.search).has('e2e')
  }
  return false
}
