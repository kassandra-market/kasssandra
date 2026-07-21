/**
 * Offline unit tests for `src/lib/oracleCardAction.ts` — the pure "what's the
 * next management action, and is it ready yet" model for an oracle-list card.
 * Fixtures only carry the 5 fields the function actually reads.
 */
import { Phase } from '@kassandra-market/oracles'
import { describe, expect, it } from 'vitest'
import { isActionReady, nextOracleAction } from '../src/lib/oracleCardAction'

const NOW = 1_700_000_000n
const HOUR = 3_600n
const DAY = 86_400n

function oracle(over: {
  phase: Phase
  deadline?: bigint
  phaseEndsAt?: bigint
  proposerCount?: number
  openChallengeCount?: number
}) {
  return {
    phase: over.phase,
    deadline: over.deadline ?? NOW,
    phaseEndsAt: over.phaseEndsAt ?? NOW,
    proposerCount: over.proposerCount ?? 0,
    openChallengeCount: over.openChallengeCount ?? 0,
  }
}

describe('nextOracleAction — Proposal', () => {
  it('is not ready before the deadline, counting down to it', () => {
    const action = nextOracleAction(oracle({ phase: Phase.Proposal, deadline: NOW + HOUR }), NOW)
    expect(action).toEqual({ label: 'Propose an outcome', tab: 'manage', readyAt: NOW + HOUR })
    expect(isActionReady(action!, NOW)).toBe(false)
    expect(isActionReady(action!, NOW + HOUR)).toBe(true)
  })

  it('is ready to propose once the deadline has passed and the window is still open', () => {
    const action = nextOracleAction(
      oracle({ phase: Phase.Proposal, deadline: NOW - HOUR, phaseEndsAt: NOW + HOUR }),
      NOW,
    )
    expect(action).toEqual({ label: 'Propose an outcome', tab: 'manage' })
    expect(isActionReady(action!, NOW)).toBe(true)
  })

  it('switches to "Finalize proposals" once the window closes with at least one proposer', () => {
    const action = nextOracleAction(
      oracle({ phase: Phase.Proposal, deadline: NOW - DAY, phaseEndsAt: NOW - HOUR, proposerCount: 2 }),
      NOW,
    )
    expect(action).toEqual({ label: 'Finalize proposals', tab: 'manage' })
    expect(isActionReady(action!, NOW)).toBe(true)
  })

  it('keeps offering "Propose an outcome" past the window when nobody has proposed yet (the seeding re-open)', () => {
    const action = nextOracleAction(
      oracle({ phase: Phase.Proposal, deadline: NOW - DAY, phaseEndsAt: NOW - HOUR, proposerCount: 0 }),
      NOW,
    )
    expect(action).toEqual({ label: 'Propose an outcome', tab: 'manage' })
  })
})

describe('nextOracleAction — FactProposal', () => {
  it('offers "Submit a fact" while the window is open', () => {
    const action = nextOracleAction(oracle({ phase: Phase.FactProposal, phaseEndsAt: NOW + HOUR }), NOW)
    expect(action).toEqual({ label: 'Submit a fact', tab: 'manage' })
  })

  it('offers "Advance to fact voting" once the window closes', () => {
    const action = nextOracleAction(oracle({ phase: Phase.FactProposal, phaseEndsAt: NOW - HOUR }), NOW)
    expect(action).toEqual({ label: 'Advance to fact voting', tab: 'manage' })
  })
})

describe('nextOracleAction — FactVoting', () => {
  it('routes to the Facts tab while voting is open (voting happens per-fact there)', () => {
    const action = nextOracleAction(oracle({ phase: Phase.FactVoting, phaseEndsAt: NOW + HOUR }), NOW)
    expect(action).toEqual({ label: 'Vote on facts', tab: 'facts' })
  })

  it('routes to Manage for "Finalize facts" once the window closes', () => {
    const action = nextOracleAction(oracle({ phase: Phase.FactVoting, phaseEndsAt: NOW - HOUR }), NOW)
    expect(action).toEqual({ label: 'Finalize facts', tab: 'manage' })
  })
})

describe('nextOracleAction — AiClaim', () => {
  it('offers "Submit AI claim" while the window is open', () => {
    const action = nextOracleAction(oracle({ phase: Phase.AiClaim, phaseEndsAt: NOW + HOUR }), NOW)
    expect(action).toEqual({ label: 'Submit AI claim', tab: 'manage' })
  })

  it('offers "Finalize AI claims" once the window closes', () => {
    const action = nextOracleAction(oracle({ phase: Phase.AiClaim, phaseEndsAt: NOW - HOUR }), NOW)
    expect(action).toEqual({ label: 'Finalize AI claims', tab: 'manage' })
  })
})

describe('nextOracleAction — Challenge', () => {
  it('offers "Open a challenge" while the window is open and none is open yet', () => {
    const action = nextOracleAction(oracle({ phase: Phase.Challenge, phaseEndsAt: NOW + HOUR }), NOW)
    expect(action).toEqual({ label: 'Open a challenge', tab: 'manage' })
  })

  it('offers "Finalize oracle" once the window closes with no open challenge', () => {
    const action = nextOracleAction(oracle({ phase: Phase.Challenge, phaseEndsAt: NOW - HOUR }), NOW)
    expect(action).toEqual({ label: 'Finalize oracle', tab: 'manage' })
  })

  it('offers "View open challenge" whenever a challenge market is open, window or not', () => {
    const open = nextOracleAction(
      oracle({ phase: Phase.Challenge, phaseEndsAt: NOW + HOUR, openChallengeCount: 1 }),
      NOW,
    )
    expect(open).toEqual({ label: 'View open challenge', tab: 'manage' })
    const closed = nextOracleAction(
      oracle({ phase: Phase.Challenge, phaseEndsAt: NOW - HOUR, openChallengeCount: 1 }),
      NOW,
    )
    expect(closed).toEqual({ label: 'View open challenge', tab: 'manage' })
  })
})

describe('nextOracleAction — FinalRecompute / Resolved / InvalidDeadend', () => {
  it('always offers "Finalize oracle" (ready) in FinalRecompute', () => {
    const action = nextOracleAction(oracle({ phase: Phase.FinalRecompute }), NOW)
    expect(action).toEqual({ label: 'Finalize oracle', tab: 'manage' })
  })

  it('gates "Sweep" on the 30-day grace after phaseEndsAt, for both terminal phases', () => {
    const notYet = nextOracleAction(oracle({ phase: Phase.Resolved, phaseEndsAt: NOW }), NOW)
    expect(notYet?.label).toBe('Sweep')
    expect(isActionReady(notYet!, NOW)).toBe(false)
    expect(isActionReady(notYet!, NOW + 30n * DAY)).toBe(true)

    const deadend = nextOracleAction(oracle({ phase: Phase.InvalidDeadend, phaseEndsAt: NOW - 30n * DAY }), NOW)
    expect(isActionReady(deadend!, NOW)).toBe(true)
  })
})

describe('nextOracleAction — no actionable phase', () => {
  it('returns null for Created (reserved/unused) and unknown phases', () => {
    expect(nextOracleAction(oracle({ phase: Phase.Created }), NOW)).toBeNull()
    expect(nextOracleAction(oracle({ phase: 99 as Phase }), NOW)).toBeNull()
  })
})
