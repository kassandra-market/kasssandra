import { useState, type FormEvent } from "react";
import type { Market } from "@kassandra-market/markets";
import { Card } from "../../ui";
import { buildAddLiquidityIxs } from "../../../market/data/actions";
import type { AmmReserves } from "../../../market/data/markets";
import { useWriteAction } from "../../../market/hooks/useWriteAction";
import { useKassBalance } from "../../../market/hooks/useKassBalance";
import { formatKass } from "../../../market/lib/marketView";
import { parseKassAmount, balanceGateError } from "../../../market/data/amount";
import { ConnectGate } from "./ConnectGate";
import { Field, KassBalanceLine, SubmitButton, TextInput } from "./formPrimitives";
import { WriteStatusRegion } from "./WriteStatusRegion";

/**
 * Add KASS liquidity to an ACTIVE market's live cYES/cNO AMM. The deposit is split
 * 1:1 into cYES/cNO and added at the pool's current price; the unmatched heavy side
 * is returned to the wallet as conditional tokens. The minted LP joins the pooled
 * `lp_vault`, claimable pro-rata (gross-LP basis) after the market settles.
 *
 * Requires live pool reserves (to size the balanced deposit); renders a calm note
 * if they're momentarily unavailable.
 */
export function AddLiquidityControl({
  pubkey,
  market,
  reserves,
  onSuccess,
}: {
  pubkey: string;
  market: Market;
  reserves: AmmReserves | null;
  onSuccess: () => void;
}) {
  const kassMint = market.kassMint.toString();
  const { balance, loading: balanceLoading, refetch: refetchBalance } = useKassBalance(kassMint);
  const action = useWriteAction(() => {
    refetchBalance();
    onSuccess();
  });

  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | undefined>();
  const balanceError = balanceGateError(parseKassAmount(amount).value, balance);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseKassAmount(amount);
    if (parsed.error) {
      setAmountError(parsed.error);
      return;
    }
    if (!reserves) {
      setAmountError("Pool reserves are unavailable right now — try again in a moment.");
      return;
    }
    setAmountError(undefined);
    void action.run(async () =>
      (
        await buildAddLiquidityIxs({
          market: pubkey,
          marketAccount: market,
          reserves,
          contributor: action.address!,
          amount: parsed.value!,
        })
      ).ixs,
    );
  };

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="font-serif text-subheading font-light text-sepia">Add liquidity</h3>
        <p className="mt-1 font-inter text-[13px] text-driftwood">
          Deposit KASS into the live pool. It's split into YES/NO and added at the current
          price; the unmatched side is returned to your wallet as conditional tokens. Your LP is
          claimable after the market settles.
        </p>
      </div>
      <ConnectGate connected={action.connected}>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field label="Amount (KASS)" error={amountError ?? balanceError}>
            {(ids) => (
              <TextInput
                ids={ids}
                inputMode="decimal"
                placeholder="e.g. 250"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            )}
          </Field>
          <KassBalanceLine balance={balance} loading={balanceLoading} format={formatKass} />
          <div className="flex items-center gap-3">
            <SubmitButton
              verb="Add liquidity"
              status={action.status}
              disabled={Boolean(balanceError) || !reserves}
            />
          </div>
          <WriteStatusRegion status={action.status} successVerb="Liquidity added" />
        </form>
      </ConnectGate>
    </Card>
  );
}

export default AddLiquidityControl;
