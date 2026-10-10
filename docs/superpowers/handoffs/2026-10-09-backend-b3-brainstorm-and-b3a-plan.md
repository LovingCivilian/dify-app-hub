# Handoff 2026-10-09: B3 brainstorm, spec and the B3a plan

This session brainstormed backend rework B3 (groups, per-app access, LDAP) with the owner, wrote and committed the spec and its research, and wrote and committed the B3a implementation plan. No product code was written. This file holds only what those records don't say; read them rather than repeating them here.

## Where things stand

- **`fork/overhaul`** is at `e31b4376` (PR #30 merged), unchanged this session.
- **Branch `feat/backend-b3a-groups-access`** (local only, not pushed) holds two commits on top of it:
  - `8f713a08`: the B3 spec and the research folder;
  - `a2a72c03`: the B3a plan.
- **Owner approvals:** the spec (2026-10-09, "go") and the B3a plan ("its good"). The plan's execution has not started; its first step is an Opus pre-flight review of the plan.
- **`CLAUDE.md` on the branch is not updated yet.** Its "Next step" still says the B3 brainstorm, and "Latest handoff" points at the 2026-10-09 B2 handoff. The plan's Task 8 updates those pointers; add this handoff as "Latest handoff" there.
- **Branches kept on the owner's standing instruction:** `feat/backend-b2-accounts`, `feat/dify-user-id`, `docs/accept-adrs-0022-0026`. Delete nothing without the owner's word.
- **Still open from the previous handoff:** the owner's browser check of B2 (PR #28) and the account-id Dify user (PR #29), unless the owner has done it since; ask.
- **This handoff file is not committed.** Commit it with B3a's records (Task 8) or when the owner says.

## Records (read these, don't repeat them)

- **Spec:** `docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md`. §2 holds the owner's 18 decisions, §11 the charter deviations, §12 the follow-ups, §13 the risks, §14 what is not confirmed.
- **Research:** `docs/superpowers/research/2026-10-09-backend-b3/` (start at its README): the LDAP client, eight reference projects' LDAP models, groups and access in six projects, periodic jobs in self-hosted Next.js, the e2e LDAP servers, and the next-auth/Drizzle/antd checks.
- **B3a plan:** `docs/superpowers/plans/2026-10-09-backend-b3a-groups-access.md`. Its header carries deviations 1–6 and decisions a–e, the Review Focus and the execution notes (workspace, rule R0, models table).
- **Prior records the plan builds on:** ADR-0024 (DAL, rank map, locking, logging), ADR-0026 (the Dify user is `users.id`; link LDAP accounts by `entryUUID`/`objectGUID`), the B2 plan `docs/superpowers/plans/2026-10-08-backend-b2-accounts.md` (task and test style).

## Owner decisions this session not written elsewhere

The design decisions are all in spec §2. Beyond them:

- **B3b's plan is written only after B3a merges**, from spec §6–§8 and B3a's final code. The owner agreed to defer it rather than write it now.
- **PostgreSQL:** the owner's whole stack runs on PostgreSQL, and they want the hub moved off MySQL after B3 or after frontend phase 2, as its own sub-project with an ADR superseding ADR-0004 (memory `postgres-move-planned`; spec §12). B3 stays on MySQL.
- **An admin "Logs" tab** (the hub's logs with filters, instead of `docker logs`) is a future feature only (memory `admin-logs-tab-idea`; spec §12).

## How the owner wanted the brainstorm run (learned this session)

- **One question at a time, with a recommendation and the reference projects behind it.** The owner answers tersely ("a", "yes") and approves stage by stage.
- **The owner asks "what do you mean by…" when a term is new.** Answer with a concrete example before moving on: what "admins skip the grants" means, how groups affect admins, how the two deactivation markers differ.
- **The owner pushes back on restrictions that don't fit their environment.** They asked for cron expressions instead of a plain interval, and for plaintext LDAP because their directory has no TLS today. Offer the documented option with its risk stated plainly, rather than refusing.
- **ADR-0002 applies to the assistant's own choices too.** When the research found OWASP's "generic error message" rule, the earlier promise of specific sign-in messages was revised and put back to the owner.

## Environment facts learned this session

- **Research scratch** is in `tmp/b3-research/` (git-ignored):
  - the source clones in `src/` had their `.ts`/`.tsx` files renamed to `.txt` (tsc safety) and their `.env.example` files renamed (`.dockerignore`'s `!**/.env.example` exception would let them into the image build);
  - `probe/` holds the drizzle-kit probe that found the single-table cascade bug.
- **The local Docker image** (`dify-app-hub-local-app`, built 2026-10-08) contains two harmless `.env.example` files from `tmp/identity-research/`, through that same exception (recorded as a follow-up in spec §12).
- **`GROUPS` is a reserved word in MySQL 8.4**, hence the table name `user_groups` (checked against the manual's keyword list).
- **Drizzle documents a standalone `QueryBuilder`** (`drizzle-orm/mysql-core`). The plan's `visibleTo` uses it, so the rule needs no database handle and tests render it on `drizzle.mock()`.
- **croner 10.0.1** documents `previousRuns(n)`, `nextRun()`, `timezone`, `protect` and `catch` (Context7 `/hexagon/croner`).
- **`smblds/smblds`**, the AD-like e2e server for B3b, refuses plain simple binds by default. That's why spec §8 runs the `none` encryption mode on OpenLDAP.

## Next steps

1. Execute the B3a plan in a fresh session (kick-off prompt below).
2. After B3a merges, write the B3b plan from the spec (a second prompt below).
3. B3b ends with the owner's live check against their Active Directory over plain LDAP (spec §9).

## Suggested skills

- `superpowers:subagent-driven-development`: run the B3a plan (pre-flight review, implementer and reviewer per task, whole-branch review, fix wave).
- `superpowers:requesting-code-review` and `superpowers:receiving-code-review`: the per-task and whole-branch reviews, findings judged by rule R0.
- `superpowers:test-driven-development`: every task writes its tests first.
- `antd`: before the groups page, the app drawer's Access section and the users-table changes (Tasks 5–7).
- `find-docs` (Context7) for Drizzle, next-auth, zod and croner, whenever an API detail is in doubt.
- `adr-skill` (project copy `.claude/skills/adr-skill`): ADR-0027 in Task 8.
- `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch`: Task 9 and the PR.
- Later, for B3b: `superpowers:writing-plans`.

## Suggested kick-off prompts

For B3a (in `~/repos/dify-app-hub`, already on `feat/backend-b3a-groups-access`):

> Read docs/superpowers/handoffs/2026-10-09-backend-b3-brainstorm-and-b3a-plan.md, then CLAUDE.md, the B3 spec docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md and the B3a plan docs/superpowers/plans/2026-10-09-backend-b3a-groups-access.md (both committed on the current branch feat/backend-b3a-groups-access, not pushed). Execute the B3a plan with superpowers:subagent-driven-development, following its execution notes: an Opus pre-flight review of the plan first, rule R0 (ADR-0002 governs every decision), and the models table. Don't push, open a PR or delete any branch without my word.

For B3b, once B3a is merged:

> Read CLAUDE.md, then the B3 spec docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md (§2, §6–§10, §13–§14) and its research docs/superpowers/research/2026-10-09-backend-b3/. B3a is merged. Write the B3b implementation plan with superpowers:writing-plans, built on B3a's final code and ADR-0027, then stop for my review.
