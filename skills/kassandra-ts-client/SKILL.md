---
name: kassandra-ts-client
description: "Use when integrating with the Kassandra prediction-market Solana program from TypeScript or a dApp - building an instruction (create a GPT Subject, create/trade/resolve a market, request AI), decoding an on-chain account (market, config, Subject), or deriving a Kassandra PDA. Reach for it before hand-writing account metas, discriminants, or PDA seeds."
---

# Integrating Kassandra from TypeScript

The `@kassandra-market/markets` package is the client for the Kassandra markets program
(`MARKET_PROGRAM_ID` = `FEGNHWAB7kc7VC9CCwbvVPsv4Jykz2r2WQ758V4xCT9S`). It is ESM, built on
`@solana/web3.js` (v3 class-`Address`, no codec helpers). Never hand-roll a Kassandra
instruction — every one has a builder here, and the discriminants/seeds/layouts are the
SDK's job.

Resolution is MagicBlock's GPT oracle, not a Kassandra dispute program. `Market.oracle`
stores a markets-owned **Subject** PDA. GPT's callback stamps `Subject.resolved_option`;
`resolveMarket` reads that.

## Instruction builders

Each is `async` and returns a web3.js `TransactionInstruction`. The builder **derives its own
PDAs** (config, market, escrow, subject, etc.) — you pass wallets + token accounts, not PDAs.

Lifecycle: `initConfig`, `updateConfig`, `createSubject`, `createMarket`, `contribute`,
`cancel`, `refund`, `activate`, `addLiquidity`, `claimLp`, `resolveMarket`, `collectFee`,
`closeMarket`, `requestAi`. ER: `delegateMarket`, `commitMarket`, `undelegateMarket`.

Each takes one args object; a `programId?` override is always accepted.

`createSubject` takes `payer`, `nonce`, `optionsCount`, `llmContext`. `createMarket` binds
a binary sub-market to that Subject (`oracle` = Subject pubkey, `outcomeIndex`). `requestAi`
takes `subject`, `payer`, `text`, and optional `llmContext` (when set, remaining accounts
for the GPT-oracle CPI are appended).

## Decoders, PDAs, enums

- Decoders: `decodeMarket`, `decodeConfig`, `decodeMarketOracle` (88-byte Subject). A
  Subject exposes `phase` (`Phase.Open` / `Resolved` / `Void`), `optionsCount`,
  `resolvedOption`.
- PDAs (`pda` namespace, async, return `{ address, bump }`): `pda.config()`,
  `pda.subject(nonce)`, `pda.market(oracle, outcomeIndex)`, `pda.escrow(market)`,
  `pda.contribution(market, contributor)`, plus GPT helpers `pda.gptOracleIdentity()`,
  `pda.gptOracleInteraction(payer, llmContext)`, `pda.gptOracleCounter()`,
  `pda.gptOracleContext(...)`.
- Enums/constants: `Ix`, `MarketStatus`, `Phase`, `MARKET_PROGRAM_ID`,
  `GPT_ORACLE_PROGRAM_ID`.

## Example

```ts
import { createSubject, createMarket, decodeMarketOracle, Phase, pda } from "@kassandra-market/markets";

async function standUpBinaryMarket(payer, llmContext, baseMint, creatorBaseAta, seedAmount) {
  const nonce = 1n;
  const subjectIx = await createSubject({ payer, nonce, optionsCount: 2, llmContext });
  const { address: subject } = await pda.subject(nonce);
  const marketIx = await createMarket({
    creator: payer,
    oracle: subject,
    outcomeIndex: 0,
    baseMint,
    creatorBaseAta,
    seedAmount,
  });
  return { subjectIx, marketIx, subject };
}

function readSubject(accountData: Uint8Array) {
  const subject = decodeMarketOracle(accountData);
  return { phase: subject.phase, option: subject.resolvedOption, options: subject.optionsCount };
  // subject.phase === Phase.Open, Phase.Resolved, Phase.Void
}
```

## Notes

- The app's `@solana/web3.js@3.0.0-rc.2` has **no** codec helpers (`getBase58Encoder` /
  `getU64Encoder`). Byte helpers are hand-rolled or use `bs58`.
- Cross-language parity: the Rust client is `kassandra-markets-sdk` (see the
  `kassandra-rust-client` skill); both mirror the same program, kept in lockstep by
  byte-parity tests.
