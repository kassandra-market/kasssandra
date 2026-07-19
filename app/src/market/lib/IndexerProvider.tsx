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
 * indexer or RPC reachable. The cast below is necessary — not just convenient
 * — because `IndexerContext` is typed `IndexerClient | null` and `IndexerClient`
 * has a `private readonly base` field, which makes it a nominal type: no class
 * without that exact private field can ever be structurally assignable to it,
 * cast or not withstanding the method shapes matching. `mockIndexerClient.ts`
 * carries a compile-time parity check (`IndexerReadWriteSurface`) that pins
 * `MockIndexerClient`'s method signatures to `IndexerClient`'s own, so this
 * cast can't silently paper over a signature drift on the 8 existing methods —
 * only over a wholly new method being added to `IndexerClient` that the mock
 * doesn't yet implement. Closing that last gap would mean typing
 * `IndexerContext` itself against a shared interface instead of the concrete
 * class, which touches `indexer.ts` and is out of scope here.
 */
export function IndexerProvider({ children }: { children: ReactNode }) {
  const client = useMemo(
    () => (isMockMode() ? (new MockIndexerClient() as unknown as IndexerClient) : new IndexerClient()),
    [],
  );
  return <IndexerContext.Provider value={client}>{children}</IndexerContext.Provider>;
}

export default IndexerProvider;
