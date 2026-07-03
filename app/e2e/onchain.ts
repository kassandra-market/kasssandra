/**
 * Read + decode on-chain accounts from surfpool in the Playwright test process,
 * so a browser write can be asserted by its PERSISTENT on-chain effect (the UI
 * success line is transient — it is cleared by the post-write refetch).
 */
import { Address } from '@solana/web3.js'
import { decodeFact, decodeOracle, decodeProposer, decodeProtocol } from '@kassandra/sdk'

const RPC = 'http://127.0.0.1:8899'
const PROGRAM = 'KassVxvXUEPr5apSr2MqiGva4VFtJXyYLLDFS3f83nY'

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return ((await res.json()) as { result: T }).result
}

/** The on-chain Clock sysvar `unix_timestamp` — what the program's `now()` reads. */
export async function clockUnix(): Promise<number> {
  const data = await getAccountData('SysvarC1ock11111111111111111111111111111111')
  if (!data) throw new Error('Clock sysvar not readable')
  return Number(Buffer.from(data).readBigInt64LE(32))
}

/**
 * Set the surfpool clock so the program's `now()` lands at ~`targetUnix`, by
 * jumping the absolute slot (surfpool moves unix at ~0.4 s/slot). Because the
 * shared clock is advanced far forward by seeding, each spec resets it into its
 * oracle's phase window right before acting (tests run serially, one oracle each).
 */
export async function setClockTo(targetUnix: number): Promise<void> {
  const cur = await clockUnix()
  const slot = await rpc<number>('getSlot', [])
  const delta = Math.round((targetUnix - cur) / 0.4)
  await rpc('surfnet_timeTravel', [{ absoluteSlot: Math.max(1, slot + delta) }])
  await new Promise((r) => setTimeout(r, 250))
}

/** Raw account data (base64 → bytes) or null when the account does not exist. */
export async function getAccountData(address: string): Promise<Uint8Array | null> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountInfo',
      params: [address, { encoding: 'base64', commitment: 'confirmed' }],
    }),
  })
  const json = (await res.json()) as { result?: { value?: { data?: [string, string] } | null } }
  const value = json.result?.value
  if (!value || !value.data) return null
  return Uint8Array.from(Buffer.from(value.data[0], 'base64'))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Poll `read` until `pred` holds (or throw with the last value). */
export async function poll<T>(
  read: () => Promise<T>,
  pred: (v: T) => boolean,
  timeoutMs = 25_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined
  while (Date.now() < deadline) {
    last = await read()
    if (pred(last)) return last
    await sleep(300)
  }
  throw new Error(
    `on-chain poll timed out; last = ${JSON.stringify(last, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`,
  )
}

export async function oracleAt(address: string): Promise<ReturnType<typeof decodeOracle>> {
  const data = await getAccountData(address)
  if (!data) throw new Error(`oracle ${address} not found`)
  return decodeOracle(data)
}

export async function factAt(address: string): Promise<ReturnType<typeof decodeFact>> {
  const data = await getAccountData(address)
  if (!data) throw new Error(`fact ${address} not found`)
  return decodeFact(data)
}

export async function proposerAt(address: string): Promise<ReturnType<typeof decodeProposer>> {
  const data = await getAccountData(address)
  if (!data) throw new Error(`proposer ${address} not found`)
  return decodeProposer(data)
}

export async function protocolAt(address: string): Promise<ReturnType<typeof decodeProtocol>> {
  const data = await getAccountData(address)
  if (!data) throw new Error(`protocol ${address} not found`)
  return decodeProtocol(data)
}

/** Overwrite an account's data via surfnet_setAccount (owner defaults to the program). */
export async function setAccountRaw(address: string, data: Uint8Array, owner = PROGRAM): Promise<void> {
  await rpc('surfnet_setAccount', [
    address,
    { lamports: 5_000_000, owner, executable: false, data: Buffer.from(data).toString('hex') },
  ])
}

/**
 * Fabricate governance fields on the Protocol singleton (admin @8, governance_set
 * @121, dao_authority @128, kass_dao @160) so the connected wallet can drive each
 * DAO-gated op — the real set_governance requires a Squads vault PDA no keypair
 * can sign, so admin/DAO tests fabricate the linkage directly (per claims.e2e).
 */
export async function patchProtocol(
  protocol: string,
  fields: { admin?: string; daoAuthority?: string; governanceSet?: boolean; kassDao?: string },
): Promise<void> {
  const cur = await getAccountData(protocol)
  if (!cur) throw new Error('protocol not found')
  const d = Uint8Array.from(cur)
  if (fields.admin) d.set(new Address(fields.admin).toBytes(), 8)
  if (fields.governanceSet !== undefined) d[121] = fields.governanceSet ? 1 : 0
  if (fields.daoAuthority) d.set(new Address(fields.daoAuthority).toBytes(), 128)
  if (fields.kassDao) d.set(new Address(fields.kassDao).toBytes(), 160)
  await setAccountRaw(protocol, d)
}
