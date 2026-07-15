---
id: mem-web3js-address-variant
title: "web3.js@3.0.0-rc.2 here has NO codec helpers"
tags: [memory, gotcha, typescript, web3js]
updated: 2026-07-10
---

# `@solana/web3.js@3.0.0-rc.2` is the class-`Address` build with no codecs

Both the app and the SDK **source** use `@solana/web3.js@3.0.0-rc.2` — the
class-based `Address` build (`new Address(str)`, `.toBytes()`,
`Address.findProgramAddress` — **async only**, no sync variant). It exports
**none** of the codec helpers: `getBase58Encoder/Decoder`, `getBase16*`,
`getU64Encoder`, etc. are absent.

`@solana/kit` (which *does* have codecs) is a dep but is imported **only** in
`sdks/*/ts/src/litesvm-interop.ts` and test harnesses — never in the
instruction/PDA hot paths.

## Consequences

- You cannot "just import `getU64Encoder`" in app or SDK src. Byte/LE-integer
  helpers are hand-rolled in each SDK's `bytes.ts`; the app uses `bs58` for base58
  (`app/src/lib/base58.ts`) and `atob` for base64 (`app/src/lib/base64.ts`).
- The app has **no `Buffer` polyfill** either — `Buffer.from(...,'hex')` isn't
  available there.
- Don't "modernize" to kit codecs in the hot paths; it mixes two address models
  and pulls kit into the published SDK surface.

Related: [external-crates-over-handrolled.md](external-crates-over-handrolled.md).
