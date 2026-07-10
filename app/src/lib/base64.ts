/**
 * Base64 → bytes decode, shared by the oracle and market indexer clients (both
 * receive raw Pod/account bytes as standard base64 in the indexer JSON). One
 * implementation over the browser `atob`, rather than a copy per client module.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
