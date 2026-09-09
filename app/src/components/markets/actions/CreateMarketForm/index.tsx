import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../../../ui";
import {
  buildCreateMarketIxs,
  buildCreateAllSteps,
  type ActivateStep,
  type CreateMarketBuild,
} from "../../../../market/data/actions";
import { useWriteAction } from "../../../../market/hooks/useWriteAction";
import { useActionSequence } from "../../../../market/hooks/useActionSequence";
import { useConfig } from "../../../../market/hooks/useMarketDetail";
import { useSolBalance } from "../../../../market/hooks/useSolBalance";
import { formatSol } from "../../../../market/lib/marketView";
import { parseSolAmount, balanceGateError } from "../../../../market/data/amount";
import { ConnectGate } from "../ConnectGate";
import { Field, SolBalanceLine, SubmitButton, TextInput } from "../formPrimitives";
import { WriteStatusRegion } from "../WriteStatusRegion";
import { ModeButton } from "./ModeButton";
import { BatchStepList } from "./BatchStepList";

/**
 * Create a new prediction market: `createSubject` (GPT Subject PDA) then
 * `createMarket` with `oracle` = that Subject. Binary markets use
 * `optionsCount = 2` and a single sub-market. Categorical questions create one
 * Subject then N outcome sub-markets in a resumable sequence.
 */
export function CreateMarketForm() {
  const navigate = useNavigate();
  const config = useConfig();
  const baseMint = config.data ? config.data.baseMint.toString() : undefined;
  const notInitialized = !config.loading && config.data === null;
  const { balance, loading: balanceLoading, refetch: refetchBalance } = useSolBalance(baseMint);

  const builtRef = useRef<CreateMarketBuild | null>(null);

  const [seed, setSeed] = useState("");
  const [seedError, setSeedError] = useState<string | undefined>();
  const [optionsCount, setOptionsCount] = useState(2);
  const [batchMode, setBatchMode] = useState(false);
  const [batchSteps, setBatchSteps] = useState<ActivateStep[] | null>(null);
  const [batchError, setBatchError] = useState<string | undefined>();

  const isCategorical = optionsCount > 2;

  const action = useWriteAction(() => {
    refetchBalance();
    const built = builtRef.current;
    if (built) navigate(`/markets/${built.market.toString()}`);
  });

  const seq = useActionSequence(() => {
    refetchBalance();
    navigate("/markets");
  });

  useEffect(() => {
    if (!isCategorical) setBatchMode(false);
  }, [isCategorical]);

  const parsedSeed = parseSolAmount(seed);
  const totalCost =
    batchMode && parsedSeed.value !== undefined
      ? parsedSeed.value * BigInt(optionsCount)
      : undefined;
  const balanceError = balanceGateError(batchMode ? totalCost : parsedSeed.value, balance);

  const validate = (): { seedValue: bigint } | null => {
    if (parsedSeed.error) {
      setSeedError(parsedSeed.error);
      return null;
    }
    if (!baseMint) {
      setSeedError("Waiting for the on-chain config (SOL mint) to load.");
      return null;
    }
    setSeedError(undefined);
    return { seedValue: parsedSeed.value! };
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (!v) return;
    void action.run(async () => {
      const built = await buildCreateMarketIxs({
        indexer: action.indexer,
        baseMint: baseMint!,
        creator: action.address!,
        seedAmount: v.seedValue,
        optionsCount: 2,
        outcomeIndex: 0,
      });
      builtRef.current = built;
      return built.ixs;
    });
  };

  const onBatchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (seq.busy) return;
    const v = validate();
    if (!v) return;
    try {
      setBatchError(undefined);
      const built = await buildCreateAllSteps({
        indexer: action.indexer,
        optionsCount,
        creator: seq.address!,
        baseMint: baseMint!,
        seedAmount: v.seedValue,
      });
      setBatchSteps(built.steps);
      await seq.run(built.steps);
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : String(err));
    }
  };

  const anyBatchError = seq.statuses.some((s) => s.kind === "error");
  const batchVerb = seq.allDone
    ? "Created — view markets"
    : anyBatchError
      ? "Retry creating"
      : seq.busy
        ? "Creating…"
        : `Create all ${optionsCount} outcomes`;
  const runningIdx = seq.statuses.findIndex((s) => s.kind === "running");

  return (
    <Card className="flex flex-col gap-4">
      {notInitialized ? (
        <div className="rounded-tag border border-hairline bg-liquid-deep p-4">
          <p className="font-inter text-[13px] text-silver">
            The program is not initialized (no on-chain Config), so its SOL mint is unknown. Deploy
            + initialize the program before creating a market.
          </p>
        </div>
      ) : null}
      <ConnectGate connected={action.connected}>
        <form className="flex flex-col gap-4" onSubmit={batchMode ? onBatchSubmit : onSubmit} noValidate>
          <div
            role="radiogroup"
            aria-label="Market type"
            className="inline-flex rounded-tag border border-hairline bg-liquid-deep p-0.5"
          >
            <ModeButton
              active={!isCategorical}
              onClick={() => {
                setOptionsCount(2);
                setBatchMode(false);
              }}
            >
              Binary
            </ModeButton>
            <ModeButton
              active={isCategorical}
              onClick={() => {
                setOptionsCount((n) => (n > 2 ? n : 3));
                setBatchMode(true);
              }}
            >
              Categorical
            </ModeButton>
          </div>

          {isCategorical ? (
            <Field
              label="Outcomes"
              hint="One GPT Subject, then one binary sub-market per outcome."
            >
              {(ids) => (
                <TextInput
                  ids={ids}
                  inputMode="numeric"
                  placeholder="3"
                  value={String(optionsCount)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 3 && n <= 32) setOptionsCount(n);
                  }}
                />
              )}
            </Field>
          ) : (
            <p className="font-inter text-[12px] text-silver">
              Binary market — YES if MagicBlock GPT resolves the subject to outcome 0.
            </p>
          )}

          <Field
            label={batchMode ? "Seed per outcome (SOL)" : "Seed (SOL)"}
            hint="Your initial contribution to the funding pool."
            error={seedError ?? balanceError}
          >
            {(ids) => (
              <TextInput
                ids={ids}
                inputMode="decimal"
                placeholder="e.g. 1000"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
            )}
          </Field>
          {batchMode && parsedSeed.value !== undefined ? (
            <p className="-mt-1 font-inter text-[12px] text-silver">
              Total: {optionsCount} × seed ={" "}
              <span className="font-medium text-silver">
                {formatSol(parsedSeed.value * BigInt(optionsCount))}
              </span>
            </p>
          ) : null}
          <SolBalanceLine balance={balance} loading={balanceLoading} format={formatSol} />

          {batchMode ? (
            <>
              {batchSteps ? <BatchStepList steps={batchSteps} statuses={seq.statuses} /> : null}
              {seq.busy && runningIdx >= 0 ? (
                <p aria-live="polite" className="font-inter text-[12px] text-silver">
                  {runningIdx === 0
                    ? "Creating GPT subject…"
                    : `Creating outcome ${runningIdx} of ${optionsCount}…`}
                </p>
              ) : null}
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={seq.busy || seq.allDone || Boolean(balanceError)}
                  aria-busy={seq.busy}
                  className="inline-flex items-center justify-center gap-2 rounded-button bg-aqua px-4 py-2.5 font-inter text-body font-medium text-liquid-abyss shadow-bloom transition-[transform,filter,box-shadow] duration-150 ease-out hover:-translate-y-px hover:brightness-110 active:translate-y-0 active:scale-[0.97] disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-phosphor focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {batchVerb}
                </button>
              </div>
              {batchError ? (
                <div className="rounded-tag border border-coral/40 bg-coral/10 px-3 py-2">
                  <p className="font-inter text-[13px] text-coral">{batchError}</p>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <SubmitButton
                  verb="Create market"
                  status={action.status}
                  disabled={Boolean(balanceError)}
                />
              </div>
              <WriteStatusRegion status={action.status} successVerb="Market created" />
            </>
          )}
        </form>
      </ConnectGate>
    </Card>
  );
}

export default CreateMarketForm;
