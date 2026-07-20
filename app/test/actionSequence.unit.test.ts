/**
 * Offline unit tests for `src/market/hooks/useActionSequence.ts`'s pure
 * `initialRunState` helper — the resume-vs-fresh decision `run()` makes before
 * sending any step.
 *
 * Regression coverage for a real bug: `GroupLiquidityPanel`'s deposit/withdraw
 * called `seq.reset(); await seq.run(built)` on every submit, intending each
 * submission to start fresh. But `reset()`'s state update isn't visible to
 * `run()`'s own closure until the NEXT render, so `run()` still saw the
 * PREVIOUS run's statuses. When a new deposit's step count happened to match
 * the prior (successful) deposit's — the common case, since it's driven by the
 * same `depositable.length` — `run()` found every status already `done`,
 * computed `begin === steps.length`, and silently returned via the
 * `pending.length === 0` short-circuit: no transaction sent, no error shown,
 * yet `onDone` still fired. A packed multi-instruction transaction could not be
 * retriggered. The fix: an explicit `startIndex` parameter that ignores
 * `prevStatuses` entirely, matching `useComposeSequence`'s already-correct
 * `run(steps, startIndex)` design.
 */
import { describe, expect, it } from "vitest";

import { initialRunState, type StepStatus } from "../src/market/hooks/useActionSequence";

const done = (sig = "sig"): StepStatus => ({ kind: "done", signature: sig });
const pending: StepStatus = { kind: "pending" };
const error = (message = "boom"): StepStatus => ({ kind: "error", message });

describe("initialRunState — without startIndex (auto-resume, the ActivateControl/CreateMarketForm case)", () => {
  it("starts every step pending when there is no prior state", () => {
    const { statusArr, begin } = initialRunState(3, []);
    expect(statusArr).toEqual([pending, pending, pending]);
    expect(begin).toBe(0);
  });

  it("resumes at the first non-done step when prevStatuses aligns in length", () => {
    const prev: StepStatus[] = [done("a"), error("failed"), pending];
    const { statusArr, begin } = initialRunState(3, prev);
    expect(begin).toBe(1);
    // The error at/after the resume point is cleared back to pending.
    expect(statusArr).toEqual([done("a"), pending, pending]);
  });

  it("starts fresh when prevStatuses is a different length (an unrelated prior sequence)", () => {
    const prev: StepStatus[] = [done("a"), done("b")];
    const { statusArr, begin } = initialRunState(3, prev);
    expect(begin).toBe(0);
    expect(statusArr).toEqual([pending, pending, pending]);
  });

  it("REGRESSION: a same-length prior fully-done run makes begin === stepsLength (would run nothing) — exactly why a fresh caller must pass startIndex", () => {
    const prev: StepStatus[] = [done("a"), done("b"), done("c")];
    const { begin } = initialRunState(3, prev);
    expect(begin).toBe(3); // no step would be probed/sent if a caller relied on this path
  });
});

describe("initialRunState — with startIndex (the fix: GroupLiquidityPanel's per-submission runs)", () => {
  it("ignores a same-length fully-done prevStatuses and starts every step pending at begin=0", () => {
    const prev: StepStatus[] = [done("a"), done("b"), done("c")];
    const { statusArr, begin } = initialRunState(3, prev, 0);
    expect(begin).toBe(0);
    expect(statusArr).toEqual([pending, pending, pending]);
  });

  it("ignores prevStatuses even when it has errors, still forcing begin to startIndex", () => {
    const prev: StepStatus[] = [error("old failure"), done("b")];
    const { statusArr, begin } = initialRunState(2, prev, 0);
    expect(begin).toBe(0);
    expect(statusArr).toEqual([pending, pending]);
  });

  it("honors a non-zero explicit startIndex (a genuine resume point)", () => {
    const { begin } = initialRunState(4, [], 2);
    expect(begin).toBe(2);
  });
});
