---
status: accepted
date: 2026-10-06
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (sub-project 2 execution)
---

# Keep two product lines: `fork/main` for the line-level fork, `fork/overhaul` for the frontend overhaul

## Context and Problem Statement

[ADR-0003](0003-run-the-fork-on-a-two-branch-model.md) made `fork/main` the single integration branch for every fork feature. Between 2026-10-04 and 2026-10-05 the frontend overhaul (charter PR #10, plan #11, foundation #12, ADRs #14) was merged into `fork/main`, and the chat rebuild (PR #15, sub-project 2) was about to follow. The owner wants to keep **both** apps: the upstream app hub with only the fork's line-level modifications (English and Arabic i18n, login for everyone, header fixes), and the app hub with the full frontend overhaul. One integration branch cannot hold both, and the overhaul had already replaced the line-level app's frontend on `fork/main`.

## Decision Drivers

- Both apps must stay deployable from a branch of their own.
- The line-level app keeps taking upstream changes cheaply (merge-friendly, as today).
- The overhaul line is free to diverge from upstream, including the backend (`docs/superpowers/specs/2026-10-05-backend-rework-brief.md`).
- No history is lost; open PRs keep a valid target.

## Considered Options

- Two product lines on two long-lived branches (`fork/main`, `fork/overhaul`), each with its own PR flow.
- Keep one integration branch and gate the overhaul behind a feature flag.
- Split the overhaul into a second repository.

## Decision Outcome

Chosen option: "two product lines on two long-lived branches", because it keeps both apps whole with no runtime switch and no second repository to sync.

- `main` stays an untouched mirror of `upstream/main` (unchanged from ADR-0003).
- `fork/main` is the **line-level product**: upstream plus the fork's line-level modifications. On 2026-10-06 it was reset with a leased force-push from `11c3fb3d` to `3d8e628e` (the merge of PR #9, i.e. PRs #3–#6 and #9 on upstream; PRs #7 and #8 branch from `55832f4e`, one merge earlier). It takes upstream by merging `main` (ADR-0003's sync rule) and keeps the merge-friendly rules of its own `CLAUDE.md`. Its features branch from and target `fork/main`; PRs #7 and #8 belong here (they fix the original chat this line keeps).
- `fork/overhaul` is the **overhaul product**: it starts at `11c3fb3d` (the old `fork/main` with PRs #10–#14) and receives sub-project 2 through PR #15 and every later overhaul sub-project. Its features branch from and target `fork/overhaul`: `gh pr create -R LovingCivilian/dify-app-hub --base fork/overhaul …`, merged with merge commits.
- `fork/overhaul` takes **no routine merges** from `main` or `fork/main`. Upstream commits and fixes made on `fork/main` reach it only by `git cherry-pick` when wanted; frontend fixes are re-implemented in the overhaul's structure instead (ADR-0009 already treats the frontend as fork-owned).
- `fork/overhaul` never merges back into `fork/main`.
- The GitHub default branch stays `fork/main` (the line-level product is what a visitor sees first).
- The backend rework (`docs/superpowers/specs/2026-10-05-backend-rework-brief.md`) applies to `fork/overhaul` only and runs after sub-project 4, last; on `fork/main` the backend stays upstream-shaped.

Non-goals: merging the two lines later; a feature flag or runtime switch between the two UIs; automatic syncing between the lines.

### Consequences

- Good, because both apps stay deployable and testable on their own branch, and the line-level app keeps cheap upstream merges.
- Good, because the overhaul can change the backend without creating merge conflicts for the line-level app.
- Bad, because a fix wanted on both lines is done twice (cherry-pick or re-implementation), and upstream changes reach the overhaul only when someone picks them.
- Bad, because `gh` commands must name the right base (`fork/main` or `fork/overhaul`); a PR opened against the wrong line must be retargeted.
- Neutral, because the ADRs, handoffs and overhaul docs live on `fork/overhaul` only; `fork/main`'s `CLAUDE.md` carries one pointer to this line.

## Implementation Plan

- **Affected paths**: branch layout; `CLAUDE.md` "Branch model" on both lines; this ADR and the index; ADR-0003 (superseded) and ADR-0009 (dated note) on `fork/overhaul`; `docs/superpowers/handoffs/2026-10-05-chat-on-ant-design-x-execution.md`; `docs/superpowers/specs/2026-10-05-backend-rework-brief.md`; the PR #15 description.
- **Dependencies**: none.
- **Patterns to follow**: overhaul work branches from `fork/overhaul` and its PRs target `fork/overhaul`; line-level work branches from `fork/main`; cherry-pick with `git cherry-pick -x` so the origin commit is recorded.
- **Patterns to avoid**: merging `main` or `fork/main` into `fork/overhaul`; merging `fork/overhaul` into `fork/main`; force-pushing either line again without the owner's explicit go-ahead.

### Verification

- [x] `origin/fork/overhaul` = `11c3fb3d` before PR #15 merges; `origin/fork/main` = `3d8e628e` (2026-10-06).
- [x] PR #15 targets `fork/overhaul`; PR #7 targets `fork/main`, PR #8 stacks on #7.
- [x] `git merge-base --is-ancestor 3d8e628e origin/fork/overhaul` succeeds (the overhaul line contains the line-level history it started from).
- [x] `fork/main`'s `CLAUDE.md` names `fork/overhaul` (7485dd56).
- [ ] After PR #15 merges: `fork/overhaul` holds sub-project 2; no merge from `fork/main` or `main` appears in `git log --first-parent fork/overhaul` after `11c3fb3d`.

## Pros and Cons of the Options

### Two product lines on two long-lived branches

- Good, because each app is complete on its own branch.
- Good, because the reset was reversible up to the force-push and lost nothing (`fork/overhaul` was pushed first).
- Bad, because fixes wanted on both lines are done twice.

### One integration branch with a feature flag

- Good, because one branch to maintain.
- Bad, because the two UIs share providers, layouts and dependencies; a flag would keep both frontends and their dependencies in every build and double the test matrix.

### A second repository for the overhaul

- Good, because full separation.
- Bad, because the fork's PR history, ADRs and CI would split, and syncing the shared backend would be a cross-repository chore.

## More Information

Decided by the owner on 2026-10-06 ("I want to have both, the app hub with just the line mods we did, and the app hub with the overhauls"), with the reset point `3d8e628e` (keeping PR #9's `.dockerignore` and lookup-tools note), the branch name `fork/overhaul`, PR #15 retargeted rather than closed, and cherry-pick-only updates for the overhaul line. Supersedes [ADR-0003](0003-run-the-fork-on-a-two-branch-model.md). Related: [ADR-0009](0009-treat-the-frontend-as-fork-owned.md), [ADR-0015](0015-record-decisions-as-adrs-and-session-handoffs.md).

Note, 2026-10-06 (owner, after this record was accepted): ADR numbers after 0019 are per line. Each line numbers its own records; a reference to the other line's ADR names the line, and an ADR file brought over by cherry-pick is renumbered (`docs/decisions/README.md`, Workflow). The same rule is recorded on `fork/main` (PR #16).

Note, 2026-10-06 (local folders): each line now runs from its own folder on the owner's machine, two git worktrees of one repository, so a session works on one line without checking out the other. `fork/overhaul` keeps `~/repos/dify-app-hub` (project `dify-app-hub-local`, `localhost:5300`, MySQL `127.0.0.1:3306`); `fork/main` lives in `~/repos/dify-app-hub-main` with its own Docker stack (project `dify-app-hub-main-local`, app on `127.0.0.1:5310`, MySQL on `127.0.0.1:3316`, its own volume; PR #18 on that line). Details in `CLAUDE.md` (Branch model, Docker stack).

Note, 2026-10-08 (owner, branch names and merged branches): branch names follow the Conventional Branch specification (conventionalbranch.org), `<type>/<description>` in lowercase letters, digits and single hyphens, using the commit types of `CLAUDE.md` as types: `feat/`, `fix/`, `chore/`, plus `docs/`, which the specification does not list but this repository's commits use. The earlier `plan/`, `auth/` and `ui/` prefixes are not used for new branches. A branch is deleted, on GitHub and locally, once its pull request is merged, as GitHub flow says ("After you merge your pull request, delete your branch. This indicates that the work on the branch is complete and prevents you or others from accidentally using old branches.", docs.github.com, "GitHub flow") and as the Git book does after a merge (git-scm.com, "Basic Branching and Merging"). Nothing is lost: the pull requests are merged with merge commits, so every commit of the branch stays in the base's history; the pull request keeps its commits, diff and discussion; and a deleted head branch comes back with the pull request's **Restore branch** button (GitHub Docs, "Deleting and restoring branches in a pull request"). When a deleted branch is the base of another open pull request, GitHub retargets that pull request to the merged one's base (GitHub Docs, "Creating and deleting branches within your repository"). The repository's "Automatically delete head branches" setting stays off; the merge command deletes the branch (`gh pr merge … --merge --delete-branch`). A milestone that needs a lasting name gets a tag, not a kept branch. The branches of open pull requests (#7 and #8 on `fork/main`) stay until those pull requests close.
