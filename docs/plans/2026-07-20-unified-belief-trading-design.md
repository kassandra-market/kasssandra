# Unified belief trading (chart + order ticket)

## Context

`GroupTradePanel` (merged in `f668d1e`, "unify categorical-market trading")
already lets any Active outcome in a categorical group be traded from any one
outcome's page, without navigation: a row of clickable outcome pills sits
above `TradePanel`, swapping which market's `pubkey`/`market`/`reserves` feed
the trade form as the user picks. `TradePanel` itself renders a two-series
(YES + NO) price chart for whichever single market it was handed, plus a
YES/NO tile-button toggle to pick which side of that market to buy or sell.

This works, but exposes plumbing the user shouldn't have to think about:

- The pill row above the chart reads as a second, competing selector once the
  order ticket also lets you switch outcomes.
- YES and NO are complementary within one market (`P(NO) = 1 - P(YES)`), so
  showing both curves is redundant, and for a categorical group "NO of
  option A" isn't a well-defined bet — the real complement is "one of the
  other options."
- Selection state is split awkwardly between `GroupTradePanel` (which
  market) and `TradePanel` (yes/no), reset only via a full remount
  (`key={picked.pubkey}`) instead of an intentional transition.

## Goal

One interface, keyed to a single new concept — a **belief** — that unifies
"which outcome" and "which side" into the one thing a user is actually
choosing when they trade.

## Core model: beliefs

A belief is the distinct thing a user can bet on for this oracle:
`{ pubkey, market, reserves, outcome: 'yes' | 'no', label }`.

- **Categorical group** (`group.isGroup`): one belief per tradable (Active)
  outcome, always its YES side — `outcome: 'yes'`, `label` = the oracle-meta
  option text, falling back to `Outcome {i}` when unlabeled. NO is never
  exposed here: betting against option A means picking a different belief
  (B, C, …) from the dropdown, since "not A" isn't a single well-defined bet
  once there are 3+ options.
- **Lone binary market** (not a group): exactly two beliefs on the *same*
  single market — `{ outcome: 'yes', label: boundLabel ?? 'Yes' }` and
  `{ outcome: 'no', label: <the oracle's other option label, else 'No'> }`.
  This is the only place NO stays a first-class, explicitly selectable
  belief, because there's no sibling market to switch to instead — it's the
  sole way to express the complementary bet.

This list is computed once, in `GroupTradePanel` (replacing today's
`tradable` array derivation), and threaded down as-is to both the chart and
the order ticket. Whether an oracle is grouped already comes from
`useOracleGroup`; this only adds a derivation step on top of it.

## Chart: one curve per belief

`PriceChart` moves from a fixed two-series (YES/NO of one pubkey) component
to an N-series component driven by the belief list: one line per belief,
plotting only that belief's own implied-YES-probability curve. For a
binary market's NO belief, that curve is `1 - yesProbability` of the shared
market's existing candle series, computed client-side — no new indexer
endpoint. Colors come from a small fixed categorical palette, cycling if
there are more beliefs than colors.

Note: this means a lone binary market's chart shows **two** curves (YES and
NO), matching its two-entry dropdown below — a deliberate final call to keep
the chart and dropdown showing the exact same belief set everywhere, made
after this drifted from an earlier "always a single YES curve" brainstorm
answer; confirmed and kept as-is once the discrepancy surfaced during manual
browser verification (Task 6).

Above the chart, a row of small pills — visually similar to today's outcome
tabs but **not clickable** — shows one pill per belief: color dot, label,
live probability. Pure legend/readout, replacing both the old clickable
pill-row selector and the old big YES/NO price tiles. This whole block
(chart + legend) moves from `TradePanel` up into `GroupTradePanel`, since it
no longer depends on which belief is selected to trade — every belief's
curve is always visible regardless of what's selected in the order ticket.

## Order ticket: belief dropdown + Buy/Sell

The existing two-button `OutcomeButton` YES/NO row is replaced by a single
custom dropdown (no listbox primitive exists in `ui/` yet, so this is a new
small component): a trigger button showing the selected belief's label +
live price + chevron, opening a popover list of every belief with its own
live price, closing on select / outside-click / Escape.

Selecting a belief sets the one piece of state the rest of the form keys
off — `{ pubkey, market, reserves, outcome }` — replacing what used to be
split between `GroupTradePanel`'s `selected` (which market) and
`TradePanel`'s `outcome` (yes/no). This state now lives entirely inside
`TradePanel`, defaulting to the current page's own market's YES belief when
it's Active, else the first tradable belief (mirrors today's default logic).

Buy/Sell mode tabs (`ModeTabs`) are unchanged. Because a belief already
carries `outcome`, `buildBuyIxs`/`buildSellIxs` need **no changes** — Buy
still means "obtain the belief's `outcome` shares" (split KASS into a
cYES+cNO pair, swap the unwanted leg), Sell still unwinds that same leg.
Only the selection UI changes; balances, the "you receive" preview, and
price-impact math all read off the selected belief's `market`/`reserves`/
`outcome` instead of separate props.

One explicit behavior change: since switching the dropdown no longer
remounts `TradePanel` (today's pill-row switch does, via
`key={picked.pubkey}`), the amount field is reset and the slippage
disclosure closed whenever the selected belief changes — otherwise a
half-typed amount for belief A would silently carry over to belief B.

## Component wiring

- `GroupTradePanel`: computes `beliefs` (replacing `tradable`), renders the
  chart + legend pills, and passes the whole `beliefs` array + `detail` down
  into `TradePanel` — no longer a single picked market/pubkey/reserves/
  boundLabel.
- `TradePanel`: gains the belief-dropdown + internal selection state
  described above; loses the chart (moved to `GroupTradePanel`) and the
  `OutcomeButton` row.
- `PriceChart`: new props — an array of `{ pubkey, label, color }` series
  descriptors instead of a single `pubkey`. `refreshKey` becomes a signature
  over *all* beliefs' reserves combined (not just the selected one), so any
  trade in the group reloads every curve — simplest correct option, and
  trades are infrequent enough that reloading all series isn't wasteful.

## Edge cases

- Unlabeled binary market → generic "Yes"/"No" beliefs (today's fallback,
  unchanged).
- Categorical group with only one Active outcome so far → a 1-entry
  dropdown/chart, no synthetic NO; more entries appear as siblings activate,
  without remounting (selection is keyed by `pubkey` + `outcome`, not by
  array position).
- A selected belief that disappears after a resolve/refetch (e.g. the
  oracle resolves mid-session) falls back through the same default-belief
  logic used on mount.

## Testing

- `PriceChart`: multi-series rendering, a binary market's derived NO curve
  (`1 - yes`), color cycling beyond the palette size.
- `TradePanel`: dropdown default-belief selection (own market when Active,
  else first tradable), amount/slippage reset on belief switch, unchanged
  buy/sell instruction building per selected `outcome`.
- `GroupTradePanel`: `beliefs` derivation for both a categorical group and a
  lone binary market; legend pills are non-interactive (no click handler).
- `MarketDetail` (`marketDetailTabsGrouped.render.test.tsx`): Trade tab
  still gates/defaults the same way now that selection lives inside
  `TradePanel` instead of `GroupTradePanel`.
