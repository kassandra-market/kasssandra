# AGENT.md — entrypoint for AI agents

> This is the first file an AI agent should read when working in this repo.
> It orients you, then points you at the `.agent/` knowledge base for depth.
> **Keep this file and `.agent/` up to date** — see [Maintenance](#maintenance).

## What this project is

**Kassandra** — a Solana prediction-market protocol. Binary/categorical questions
are posted as a markets-owned **Subject** PDA; MagicBlock's GPT oracle resolves
the Subject, and `ResolveMarket` reads that result. Honesty is enforced
economically (SOL liquidity / fees) and by MetaDAO-style cYES/cNO markets.

One on-chain program: **markets** (prediction/decision markets + GPT Subject).
Client SDKs (Rust + TS) wrap it; a React app and a Postgres indexer complete
the stack. MagicBlock `llm_oracle` is the off-chain AI sidecar.

## Repository map (monorepo: Cargo workspace + pnpm workspace)

| Path | Crate / package | What |
|---|---|---|
| `programs/markets` | `kassandra-markets-program` (`.so` `kassandra_markets_program.so`) | On-chain prediction-market program (pinocchio) + GPT Subject |
| `sdks/markets/rust` | `kassandra-markets-sdk` | Rust client SDK for the market program (solana-sdk **v2 island**) |
| `sdks/markets/ts` | `@kassandra-market/markets` | TS client SDK for the market program |
| `indexer` | `kassandra-indexer` | Carbon → Postgres account indexer + axum read API |
| `app` | (vite/react) | The dApp; consumes the markets TS SDK `dist/` |
| `docs-site` | (mintlify) | Public documentation site |
| `docs/plans` | — | Historical design docs (do NOT rewrite; append-only history) |

## Golden commands (the ones that actually work)

- `just build` — builds the SBF `.so` (`cargo build-sbf`). **Run this
  before `cargo test`** — LiteSVM tests `include_bytes!` the `.so`, so a stale
  `.so` silently tests old bytecode.
- `make test` — all unit tests (rust workspace + SDK + app + indexer).
- `make dev` — the full production-like local stack (surfpool + indexer +
  app, real wallet, Ctrl-C teardown). Narrates each seeding step.
- `make ci` — exactly what CI runs.
- `cargo test --workspace` — the reliable way to run Rust tests. Prefer the
  whole workspace over `cargo test -p <crate>`. See [`.agent/skills/running-and-verifying.md`](.agent/skills/running-and-verifying.md).
- `pnpm --filter <pkg> {build,typecheck,test}` — per TS package.

## Read next — the `.agent/` knowledge base

`.agent/` is the durable, agent-first knowledge base. **Read the folder relevant
to your task before editing.** Index: [`.agent/README.md`](.agent/README.md).

- `.agent/context/` — high-level notes summarizing each part of the codebase.
- `.agent/specs/`   — detailed, evolving specs (instructions, accounts, phases, versioning).
- `.agent/skills/`  — reusable procedures derived from work in this repo.
- `.agent/memories/`— non-obvious facts/gotchas that would otherwise be re-discovered the hard way.

## Non-negotiable conventions (top gotchas — full list in `.agent/memories/`)

1. **Prefer `cargo test --workspace`** over `cargo test -p …`.
2. **Rebuild `.so` before Rust tests** (`just build`) or you test stale bytecode.
3. **The app's `@solana/web3.js@3.0.0-rc.2` is a class-`Address` build with NO
   codec helpers** — no `getBase58Encoder`/`getU64Encoder`. Byte helpers are
   hand-rolled or use `bs58`. `@solana/kit` is only in the litesvm-interop bridge + tests.
4. **`sdks/markets/rust` is a solana-sdk v2 "island"** — it pins v2 directly, not
   via the workspace (which is on the granular v3 client stack). Both majors coexist.
5. **Versioning is single-source**: `[workspace.package].version` in root
   `Cargo.toml`; `scripts/sync-version.mjs` stamps it into TS `package.json`s. Bump
   once, run `make version-sync`. See [`.agent/specs/versioning-and-publishing.md`](.agent/specs/versioning-and-publishing.md).
6. **Resolution is GPT, not a Kassandra dispute program** — `Market.oracle` stores
   a markets-owned Subject pubkey. MagicBlock `solana-gpt-oracle` callbacks stamp
   `Subject.resolved_option`.

## Maintenance

**These docs are load-bearing. Update them as part of the work, not after.**

- Finished a feature / refactor / rename → update the affected
  `.agent/context/*` and `.agent/specs/*` in the SAME change.
- Learned something non-obvious (a gotcha, a fixed footgun, a toolchain quirk) →
  add a `.agent/memories/*.md` file and link it from `.agent/README.md`.
- Derived a reusable procedure → add/append a `.agent/skills/*.md`.
- Keep the Repository map + Golden commands above accurate.

Format rule: every `.agent/` file is Markdown with a YAML frontmatter block
(`id`, `title`, `tags`, `updated`) so agents can parse metadata without reading
the whole file. Keep files short and single-topic; cross-link with relative paths.
