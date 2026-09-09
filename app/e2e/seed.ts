/**
 * Reusable on-chain seeding for the browser E2E — stands up surfpool with the
 * kassandra-market program, a SOL mint, Config, and fabricated GPT Subject
 * accounts so Playwright specs can browse and create markets.
 *
 * Thin barrel: `seed-core.ts` (context, boot/init, tx sending, fund helpers)
 * and `seed-drivers.ts` (Subject fabrication). Importers keep using `./seed.ts`.
 *
 * IMPORTANT: every pubkey handed to an `@kassandra-market/markets` builder is
 * passed as a base58 STRING (`.toString()`), never a web3.js `Address` object
 * from a foreign copy — under Playwright's loader the app and the SDK can
 * resolve separate copies of `@solana/web3.js`.
 */
export * from './seed-core.ts'
export * from './seed-drivers.ts'
