/**
 * The React seam driving a STAGED, multi-tx SEQUENCE (the activate bring-up and
 * bulk-liquidity deposits/withdrawals).
 *
 * `compose → activate` (and a group liquidity deposit across several sub-markets)
 * often can't fit ONE transaction, so a builder returns an ORDERED list of
 * {@link ActivateStep}s. This hook first PACKS the not-yet-landed steps into as
 * few transactions as {@link packSteps} can fit (each packed transaction may
 * cover several steps at once — see `data/actions/packTx`), then sends them:
 *
 *   - ONE packed transaction → the existing single-tx wallet-signed path (one
 *     approval already).
 *   - MORE THAN ONE → every transaction is signed together in a SINGLE
 *     `signAllTransactions` wallet approval, then relayed + confirmed one at a
 *     time in order (a later transaction may read accounts an earlier one
 *     creates, so relaying still waits for each confirm before the next). A
 *     wallet that doesn't expose `signAllTransactions` falls back to the
 *     one-popup-per-transaction path.
 *
 * Per-step {@link StepStatus} stays index-aligned to the ORIGINAL step list
 * regardless of packing — every step in the same packed transaction moves
 * through `running`/`done`/`error` together, sharing that transaction's
 * signature, so the step-list UI (`BatchStepList`/`StepList`) needs no changes.
 *
 * The composition instructions are NOT idempotent (re-running a landed init
 * reverts "already in use"), so BEFORE packing, the hook probes each step's
 * account ({@link stepAlreadyLanded}) and SKIPS it when it already exists —
 * making a resume after a confirm-timeout safe instead of fatal.
 *
 * It reuses the SAME wallet-adapter sender the single-write seam
 * ({@link useWriteAction}) uses.
 */
import { useCallback, useMemo, useState } from "react";
import { Address, type Transaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useIndexer } from "../lib/indexer";
import { buildUnsignedTx, sendAndConfirm, sendSignedAndConfirm, signAndRelay, type TxSender } from "../data/send";
import { mapWriteError } from "../data/writeAction";
import { stepAlreadyLanded, type ActivateStep } from "../data/actions/activate";
import { packSteps } from "../data/actions/packTx";

/** The lifecycle of one step in the sequence. */
export type StepStatus =
  | { kind: "pending" }
  | { kind: "running" }
  | { kind: "done"; signature: string }
  | { kind: "error"; message: string; logs?: string[] };

function isRunning(statuses: StepStatus[]): boolean {
  return statuses.some((s) => s.kind === "running");
}

/**
 * Compute the initial per-step status array + resume index for a `run()` call.
 * Exported (pure, no React) so the resume-vs-fresh decision is unit-testable
 * without a render harness — see `test/actionSequence.unit.test.ts`.
 *
 * When `startIndex` is given, the caller is declaring a DELIBERATE fresh run
 * (or an explicit resume point): every status starts `pending`, `prevStatuses`
 * is ignored entirely. This matters because `prevStatuses` may still reflect an
 * UNRELATED earlier run whose length merely happens to match the new `steps`
 * (same length is a coincidence, not evidence of a resume) — and because a
 * caller that just called `reset()` cannot assume that reset has been applied
 * to `prevStatuses` yet: React batches the state update, so `run()`'s own
 * closure over it is still the PRE-reset value until the next render. A
 * `reset(); run(newSteps)` pair in the same event handler races this and can
 * silently no-op a brand-new run whose step count matches the old one (see the
 * "packed multi-instruction transactions can't be retriggered" bug this fixed —
 * `GroupLiquidityPanel`'s bulk deposit/withdraw). Passing `startIndex`
 * sidesteps the race by not depending on `prevStatuses` timing at all.
 *
 * Without `startIndex` (the `ActivateControl` / `CreateMarketForm` case — one
 * persistent step list, retried in place after a mid-sequence failure):
 * auto-detect — reuse `prevStatuses` when its length matches `stepsLength` and
 * resume at the first non-`done` entry; otherwise start fresh.
 */
export function initialRunState(
  stepsLength: number,
  prevStatuses: StepStatus[],
  startIndex?: number,
): { statusArr: StepStatus[]; begin: number } {
  const fresh = (): StepStatus[] => Array.from({ length: stepsLength }, () => ({ kind: "pending" as const }));
  const statusArr: StepStatus[] =
    startIndex === undefined && prevStatuses.length === stepsLength ? [...prevStatuses] : fresh();
  const found = startIndex ?? statusArr.findIndex((s) => s.kind !== "done");
  const begin = found === -1 ? stepsLength : found;
  // Clear any prior error at/after the resume point.
  const cleared = statusArr.map((s, i) => (i >= begin && s.kind === "error" ? { kind: "pending" as const } : s));
  return { statusArr: cleared, begin };
}

export interface ActionSequence {
  /** Per-step status, index-aligned to the last-run step list. */
  statuses: StepStatus[];
  /** Whether the sequence is currently sending a step. */
  busy: boolean;
  /** Whether a wallet is connected (the control gates on this). */
  connected: boolean;
  /** The connected wallet's base58 address (or null). */
  address: string | null;
  /** Whether every step has completed. */
  allDone: boolean;
  /**
   * Run the given ordered steps, stopping at the first failure. Safe to call
   * again to retry from the failure. `startIndex` forces a deliberate fresh
   * run (or explicit resume point) instead of the default auto-detected
   * resume — see {@link initialRunState}'s doc comment for why this matters
   * for a caller (like `GroupLiquidityPanel`) that runs a NEW step list on
   * every call rather than retrying the same one in place.
   */
  run: (steps: ActivateStep[], startIndex?: number) => Promise<void>;
}

export function useActionSequence(onDone?: () => void): ActionSequence {
  const indexer = useIndexer();
  const { publicKey, connected, signTransaction, signAllTransactions } = useWallet();
  const [statuses, setStatuses] = useState<StepStatus[]>([]);

  const walletSender = useMemo<TxSender | null>(() => {
    if (!connected || !publicKey || !signTransaction) return null;
    const feePayer = new Address(publicKey.toBase58());
    return (ixs) => signAndRelay(indexer, feePayer, signTransaction, ixs);
  }, [connected, publicKey, signTransaction, indexer]);

  const allDone = statuses.length > 0 && statuses.every((s) => s.kind === "done");

  const run = useCallback(
    async (steps: ActivateStep[], startIndex?: number) => {
      if (isRunning(statuses)) return;
      if (!walletSender || !publicKey) {
        setStatuses(steps.map(() => ({ kind: "pending" as const })));
        return;
      }

      const { statusArr, begin } = initialRunState(steps.length, statuses, startIndex);
      setStatuses(statusArr);

      // Probe every not-yet-done step for a landed (but unconfirmed) prior send,
      // marking it done and excluding it from packing (see `stepAlreadyLanded`).
      const pending: { index: number; step: ActivateStep }[] = [];
      for (let i = begin; i < steps.length; i++) {
        if (steps[i].skipIfLanded !== false && (await stepAlreadyLanded(indexer, steps[i]))) {
          setStatuses((prev) => {
            const next = [...prev];
            next[i] = { kind: "done", signature: "already-landed" };
            return next;
          });
        } else {
          pending.push({ index: i, step: steps[i] });
        }
      }
      if (pending.length === 0) {
        onDone?.();
        return;
      }

      const setRunning = (idxs: number[]) =>
        setStatuses((prev) => {
          const next = [...prev];
          for (const i of idxs) next[i] = { kind: "running" };
          return next;
        });
      const setDone = (idxs: number[], signature: string) =>
        setStatuses((prev) => {
          const next = [...prev];
          for (const i of idxs) next[i] = { kind: "done", signature };
          return next;
        });
      const setError = (idxs: number[], failure: { message: string; logs?: string[] }) =>
        setStatuses((prev) => {
          const next = [...prev];
          for (const i of idxs) next[i] = { kind: "error", ...failure };
          return next;
        });

      const feePayer = new Address(publicKey.toBase58());
      const batches = packSteps(
        feePayer,
        pending.map((p) => p.step),
      );
      let cursor = 0;
      const batchIndices = (stepCount: number) => {
        const idxs = pending.slice(cursor, cursor + stepCount).map((p) => p.index);
        cursor += stepCount;
        return idxs;
      };

      if (batches.length <= 1 || !signAllTransactions) {
        // Either everything already packed into one transaction, or the wallet
        // can't batch-sign — fall back to one popup per packed transaction
        // (still fewer than one-per-step whenever packing combined steps).
        for (const batch of batches) {
          const idxs = batchIndices(batch.steps.length);
          setRunning(idxs);
          try {
            const { signature } = await sendAndConfirm(indexer, walletSender, batch.ixs);
            setDone(idxs, signature);
          } catch (err) {
            setError(idxs, mapWriteError(err));
            return;
          }
        }
      } else {
        // More than one transaction needed — sign them ALL in one wallet
        // approval, then relay + confirm sequentially (a later batch may read
        // accounts an earlier batch creates).
        let signed: Transaction[];
        try {
          const unsigned = await Promise.all(
            batches.map((b) => indexer.getBlockhash().then((bh) => buildUnsignedTx(feePayer, bh, b.ixs))),
          );
          signed = await signAllTransactions(unsigned);
        } catch (err) {
          setError(
            pending.map((p) => p.index),
            mapWriteError(err),
          );
          return;
        }
        for (let b = 0; b < batches.length; b++) {
          const idxs = batchIndices(batches[b].steps.length);
          setRunning(idxs);
          try {
            const { signature } = await sendSignedAndConfirm(indexer, signed[b]);
            setDone(idxs, signature);
          } catch (err) {
            setError(idxs, mapWriteError(err));
            return;
          }
        }
      }
      onDone?.();
    },
    [statuses, walletSender, publicKey, signAllTransactions, indexer, onDone],
  );

  return {
    statuses,
    busy: isRunning(statuses),
    connected,
    address: publicKey ? publicKey.toBase58() : null,
    allDone,
    run,
  };
}

export default useActionSequence;
