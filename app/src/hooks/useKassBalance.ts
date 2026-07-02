/**
 * A tiny read hook over {@link fetchKassBalance} for the staking forms.
 *
 * {@link useKassBalance} resolves the connected wallet's KASS balance (raw base
 * units) for a given mint, mirroring the unmount-guarded `useEffect`+nonce
 * pattern in `useOracles` (TanStack Query is NOT a dep). It reads the RPC
 * `Connection` from FA1's `useConnection()` and the connected `publicKey` from
 * wallet-adapter, so switching cluster/wallet re-runs the fetch automatically.
 *
 * `balance` is `null` while disconnected, still loading, or after a transient
 * fetch error — the caller must NOT hard-block a form on a `null` balance (the
 * on-chain tx remains the ultimate guard). A resolved `0n` means the wallet
 * genuinely holds no KASS (absent ATA), which the form MAY gate on.
 *
 * Mock mode: the `ClusterProvider` connection stays real (a dead RPC under
 * `?mock`), so — exactly like `useWriteAction` — this hook swaps in the
 * {@link mockWriteConnection}, whose `getTokenAccountBalance` stub (see
 * `lib/mockWrite`) feeds the fixture balance under `?mock&wallet=connected`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useConnection } from '../lib/cluster'
import { isMockMode } from '../data/mockOracles'
import { mockWriteConnection } from '../lib/mockWrite'
import { fetchKassBalance } from '../data/balance'

export interface KassBalanceState {
  /** Raw base-unit KASS balance, or `null` (disconnected / loading / transient error). */
  balance: bigint | null
  /** True while a fetch is in flight. */
  loading: boolean
  /** Re-run the fetch (e.g. after a successful bond/stake spends KASS). */
  refetch: () => void
}

export function useKassBalance(kassMint: string): KassBalanceState {
  const { connection: liveConnection } = useConnection()
  const mock = isMockMode()
  // Under mock mode the live ConnectionProvider points at a dead RPC; swap in
  // the same mock connection `useWriteAction` uses (its stub feeds the balance).
  const connection = useMemo(
    () => (mock ? mockWriteConnection() : liveConnection),
    [mock, liveConnection],
  )
  const { publicKey, connected } = useWallet()
  const owner = connected && publicKey ? publicKey.toBase58() : null

  const [balance, setBalance] = useState<bigint | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)

  const refetch = useCallback(() => setNonce((n) => n + 1), [])

  // A stable ref lets the effect read the latest connection without re-binding
  // on every Connection identity change beyond the intended deps.
  const connectionRef = useRef(connection)
  connectionRef.current = connection

  useEffect(() => {
    if (!owner) {
      setBalance(null)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    // Mock mode: the mock wallet key isn't a real address, so — like
    // `useWriteAction` skips the real ix-build — skip the ATA derivation and read
    // the mock connection's `getTokenAccountBalance` stub (which ignores its arg).
    const task = mock
      ? (async () => {
          const read = connectionRef.current.getTokenAccountBalance as unknown as () => Promise<{
            value?: { amount: string }
          }>
          const res = await read()
          return res?.value ? BigInt(res.value.amount) : 0n
        })()
      : fetchKassBalance(connectionRef.current, owner, kassMint)
    task.then(
      (value) => {
        if (!active) return
        setBalance(value)
        setLoading(false)
      },
      () => {
        // Transient/unexpected RPC error: treat softly — leave balance null so
        // the form doesn't hard-block; the tx is the ultimate guard.
        if (!active) return
        setBalance(null)
        setLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [owner, kassMint, connection, mock, nonce])

  return { balance, loading, refetch }
}
