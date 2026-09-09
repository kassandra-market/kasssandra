/**
 * Decoder for the protocol-singleton `AiOracleConfig` (`state/ai_oracle.rs`, 48 bytes).
 */
import { Address } from "@solana/web3.js";

import { AccountType, ACCOUNT_SIZES } from "../constants.js";
import { assertAccount, readBool, readPubkey, readU64LE, readU8, view } from "./common.js";

/** Decoded `AiOracleConfig`. */
export interface AiOracleConfig {
  accountType: AccountType.AiOracleConfig;
  bump: number;
  enabled: boolean;
  /** `AI_ORACLE_SOURCE_*`. */
  source: number;
  /** MagicBlock `ContextAccount` (created via `create_llm_context`). */
  llmContext: Address;
  maxStalenessSlots: bigint;
}

/** Encode an `AiOracleConfig` account (48 bytes). */
export function encodeAiOracleConfig(cfg: {
  bump: number;
  enabled: boolean;
  source: number;
  llmContext: Address;
  maxStalenessSlots: bigint;
}): Uint8Array {
  const data = new Uint8Array(ACCOUNT_SIZES.AiOracleConfig);
  const dv = new DataView(data.buffer);
  data[0] = AccountType.AiOracleConfig;
  data[1] = cfg.bump;
  data[2] = cfg.enabled ? 1 : 0;
  data[3] = cfg.source;
  data.set(cfg.llmContext.toBytes(), 8);
  dv.setBigUint64(40, cfg.maxStalenessSlots, true);
  return data;
}

/** Decode an `AiOracleConfig` account from its raw bytes. Throws on wrong size or tag. */
export function decodeAiOracleConfig(data: Uint8Array): AiOracleConfig {
  assertAccount(data, AccountType.AiOracleConfig, ACCOUNT_SIZES.AiOracleConfig, "AiOracleConfig");
  const dv = view(data);
  return {
    accountType: AccountType.AiOracleConfig,
    bump: readU8(dv, 1),
    enabled: readBool(dv, 2),
    source: readU8(dv, 3),
    llmContext: readPubkey(data, 8),
    maxStalenessSlots: readU64LE(dv, 40),
  };
}
