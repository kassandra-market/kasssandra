import { useId, useState, type FormEvent } from "react";
import type { Market } from "@kassandra-market/markets";
import { Card } from "../../ui";
import { buildAddLiquidityIxs } from "../../../market/data/actions";
import type { AmmReserves } from "../../../market/data/markets";
import { useWriteAction } from "../../../market/hooks/useWriteAction";
import { useKassBalance } from "../../../market/hooks/useKassBalance";
import { KASS_DECIMALS, formatKass } from "../../../market/lib/marketView";
import { parseKassAmount, balanceGateError } from "../../../market/data/amount";
import { ConnectGate } from "./ConnectGate";
import { SubmitButton } from "./formPrimitives";
import { WriteStatusRegion } from "./WriteStatusRegion";

/** Quick-set fractions of the wallet balance (100 renders as "Max"). */
const PERCENTS = [25, 50, 75, 100] as const;

/** A base-unit KASS balance → a plain, comma-free decimal string the amount input
 *  (and {@link parseKassAmount}) accepts. Trailing-zero trimmed. */
function baseToPlain(base: bigint): string {
  const s = base.toString().padStart(KASS_DECIMALS + 1, "0");
  const whole = s.slice(0, s.length - KASS_DECIMALS);
  const frac = s.slice(s.length - KASS_DECIMALS).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** The KASS token mark — a circular aqua coin badge beside the symbol. */
function KassBadge() {
  return (
    <span
      className="grid h-9 w-9 shrink-0 place-items-center rounded-avatar border border-aqua/30 bg-aqua/15"
      aria-hidden="true"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="var(--color-aqua)" strokeWidth="1.6" />
        <path
          d="M9.5 7.5v9M9.5 12l4-4.5M9.5 12l4 4.5"
          stroke="var(--color-aqua)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * Add KASS liquidity to an ACTIVE market's live cYES/cNO AMM. The deposit is split
 * 1:1 into cYES/cNO and added at the pool's current price; the unmatched heavy side
 * is returned to the wallet as conditional tokens. The minted LP joins the pooled
 * `lp_vault`, claimable pro-rata (gross-LP basis) after the market settles.
 *
 * Presented as a pool-deposit ticket: a large token-amount row (KASS mark + symbol
 * + right-aligned amount), a balance line with percentage quick-sets, a risk
 * acknowledgment, and a full-width Deposit CTA. Requires live pool reserves (to
 * size the balanced deposit); the CTA self-disables until they're available.
 */
export function AddLiquidityControl({
  pubkey,
  market,
  reserves,
  onSuccess,
  embedded = false,
}: {
  pubkey: string;
  market: Market;
  reserves: AmmReserves | null;
  onSuccess: () => void;
  /** Render bare (no Card / heading) — for use as a tab inside another panel. */
  embedded?: boolean;
}) {
  const kassMint = market.kassMint.toString();
  const { balance, loading: balanceLoading, refetch: refetchBalance } = useKassBalance(kassMint);
  const action = useWriteAction(() => {
    refetchBalance();
    onSuccess();
  });

  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | undefined>();
  const [accepted, setAccepted] = useState(false);
  const riskId = useId();

  const parsed = parseKassAmount(amount);
  const balanceError = balanceGateError(parsed.value, balance);
  const inputError = amountError ?? balanceError;

  function setPercent(pct: number) {
    if (balance == null || balance <= 0n) return;
    // Max uses the exact balance; others take an integer-basis fraction of it.
    setAmount(baseToPlain(pct === 100 ? balance : (balance * BigInt(pct)) / 100n));
    setAmountError(undefined);
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
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

  const body = (
    <>
      <div>
        {embedded ? null : (
          <h3 className="font-serif text-subheading font-light text-platinum">Add liquidity</h3>
        )}
        <p
          className={`text-pretty font-inter text-[13px] text-silver ${embedded ? "" : "mt-1"}`}
        >
          Deposit KASS into the live pool. It's split into YES/NO and added at the current price;
          the unmatched side is returned to your wallet as conditional tokens. Your LP is claimable
          after the market settles.
        </p>
      </div>

      <ConnectGate connected={action.connected}>
        <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
          <p className="font-inter text-[13px] font-medium text-platinum">Enter deposit amount</p>

          {/* Token-amount row — KASS mark + symbol on the left, the amount on the right. */}
          <div
            className={`flex items-center gap-3 rounded-card border bg-liquid-deep px-4 py-3.5 transition-colors focus-within:border-cyan-phosphor/50 ${
              inputError ? "border-coral/60" : "border-hairline"
            }`}
          >
            <KassBadge />
            <span className="font-serif text-heading-sm font-light text-platinum">KASS</span>
            <input
              inputMode="decimal"
              placeholder="0.00"
              aria-label="Deposit amount in KASS"
              aria-invalid={Boolean(inputError)}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setAmountError(undefined);
              }}
              className="w-full bg-transparent text-right font-serif text-heading-sm font-light tabular-nums text-platinum placeholder:text-silver focus:outline-none"
            />
          </div>

          {/* Balance + percentage quick-sets. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-inter text-[12px] text-silver">
              Balance:{" "}
              <span className="tabular-nums text-silver">
                {balance === null ? (balanceLoading ? "…" : "—") : formatKass(balance)}
              </span>
            </span>
            <div className="flex gap-1.5">
              {PERCENTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPercent(p)}
                  className="rounded-tag border border-hairline bg-transparent px-2.5 py-1.5 font-inter text-[12px] tabular-nums text-platinum transition-colors hover:border-silver-mist active:scale-[0.96]"
                >
                  {p === 100 ? "Max" : `${p}%`}
                </button>
              ))}
            </div>
          </div>

          {inputError ? (
            <p className="font-inter text-[12px] text-coral">{inputError}</p>
          ) : null}

          {/* Risk acknowledgment — gates the deposit, mirroring the reference. */}
          <label
            htmlFor={riskId}
            className="flex cursor-pointer items-start gap-2.5 pt-1 font-inter text-[13px] text-silver"
          >
            <input
              id={riskId}
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-aqua"
            />
            <span className="text-pretty">
              I understand and accept the risks involved in providing liquidity to this pool.
            </span>
          </label>

          <SubmitButton
            className="w-full py-3 text-[15px]"
            verb="Deposit"
            status={action.status}
            disabled={Boolean(balanceError) || !reserves || !accepted}
          />
          <WriteStatusRegion status={action.status} successVerb="Liquidity added" />
        </form>
      </ConnectGate>
    </>
  );

  return embedded ? (
    <div className="flex flex-col gap-4">{body}</div>
  ) : (
    <Card className="flex flex-col gap-4">{body}</Card>
  );
}

export default AddLiquidityControl;
