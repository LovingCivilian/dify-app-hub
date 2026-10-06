---
status: superseded by [ADR-0019](0019-keep-two-product-lines.md)
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
---

# Run the fork on a two-branch model: `main` mirrors upstream, `fork/main` integrates

## Context and Problem Statement

`LovingCivilian/dify-app-hub` is a personal fork of `lexmin0412/dify-app-hub`. Upstream keeps moving (backend, Dify API changes), and the fork adds features upstream will not take (login for everyone, i18n, the frontend overhaul). Mixing the two on one branch made upstream syncs painful and hid which commits were the fork's.

## Decision

- `main` is an untouched mirror of `upstream/main`; nobody commits to it. Sync: `git fetch upstream && git checkout main && git merge --ff-only upstream/main`.
- `fork/main` is the integration branch: upstream plus every accepted fork feature. Deploy and test from it. Upstream sync = `git checkout fork/main && git merge main`, conflicts resolved there (expected conflicts are listed in `docs/auth-gate.md` and `docs/i18n-maintenance.md`).
- Feature branches start from `fork/main`; PRs target `fork/main` and are merged with merge commits (history kept). A branch stacks on another only when it needs unmerged work; its PR targets the parent branch and GitHub retargets it after the parent merges.
- On the fork, `gh` defaults to the parent repo, so every command names the repo: `gh pr create -R LovingCivilian/dify-app-hub --base fork/main …`, `gh pr merge <n> -R LovingCivilian/dify-app-hub --merge`.
- The GitHub default branch is still `main` (switching it to `fork/main` is an open follow-up).

Non-goals: rebasing fork work onto upstream; squash merges.

## Consequences

- Good, because `git log --first-parent upstream/main..fork/main` lists exactly the fork's merges, and upstream syncs are one merge on one branch.
- Good, because PR review happens per feature with a reviewed diff against `fork/main`.
- Bad, because contributors must remember `-R` and `--base fork/main`; a PR opened against `main` by mistake must be closed.
- Bad, because merge commits make the history bushier than a rebase flow.

## Implementation Plan

- **Affected paths**: branch layout only; documented in `CLAUDE.md` ("Branch model").
- **Patterns to follow**: feature branch names by area (`auth/…`, `i18n/…`, `feat/…`, `docs/…`, `chore/…`); conventional commit messages in English; the attribution trailers the session supplies.
- **Patterns to avoid**: committing to `main`; force-pushing shared branches; squash merges that lose the per-task commits.

### Verification

- [x] `git merge-base main upstream/main` equals `upstream/main` (mirror intact).
- [x] All fork PRs (#3–#12) target `fork/main`.
- [ ] GitHub default branch switched to `fork/main` (open follow-up).

## Alternatives Considered

- Single branch with upstream merged in: rejected; fork commits and upstream commits became indistinguishable and syncs touched everything.
- Rebase fork work on top of upstream each sync: rejected; rewrites shared history and loses PR provenance.

## More Information

Sources: `CLAUDE.md` "Branch model" (PR #6, 2026-10-04); merged PRs #3–#11; the i18n branches were merged directly before the PR flow existed (`6b6da666`, 2026-10-03). Related: [ADR-0009](0009-treat-the-frontend-as-fork-owned.md) (what upstream syncs may touch).

Note, 2026-10-06: superseded by [ADR-0019](0019-keep-two-product-lines.md). The owner kept two products: `fork/main` (upstream + the line-level fork modifications) was reset from `11c3fb3d` to `3d8e628e`, and the frontend overhaul moved to `fork/overhaul` (from `11c3fb3d`). `fork/main` keeps this ADR's sync rule; `fork/overhaul` takes upstream changes by cherry-pick only. The GitHub default branch is `fork/main`.
