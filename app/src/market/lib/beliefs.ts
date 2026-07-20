/**
 * A "belief" is the distinct thing a user can bet on for an oracle — the unit
 * both the price chart and the order ticket's selector are built from. A real
 * categorical group has one belief per tradable outcome (always its YES side —
 * betting against option A means picking a different belief, not buying A's
 * NO, since "not A" isn't a single well-defined bet once there are 3+ options).
 * A lone binary market has exactly two beliefs on the SAME market (YES and
 * NO), since there's no sibling market to express the complementary bet.
 */
import type { Market } from "@kassandra-market/markets";
import type { AmmReserves, MarketSummary } from "../data/markets";
import type { Outcome } from "../data/actions";
import { impliedYesProbability, outcomeLabel } from "./marketView";

export interface Belief {
  /** Stable identity for selection state — `${pubkey}:${outcome}`. */
  key: string;
  pubkey: string;
  market: Market;
  reserves: AmmReserves | null;
  outcome: Outcome;
  /** Display label — an oracle-meta option name, or a generic fallback. */
  label: string;
}

export function beliefKey(pubkey: string, outcome: Outcome): string {
  return `${pubkey}:${outcome}`;
}

/** The belief's own implied probability — the reserves' YES probability, or
 *  its complement for a NO belief. */
export function beliefProbability(belief: Pick<Belief, "reserves" | "outcome">): number | null {
  const p = impliedYesProbability(belief.reserves);
  if (p === null) return null;
  return belief.outcome === "yes" ? p : 1 - p;
}

/**
 * The full set of beliefs for this market/group.
 *  - A real categorical group (`isGroup`) → one belief per entry in `tradable`,
 *    always YES, labelled from `options[outcomeIndex]`.
 *  - A lone binary market (`!isGroup`) → two beliefs on `tradable[0]`, YES and
 *    NO, labelled from `options[0]`/`options[1]` when the oracle names both
 *    sides, else the generic "Yes"/"No".
 *  - No tradable market → `[]`.
 */
export function computeBeliefs(args: {
  isGroup: boolean;
  tradable: MarketSummary[];
  options: string[];
}): Belief[] {
  const { isGroup, tradable, options } = args;
  if (isGroup) {
    return tradable.map((m) => ({
      key: beliefKey(m.pubkey, "yes"),
      pubkey: m.pubkey,
      market: m.market,
      reserves: m.reserves,
      outcome: "yes" as const,
      label: outcomeLabel(m.market.outcomeIndex, options[m.market.outcomeIndex]),
    }));
  }
  const lone = tradable[0];
  if (!lone) return [];
  const yesLabel = options[0]?.trim() || "Yes";
  const noLabel = options[1]?.trim() || "No";
  return [
    {
      key: beliefKey(lone.pubkey, "yes"),
      pubkey: lone.pubkey,
      market: lone.market,
      reserves: lone.reserves,
      outcome: "yes",
      label: yesLabel,
    },
    {
      key: beliefKey(lone.pubkey, "no"),
      pubkey: lone.pubkey,
      market: lone.market,
      reserves: lone.reserves,
      outcome: "no",
      label: noLabel,
    },
  ];
}

/** Default selection: the CURRENT market's YES belief when it's itself
 *  tradable, else the first belief in the list; `null` when there are none. */
export function defaultBeliefKey(
  beliefs: Belief[],
  currentPubkey: string,
  currentIsActive: boolean,
): string | null {
  if (currentIsActive) {
    const own = beliefs.find((b) => b.pubkey === currentPubkey && b.outcome === "yes");
    if (own) return own.key;
  }
  return beliefs[0]?.key ?? null;
}
