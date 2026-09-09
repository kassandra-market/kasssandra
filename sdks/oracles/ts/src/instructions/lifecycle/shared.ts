/**
 * Shared meta helpers for the protocol + oracle-lifecycle instruction builders.
 * Internal to the `lifecycle/` folder module — NOT re-exported by `./index.ts`.
 */
import type { Address, AccountMeta } from "@solana/web3.js";

import { type AddressInput, toAddress } from "../../pda.js";

/** Coerce an `AddressInput` into this module's web3.js `Address`. */
export function addr(a: AddressInput): Address {
  return toAddress(a);
}

/** Writable account meta. */
export function w(pubkey: Address, isSigner = false): AccountMeta {
  return { pubkey, isSigner, isWritable: true };
}

/** Read-only account meta. */
export function ro(pubkey: Address, isSigner = false): AccountMeta {
  return { pubkey, isSigner, isWritable: false };
}
