---
id: skill-pr-workflow
title: "Skill: branch / commit / PR conventions"
tags: [skill, git, pr, workflow]
updated: 2026-07-10
---

# Skill: branch / commit / PR conventions

## Branch & PR

- **Never commit to `master`.** Branch first (`git switch -c <type>/<slug> master`).
  Types seen here: `fix/`, `refactor/`, `feat/`, `docs/`, `perf/`, `test/`.
- One PR per concern (independent PRs off master; avoid stacking unless intended).
  Recent PRs stayed non-overlapping so they merge in any order.
- Open with `gh pr create --base master --head <branch>`. GitHub remote:
  `github.com/kassandra-market/kasssandra` (the local `origin` may still point at
  the old `.../oracle.git` and redirect).
- After a merge to master your local checkout may end up on `master` with a stray
  commit — move it to a branch, reset master to `origin/master`, re-open a PR.

## Commit messages

- Conventional prefix (`fix(app):`, `refactor(sdks):`, `feat(dev):`, …).
- Explain the *why* + verification results in the body.
- **End every commit with:**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```
- **End PR bodies with:** `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

## Before pushing

Run the relevant gate (see [running-and-verifying.md](running-and-verifying.md)).
Commit in verified checkpoints for big changes so a bisect is meaningful.

## Update the knowledge base

Finishing a feature/refactor/rename → update `../context/*` + `../specs/*` (and
add a `../memories/*` for anything non-obvious) **in the same PR**. `AGENT.md`
says this is load-bearing.
