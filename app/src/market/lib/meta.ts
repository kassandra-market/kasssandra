/**
 * Optional display metadata for a GPT Subject (the `Market.oracle` PDA).
 * Subjects do not store a question string on-chain; callers may still pass
 * client-side labels (tests, a future indexer) so cards can lead with a title.
 */
export interface OracleMetaView {
  /** The human question, when known. */
  subject?: string
  /** Option labels (index-aligned with `outcomeIndex`). */
  options?: string[]
}
