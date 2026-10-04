---
status: accepted
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
---

# Treat the frontend as fork-owned; upstream syncs take the backend only

## Context and Problem Statement

Until the overhaul, the fork's rule was "line-level edits inside upstream files, new behaviour in fork-owned files, upstream file paths never moved", so that `git merge main` stayed cheap. The overhaul ([ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md)) moves pages into route groups, deletes upstream components and rewrites the chat on Ant Design X. Those files can no longer merge with upstream's versions.

## Decision

- The frontend (`app/**` except `app/api/**`, `components/**`, `hooks/**`, `lib/theme/**`, `app/globals.css`, locales, e2e) is fork-owned. Upstream UI changes are re-implemented in the fork's structure when wanted, not merged.
- Upstream syncs take the backend only: `app/api/**`, `db/**`, `lib/auth*`, `proxy.ts`, `lib/access.ts`, `services/**`, `lib/dify-client.ts`, Docker and tooling files. For those, the old rule stands: line-level edits, paths never moved, upstream-shaped files kept close to upstream.
- During a sync, conflicts in fork-owned frontend files are resolved by keeping the fork's version and noting upstream's change for re-implementation (`docs/auth-gate.md` and `docs/i18n-maintenance.md` list the expected conflicts and after-merge checks).

Non-goals: contributing the overhaul upstream; mirroring upstream's UI changes automatically.

## Consequences

- Good, because the overhaul can restructure freely and the backend stays mergeable.
- Bad, because upstream UI fixes must be ported by hand; the sync checklist must say which upstream commits touched the frontend.
- Bad, because the fork's `.cii-assessment.md` and docs now describe a UI upstream does not have.

## Implementation Plan

- **Affected paths**: `CLAUDE.md` "How to work here" (rule qualified) and "Frontend overhaul" (drift note); `docs/auth-gate.md`, `docs/i18n-maintenance.md` (sync checklists).
- **Patterns to follow**: before a sync, `git log main..upstream/main --stat -- app components` to list upstream frontend changes; port what matters as fork commits.
- **Patterns to avoid**: merging upstream's `components/**` or page files over the fork's shells; editing backend files beyond line-level changes.

### Verification

- [x] PR #12 touches nothing under `app/api`, `db`, `lib/auth*`, `proxy.ts`, `lib/access.ts`, `services`, `lib/dify-client.ts`.
- [ ] Next upstream sync: backend merges cleanly; frontend conflicts resolved per this ADR and recorded.

## Alternatives Considered

- Keep "paths never moved" for the frontend too: rejected; the charter's route groups and shells are impossible under it.
- Fork the backend as well: rejected; the backend is where upstream's value (Dify API coverage) keeps arriving.

## More Information

Sources: charter lines on upstream drift ("the frontend becomes fork-owned … syncs take the backend only"), `CLAUDE.md` (PR #12 wording), final review of PR #12. Related: [ADR-0003](0003-run-the-fork-on-a-two-branch-model.md).
