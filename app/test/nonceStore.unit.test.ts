import { beforeEach, describe, expect, it } from 'vitest'
import { recallNonce, rememberNonce } from '../src/lib/nonceStore'

// jsdom/happy-dom isn't configured; provide a minimal localStorage shim.
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
  clear() {
    this.m.clear()
  }
}

describe('nonceStore', () => {
  beforeEach(() => {
    ;(globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage
  })

  it('remembers and recalls a nonce (bigint round-trip)', () => {
    const oracle = 'OrAcLePubKey11111111111111111111111111111111'
    // A full-range random-style u64 that a bounded scan could never reach.
    const nonce = 17293822569102704642n
    rememberNonce(oracle, nonce)
    expect(recallNonce(oracle)).toBe(nonce)
  })

  it('returns null for an unknown oracle', () => {
    expect(recallNonce('nope')).toBeNull()
  })

  it('keeps distinct oracles independent', () => {
    rememberNonce('a', 1n)
    rememberNonce('b', 2n)
    expect(recallNonce('a')).toBe(1n)
    expect(recallNonce('b')).toBe(2n)
  })

  it('overwrites on re-remember', () => {
    rememberNonce('a', 1n)
    rememberNonce('a', 99n)
    expect(recallNonce('a')).toBe(99n)
  })

  it('does not throw when localStorage is absent', () => {
    ;(globalThis as { localStorage?: Storage }).localStorage = undefined
    expect(() => rememberNonce('a', 1n)).not.toThrow()
    expect(recallNonce('a')).toBeNull()
  })
})
