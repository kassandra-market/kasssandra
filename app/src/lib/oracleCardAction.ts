/**
 * Pure "what's the next management action, and is it ready yet" model for an
 * oracle-list CARD (RU-adjacent to `phaseTimeline.ts`'s narrative "what's
 * next" hint, but concrete + actionable: a label, which DETAIL-PAGE TAB it
 * routes to, and — when the on-chain window gating it hasn't opened/closed
 * yet — the unix-seconds timestamp it becomes ready).
 *
 * Derived ENTIRELY from list-level `Oracle` fields (`phase`, `deadline`,
 * `phaseEndsAt`, `proposerCount`, `openChallengeCount`) — no per-card extra
 * fetch, no participation lookup (a card never claims "you already did this";
 * it just routes to the tab where the real, wallet-aware state renders). Gate
 * semantics are pinned against the program processors (`programs/oracles/src/
 * processor/*.rs`): `propose` needs `now >= deadline`; the four finalize/
 * advance cranks need `now >= phaseEndsAt` (`require_after_end`); submit_fact /
 * vote_fact / submit_ai_claim / open_challenge need `now < phaseEndsAt`
 * (`require_before_end`); `sweep_oracle` needs `now >= phaseEndsAt +
 * SWEEP_GRACE`.
 */
import { Phase, type Oracle } from '@kassandra-market/oracles'

/** 30-day sweep grace (config.rs `SWEEP_GRACE` = 30·24·60·60) — mirrors `SweepControl.tsx`. */
const SWEEP_GRACE = 30n * 24n * 60n * 60n

/** Which detail-page tab a card CTA routes to. */
export type OracleCardActionTab = 'manage' | 'facts'

/** The next management action for an oracle card. */
export interface OracleCardAction {
  /** Button label, e.g. "Propose an outcome". */
  label: string
  /** Which detail-page tab the CTA navigates to. */
  tab: OracleCardActionTab
  /** Unix seconds the action becomes available; `undefined` = ready now. */
  readyAt?: bigint
}

/** Whether an action's gating window has passed as of `nowSec`. */
export function isActionReady(action: OracleCardAction, nowSec: bigint): boolean {
  return action.readyAt === undefined || nowSec >= action.readyAt
}

type OracleFields = Pick<
  Oracle,
  'phase' | 'deadline' | 'phaseEndsAt' | 'proposerCount' | 'openChallengeCount'
>

/**
 * The next management action for `oracle`, or `null` when nothing is
 * actionable from a card (an unreadable/unknown phase, or the settled window
 * has no sweep left to do — callers should already be past that once swept,
 * though a card can't know that without a fetch; it just shows "ready" and
 * `sweep_oracle`'s own idempotency guard makes a redundant sweep harmless).
 */
export function nextOracleAction(oracle: OracleFields, nowSec: bigint): OracleCardAction | null {
  switch (oracle.phase) {
    case Phase.Proposal: {
      if (nowSec < oracle.deadline) {
        return { label: 'Propose an outcome', tab: 'manage', readyAt: oracle.deadline }
      }
      // The window re-opens for a first ("seeding") proposal when NO proposer
      // has registered yet, even past `phaseEndsAt` (`propose.rs`) — so only
      // offer "Finalize proposals" once there is at least one to finalize.
      if (nowSec < oracle.phaseEndsAt || oracle.proposerCount === 0) {
        return { label: 'Propose an outcome', tab: 'manage' }
      }
      return { label: 'Finalize proposals', tab: 'manage' }
    }

    case Phase.FactProposal:
      return nowSec < oracle.phaseEndsAt
        ? { label: 'Submit a fact', tab: 'manage' }
        : { label: 'Advance to fact voting', tab: 'manage' }

    case Phase.FactVoting:
      // Voting happens per-fact on the Facts tab, not a Manage-tab form.
      return nowSec < oracle.phaseEndsAt
        ? { label: 'Vote on facts', tab: 'facts' }
        : { label: 'Finalize facts', tab: 'manage' }

    case Phase.AiClaim:
      return nowSec < oracle.phaseEndsAt
        ? { label: 'Submit AI claim', tab: 'manage' }
        : { label: 'Finalize AI claims', tab: 'manage' }

    case Phase.Challenge: {
      // An open challenge market blocks both a new challenge (moot — the
      // round is already contested) and `finalize_oracle` (`ChallengesOutstanding`).
      if (oracle.openChallengeCount > 0) return { label: 'View open challenge', tab: 'manage' }
      return nowSec < oracle.phaseEndsAt
        ? { label: 'Open a challenge', tab: 'manage' }
        : { label: 'Finalize oracle', tab: 'manage' }
    }

    case Phase.FinalRecompute:
      return { label: 'Finalize oracle', tab: 'manage' }

    case Phase.Resolved:
    case Phase.InvalidDeadend:
      return { label: 'Sweep', tab: 'manage', readyAt: oracle.phaseEndsAt + SWEEP_GRACE }

    default:
      return null
  }
}
