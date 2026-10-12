---
status: accepted
date: 2026-10-07
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (backend rework brainstorm and B1)
---

# Treat the `fork/overhaul` line as fully fork-owned; upstream is a cherry-pick source only

## Context and Problem Statement

[ADR-0009](0009-treat-the-frontend-as-fork-owned.md) made the frontend fork-owned and kept the backend upstream-shaped (line-level edits, paths never moved) so that upstream syncs stayed cheap. [ADR-0019](0019-keep-two-product-lines.md) then split the product into two lines and ruled that `fork/overhaul` takes no routine merges: upstream commits reach it by `git cherry-pick -x` only. The merge-friendly backend rule therefore protected nothing on this line any more, while it held back the recorded follow-ups (the stop routes, the human-input form GET, the audio part, the icon on the app row, the chat's server lookup, the envelope mess, the untyped session). On 2026-10-07 the owner asked for a total backend rework of this line, compliant with the Dify Service API, Next 16, next-auth and Drizzle as their documentation prescribes (`docs/superpowers/specs/2026-10-07-backend-rework-charter.md`). Which files does the fork own on this line, and how does upstream's work reach it?

## Decision Drivers

- The line's backend must follow the current documentation of its stack ([ADR-0002](0002-use-documented-library-approaches-only.md)), not upstream's shape.
- Upstream's value (Dify API tracking, security fixes) must still be reachable.
- One rule for the whole line, so a session does not have to ask which files it may reshape.

## Considered Options

- The whole line is fork-owned; upstream commits are cherry-picked when wanted and re-implemented where the structure differs.
- Keep the backend upstream-shaped and do the follow-ups as line-level patches (the brief of 2026-10-05).
- Keep routine merges from `main` for the backend only.

## Decision Outcome

Chosen option: the whole `fork/overhaul` line is fork-owned. Files and folders are shaped as the docs and the surveyed reference projects recommend; nothing is kept only because upstream had it. Upstream is a source of cherry-picks (`git cherry-pick -x`): a backend commit that still applies is picked, one that touches a reshaped area is re-implemented in this line's structure and the origin commit named in the message. `AGENTS.md` stays byte-identical to upstream; `CLAUDE.md` says which of its paragraphs do not apply here (its project-structure tree and its "Tailwind CSS v4" paragraph describe upstream's tree).

### Consequences

- Good, because the backend can follow its stack's documentation ([ADR-0023](0023-build-the-dify-layer-as-one-route-per-operation.md)) and the follow-ups stop being "known limits".
- Bad, because an upstream backend change is a reading and re-implementation task, never an automatic merge; `fork/main` keeps the cheap path (ADR-0019).
- Neutral, because ADR-0009's frontend half was already this rule.

## Implementation Plan

- **Affected paths**: everything on `fork/overhaul`; the rule lives in `CLAUDE.md` "Branch model" and "How to work here".
- **Patterns to follow**: before picking an upstream commit, `git show --stat <sha>` and map each touched upstream path to this line's structure (`CLAUDE.md` "Where things are"); re-implement with tests when the path no longer exists.
- **Patterns to avoid**: merging `main` or `fork/main` into this line; keeping an upstream-shaped file beside its fork-owned replacement.

### Verification

- [x] B1 (`docs/superpowers/plans/2026-10-07-backend-b1-dify-layer.md`) deleted `app/api/client/**`, `lib/api/`, `lib/core/`, `repository/`, `services/` and reshaped `lib/` without a merge conflict to consider.
- [ ] The first upstream cherry-pick after B1 records its mapping in the commit message.

## Alternatives Considered

- Line-level patches on the upstream-shaped backend: rejected by the owner on 2026-10-07 ("not what I want any more"); it would keep three response shapes, two clients and the untyped session.
- Routine backend merges: rejected by ADR-0019 already.

## More Information

Supersedes [ADR-0009](0009-treat-the-frontend-as-fork-owned.md) on this line (on `fork/main` ADR-0009 still governs). Charter: `docs/superpowers/specs/2026-10-07-backend-rework-charter.md` §1, §2, §6; the brainstorm record behind it: `docs/superpowers/research/2026-10-07-backend-rework/design-notes.md`. Related: [ADR-0019](0019-keep-two-product-lines.md), [ADR-0023](0023-build-the-dify-layer-as-one-route-per-operation.md).

### Note, 2026-10-12 (upstream disregarded; AGENTS.md is this line's guide)

The owner: "disregared upstream from now on, this repo is our own". Upstream is no longer even a cherry-pick source for this line: nothing comes from `upstream`, `main` or `fork/main`, and `AGENTS.md` (upstream's Chinese guide until now) is replaced by this line's own guide in English, which `CLAUDE.md` imports (`@AGENTS.md`), the setup Next.js and Claude Code document. Upstream's maturity tracking goes with it: `.cii-assessment.md` and the per-commit re-check, and `.github/workflows/scorecard.yml` (a scheduled workflow GitHub never ran on this fork). The owner also chose global installs for agent tooling, made through npm and npx only, never through Claude Code's own marketplace, plugin or `claude mcp add` commands (the Claude-specific superpowers-extended-cc plugin stays). The project copies of `adr-skill` and the antd and Ant Design X skills are removed; the `antd` skill (`ant-design/ant-design-cli`), the Ant Design X skills (`ant-design/x`'s `packages/x-skill/skills`) and `adr-skill` come from the `skills` CLI with `-g`, one copy in `~/.agents/skills` linked for every agent, and Context7 from `npx ctx7 setup` (its MCP server) (X's plugin marketplace would not load anyway: its `marketplace.json` has no `owner`, which Claude Code's schema requires). `fork/main` keeps upstream's `AGENTS.md` and ADR-0009.
