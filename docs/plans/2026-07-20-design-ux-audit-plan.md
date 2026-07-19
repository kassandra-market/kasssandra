# Design/UX audit remediation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the findings from the design/UX audit (`docs/plans/2026-07-20-design-ux-audit-design.md`): consolidate the legacy color-token naming onto the Auros palette, add offline mock fixtures for the Markets flow, and land two small polish fixes.

**Architecture:** Three independent slices, each its own commit(s): (1) a pure CSS-token rename + scripted class-name rename, verified by full-suite pass + a before/after screenshot diff; (2) a `MockIndexerClient` swapped in at the single `IndexerProvider` construction point, backed by new fixture DTOs; (3) two isolated component edits.

**Tech Stack:** Vite + React 19 + TypeScript, Tailwind v4 (CSS-first `@theme` in `app/src/index.css`), Vitest, Playwright (manual screenshot verification only — no new Playwright specs).

**Working directory for every step below:** `/Users/dode/Documents/solana/kassandra/.worktrees/design-ux-audit/app` (already set up: `pnpm install` done, SDK deps built, baseline typecheck clean, 302/302 tests passing).

---

## Part 1 — Design-token rename

Note on scope refinement since the design doc was written: of the 15 legacy names, **10 are exact-hex duplicates of an already-existing canonical Auros token** (`parchment`≡`liquid-abyss`, `soft-cream`/`ink-black`≡`liquid-deep`, `pure-card`/`peach-glow`≡`liquid-kelp`, `charcoal-bark`≡`liquid-mist`, `sepia`≡`platinum`, `saffron-pulse`/`cobalt`≡`cyan-phosphor`) — these get **deleted outright**, usages repointed straight to the existing canonical name, no new token needed. Only **5 legacy names have no canonical equivalent** and need a genuinely new token: `bronze`+`driftwood` (identical to each other, `#c7d3d2`, merge to one new name `silver`), `stone` (`#b3c6c3`, distinct, rename to `silver-dim`), `pebble` (hairline rgba, rename to `hairline`), `chestnut` (`#8fe9dd`, rename to `aqua`), `ember-orange` (`#ff6f61`, rename to `coral`).

### Task 1.1: Rewrite the token block in `index.css`

**Files:**
- Modify: `src/index.css:35-50`

**Step 1: Replace the legacy block**

Replace lines 35-50 (the `/* ---- Legacy (Delphi) names ... ---- */` comment through the `--color-cobalt` line) with:

```css
  /* ---- Auros accents without a canonical name above ---- */
  --color-silver: #c7d3d2; /* secondary/muted text on the lighter canvas (was bronze/driftwood — identical hex, merged) */
  --color-silver-dim: #b3c6c3; /* lowest-emphasis text — lifted to clear AA 4.5:1 on kelp cards while staying dimmer than silver (was stone) */
  --color-hairline: rgba(255, 255, 255, 0.12); /* hairline borders on dark (was pebble) */
  --color-aqua: #8fe9dd; /* positive/confirmed/active accent (success lines, confirmed chips, active toggles, current step). MUST stay distinct from the kelp card surface (was chestnut) */
  --color-coral: #ff6f61; /* error/danger signal (alerts, invalid inputs, disqualify verdicts, high-impact warnings) (was ember-orange) */
```

Also update the file-header comment block (lines 10-18) — replace the sentence "The legacy Delphi token NAMES are preserved and remapped onto the Auros palette so existing components re-skin without edits; new code should prefer the Auros-named tokens (liquid-\*, platinum, silver-mist, lavender-phosphor)." with: "Every token below is Auros-named; there is no legacy alias layer."

**Step 2: Verify the CSS still builds**

Run: `pnpm dev &` then `curl -sf http://localhost:5173/src/index.css > /dev/null && echo OK` (or simpler: `pnpm build` will fail loudly on bad CSS). Kill the dev server after.

Expected: no Tailwind/PostCSS errors about unknown tokens (there will be broken utility classes until Task 1.2 runs — that's expected, don't chase it yet).

**Step 3: Commit**

```bash
git add src/index.css
git commit -m "refactor: consolidate legacy Delphi color tokens onto Auros names"
```

### Task 1.2: Rename class usages across the codebase

**Files:** all files under `src/` matching the tokens below (28 files — full list was enumerated during design; re-derive with the grep in Step 1 to be safe against drift).

**Step 1: Confirm the file set**

```bash
grep -rlE "(^|[^a-zA-Z-])(parchment|soft-cream|pure-card|ink-black|charcoal-bark|sepia|bronze|driftwood|stone|pebble|chestnut|ember-orange|saffron-pulse|peach-glow|cobalt)([^a-zA-Z-]|$)" src --include="*.tsx" --include="*.ts" | sort
```

**Step 2: Run the rename**

Each legacy name is always used as a Tailwind color-utility suffix (`text-`, `bg-`, `border-`, `border-l-`, `ring-`, `offset-`, `decoration-`, `divide-`, `accent-`) or inside a `var(--color-NAME)` reference — always immediately preceded by a hyphen and followed by a word boundary (end of word, `/`, quote, backtick, `)`, `}`). A hyphen-anchored, word-bounded substitution is safe:

```bash
cd src
for pair in \
  "parchment:liquid-abyss" \
  "soft-cream:liquid-deep" \
  "ink-black:liquid-deep" \
  "pure-card:liquid-kelp" \
  "peach-glow:liquid-kelp" \
  "charcoal-bark:liquid-mist" \
  "sepia:platinum" \
  "saffron-pulse:cyan-phosphor" \
  "cobalt:cyan-phosphor" \
  "bronze:silver" \
  "driftwood:silver" \
  "stone:silver-dim" \
  "pebble:hairline" \
  "chestnut:aqua" \
  "ember-orange:coral" ; do
  old="${pair%%:*}"
  new="${pair##*:}"
  files=$(grep -rlE "(^|[^a-zA-Z-])${old}\b" . --include="*.tsx" --include="*.ts")
  if [ -n "$files" ]; then
    echo "$files" | xargs sed -i '' -E "s/-${old}\b/-${new}/g"
  fi
done
cd ..
```

Note: this only replaces `-${old}` (hyphen-prefixed), which is exactly how every real usage appears (`text-sepia`, `var(--color-sepia)`, `border-l-bronze`, etc.) — it will not touch the bare word `sepia` if it somehow appeared without a leading hyphen, which none of the real usages do (confirmed during design research).

**Step 3: Fix the two prose comments the sed pass will garble**

The rename turns `chestnut` → `aqua` inside two comments that read oddly afterward:

- `src/components/markets/actions/TradePanel.tsx` — was `... (YES aqua-chestnut, NO ember); ...`, will become `... (YES aqua-aqua, NO ember); ...`. Fix by hand to: `fills its tone (YES aqua, NO coral); unselected is a quiet outline.` (also fix the stale `ember` reference in the same comment — the token is now `coral`).
- `src/lib/phaseTimeline.ts` — was `... a muted (non-chestnut) end.`, will become `... a muted (non-aqua) end.` — this reads fine as-is, leave it.

Also update the three prose-only mentions that the word-boundary sed will correctly *skip* (they're not hyphen-prefixed) but are now stale terminology — fix by hand:

- `src/App.tsx:22` — "parchment tone" → "abyss tone"
- `src/lib/oracleView.ts:26` — "stone for dead-ends" → "silver-dim for dead-ends"
- `src/market/lib/marketView.ts:37` — "Lowest-emphasis stone for voided / cancelled." → "Lowest-emphasis silver-dim for voided / cancelled."

**Step 4: Verify nothing was missed**

```bash
grep -rlE "(^|[^a-zA-Z-])(parchment|soft-cream|pure-card|ink-black|charcoal-bark|sepia|bronze|driftwood|stone|pebble|chestnut|ember-orange|saffron-pulse|peach-glow|cobalt)([^a-zA-Z-]|$)" src --include="*.tsx" --include="*.ts"
```

Expected: no output (empty).

**Step 5: Typecheck + full test suite**

```bash
pnpm typecheck
pnpm test
```

Expected: typecheck clean, 302/302 tests still passing (this is a pure rename — test count/names should not change).

**Step 6: Visual regression check**

```bash
pnpm exec vite --port 5173 --strictPort &
sleep 3
```

Reuse the screenshot approach from the audit (Playwright via `@playwright/test`'s `chromium` export, run from inside `app/` for module resolution) to capture the same 9 routes as the original audit (`/?mock`, `/oracles?mock`, `/oracles/OracLeChaLLenged11111111111111111111111111111?mock`, `/oracles/OracLeReso1ved1111111111111111111111111111111?mock`, `/oracles/new?mock`, `/markets/new?mock`, `/styleguide?mock`, `/admin?mock`), diff against the pre-rename screenshots. Expect **zero visual difference** — this was a pure rename. Kill the dev server after (`kill %1`).

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: rename legacy Delphi color-token usages to Auros names"
```

---

## Part 2 — Markets mock-mode fixtures

### Task 2.1: Write the fixture DTOs

**Files:**
- Create: `src/market/data/mockMarkets/fixtures.ts`
- Test: `src/market/data/mockMarkets/fixtures.test.ts` (or `app/test/mockMarkets.unit.test.ts`, matching this repo's convention of a flat `test/` dir — check `app/test/markets.unit.test.ts` for the existing import style before choosing)

**Step 1: Look at the DTO shapes and an existing mock fixture for the pattern**

Read `src/market/lib/indexer.ts` for `MarketDto`, `MarketDetailDto`, `CandleDto`, `ConfigDto`, `ContributionDto`, `OracleDto`, `ReservesDto` type definitions, and `src/data/mockOracles/fixtures.ts` for the fixture-authoring style already established (plain literal objects, base58-look-alike pubkeys like `'OracLeChaLLenged11111111111111111111111111111'`).

**Step 2: Write the failing test**

```ts
// app/test/mockMarkets.unit.test.ts
import { describe, expect, it } from 'vitest'
import { mockMarkets, mockMarketDetail, MOCK_MARKET_PUBKEYS } from '../src/market/data/mockMarkets'
import { groupByOracle, isCategorical, mapMarketDto } from '../src/market/data/markets'

describe('mockMarkets fixtures', () => {
  it('covers funding, active, and resolved lifecycle states', async () => {
    const markets = await mockMarkets()
    const mapped = markets.map((m) => mapMarketDto(m))
    expect(mapped.some((m) => !m.openContributions && m.totalContributed === 0n)).toBe(false) // sanity: every fixture has SOME contribution
    expect(new Set(mapped.map((m) => m.status)).size).toBeGreaterThanOrEqual(3)
  })

  it('includes one categorical group (>2 sub-markets sharing an oracle)', async () => {
    const markets = await mockMarkets()
    const mapped = markets.map((dto, i) => ({
      pubkey: dto.address,
      market: mapMarketDto(dto),
      reserves: null,
      oracleOptionsCount: null,
    }))
    const groups = groupByOracle(mapped)
    expect(groups.some((g) => g.markets.length > 2)).toBe(true)
  })

  it('mockMarketDetail returns contributions for every fixture pubkey', async () => {
    for (const pubkey of MOCK_MARKET_PUBKEYS) {
      const detail = await mockMarketDetail(pubkey)
      expect(detail).not.toBeNull()
      expect(detail!.contributions.length).toBeGreaterThan(0)
    }
  })
})
```

(Adjust the exact `MarketDto` field names to match what Task 2.1 Step 1 found — this is illustrative of the shape of the test, not final code.)

**Step 3: Run it, confirm it fails on missing module**

```bash
pnpm exec vitest run test/mockMarkets.unit.test.ts
```

Expected: FAIL — `Cannot find module '../src/market/data/mockMarkets'`.

**Step 4: Write the fixtures**

Author `src/market/data/mockMarkets/fixtures.ts` exporting:
- `MOCK_MARKET_PUBKEYS: string[]` — at least 5 pubkeys covering: one pre-activation/funding market, one Active market (binary, 2 sub-markets total across its oracle group), one Resolved/settled market, and 3 markets sharing one oracle (categorical, `outcomeIndex` 0/1/2) to form the >2-sub-market group.
- `mockMarketDtos(): MarketDto[]`
- `mockMarketDetailFor(pubkey: string): MarketDetailDto | null`
- `mockCandlesFor(pubkey: string, intervalSecs: number, limit: number): CandleDto[]` — a deterministic (no `Date.now()`/`Math.random()`) synthetic OHLC series: seed a simple LCG or just a fixed sine-ish walk keyed off the candle index, centered around 0.5 implied-YES, `limit` candles spaced `intervalSecs` apart ending at a fixed constant epoch (do not use wall-clock time — keep it reproducible).
- `mockConfigDto(): ConfigDto`

Use `mapMarketDto`/`mapContributionDto` mentally as the contract — every field the mapper reads must be present with the right raw (string/number) shape, since the real fetch path round-trips through the same mapper.

**Step 5: Write `mockMarkets`, `mockMarketDetail`, index re-exports**

Create `src/market/data/mockMarkets/index.ts`:

```ts
import { mockMarketDtos, mockMarketDetailFor, mockCandlesFor, mockConfigDto, MOCK_MARKET_PUBKEYS } from './fixtures'
import type { MarketDto, MarketDetailDto, CandleDto, ConfigDto } from '../../lib/indexer'

export { MOCK_MARKET_PUBKEYS }

export async function mockMarkets(): Promise<MarketDto[]> {
  return mockMarketDtos()
}

export async function mockMarketDetail(pubkey: string): Promise<MarketDetailDto | null> {
  return mockMarketDetailFor(pubkey)
}

export async function mockCandles(pubkey: string, intervalSecs: number, limit: number): Promise<CandleDto[]> {
  return mockCandlesFor(pubkey, intervalSecs, limit)
}

export async function mockConfig(): Promise<ConfigDto> {
  return mockConfigDto()
}
```

**Step 6: Run the test, confirm it passes**

```bash
pnpm exec vitest run test/mockMarkets.unit.test.ts
```

Expected: PASS (3 tests).

**Step 7: Commit**

```bash
git add src/market/data/mockMarkets test/mockMarkets.unit.test.ts
git commit -m "feat: add mock DTO fixtures for the Markets flow"
```

### Task 2.2: Add `MockIndexerClient` and wire it into `IndexerProvider`

**Files:**
- Create: `src/market/lib/mockIndexerClient.ts`
- Modify: `src/market/lib/IndexerProvider.tsx`
- Test: `test/mockIndexerClient.unit.test.ts`

**Step 1: Write the failing test**

```ts
// app/test/mockIndexerClient.unit.test.ts
import { describe, expect, it } from 'vitest'
import { MockIndexerClient } from '../src/market/lib/mockIndexerClient'
import { MOCK_MARKET_PUBKEYS } from '../src/market/data/mockMarkets'

describe('MockIndexerClient', () => {
  it('getMarkets returns the fixture set', async () => {
    const client = new MockIndexerClient()
    const markets = await client.getMarkets()
    expect(markets.length).toBe(MOCK_MARKET_PUBKEYS.length)
  })

  it('getMarket 404s (returns null) for an unknown pubkey', async () => {
    const client = new MockIndexerClient()
    const detail = await client.getMarket('not-a-real-pubkey')
    expect(detail).toBeNull()
  })

  it('getCandles returns a non-empty deterministic series', async () => {
    const client = new MockIndexerClient()
    const a = await client.getCandles(MOCK_MARKET_PUBKEYS[0], 3600, 50)
    const b = await client.getCandles(MOCK_MARKET_PUBKEYS[0], 3600, 50)
    expect(a.length).toBeGreaterThan(0)
    expect(a).toEqual(b) // deterministic — no Date.now()/Math.random()
  })
})
```

**Step 2: Run it, confirm it fails**

```bash
pnpm exec vitest run test/mockIndexerClient.unit.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement `MockIndexerClient`**

```ts
// src/market/lib/mockIndexerClient.ts
/**
 * The mock-mode counterpart to {@link IndexerClient} — same read surface, backed
 * by fixture DTOs instead of `fetch`. Swapped in by {@link IndexerProvider} under
 * `?mock`/`VITE_MOCK=1`. The write path is intentionally NOT implemented (throws),
 * matching how mock oracles never let you submit a real transaction.
 */
import type { ConfigDto, MarketDto, MarketDetailDto, CandleDto, AccountRead, SignatureStatus } from './indexer'
import { mockMarkets, mockMarketDetail, mockCandles, mockConfig } from '../data/mockMarkets'

export class MockIndexerClient {
  async getConfig(): Promise<ConfigDto | null> {
    return mockConfig()
  }

  async getMarkets(): Promise<MarketDto[]> {
    return mockMarkets()
  }

  async getMarket(pubkey: string): Promise<MarketDetailDto | null> {
    return mockMarketDetail(pubkey)
  }

  async getCandles(pubkey: string, intervalSecs: number, limit = 300): Promise<CandleDto[]> {
    return mockCandles(pubkey, intervalSecs, limit)
  }

  async getAccount(_pubkey: string): Promise<AccountRead | null> {
    return null
  }

  async getBlockhash(): Promise<string> {
    throw new Error('MockIndexerClient: writes are not supported in mock mode')
  }

  async sendTransaction(_txBase64: string): Promise<string> {
    throw new Error('MockIndexerClient: writes are not supported in mock mode')
  }

  async getSignatureStatus(_signature: string): Promise<SignatureStatus> {
    throw new Error('MockIndexerClient: writes are not supported in mock mode')
  }
}
```

Check `IndexerClient`'s actual method signatures in `src/market/lib/indexer.ts` (read in Task 2.1 Step 1) and match exactly — the snippet above is illustrative.

**Step 4: Wire into `IndexerProvider`**

```tsx
// src/market/lib/IndexerProvider.tsx
import { useMemo, type ReactNode } from "react";
import { IndexerClient, IndexerContext } from "./indexer";
import { MockIndexerClient } from "./mockIndexerClient";
import { isMockMode } from "../../data/mockOracles";

export function IndexerProvider({ children }: { children: ReactNode }) {
  const client = useMemo(
    () => (isMockMode() ? (new MockIndexerClient() as unknown as IndexerClient) : new IndexerClient()),
    [],
  );
  return <IndexerContext.Provider value={client}>{children}</IndexerContext.Provider>;
}

export default IndexerProvider;
```

If the `as unknown as IndexerClient` cast feels wrong, prefer changing `IndexerContext`'s type to a narrower interface (`Pick<IndexerClient, 'getConfig'|'getMarkets'|'getMarket'|'getCandles'|'getAccount'|'getBlockhash'|'sendTransaction'|'getSignatureStatus'>`) — cleaner, and avoids the cast. Use judgment; either is acceptable, but do not silently drop type-safety on the whole context.

**Step 5: Run the test, confirm it passes**

```bash
pnpm exec vitest run test/mockIndexerClient.unit.test.ts
```

Expected: PASS (3 tests).

**Step 6: Full suite + typecheck**

```bash
pnpm typecheck
pnpm test
```

Expected: clean, all prior tests still passing plus the new ones.

**Step 7: Commit**

```bash
git add src/market/lib/mockIndexerClient.ts src/market/lib/IndexerProvider.tsx test/mockIndexerClient.unit.test.ts
git commit -m "feat: swap in MockIndexerClient under ?mock for the Markets flow"
```

### Task 2.3: Manual visual verification

**Step 1: Start the dev server, screenshot the previously-broken routes**

```bash
pnpm exec vite --port 5173 --strictPort &
sleep 3
```

Using the same Playwright-via-`@playwright/test` approach as the original audit, screenshot:
- `/markets?mock` (list — expect fixture cards, including the 3-way categorical group, not the "Could not load markets" error)
- `/markets/<one of MOCK_MARKET_PUBKEYS>?mock` (detail — expect the trade panel, liquidity tab, and price chart to render with data instead of the 502 error state)

Confirm no `pageerror`/`console.error` events fire (check for stray 502s — there should be none now).

**Step 2: Kill the dev server**

```bash
kill %1
```

**Step 3: No commit needed** (verification only, nothing to stage).

---

## Part 3 — Small polish batch

### Task 3.1: Jupiter stub → status badge

**Files:**
- Modify: `src/components/markets/actions/TradePanel.tsx:479-487`

**Step 1: Read `EyebrowTag`'s pill mode**

`src/components/ui/EyebrowTag.tsx` — `<EyebrowTag pill>` renders a small uppercase label in a hairline-bordered pill, the same visual language as the oracle phase badges. Confirm the import path (`../../ui` from this file's location, matching other imports already in `TradePanel.tsx`).

**Step 2: Replace the disabled checkbox**

Replace lines 479-487:

```tsx
{/* Jupiter any-token entry: DISABLED (deferred). */}
{/* TODO wire buildJupiterEntryRequest + app fetch (GET /quote → POST /swap) + composeWithEntry. */}
<label
  className="flex cursor-not-allowed items-center gap-2 font-inter text-[12px] text-stone"
  title="Coming soon — pay with USDC/SOL via Jupiter"
>
  <input type="checkbox" disabled className="cursor-not-allowed" />
  Pay with any token (Jupiter) — coming soon
</label>
```

with:

```tsx
{/* Jupiter any-token entry: DEFERRED. */}
{/* TODO wire buildJupiterEntryRequest + app fetch (GET /quote → POST /swap) + composeWithEntry. */}
<div className="flex items-center gap-2 font-inter text-[12px] text-silver-dim">
  <span>Pay with any token (Jupiter)</span>
  <EyebrowTag pill className="!text-[10px] !tracking-[0.06em]">
    Coming soon
  </EyebrowTag>
</div>
```

Add `EyebrowTag` to the existing import from `'../../ui'` (or wherever `TradePanel.tsx` imports UI primitives from — check the top of the file) if not already imported.

Note: this task must run *after* Part 1's token rename (`text-stone` → `text-silver-dim`) — if executed before, use `text-stone` in the "before" snippet above instead.

**Step 3: Verify no test references the removed checkbox**

```bash
grep -rn "Pay with any token" test/
```

If a render test asserts on the checkbox's presence/disabled state, update it to assert on the new badge text instead (`getByText(/Coming soon/i)` or similar) rather than deleting coverage.

**Step 4: Run the affected test file(s) (or full suite if none specifically cover TradePanel)**

```bash
pnpm test
```

Expected: all passing.

**Step 5: Manual visual check**

Since TradePanel only renders on `/markets/:pubkey` (which needed Part 2's fixtures to preview), screenshot the trade tab of one of the new mock markets and confirm the badge reads cleanly next to the label, matching the oracle-card badge look.

**Step 6: Commit**

```bash
git add src/components/markets/actions/TradePanel.tsx
git commit -m "polish: replace disabled Jupiter checkbox with a Coming soon badge"
```

### Task 3.2: CreateMarket copy dedup

**Files:**
- Modify: `src/components/markets/actions/CreateMarketForm/index.tsx:228-235`

**Step 1: Remove the redundant heading block**

Current (lines 228-235):

```tsx
return (
  <Card className="flex flex-col gap-4">
    <div>
      <h3 className="font-serif text-subheading font-light text-sepia">Create market</h3>
      <p className="mt-1 font-inter text-[13px] text-driftwood">
        Bind a market to an existing Kassandra oracle and seed its funding.
      </p>
    </div>
    {notInitialized ? (
```

Replace with:

```tsx
return (
  <Card className="flex flex-col gap-4">
    {notInitialized ? (
```

(i.e. delete the `<div>...</div>` block entirely, keep everything else — `Card`'s `flex flex-col gap-4` still applies correctly to the remaining children.)

Note: after Part 1's rename, `text-sepia`/`text-driftwood` will already read as `text-platinum`/`text-silver` — irrelevant here since the whole block is deleted regardless of which names it uses. If Task 3.2 runs before Part 1, delete the block as shown above (with `text-sepia`/`text-driftwood`); if after, the block will already say `text-platinum`/`text-silver` — delete it all the same.

**Step 2: Check for any test asserting on the removed heading**

```bash
grep -rn "Create market" test/ | grep -v "verb="
```

If a render test does `getByText('Create market')` expecting the card heading specifically (not the submit button's `verb="Create market"`, which is untouched), it needs updating — the page-level `SectionHeader` in `src/pages/CreateMarket.tsx` still says "New market", not "Create market", so a test scoped to the card would break. Fix any such assertion to match against the wallet-gate copy or form field instead.

**Step 3: Run tests**

```bash
pnpm test
```

Expected: all passing.

**Step 4: Manual visual check**

Screenshot `/markets/new?mock` — confirm the card now goes straight from the top edge (or the `notInitialized` banner, if present in mock mode) into the wallet-gate/form, no restated heading.

**Step 5: Commit**

```bash
git add src/components/markets/actions/CreateMarketForm/index.tsx
git commit -m "polish: drop redundant heading on the create-market card"
```

---

## Final verification

**Step 1: Full suite one more time from a clean state**

```bash
pnpm typecheck
pnpm test
pnpm lint
```

Expected: all clean.

**Step 2: Review the full diff**

```bash
git log --oneline master..HEAD
git diff master...HEAD --stat
```

Sanity-check the file list matches: `index.css` + ~28 renamed files, the new `mockMarkets`/`mockIndexerClient` files + `IndexerProvider.tsx`, `TradePanel.tsx`, `CreateMarketForm/index.tsx`.

**Step 3: Hand off**

Report back with the branch name (`design-ux-audit`) and commit list, ready for `superpowers:finishing-a-development-branch` (merge / PR / cleanup decision) — do not merge or push without the user's explicit go-ahead.
