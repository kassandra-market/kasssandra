/**
 * The mock-mode counterpart to {@link IndexerClient} — same read surface, backed
 * by fixture DTOs instead of `fetch`. Swapped in by {@link IndexerProvider} under
 * `?mock` / `VITE_MOCK=1`. The write path is intentionally NOT implemented (each
 * method throws), matching how mock oracles never let you submit a real
 * transaction — there's no chain to send one to.
 */
import type {
  AccountRead,
  CandleDto,
  ConfigDto,
  IndexerClient,
  MarketDetailDto,
  MarketDto,
  SignatureStatus,
} from "./indexer";
import { mockCandles, mockConfig, mockMarketDetail, mockMarkets } from "../data/mockMarkets";

export class MockIndexerClient {
  /** Mirrors `IndexerClient.getConfig` — the fixture `Config` singleton. */
  async getConfig(): Promise<ConfigDto | null> {
    return mockConfig();
  }

  /** Mirrors `IndexerClient.getMarkets` — every fixture market. */
  async getMarkets(): Promise<MarketDto[]> {
    return mockMarkets();
  }

  /** Mirrors `IndexerClient.getMarket` — `null` for an unknown pubkey (mirrors a 404). */
  async getMarket(pubkey: string): Promise<MarketDetailDto | null> {
    return mockMarketDetail(pubkey);
  }

  /** Mirrors `IndexerClient.getCandles` — a deterministic synthetic OHLC series. */
  async getCandles(pubkey: string, intervalSecs: number, limit = 300): Promise<CandleDto[]> {
    return mockCandles(pubkey, intervalSecs, limit);
  }

  /** No raw account reads in mock mode — always resolves to `null`. */
  async getAccount(_pubkey: string): Promise<AccountRead | null> {
    return null;
  }

  /** Mock mode has no chain to fetch a blockhash from. */
  async getBlockhash(): Promise<string> {
    throw new Error("MockIndexerClient: writes are not supported in mock mode");
  }

  /** Mock mode has no chain to relay a transaction to. */
  async sendTransaction(_txBase64: string): Promise<string> {
    throw new Error("MockIndexerClient: writes are not supported in mock mode");
  }

  /** Mock mode never submits a transaction, so there is no status to poll. */
  async getSignatureStatus(_signature: string): Promise<SignatureStatus> {
    throw new Error("MockIndexerClient: writes are not supported in mock mode");
  }
}

/**
 * Compile-time parity check. `IndexerContext` is typed `IndexerClient | null`
 * (declared in `./indexer`), and `IndexerClient` has a `private readonly base`
 * field — that makes it nominal, not structural, so `MockIndexerClient` can
 * never be assigned to the context without a cast (see `IndexerProvider.tsx`).
 * This type pins each read/write method's signature to `IndexerClient`'s own,
 * so the assignment below fails to typecheck if `MockIndexerClient` drifts
 * from `IndexerClient` on any of the 8 methods — catching most of what the
 * cast in `IndexerProvider.tsx` would otherwise silently swallow.
 *
 * Caveat: this does NOT catch a wholly NEW method being added to
 * `IndexerClient` — nothing here references a method that doesn't exist yet.
 * A properly narrowed shared interface (typing `IndexerContext` itself against
 * an interface instead of the concrete class) would close that gap too, but
 * requires editing `indexer.ts`, which is out of scope for this change.
 */
type IndexerReadWriteSurface = {
  getConfig: IndexerClient["getConfig"];
  getMarkets: IndexerClient["getMarkets"];
  getMarket: IndexerClient["getMarket"];
  getCandles: IndexerClient["getCandles"];
  getAccount: IndexerClient["getAccount"];
  getBlockhash: IndexerClient["getBlockhash"];
  sendTransaction: IndexerClient["sendTransaction"];
  getSignatureStatus: IndexerClient["getSignatureStatus"];
};
// Referenced only for its type-check side effect — assignment must typecheck.
const _parityCheck: IndexerReadWriteSurface = new MockIndexerClient();
void _parityCheck;
