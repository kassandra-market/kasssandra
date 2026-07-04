import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchAccountEvents,
  indexerBaseUrl,
  isIndexerConfigured,
  type IndexedEvent,
} from '../src/data/indexer'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('indexer client config', () => {
  it('is unconfigured when VITE_INDEXER_URL is unset/blank', () => {
    vi.stubEnv('VITE_INDEXER_URL', '')
    expect(indexerBaseUrl()).toBeUndefined()
    expect(isIndexerConfigured()).toBe(false)
  })

  it('normalizes a trailing slash', () => {
    vi.stubEnv('VITE_INDEXER_URL', 'https://idx.example.com/')
    expect(indexerBaseUrl()).toBe('https://idx.example.com')
    expect(isIndexerConfigured()).toBe(true)
  })
})

describe('fetchAccountEvents', () => {
  it('hits the account-events route and returns the events array', async () => {
    vi.stubEnv('VITE_INDEXER_URL', 'https://idx.example.com')
    const sample: IndexedEvent = {
      signature: 'Sig1',
      ixIndex: 0,
      ixType: 'propose',
      discriminant: 11,
      slot: 42,
      blockTime: 1_700_000_000,
      account0: 'OracleA',
      accounts: ['OracleA'],
      dataBase64: 'Cw==',
    }
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://idx.example.com/accounts/OracleA/events?limit=25')
      return new Response(JSON.stringify({ count: 1, events: [sample] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const events = await fetchAccountEvents('OracleA', { limit: 25 })
    expect(events).toEqual([sample])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('throws a clear error on a non-2xx response', async () => {
    vi.stubEnv('VITE_INDEXER_URL', 'https://idx.example.com')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    )
    await expect(fetchAccountEvents('OracleA')).rejects.toThrow(/503/)
  })

  it('throws when the indexer is not configured', async () => {
    vi.stubEnv('VITE_INDEXER_URL', '')
    await expect(fetchAccountEvents('OracleA')).rejects.toThrow(/not configured/)
  })
})
