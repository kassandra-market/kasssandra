/**
 * A small, dependency-free fuzzy string matcher — subsequence matching with a
 * score that rewards consecutive runs and matches at a word boundary (fzf-style,
 * simplified). No library dependency: every existing "search" in this app
 * (`Oracles.tsx`, `Markets.tsx`) is a hand-rolled plain substring filter, so this
 * follows the same minimal-deps convention, just typo-tolerant.
 */

/**
 * Score how well `query` fuzzy-matches `text` as an in-order (not necessarily
 * contiguous) subsequence, case-insensitive. Returns `null` when `query` is not
 * a subsequence of `text` at all (no match). Higher scores are better matches;
 * the scale is arbitrary (only meaningful relative to other calls), rewarding:
 *   - longer consecutive runs (typing "abc" matching "abc" beats matching "a-b-c"),
 *   - a match starting right at a word boundary (start of string, or right after
 *     a space/hyphen/underscore/slash),
 *   - an overall tighter (shorter) span from first to last matched character.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const t = text.toLowerCase();

  let score = 0;
  let searchFrom = 0;
  let firstMatch = -1;
  let consecutive = 0;

  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], searchFrom);
    if (idx === -1) return null;
    if (firstMatch === -1) firstMatch = idx;

    if (idx === searchFrom) {
      consecutive += 1;
      score += 3 + consecutive; // increasing bonus for longer consecutive runs
    } else {
      consecutive = 0;
      score += 1;
    }

    const prevChar = t[idx - 1];
    if (idx === 0 || prevChar === " " || prevChar === "-" || prevChar === "_" || prevChar === "/") {
      score += 2; // word-boundary bonus
    }

    searchFrom = idx + 1;
  }

  // Tie-breaker: a tighter overall span (first match to last match) reads as a
  // "more precise" match than the same characters scattered far apart.
  const span = searchFrom - firstMatch;
  score += Math.max(0, 20 - span) * 0.1;

  return score;
}

/** One scored match from {@link fuzzySearch}. */
export interface FuzzyMatch<T> {
  item: T;
  score: number;
}

/**
 * Fuzzy-search `items` against one or more candidate strings per item (e.g. an
 * oracle's subject AND its pubkey, so pasting a known pubkey still matches),
 * taking each item's BEST score across its candidates. Returns the top `topK`
 * matches, best first. An empty (or whitespace-only) `query` returns no
 * matches — the caller decides what to show when there's nothing to search yet.
 */
export function fuzzySearch<T>(
  query: string,
  items: readonly T[],
  getCandidates: (item: T) => readonly string[],
  topK: number,
): FuzzyMatch<T>[] {
  if (query.trim() === "") return [];
  const scored: FuzzyMatch<T>[] = [];
  for (const item of items) {
    let best: number | null = null;
    for (const candidate of getCandidates(item)) {
      const s = fuzzyScore(query, candidate);
      if (s !== null && (best === null || s > best)) best = s;
    }
    if (best !== null) scored.push({ item, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
