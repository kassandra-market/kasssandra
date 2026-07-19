import type { Market, Contribution } from "@kassandra-market/markets";
import { Card } from "../../ui";
import { buildClaimLpIxs } from "../../../market/data/actions";
import { useWriteAction } from "../../../market/hooks/useWriteAction";
import { formatKass } from "../../../market/lib/marketView";
import { SubmitButton } from "./formPrimitives";
import { WriteStatusRegion } from "./WriteStatusRegion";

/**
 * A contributor's pro-rata LP claim, shown by {@link MarketActions} on an
 * Active/Resolved/Void market. It self-hides unless the CONNECTED wallet has a
 * still-open (unclaimed) contribution to this market — permissionless, but only
 * the contributor's own stake is claimable. On success the detail refetch flips
 * the contribution to "claimed" and this control disappears.
 *
 * `claim_lp` is gated on protocol-fee collection: it opens only once
 * `market.feeCollected` is set (resolve → collect_fee → claim_lp). Until then this
 * shows a disabled "waiting for fee collection" state rather than an enabled claim,
 * so a contributor isn't handed a button the program would reject.
 */
export function ClaimLpControl({
  pubkey,
  market,
  contributions,
  onSuccess,
  embedded = false,
}: {
  pubkey: string;
  market: Market;
  contributions: { pubkey: string; contribution: Contribution }[];
  onSuccess: () => void;
  /** Render bare (no Card / heading) and, with nothing to claim, an explanatory
   *  note instead of nothing — for use as a tab inside another panel. */
  embedded?: boolean;
}) {
  const action = useWriteAction(onSuccess);

  const mine =
    action.address == null
      ? undefined
      : contributions.find(
          ({ contribution }) => !contribution.claimed && contribution.contributor.toString() === action.address,
        );

  const wrap = (children: React.ReactNode) =>
    embedded ? (
      <div className="flex flex-col gap-4">{children}</div>
    ) : (
      <Card className="flex flex-col gap-4">{children}</Card>
    );
  const heading = embedded ? null : (
    <h3 className="font-serif text-subheading font-light text-platinum">Claim LP tokens</h3>
  );
  // Full-width CTA when embedded (matches the Deposit tab); auto-width standalone.
  const btnClass = embedded ? "w-full py-3 text-[15px]" : "";

  // Nothing to claim (disconnected, not a contributor, or already claimed). A
  // standalone control hides; a Claim TAB shows a calm note rather than an empty tab.
  if (!mine) {
    if (!embedded) return null;
    return wrap(
      <p className="font-inter text-[13px] text-silver">
        You have no LP position to claim here. Add liquidity on the Deposit tab — your LP becomes
        claimable once the market resolves and its protocol fee is collected.
      </p>,
    );
  }

  // A contributor's claimable position is their Funding stake (`amount` KASS, which
  // earned LP pro-rata at activation) and/or the liquidity they added post-activation
  // (`lateLp`, recorded as LP with `amount == 0`). Describe whichever they hold — a
  // pure late LP must NOT read as a "0 KASS contribution".
  const c = mine.contribution;
  const parts: string[] = [];
  if (c.amount > 0n) parts.push(`${formatKass(c.amount)} KASS funding contribution`);
  if (c.lateLp > 0n) parts.push(`${formatKass(c.lateLp)} LP you added to the pool`);
  const positionText = parts.length > 0 ? parts.join(" and ") : "position";

  // Fee gate: claim_lp opens only after the protocol fee is collected. Until then
  // (Active, or Resolved/Void awaiting the crank) show a disabled waiting state.
  if (!market.feeCollected) {
    return wrap(
      <>
        <div>
          {heading}
          <p className={`font-inter text-[13px] text-silver ${embedded ? "" : "mt-1"}`}>
            Your {positionText} is claimable as a share of the pool's LP tokens. Claims open once the
            market resolves and its protocol fee is collected.
          </p>
        </div>
        <SubmitButton
          className={btnClass}
          verb="Waiting for fee collection"
          status={{ kind: "idle" }}
          disabled
        />
      </>,
    );
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void action.run(() =>
      buildClaimLpIxs({
        indexer: action.indexer,
        market: pubkey,
        contributor: action.address!,
        lpMint: market.lpMint,
      }),
    );
  };

  return wrap(
    <>
      <div>
        {heading}
        <p className={`font-inter text-[13px] text-silver ${embedded ? "" : "mt-1"}`}>
          Your {positionText} is claimable as a share of the pool's LP tokens. Claim them to your
          wallet.
        </p>
      </div>
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <SubmitButton className={btnClass} verb="Claim LP" status={action.status} />
        <WriteStatusRegion status={action.status} successVerb="LP claimed" />
      </form>
    </>,
  );
}

export default ClaimLpControl;
