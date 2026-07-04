/**
 * Read hooks over the indexer backend, reusing the `useAsync` primitive from
 * {@link useOracles}. Gated on {@link isIndexerConfigured} — when the indexer URL
 * is unset (or in mock mode) the hooks resolve empty without any network call, so
 * the activity feed simply renders nothing.
 */
import { fetchAccountEvents, isIndexerConfigured, type IndexedEvent } from '../data/indexer'
import { isMockMode } from '../data/mockOracles'
import { useAsync, type AsyncState } from './useOracles'

/** The indexed event history touching an account (e.g. an oracle PDA). */
export function useAccountEvents(
  account: string | undefined,
  limit = 50,
): AsyncState<IndexedEvent[]> {
  return useAsync(() => {
    if (!account || isMockMode() || !isIndexerConfigured()) return Promise.resolve([])
    return fetchAccountEvents(account, { limit })
  }, [account, limit])
}
