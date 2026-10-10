# Handoff 2026-10-10: B3b plan written and approved; next, execute it

This session wrote the B3b implementation plan (directory sign-in and sync) and its research. The owner approved it ("yes"). The next session executes it subagent-driven, starting with the Opus pre-flight. This file holds only what the records below don't say; read them rather than repeating them here.

## Where things stand

- **Branch `feat/backend-b3b-directory`**, from `fork/overhaul` at `4eb07c21`: 12 local commits, ending at `624774e3`; plus the commit that adds this file. Nothing is pushed and no PR is open. Delete no branch without the owner's word.
- **Owner decisions this session:**
  - The plan is approved as written, executed subagent-driven, as in B3a.
  - `LDAP_ENCRYPTION=none` is the company's choice; the owner knows its risks (plaintext passwords; a Windows Server 2025 domain controller enforces LDAP signing by default). Do not reopen it.
  - The owner did not object to committing a test-only CA, certificate and key under `e2e/fixtures/ldap/tls/` (plan Task 4, decision h).
- **Local Docker stack:** unchanged since B3a (image from `feat/backend-b3a-groups-access`, port 5300). The e2e stack is down.

## Records (read these, don't repeat them)

- **The plan:** `docs/superpowers/plans/2026-10-10-backend-b3b-directory.md`.
  - The header lists the 8 deviations from the spec.
  - Global Constraints, Review Focus (5 lines), File structure.
  - Execution notes: the pre-flight's scope, the run rules R0–R10, and the models table, with Fable for the security-sensitive reviews and the final review.
  - 16 tasks with 43 decisions, lettered a–aq.
- **The plan's research,** checked against the current docs on 2026-10-10: `docs/superpowers/research/2026-10-09-backend-b3/b3b-plan/`.
  - `library-apis.md`
  - `ldap-test-servers.md` (its §7.6 is the pre-flight's LDAP checklist)
  - `ad-and-reference-projects.md`
- **The spec:** `docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md`.
- **B3a's run records,** the patterns to reuse:
  - `docs/superpowers/research/2026-10-09-backend-b3/b3a-execution/`
  - B3a's git-ignored workspace `.superpowers/sdd/2026-10-09-backend-b3a-groups-access/`, whose `implementer-contract.md`, `reviewer-contract.md` and `re-review-contract.md` the plan says to copy.

## Facts the records don't say

- **The pre-commit hook rewrites the plan.** lint-staged runs oxfmt on Markdown, which de-indents code snippets and joins "Run:"/"Expected:" lines (B3a's plan reads the same way). When editing the plan, match the committed text, not the original snippet.
- **Scratch drafts.** `tmp/b3b-plan/` (git-ignored) holds the drafts the plan was assembled from. They are stale: the committed plan is the source of truth.
- **Already settled live** by a research agent, on a throwaway MySQL 8.4 container that is now removed:
  - MySQL accepts the `CHECK` with table-qualified column names;
  - a violating row raises error 3819.

  The pre-flight still runs the real migration (plan Task 1, Step 6).

- **Still open for the pre-flight:**
  - smblds provisioning on tmpfs;
  - slapadd accepting the explicit `memberOf` and `pwdAccountLockedTime` in the seed;
  - nestgroup under paging;
  - the escaped `CN=Smith\, Frank` rename;
  - start-up time, and memory, which sets `mem_limit` (the plan has 512m/128m placeholders);
  - ldapts and croner bundling under Turbopack.
- **A research agent used the owner's running app container.** It ran a read-only Node TCP probe there, with `docker compose -f docker-compose.local.yml exec`. The owner was told. Future agents' briefs keep the local stack off-limits (rule R4).
- **Progress reporting:** there is no todo tool. Post the task checklist in chat at each task boundary (owner).

## Next steps

1. **Workspace.** Create `.superpowers/sdd/2026-10-10-backend-b3b-directory/` with:
   - the B3a contracts, adapted;
   - `rules.md` (R0–R10 from the plan's execution notes);
   - `global-constraints.md` (the plan's header through File structure, verbatim);
   - a ledger, `progress.md`;
   - `RESUME.md`, with a memory pointer, in case usage pauses the run.
2. **Pre-flight (Opus).** Dispatch it as the plan's execution notes describe: the plan applied verbatim to a scratch copy in the session scratchpad, plus one run of the LDAP test directories, with nothing left running. Rule on each finding under R0. Amend the plan, including the measured `mem_limit` values, and commit it before Task 1.
3. **Tasks 1–15,** each with its implementer and reviewer models from the table.
4. **Task 16 (controller):**
   - the Fable whole-branch review and a fix wave;
   - `pnpm test:ldap`;
   - the full e2e suite from empty;
   - the migration on a copy of the local database;
   - the Docker gate;
   - the PR text in `tmp/b3b-pr.md`.

   Then stop for the owner's word.

5. **The owner's live check** against their Active Directory over `none` (Task 16, Step 7), after the owner's merge decision.

## Suggested skills

- `superpowers:subagent-driven-development`: the run; its scripts are `task-brief`, `review-package` and `sdd-workspace`.
- `superpowers:test-driven-development` and `superpowers:verification-before-completion`: implementers and gates.
- `superpowers:requesting-code-review` and `superpowers:receiving-code-review`: the pre-flight, the per-task reviews and the whole-branch review.
- `find-docs` (Context7): ldapts, croner, next-auth v4, Vitest projects, zod 4, Drizzle; only when a ruling needs a source the research doesn't already give.
- `antd`: Tasks 8, 12, 13, 14 (Tabs, Select remote search, Descriptions, Card).
- `adr-skill` (the project copy in `.claude/skills/adr-skill`): ADR-0029 in Task 15.
- `superpowers:finishing-a-development-branch`: after Task 16.

## Suggested kick-off prompt

> Read docs/superpowers/handoffs/2026-10-10-backend-b3b-plan.md, then CLAUDE.md and the plan docs/superpowers/plans/2026-10-10-backend-b3b-directory.md (header, Global Constraints, Review Focus, execution notes). Execute it with superpowers:subagent-driven-development on feat/backend-b3b-directory: set up the workspace, run the Opus pre-flight first, rule on its findings under R0 and commit the amended plan, then Tasks 1–16 with the models table. No push, PR or branch deletion without my word.
