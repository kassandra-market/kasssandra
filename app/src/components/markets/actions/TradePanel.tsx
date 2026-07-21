import { useEffect, useId, useState, type FormEvent } from "react";
import { pda } from "@kassandra-market/markets";
import { Card } from "../../ui";
import {
  buildBuyIxs,
  buildSellIxs,
  marketRefs,
  previewBuy,
  previewSell,
  buyPriceImpact,
  sellPriceImpact,
  DEFAULT_SLIPPAGE_BPS,
} from "../../../market/data/actions";
import { useWriteAction } from "../../../market/hooks/useWriteAction";
import { useKassBalance } from "../../../market/hooks/useKassBalance";
import { KASS_DECIMALS, formatKass } from "../../../market/lib/marketView";
import type { Belief } from "../../../market/lib/beliefs";
import { parseKassAmount, balanceGateError } from "../../../market/data/amount";
import { ConnectGate } from "./ConnectGate";
import { Field, SubmitButton, TextInput } from "./formPrimitives";
import { WriteStatusRegion } from "./WriteStatusRegion";

type Mode = "buy" | "sell";

/** Whole-KASS quick-add chips (mirrors the reference's +$1/+$5/… stepper). */
const PRESETS = [10, 50, 100] as const;

/** Parse a max-slippage tolerance in percent (0..100) → basis points; blank input falls back to {@link DEFAULT_SLIPPAGE_BPS}. */
function parseSlippagePercent(raw: string): { bps: number; error?: string } {
  const t = raw.trim();
  if (t === "") return { bps: DEFAULT_SLIPPAGE_BPS };
  const pct = Number(t);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return { bps: DEFAULT_SLIPPAGE_BPS, error: "Slippage must be 0–100%." };
  }
  return { bps: Math.round(pct * 100) };
}

/** A base-unit KASS balance → a plain, comma-free decimal string the amount input
 *  (and {@link parseKassAmount}) accepts. Trailing-zero trimmed. */
function toPlainAmount(base: bigint): string {
  const s = base.toString().padStart(KASS_DECIMALS + 1, "0");
  const whole = s.slice(0, s.length - KASS_DECIMALS);
  const frac = s.slice(s.length - KASS_DECIMALS).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** The Buy/Sell underline tabs (Acheter/Vendre in the reference). */
function ModeTabs({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const tabs: { value: Mode; label: string }[] = [
    { value: "buy", label: "Buy" },
    { value: "sell", label: "Sell" },
  ];
  return (
    <div role="tablist" aria-label="Buy or sell" className="flex gap-5">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={`relative -mb-px pb-2 font-inter text-[15px] transition-colors ${
              active ? "font-medium text-platinum" : "text-silver hover:text-platinum"
            }`}
          >
            {t.label}
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-aqua transition-opacity ${
                active ? "opacity-100" : "opacity-0"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

/** The single selector for "what you're buying/selling" — one option per
 *  belief. A native <select> (not a custom popover): accessible by default,
 *  and every option is always present in the markup so it's testable via SSR
 *  without simulating a click. */
function BeliefSelect({
  beliefs,
  selectedKey,
  onChange,
}: {
  beliefs: Belief[];
  selectedKey: string;
  onChange: (key: string) => void;
}) {
  return (
    <select
      aria-label="What you believe"
      value={selectedKey}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-tag border border-hairline bg-liquid-kelp px-3 py-2.5 font-inter text-[14px] text-platinum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-platinum/40 focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss"
    >
      {beliefs.map((b) => (
        <option key={b.key} value={b.key}>
          {b.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The Active-market trade surface, laid out as a prediction-market order
 * ticket: Buy/Sell tabs, a belief selector, a large amount field with
 * quick-add chips, a live "you receive" estimate and the trade CTA. Buy
 * splits KASS into a cYES+cNO pair and swaps the unwanted leg; sell unwinds
 * a held leg back to KASS (amounts from live reserves). The price chart and
 * legend live in `GroupTradePanel`, which mounts this component.
 */
export function TradePanel({
  beliefs,
  defaultBeliefKey,
  onSuccess,
  question,
}: {
  /** Every belief available to trade — a categorical group's options (always
   *  YES) or a lone binary market's YES/NO pair. Never empty when mounted. */
  beliefs: Belief[];
  /** The initially-selected belief's key, from {@link import("../../../market/lib/beliefs").defaultBeliefKey}. */
  defaultBeliefKey: string | null;
  onSuccess: () => void;
  /** The oracle question (header context; falls back to a generic label). */
  question?: string;
}) {
  const [selectedKey, setSelectedKey] = useState<string>(
    defaultBeliefKey ?? beliefs[0]?.key ?? "",
  );
  const selected = beliefs.find((b) => b.key === selectedKey) ?? beliefs[0];

  // If `selectedKey` no longer matches any belief (e.g. it resolved/vanished
  // from a parent poll or post-trade refetch), `selected` silently fell back
  // to `beliefs[0]` above. Resync `selectedKey` to that fallback and reset
  // the transient form state the same way `handleBeliefChange` would — this
  // is the passive counterpart to that user-driven handler.
  useEffect(() => {
    if (selected.key !== selectedKey) {
      setSelectedKey(selected.key);
      setAmount("");
      setAmountError(undefined);
      setDetailsOpen(false);
    }
  }, [selected.key, selectedKey]);

  const { pubkey, market, reserves, outcome } = selected;

  const kassMint = market.kassMint.toString();
  const yesMint = market.yesMint.toString();
  const noMint = market.noMint.toString();

  const kass = useKassBalance(kassMint);
  const yes = useKassBalance(yesMint);
  const no = useKassBalance(noMint);

  const action = useWriteAction(() => {
    kass.refetch();
    yes.refetch();
    no.refetch();
    onSuccess();
  });

  const [mode, setMode] = useState<Mode>("buy");
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | undefined>();
  const [slippageRaw, setSlippageRaw] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handleBeliefChange = (key: string) => {
    setSelectedKey(key);
    setAmount("");
    setAmountError(undefined);
    setDetailsOpen(false);
  };

  // Buy measures KASS to spend; sell measures shares to unwind. Switching mode
  // changes what the amount MEANS, so clear it (as belief-change does) rather than
  // silently reinterpret e.g. "100" from KASS to shares.
  const handleModeChange = (m: Mode) => {
    setMode(m);
    setAmount("");
    setAmountError(undefined);
  };

  const amountId = useId();
  const descId = `${amountId}-desc`;

  const parsed = parseKassAmount(amount);

  const slippage = parseSlippagePercent(slippageRaw);
  const slippageBps = slippage.bps;

  const positionBalance = outcome === "yes" ? yes.balance : no.balance;
  // Buy gates on KASS; sell gates on the held outcome shares (both 9 dp). The
  // gate message names the asset it checks, so selling asks for shares, not KASS.
  const gateBalance = mode === "buy" ? kass.balance : positionBalance;
  const gateAsset = mode === "buy" ? "KASS" : `${outcome.toUpperCase()} shares`;
  const balanceError = balanceGateError(parsed.value, gateBalance, gateAsset);

  const buyPreview =
    mode === "buy" && parsed.value ? previewBuy(reserves, outcome, parsed.value, slippageBps) : null;
  const buyReceived = buyPreview?.received ?? null;
  const buyMinReceived =
    buyPreview && parsed.value ? parsed.value + buyPreview.outputAmountMin : null;

  const sellPreview =
    mode === "sell" && parsed.value
      ? previewSell(reserves, outcome, parsed.value, slippageBps)
      : null;
  const sellReceived = sellPreview && sellPreview.received > 0n ? sellPreview.received : null;

  const priceImpact = parsed.value
    ? mode === "buy"
      ? buyPriceImpact(reserves, outcome, parsed.value)
      : sellPriceImpact(reserves, outcome, parsed.value)
    : 0;
  const priceImpactPct = Math.round(priceImpact * 1000) / 10;

  function bump(n: number) {
    // Bigint-exact: parse the current amount to base units, add n whole KASS, and
    // reformat. Round-tripping through Number(amount) + n silently altered the
    // low-order decimals (or emitted >9-dp strings) once a bigint-exact "Max"
    // balance ≳9M KASS had been placed in the field.
    const current = parseKassAmount(amount).value ?? 0n;
    const delta = BigInt(n) * 10n ** BigInt(KASS_DECIMALS);
    setAmount(toPlainAmount(current + delta));
    setAmountError(undefined);
  }
  function setMax() {
    if (gateBalance != null && gateBalance > 0n) setAmount(toPlainAmount(gateBalance));
    setAmountError(undefined);
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (parsed.error) {
      setAmountError(parsed.error);
      return;
    }
    if (slippage.error) return;
    setAmountError(undefined);
    const value = parsed.value!;
    void action.run(async () => {
      const refs = await marketRefs(pubkey, market);
      const userKassAta = (await pda.associatedTokenAccount(action.address!, market.kassMint)).address;
      if (mode === "buy") {
        return buildBuyIxs({
          indexer: action.indexer,
          refs,
          user: action.address!,
          outcome,
          kassAmount: value,
          userKassAta,
          reserves,
          slippageBps,
        });
      }
      return buildSellIxs({
        indexer: action.indexer,
        refs,
        user: action.address!,
        outcome,
        positionAmount: value,
        userKassAta,
        reserves,
        slippageBps,
      });
    });
  };

  const inputError = amountError ?? balanceError;

  return (
    <Card className="flex flex-col gap-4 lg:col-span-2">
      <div className="border-b border-hairline pb-3">
        <p className="font-inter text-[11px] uppercase tracking-[0.06em] text-silver">Order</p>
        <p className="mt-1 text-balance font-inter text-[14px] text-platinum" title={question}>
          {question ?? "Trade this market"}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <ModeTabs value={mode} onChange={handleModeChange} />
        <span
          className="rounded-tag border border-hairline px-2.5 py-1 font-inter text-[12px] text-silver"
          title="Trades execute at the current AMM price"
        >
          Market order
        </span>
      </div>

      <ConnectGate connected={action.connected}>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <BeliefSelect beliefs={beliefs} selectedKey={selectedKey} onChange={handleBeliefChange} />

          {/* Owned shares — visible in both buy and sell mode, unlike the
              amount field's balance line below (which only shows the side
              relevant to the current mode/outcome). */}
          <div className="flex items-center justify-between font-inter text-[12px] text-silver">
            <span>You own</span>
            <span className="flex gap-3 tabular-nums">
              <span className="text-aqua">
                {yes.balance === null ? "—" : formatKass(yes.balance)} YES
              </span>
              <span className="text-coral">
                {no.balance === null ? "—" : formatKass(no.balance)} NO
              </span>
            </span>
          </div>

          {/* Amount — large field + balance line + quick-add chips. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={amountId} className="font-inter text-[13px] font-medium text-platinum">
                Amount
              </label>
              <span className="font-inter text-[12px] text-silver">
                {mode === "buy" ? (
                  <>
                    Balance{" "}
                    <span className="text-silver">
                      {kass.balance === null ? "—" : `${formatKass(kass.balance)} KASS`}
                    </span>
                  </>
                ) : (
                  <>
                    You hold{" "}
                    <span className="text-silver">
                      {positionBalance === null ? "—" : `${formatKass(positionBalance)} ${outcome.toUpperCase()}`}
                    </span>
                  </>
                )}
              </span>
            </div>
            <div
              className={`flex items-baseline gap-2 rounded-tag border bg-liquid-kelp px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-platinum/40 focus-within:ring-offset-2 focus-within:ring-offset-liquid-abyss ${
                inputError ? "border-coral/60" : "border-hairline"
              }`}
            >
              <input
                id={amountId}
                aria-describedby={descId}
                aria-invalid={Boolean(inputError)}
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-transparent font-serif text-heading-sm font-light tabular-nums text-platinum placeholder:text-silver focus:outline-none"
              />
              <span className="font-inter text-[13px] text-silver">
                {mode === "buy" ? "KASS" : "shares"}
              </span>
            </div>
            <p id={descId} className="min-h-[1rem] font-inter text-[12px]">
              {inputError ? <span className="text-coral">{inputError}</span> : null}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => bump(n)}
                  className="rounded-tag border border-hairline bg-liquid-deep px-2 py-1.5 font-inter text-[13px] tabular-nums text-platinum transition-colors hover:border-silver active:scale-[0.96]"
                >
                  +{n}
                </button>
              ))}
              <button
                type="button"
                onClick={setMax}
                className="rounded-tag border border-hairline bg-liquid-deep px-2 py-1.5 font-inter text-[13px] text-platinum transition-colors hover:border-silver active:scale-[0.96]"
              >
                Max
              </button>
            </div>
          </div>

          {/* Live "you receive" estimate (buy). */}
          {mode === "buy" && buyReceived !== null ? (
            <div className="flex items-baseline justify-between rounded-tag bg-liquid-deep px-3 py-2 font-inter text-[13px]">
              <span className="text-silver">You receive ≈</span>
              <span className="tabular-nums text-platinum">
                {formatKass(buyReceived)} {outcome.toUpperCase()} shares
              </span>
            </div>
          ) : null}

          {/* Live "you receive" estimate (sell): the KASS the unwind returns, plus
              a note when the swap leaves a residual of conditional-token dust. */}
          {mode === "sell" && sellReceived !== null ? (
            <div className="flex flex-col gap-1 rounded-tag bg-liquid-deep px-3 py-2 font-inter text-[13px]">
              <div className="flex items-baseline justify-between">
                <span className="text-silver">You receive ≈</span>
                <span className="tabular-nums text-platinum">{formatKass(sellReceived)} KASS</span>
              </div>
              {sellPreview && sellPreview.residual > 0n ? (
                <p className="text-[11px] text-silver">
                  ≈ {formatKass(sellPreview.residual)} {outcome.toUpperCase()} shares are left
                  unmerged and stay in your wallet.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Price impact + a "Details" disclosure to configure max slippage. */}
          {parsed.value ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between rounded-tag bg-liquid-deep px-3 py-2 font-inter text-[13px]">
                <span className="text-silver">
                  Price impact{" "}
                  <span
                    className={`tabular-nums font-medium ${
                      priceImpact >= 0.1 ? "text-coral" : "text-platinum"
                    }`}
                  >
                    ≈ {priceImpactPct}%
                  </span>
                </span>
                <button
                  type="button"
                  aria-expanded={detailsOpen}
                  onClick={() => setDetailsOpen((v) => !v)}
                  className="flex items-center gap-1 font-inter text-[12px] text-silver transition-colors hover:text-platinum"
                >
                  Details
                  <span
                    aria-hidden
                    className={`inline-block transition-transform ${detailsOpen ? "rotate-180" : ""}`}
                  >
                    ⌄
                  </span>
                </button>
              </div>
              {detailsOpen ? (
                <div className="flex flex-col gap-3 rounded-tag border border-hairline bg-liquid-kelp px-3 py-3">
                  <Field
                    label="Max slippage"
                    hint="The trade reverts if the price moves beyond this tolerance before it lands."
                    error={slippage.error}
                  >
                    {(ids) => (
                      <div className="flex items-center gap-2">
                        <TextInput
                          ids={ids}
                          inputMode="decimal"
                          placeholder="1.0"
                          value={slippageRaw}
                          onChange={(e) => setSlippageRaw(e.target.value)}
                          className="max-w-[6rem]"
                        />
                        <span className="font-inter text-[13px] text-silver">%</span>
                      </div>
                    )}
                  </Field>
                  {mode === "buy" && buyMinReceived !== null ? (
                    <div className="flex items-baseline justify-between font-inter text-[12px]">
                      <span className="text-silver">Minimum received</span>
                      <span className="tabular-nums text-platinum">
                        {formatKass(buyMinReceived)} {outcome.toUpperCase()} shares
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <SubmitButton
            className="w-full py-3 text-[15px]"
            verb={mode === "buy" ? `Buy ${outcome.toUpperCase()}` : `Sell ${outcome.toUpperCase()}`}
            status={action.status}
            disabled={Boolean(balanceError) || Boolean(slippage.error)}
          />
          <WriteStatusRegion status={action.status} successVerb={mode === "buy" ? "Bought" : "Sold"} />

          {/* Jupiter any-token entry: DEFERRED. */}
          {/* TODO wire buildJupiterEntryRequest + app fetch (GET /quote → POST /swap) + composeWithEntry. */}
          <div className="flex items-center justify-between gap-2 font-inter text-[12px] text-silver-dim">
            <span>Pay with any token (Jupiter)</span>
            <span className="rounded-tag border border-hairline px-2.5 py-1 font-inter text-[12px] text-silver">
              Coming soon
            </span>
          </div>
        </form>
      </ConnectGate>
    </Card>
  );
}

export default TradePanel;
