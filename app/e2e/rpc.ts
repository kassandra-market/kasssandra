/**
 * Shared surfpool JSON-RPC + surfnet-cheatcode client for the Playwright e2e
 * helpers. Both the default (:8899) and the forked (:8940) `onchain.ts` bind this
 * to their endpoint instead of each re-implementing `rpc` / `getAccountData` /
 * `setAccountRaw` / `poll`.
 */
export const KASSANDRA_PROGRAM = 'KassVxvXUEPr5apSr2MqiGva4VFtJXyYLLDFS3f83nY'
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Poll `read` until `pred` holds (or throw with the last value). Pure — no RPC. */
export async function poll<T>(
  read: () => Promise<T>,
  pred: (v: T) => boolean,
  timeoutMs = 25_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined
  while (Date.now() < deadline) {
    try {
      last = await read()
      if (pred(last)) return last
    } catch {
      // The account may not exist yet — keep polling.
    }
    await sleep(300)
  }
  throw new Error(
    `on-chain poll timed out; last = ${JSON.stringify(last, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`,
  )
}

export interface SurfpoolRpc {
  rpc<T>(method: string, params: unknown[]): Promise<T>
  /** Raw account data (base64 → bytes) or null when the account does not exist. */
  getAccountData(address: string): Promise<Uint8Array | null>
  /** Overwrite an account's data via `surfnet_setAccount`. */
  setAccountRaw(address: string, data: Uint8Array, owner?: string): Promise<void>
}

/** Bind the RPC + surfnet helpers to a surfpool endpoint URL. */
export function surfpoolRpc(url: string): SurfpoolRpc {
  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    return ((await res.json()) as { result: T }).result
  }

  async function getAccountData(address: string): Promise<Uint8Array | null> {
    const value = await rpc<{ value?: { data?: [string, string] } | null }>('getAccountInfo', [
      address,
      { encoding: 'base64', commitment: 'confirmed' },
    ])
    if (!value?.value || !value.value.data) return null
    return Uint8Array.from(Buffer.from(value.value.data[0], 'base64'))
  }

  async function setAccountRaw(
    address: string,
    data: Uint8Array,
    owner = KASSANDRA_PROGRAM,
  ): Promise<void> {
    await rpc('surfnet_setAccount', [
      address,
      { lamports: 5_000_000, owner, executable: false, data: Buffer.from(data).toString('hex') },
    ])
  }

  return { rpc, getAccountData, setAccountRaw }
}
