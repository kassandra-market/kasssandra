import { useState, type CSSProperties, type FormEvent, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { MarketStatus, type Market } from "@kassandra-market/markets";
import { Button, Card } from "../ui";
import { StatusChip } from "./StatusChip";
import { FundingBar } from "./FundingBar";
import { ProbabilityBar } from "./ProbabilityBar";
import { ConnectGate } from "./actions/ConnectGate";
import { SubmitButton } from "./actions/formPrimitives";
import { WriteStatusRegion } from "./actions/WriteStatusRegion";
import { buildActivateSequence, buildContributeIxs, type ActivateStep } from "../../market/data/actions";
import { useWriteAction } from "../../market/hooks/useWriteAction";
import { useActionSequence } from "../../market/hooks/useActionSequence";
import { parseSolAmount } from "../../market/data/amount";
import type { MarketSummary } from "../../market/data/markets";
import { formatSol, fundingProgress, impliedYesProbability, truncateMiddle } from "../../market/lib/marketView";
import type { OracleMetaView } from "../../market/lib/meta";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-platinum/40 " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss";

/**
 * One market rendered as a card. The header carries the status badge and a
 * truncated GPT Subject address (not a link — there is no oracle page).
 * Optional {@link OracleMetaView} labels lead the title; without them, the
 * short pubkey. The body shows a funding bar (Funding) or the live YES
 * probability (Active), plus TVL.
 *
 * The footer is a status-driven CTA, not a link: a Funding market under its
 * floor gets an inline stake input, a Funding market AT its floor gets a
 * one-click launch (activate) button — so the card is actionable without a
 * detail-page round-trip. Both are genuine `<input>`/`<button>` elements, which
 * is why the "go to this market" click target is its own inner `<Link>`
 * (title + funding/probability + TVL) rather than the whole card — interactive
 * controls cannot validly nest inside an anchor.
 */
export function MarketCard({
  summary,
  meta,
  enterIndex,
  onSuccess,
}: {
  summary: MarketSummary;
  meta?: OracleMetaView;
  /** First-load stagger index (undefined = no entrance animation). */
  enterIndex?: number;
  /** Called after a stake/launch confirms — the list page's refetch, so the
   *  card's own numbers (and lifecycle status) pick up the change. */
  onSuccess?: () => void;
}) {
  const { pubkey, market, reserves } = summary;
  const isFunding = market.status === MarketStatus.Funding;
  const isActive = market.status === MarketStatus.Active;
  const { funded } = fundingProgress(market);
  const subject = meta?.subject?.trim();
  const stagger = enterIndex !== undefined;
  const oraclePubkey = market.oracle.toString();

  return (
    <Card
      className={`flex h-full flex-col gap-3 transition-[transform,border-color] duration-200 ease-out has-[a.market-card-link:hover]:-translate-y-0.5 has-[a.market-card-link:hover]:border-cyan-phosphor/40 motion-reduce:has-[a.market-card-link:hover]:translate-y-0${stagger ? " stagger-in" : ""}`}
      style={
        stagger
          ? ({ "--stagger-delay": `${Math.min(enterIndex, 10) * 40}ms` } as CSSProperties)
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusChip status={market.status} />
          <span className="font-inter text-[12px] text-silver" title={oraclePubkey}>
            Subject {truncateMiddle(oraclePubkey, 4, 4)}
          </span>
        </div>
        {/* Active markets are tradeable — surface the trade entry right on the
            card so every interface showing a tradeable market points into its
            trading interface (the detail's TradePanel). */}
        {isActive ? (
          <span className="inline-flex items-center gap-1 font-inter text-[12px] font-medium text-coral">
            Trade
            <span aria-hidden="true">→</span>
          </span>
        ) : null}
      </div>

      <Link
        to={`/markets/${pubkey}`}
        className={`market-card-link flex flex-1 flex-col gap-3 rounded-sm ${focusRing}`}
      >
        {subject ? (
          <h3 className="text-balance font-serif text-subheading font-light text-platinum" title={subject}>
            {subject}
          </h3>
        ) : (
          <h3 className="font-mono text-subheading font-light text-platinum" title={pubkey}>
            {truncateMiddle(pubkey, 6, 6)}
          </h3>
        )}

        <div>
          {isFunding ? <FundingBar market={market} /> : null}
          {isActive ? <ProbabilityBar probability={impliedYesProbability(reserves)} /> : null}
        </div>

        <dl className="mt-auto flex flex-wrap gap-x-5 gap-y-1 pt-1 font-inter text-[13px] text-silver">
          <div className="flex gap-1">
            <dt className="text-silver">TVL</dt>
            <dd className="font-medium text-platinum">{formatSol(market.totalContributed)} SOL</dd>
          </div>
        </dl>
      </Link>

      {isFunding ? (
        funded ? (
          <LaunchCta pubkey={pubkey} market={market} onSuccess={onSuccess} />
        ) : (
          <StakeCta pubkey={pubkey} market={market} onSuccess={onSuccess} />
        )
      ) : null}
    </Card>
  );
}

/** Funding, under the floor — an inline amount input + stake button. */
function StakeCta({
  pubkey,
  market,
  onSuccess,
}: {
  pubkey: string;
  market: Market;
  onSuccess?: () => void;
}) {
  const baseMint = market.baseMint.toString();
  const action = useWriteAction(onSuccess);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | undefined>();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseSolAmount(amount);
    if (parsed.error) {
      setAmountError(parsed.error);
      return;
    }
    setAmountError(undefined);
    void action.run(() =>
      buildContributeIxs({
        indexer: action.indexer,
        market: pubkey,
        baseMint,
        contributor: action.address!,
        amount: parsed.value!,
      }),
    );
  };

  return (
    <div className="mt-1 flex flex-col gap-2 border-t border-hairline pt-3">
      <ConnectGate connected={action.connected}>
        <form onSubmit={onSubmit} className="flex items-center gap-2" noValidate>
          <input
            type="text"
            inputMode="decimal"
            placeholder="Amount (SOL)"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setAmountError(undefined);
            }}
            aria-label="Amount to stake, in SOL"
            aria-invalid={Boolean(amountError)}
            className={`min-w-0 flex-1 rounded-tag border bg-liquid-kelp px-3 py-2 font-inter text-[13px] text-platinum placeholder:text-silver focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-platinum/40 focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss ${amountError ? "border-coral/60" : "border-hairline"}`}
          />
          <SubmitButton verb="Stake" status={action.status} className="shrink-0 px-3 py-2 text-[13px]" />
        </form>
        {amountError ? <p className="font-inter text-[12px] text-coral">{amountError}</p> : null}
        <WriteStatusRegion status={action.status} successVerb="Staked" />
      </ConnectGate>
    </div>
  );
}

/** Funding, at the floor — a one-click launch (activate) button. */
function LaunchCta({
  pubkey,
  market,
  onSuccess,
}: {
  pubkey: string;
  market: Market;
  onSuccess?: () => void;
}) {
  const seq = useActionSequence(onSuccess);
  const [steps, setSteps] = useState<ActivateStep[] | null>(null);
  const [buildError, setBuildError] = useState<string | undefined>();

  const onLaunch = async (e: MouseEvent) => {
    e.preventDefault();
    if (seq.busy) return;
    try {
      setBuildError(undefined);
      const built =
        steps ??
        (await buildActivateSequence({
          market: pubkey,
          oracle: market.oracle,
          baseMint: market.baseMint,
          payer: seq.address!,
        }));
      setSteps(built);
      await seq.run(built);
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : String(err));
    }
  };

  const anyError = seq.statuses.some((s) => s.kind === "error");
  const verb = seq.allDone
    ? "Launched"
    : anyError
      ? "Retry launch"
      : seq.busy
        ? "Launching…"
        : "Launch market";

  return (
    <div className="mt-1 flex flex-col gap-2 border-t border-hairline pt-3">
      <ConnectGate connected={seq.connected}>
        <Button
          type="button"
          variant="PrimaryChestnut"
          onClick={onLaunch}
          disabled={seq.busy || seq.allDone}
          aria-busy={seq.busy}
          className="w-full justify-center px-3 py-2 text-[13px]"
        >
          {verb}
        </Button>
        {buildError ? <p className="font-inter text-[12px] text-coral">{buildError}</p> : null}
      </ConnectGate>
    </div>
  );
}

export default MarketCard;
