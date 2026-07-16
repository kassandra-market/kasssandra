import { MarketStatus, isTerminal } from "@kassandra-market/markets";
import type { MarketDetail } from "../../../market/data/markets";
import { fundingActions, fundingProgress } from "../../../market/lib/marketView";
import { useConfig } from "../../../market/hooks/useMarketDetail";
import { ContributeForm } from "./ContributeForm";
import { CancelControl } from "./CancelControl";
import { RefundControl } from "./RefundControl";
import { ActivateControl } from "./ActivateControl";
import { ClaimLpControl } from "./ClaimLpControl";
import { ResolveControl } from "./ResolveControl";
import { RedeemControl } from "./RedeemControl";
import { CollectFeeControl } from "./CollectFeeControl";
import { CloseMarketControl } from "./CloseMarketControl";

/**
 * A small terminal-market note: how many contributors have yet to exit (claim/
 * refund) before the market can be closed, or that it's ready to close. It's the
 * human-readable form of the `close_market` gate (`openContributions === 0`).
 */
function ContributorsRemaining({ open }: { open: number }) {
  return (
    <p className="font-inter text-[12px] text-driftwood">
      {open > 0
        ? `${open} contributor${open === 1 ? "" : "s"} yet to claim — the market can be closed once all have exited.`
        : "All contributions claimed — the market is ready to close."}
    </p>
  );
}

/** A calm empty-state note for a tab whose actions aren't available in this phase. */
function NoActions({ children }: { children: React.ReactNode }) {
  return <p className="font-inter text-[13px] text-driftwood">{children}</p>;
}

/**
 * The status-gated LIQUIDITY surface — deposit into / withdraw from THIS market's
 * pool, phase-routed so it's available across the market's whole life (this is
 * why the Liquidity tab is present for Active markets too, not just Funding):
 *
 *   - Funding   → ContributeForm (seed the funding floor).
 *   - Active    → ClaimLpControl (LP withdrawal; self-gates until settle).
 *   - Resolved / Void → ClaimLpControl (waits for fee collection before it opens).
 *   - Cancelled → RefundControl (reclaim staked KASS) until every contributor has
 *                 exited, after which there's nothing left to withdraw.
 *
 * The bulk cross-outcome GroupLiquidityPanel sits ABOVE this in the Liquidity tab.
 */
export function MarketLiquidityActions({
  detail,
  refetch,
}: {
  detail: MarketDetail;
  refetch: () => void;
}) {
  const { pubkey, market, contributions } = detail;

  switch (market.status) {
    case MarketStatus.Funding:
      return <ContributeForm pubkey={pubkey} market={market} onSuccess={refetch} />;

    case MarketStatus.Active:
    case MarketStatus.Resolved:
    case MarketStatus.Void:
      return (
        <ClaimLpControl
          pubkey={pubkey}
          market={market}
          contributions={contributions}
          onSuccess={refetch}
        />
      );

    case MarketStatus.Cancelled:
      return market.openContributions > 0 ? (
        <RefundControl pubkey={pubkey} market={market} onSuccess={refetch} />
      ) : (
        <NoActions>All contributors have been refunded — nothing left to withdraw.</NoActions>
      );

    default:
      return null;
  }
}

/**
 * The status-gated LIFECYCLE surface — the cranks that move the market between
 * phases (and the winner's redeem), phase-routed:
 *
 *   - Funding   → ActivateControl once the funding floor is met AND the oracle is
 *                 still live; CancelControl when the oracle is terminal AND the
 *                 market is still under floor (an under-funded market whose oracle
 *                 already resolved can only be cancelled → refunded).
 *   - Active    → ResolveControl once the oracle is terminal.
 *   - Resolved / Void → RedeemControl (redeem the winning conditional tokens) +
 *                 CollectFeeControl (the permissionless protocol-fee crank while a
 *                 non-zero fee is uncollected) + CloseMarketControl once the fee is
 *                 collected AND every contributor has exited.
 *   - Cancelled → CloseMarketControl once every contributor has been refunded
 *                 (reclaim the market's rent to the creator).
 */
export function MarketLifecycleActions({
  detail,
  refetch,
}: {
  detail: MarketDetail;
  refetch: () => void;
}) {
  const { pubkey, market, oracle } = detail;
  const oracleTerminal = oracle ? isTerminal(oracle.phase) : false;
  const config = useConfig();
  // The permissionless fee crank is available on a settled market that carries a
  // non-zero, uncollected protocol fee (needs the Config for the fee destination).
  const showCollectFee = config.data != null && market.feeBps > 0 && !market.feeCollected;

  switch (market.status) {
    case MarketStatus.Funding: {
      const { funded } = fundingProgress(market);
      const { canActivate, canCancel } = fundingActions(funded, oracleTerminal);
      if (!canActivate && !canCancel)
        return (
          <NoActions>
            Waiting on the funding floor — activation opens once the market is fully funded.
          </NoActions>
        );
      return (
        <div className="flex flex-col gap-6">
          {canActivate ? <ActivateControl pubkey={pubkey} market={market} onSuccess={refetch} /> : null}
          {canCancel ? <CancelControl pubkey={pubkey} market={market} onSuccess={refetch} /> : null}
        </div>
      );
    }

    case MarketStatus.Active:
      return oracleTerminal ? (
        <ResolveControl pubkey={pubkey} market={market} onSuccess={refetch} />
      ) : (
        <NoActions>
          The market resolves once its linked oracle reaches a terminal phase.
        </NoActions>
      );

    case MarketStatus.Resolved:
    case MarketStatus.Void: {
      // Activated markets close only once the fee is collected AND every
      // contributor has exited (openContributions === 0); the crank routes the
      // market's account rent back to the creator.
      const canClose = market.feeCollected && market.openContributions === 0;
      return (
        <div className="flex flex-col gap-6">
          <RedeemControl pubkey={pubkey} market={market} onSuccess={refetch} />
          {showCollectFee ? (
            <CollectFeeControl
              pubkey={pubkey}
              market={market}
              config={config.data!}
              onSuccess={refetch}
            />
          ) : null}
          {canClose ? (
            <CloseMarketControl pubkey={pubkey} market={market} onSuccess={refetch} />
          ) : market.openContributions > 0 ? (
            <ContributorsRemaining open={market.openContributions} />
          ) : null}
        </div>
      );
    }

    case MarketStatus.Cancelled: {
      // A never-activated market closes once every contributor has been refunded.
      const canClose = market.openContributions === 0;
      return canClose ? (
        <CloseMarketControl pubkey={pubkey} market={market} onSuccess={refetch} />
      ) : (
        <ContributorsRemaining open={market.openContributions} />
      );
    }

    default:
      return null;
  }
}
