import { useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { MarketStatus } from "@kassandra-market/markets";
import { Button, Card } from "../ui";
import { StatusChip } from "./StatusChip";
import { FundingBar } from "./FundingBar";
import { ConnectGate } from "./actions/ConnectGate";
import { KassBalanceLine } from "./actions/formPrimitives";
import type { OracleGroup } from "../../market/data/markets";
import {
  buildBulkActivateSteps,
  buildBulkContributeSteps,
  outcomesReadyToActivate,
  uniformSplit,
  type ActivateStep,
  type BulkContributeEntry,
  type BulkFundingEntry,
} from "../../market/data/actions";
import { useActionSequence } from "../../market/hooks/useActionSequence";
import { useKassBalance } from "../../market/hooks/useKassBalance";
import { useIndexer } from "../../market/lib/indexer";
import { parseKassAmount, balanceGateError } from "../../market/data/amount";
import {
  formatKass,
  formatProbability,
  groupStatus,
  normalizeAcrossGroup,
  outcomeLabel,
  outcomeRow,
  truncateMiddle,
} from "../../market/lib/marketView";
import type { OracleMetaView } from "../../hooks/useOracleMeta";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-platinum/40 " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss";

/**
 * A categorical (N>2) oracle rendered as ONE grouped card: the QUESTION
 * (on-chain oracle subject, read best-effort via {@link OracleMetaView}) is the
 * title, and each outcome sub-market is listed by its option LABEL with that
 * outcome's implied chance (its sub-market's YES probability from the pool
 * reserves), linking to that sub-market's detail. Without metadata it
 * degrades to a count title + "Outcome i" rows.
 *
 * ONE overall {@link StatusChip} ({@link groupStatus}), not one per outcome
 * row — each outcome sub-market carries its own on-chain status, transitioned
 * independently, but showing that here would read as "these are N
 * independent markets" instead of one categorical market with N outcomes
 * (exactly the abstraction the detail page's unified Trade tab already
 * presents). The row-level arrow (→ this outcome is tradable) is likewise
 * gated on the GROUP's overall status, not the individual row's — landing on
 * any outcome's detail page shows the same group-wide trading surface.
 *
 * While any outcome is still Funding, the footer is a {@link FundGroupCta} —
 * an inline uniform-split deposit (or, once every Funding outcome is already
 * at its floor, a one-click bulk launch) — so a categorical group is fundable
 * right from the list, matching `MarketCard`'s lone-market Stake/Launch CTA.
 */
export function CategoricalCard({
  group,
  meta,
  enterIndex,
  onSuccess,
}: {
  group: OracleGroup;
  meta?: OracleMetaView;
  /** First-load stagger index (undefined = no entrance animation). */
  enterIndex?: number;
  /** Called after a deposit/launch sequence completes — the list page's
   *  refetch, so the card's own numbers (and lifecycle status) pick up the
   *  change. */
  onSuccess?: () => void;
}) {
  const outcomes = group.markets.map((summary) =>
    outcomeRow(summary, meta?.options?.[summary.market.outcomeIndex]),
  );
  const normalizedProbabilities = normalizeAcrossGroup(outcomes.map((o) => o.probability));
  const optionsCount = group.optionsCount ?? group.markets.length;
  const tvl = group.markets.reduce((sum, m) => sum + m.market.totalContributed, 0n);
  const subject = meta?.subject?.trim();
  const stagger = enterIndex !== undefined;
  const overallStatus = groupStatus(group.markets);

  // While any outcome is still Funding, ONE cumulative bar for the group's
  // combined raised/floor — not a bar per outcome (there is no per-outcome
  // funding bar anywhere in the group case, matching the detail page).
  const funding = group.markets.filter((m) => m.market.status === MarketStatus.Funding);
  const cumulativeFunding =
    funding.length > 0
      ? {
          totalContributed: funding.reduce((sum, m) => sum + m.market.totalContributed, 0n),
          minLiquidity: funding.reduce((sum, m) => sum + m.market.minLiquidity, 0n),
        }
      : null;

  return (
    <Card
      className={`flex h-full flex-col gap-3${stagger ? " stagger-in" : ""}`}
      style={
        stagger
          ? ({ "--stagger-delay": `${Math.min(enterIndex, 10) * 40}ms` } as CSSProperties)
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-2">
        <StatusChip status={overallStatus} />
        <span className="font-inter text-[12px] text-silver" title={group.oracle}>
          Oracle {truncateMiddle(group.oracle, 4, 4)}
        </span>
      </div>

      {subject ? (
        <h3 className="text-balance font-serif text-subheading font-light text-platinum" title={subject}>
          {subject}
        </h3>
      ) : (
        <h3 className="font-mono text-subheading font-light text-platinum">
          {group.markets.length} of {optionsCount} outcomes live
        </h3>
      )}

      {cumulativeFunding ? (
        <div className="mt-1">
          <FundingBar market={cumulativeFunding} />
        </div>
      ) : null}

      {/* Scrollable, not unbounded — a categorical oracle can have many options,
          which would otherwise overflow the card (and stretch the whole grid row). */}
      <ul className="mt-1 flex max-h-64 flex-col divide-y divide-hairline/60 overflow-y-auto">
        {outcomes.map((row, i) => (
          <li key={row.pubkey}>
            <Link
              to={`/markets/${row.pubkey}`}
              className={`group flex items-center justify-between gap-3 rounded-sm py-2 ${focusRing}`}
            >
              <span className="flex items-center gap-2">
                <span className="font-inter text-[13px] text-platinum group-hover:text-coral">
                  {row.label}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="font-inter text-[13px] font-medium text-coral"
                  title="Adjusted so all options sum to 100% — this option's own trade price still depends on its own pool."
                >
                  {formatProbability(normalizedProbabilities[i])}
                </span>
                {/* Any outcome is tradeable once the GROUP overall is Active —
                    every outcome's detail page shows the same group-wide Trade
                    tab, so this isn't gated on THIS row's own status. */}
                {overallStatus === MarketStatus.Active ? (
                  <span
                    aria-hidden="true"
                    className="font-inter text-[13px] text-coral transition-transform group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <dl className="mt-auto flex flex-wrap gap-x-5 gap-y-1 pt-1 font-inter text-[13px] text-silver">
        <div className="flex gap-1">
          <dt className="text-silver">TVL</dt>
          <dd className="font-medium text-platinum">{formatKass(tvl)} KASS</dd>
        </div>
      </dl>

      {funding.length > 0 ? <FundGroupCta funding={funding} onSuccess={onSuccess} /> : null}
    </Card>
  );
}

/**
 * Funding CTA for a categorical group: an inline "total KASS" amount input
 * that splits UNIFORMLY across every still-Funding outcome ({@link uniformSplit},
 * the same default `GroupLiquidityPanel` uses on the detail page) — or, once
 * EVERY Funding outcome is already at its own floor, a one-click bulk launch
 * (no deposit needed, just the activation crank). A deposit that pushes one
 * or more outcomes over their floor activates them in the SAME transaction
 * batch, exactly like `GroupLiquidityPanel`'s deposit does.
 *
 * Simplified relative to `GroupLiquidityPanel` for the compact list-card
 * surface: no Active-outcome add-liquidity or claim-LP here (those stay
 * detail-page actions) — just the Funding-phase deposit/launch this goal
 * calls for. `oracleTerminal` is optimistically `false` here (the list page
 * doesn't fetch full oracle-phase data); the rare terminal-oracle case simply
 * reverts the activate step on-chain rather than silently misbehaving.
 */
function FundGroupCta({
  funding,
  onSuccess,
}: {
  /** Every still-Funding outcome in the group (non-empty — the caller gates on this). */
  funding: OracleGroup["markets"];
  onSuccess?: () => void;
}) {
  const kassMint = funding[0].market.kassMint.toString();
  const indexer = useIndexer();
  const { balance, loading: balanceLoading, refetch: refetchBalance } = useKassBalance(kassMint);
  const seq = useActionSequence(() => {
    refetchBalance();
    onSuccess?.();
  });
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>();

  const fundingEntries = (share: bigint[] | null): BulkFundingEntry[] =>
    funding.map((m, i) => ({
      market: m.pubkey,
      oracle: m.market.oracle,
      label: outcomeLabel(m.market.outcomeIndex),
      totalContributed: m.market.totalContributed,
      minLiquidity: m.market.minLiquidity,
      amount: share ? share[i] : 0n,
    }));

  // Every outcome already over its own floor with ZERO additional deposit —
  // the group just needs the activation crank, no KASS to raise.
  const readyNow = outcomesReadyToActivate(fundingEntries(null), false);
  const allFunded = readyNow.length === funding.length;

  const onLaunch = async () => {
    if (seq.busy || !seq.address) return;
    setError(undefined);
    try {
      const built = await buildBulkActivateSteps({ kassMint, payer: seq.address, entries: readyNow });
      await seq.run(built, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDeposit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const parsed = parseKassAmount(amount);
    if (parsed.error) return setError(parsed.error);
    if (!parsed.value || parsed.value <= 0n) return setError("Enter an amount to deposit.");
    const gate = balanceGateError(parsed.value, balance, "KASS");
    if (gate) return setError(gate);
    if (!seq.address) return;

    const shares = uniformSplit(parsed.value, funding.length);
    const contributeEntries: BulkContributeEntry[] = funding.map((m, i) => ({
      market: m.pubkey,
      label: outcomeLabel(m.market.outcomeIndex),
      amount: shares[i],
    }));
    try {
      const built: ActivateStep[] = await buildBulkContributeSteps({
        indexer,
        kassMint,
        contributor: seq.address,
        entries: contributeEntries,
      });
      // "If a transaction is about to fund the market, it should also advance
      // to the next phase if possible" — same handoff as GroupLiquidityPanel.
      const readyToActivate = outcomesReadyToActivate(fundingEntries(shares), false);
      if (readyToActivate.length > 0) {
        built.push(
          ...(await buildBulkActivateSteps({ kassMint, payer: seq.address, entries: readyToActivate })),
        );
      }
      await seq.run(built, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const anyError = seq.statuses.some((s) => s.kind === "error");
  const launchVerb = seq.allDone
    ? "Launched"
    : anyError
      ? "Retry launch"
      : seq.busy
        ? "Launching…"
        : "Launch market";

  return (
    <div className="mt-1 flex flex-col gap-2 border-t border-hairline pt-3">
      <ConnectGate connected={seq.connected}>
        {allFunded ? (
          <Button
            type="button"
            variant="PrimaryChestnut"
            onClick={onLaunch}
            disabled={seq.busy || seq.allDone}
            aria-busy={seq.busy}
            className="w-full justify-center px-3 py-2 text-[13px]"
          >
            {launchVerb}
          </Button>
        ) : (
          <>
            <form onSubmit={onDeposit} className="flex items-center gap-2" noValidate>
              <input
                type="text"
                inputMode="decimal"
                placeholder={`Total (KASS) · split across ${funding.length}`}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(undefined);
                }}
                aria-label="Total amount to deposit across all Funding outcomes, in KASS"
                aria-invalid={Boolean(error)}
                className={`min-w-0 flex-1 rounded-tag border bg-liquid-kelp px-3 py-2 font-inter text-[13px] text-platinum placeholder:text-silver focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-platinum/40 focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss ${error ? "border-coral/60" : "border-hairline"}`}
              />
              <Button
                type="submit"
                variant="PrimaryChestnut"
                disabled={seq.busy}
                aria-busy={seq.busy}
                className="shrink-0 px-3 py-2 text-[13px]"
              >
                {seq.busy ? "Staking…" : "Stake"}
              </Button>
            </form>
            <KassBalanceLine balance={balance} loading={balanceLoading} format={formatKass} />
          </>
        )}
        {error ? <p className="font-inter text-[12px] text-coral">{error}</p> : null}
      </ConnectGate>
    </div>
  );
}

export default CategoricalCard;
