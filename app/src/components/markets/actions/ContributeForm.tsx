import { useState, type FormEvent } from "react";
import type { Market } from "@kassandra-market/markets";
import { Card } from "../../ui";
import { buildContributeIxs } from "../../../market/data/actions";
import { useWriteAction } from "../../../market/hooks/useWriteAction";
import { useSolBalance } from "../../../market/hooks/useSolBalance";
import { formatSol } from "../../../market/lib/marketView";
import { parseSolAmount, balanceGateError } from "../../../market/data/amount";
import { ConnectGate } from "./ConnectGate";
import { Field, SolBalanceLine, SubmitButton, TextInput } from "./formPrimitives";
import { WriteStatusRegion } from "./WriteStatusRegion";

/**
 * Add SOL to a Funding market's escrow (create-or-increment the caller's
 * Contribution). Shows the connected wallet's SOL balance and gates the submit
 * on it (additively — a `null` balance never blocks; the tx is the guard).
 */
export function ContributeForm({
  pubkey,
  market,
  onSuccess,
}: {
  pubkey: string;
  market: Market;
  onSuccess: () => void;
}) {
  const baseMint = market.baseMint.toString();
  const { balance, loading: balanceLoading, refetch: refetchBalance } = useSolBalance(baseMint);
  const action = useWriteAction(() => {
    refetchBalance();
    onSuccess();
  });

  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | undefined>();
  const balanceError = balanceGateError(parseSolAmount(amount).value, balance);

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
    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="font-serif text-subheading font-light text-platinum">Contribute funding</h3>
        <p className="mt-1 font-inter text-[13px] text-silver">
          Stake SOL toward this market's funding floor. Refundable if it's cancelled.
        </p>
      </div>
      <ConnectGate connected={action.connected}>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field label="Amount (SOL)" error={amountError ?? balanceError}>
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
          <SolBalanceLine balance={balance} loading={balanceLoading} format={formatSol} />
          <div className="flex items-center gap-3">
            <SubmitButton verb="Contribute" status={action.status} disabled={Boolean(balanceError)} />
          </div>
          <WriteStatusRegion status={action.status} successVerb="Contributed" />
        </form>
      </ConnectGate>
    </Card>
  );
}

export default ContributeForm;
