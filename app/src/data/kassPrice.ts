/**
 * Best-effort KASS→USD price read for the trade UI's unit toggle.
 *
 * The manipulation-resistant KASS/USDC price the protocol governs around is the
 * futarchy program's embedded spot `TwapOracle`, which lives INSIDE the
 * `Protocol.kass_dao` account (recorded by `set_governance`). Mirrors the on-chain
 * read (`programs/oracles/src/price.rs` → `cpi/metadao_v06/layout.rs`): the spot
 * `TwapOracle` sits at FIXED, variant-independent byte offsets in the `Dao`
 * account, and the TWAP is
 *
 *   aggregator / (last_updated_ts − (created_at_ts + start_delay_secs))
 *
 * a `PRICE_SCALE` (1e12) scaled quote-per-base price (USDC raw units per KASS raw
 * unit). This module is READ-ONLY and NEVER throws — any absence (governance not
 * linked, no DAO account, TWAP not yet observable) resolves to `null` so the
 * caller disables USD display.
 */
import type { Connection } from "@solana/web3.js";
import { decodeProtocol, pda } from "@kassandra-market/oracles";
import { KASS_DECIMALS, USDC_DECIMALS } from "../lib/oracleView";

/** On-chain fixed-point scale (`PRICE_SCALE = 1e12`) the spot aggregator uses. */
const PRICE_SCALE = 1_000_000_000_000n;

// Futarchy `Dao` embedded spot `TwapOracle` byte offsets — fixed + variant-
// independent (the spot Pool is the first payload element of both PoolState
// variants). Authoritative: cpi/metadao_v06/layout.rs.
const SPOT_AGGREGATOR_OFFSET = 9; // u128
const SPOT_LAST_UPDATED_TS_OFFSET = 25; // i64
const SPOT_CREATED_AT_TS_OFFSET = 33; // i64
const SPOT_START_DELAY_SECONDS_OFFSET = 105; // u32
/** Smallest `Dao` length covering every spot-TWAP field. */
const SPOT_MIN_LEN = SPOT_START_DELAY_SECONDS_OFFSET + 4; // 109

/** The all-ones system pubkey — `kass_dao` reads this until governance is set. */
const ZERO_ADDRESS = "11111111111111111111111111111111";

/** Read a little-endian u128 at `off` (low 64 ++ high 64). */
function readU128LE(dv: DataView, off: number): bigint {
  return dv.getBigUint64(off, true) | (dv.getBigUint64(off + 8, true) << 64n);
}

/**
 * Decode the `PRICE_SCALE`-scaled spot TWAP from a futarchy `Dao` account's raw
 * bytes, mirroring `futarchy_spot_twap` exactly. Returns `null` when the TWAP is
 * not yet observable — a zero aggregator, a non-positive elapsed window, or a
 * too-short buffer.
 */
export function decodeFutarchySpotTwap(data: Uint8Array): bigint | null {
  if (data.length < SPOT_MIN_LEN) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const aggregator = readU128LE(dv, SPOT_AGGREGATOR_OFFSET);
  const lastUpdated = dv.getBigInt64(SPOT_LAST_UPDATED_TS_OFFSET, true);
  const createdAt = dv.getBigInt64(SPOT_CREATED_AT_TS_OFFSET, true);
  const startDelay = BigInt(dv.getUint32(SPOT_START_DELAY_SECONDS_OFFSET, true));
  const elapsed = lastUpdated - (createdAt + startDelay);
  if (aggregator <= 0n || elapsed <= 0n) return null;
  return aggregator / elapsed;
}

/**
 * Convert the `PRICE_SCALE`-scaled raw spot TWAP into a human USDC price for one
 * whole KASS: divide out `PRICE_SCALE`, then correct for the base/quote decimal
 * scales (`10^(KASS_DECIMALS − USDC_DECIMALS)`).
 */
export function usdcPerKass(twap: bigint): number {
  return (Number(twap) / Number(PRICE_SCALE)) * 10 ** (KASS_DECIMALS - USDC_DECIMALS);
}

/**
 * Fetch the current KASS→USD (USDC) price, or `null` when it isn't available:
 * the Protocol singleton is missing, governance isn't linked (`kass_dao` unset),
 * the DAO account can't be read, or its spot TWAP isn't observable yet. Callers
 * disable the USD unit on `null`. Best-effort — swallows RPC/decode errors.
 */
export async function fetchKassUsdcPrice(conn: Connection): Promise<number | null> {
  try {
    const protocolPda = (await pda.protocol()).address;
    const info = await conn.getAccountInfo(protocolPda);
    if (!info || info.data.length === 0) return null;
    const protocol = decodeProtocol(info.data);
    if (!protocol.governanceSet || protocol.kassDao.toString() === ZERO_ADDRESS) return null;
    const daoInfo = await conn.getAccountInfo(protocol.kassDao);
    if (!daoInfo || daoInfo.data.length === 0) return null;
    const twap = decodeFutarchySpotTwap(daoInfo.data);
    if (twap === null) return null;
    const price = usdcPerKass(twap);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}
