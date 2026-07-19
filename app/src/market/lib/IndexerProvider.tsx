import { useMemo, type ReactNode } from "react";
import { IndexerClient, IndexerContext } from "./indexer";
import { MockIndexerClient } from "./mockIndexerClient";
import { isMockMode } from "../../data/mockOracles";

/**
 * Provides the app's single {@link IndexerClient} — the sole data + transaction
 * gateway (same-origin `/api/*`). Replaces the old RPC connection provider: the
 * app no longer knows about RPC endpoints or clusters, it only ever talks to the
 * indexer. The `useIndexer()` hook lives in `./indexer`.
 *
 * Under mock mode (`?mock` / `VITE_MOCK=1`, see `isMockMode`) a
 * {@link MockIndexerClient} is swapped in instead, so `/markets`,
 * `/markets/:pubkey`, and the price chart render off fixture data with no
 * indexer or RPC reachable. No cast is needed: `IndexerContext` is typed
 * against `IndexerReads` (`./indexer`) — a structural `Pick` of
 * `IndexerClient`'s 8 public methods, with its private `base` field stripped
 * out — and `MockIndexerClient` declares `implements IndexerReads`, so it's
 * directly assignable here.
 */
export function IndexerProvider({ children }: { children: ReactNode }) {
  const client = useMemo(
    () => (isMockMode() ? new MockIndexerClient() : new IndexerClient()),
    [],
  );
  return <IndexerContext.Provider value={client}>{children}</IndexerContext.Provider>;
}

export default IndexerProvider;
