# Handoff 2026-10-10: backend B3a executed and merged; next, plan B3b

This session executed the B3a plan subagent-driven, added the owner's admin sidebar on the way, merged it as PR #31 and accepted ADR-0027 and ADR-0028. The next session writes the B3b plan (directory sign-in and sync). This file holds only what the records below don't say; read them rather than repeating them here.

## Where things stand

- **`fork/overhaul`** is at `c3de4637`, the merge of PR #31: https://github.com/LovingCivilian/dify-app-hub/pull/31
- **Branch `docs/accept-adrs-0027-0028`**, from `c3de4637`, holds `a77a4c28` (ADR-0027 and ADR-0028 set to `accepted`, the decisions index and `CLAUDE.md`'s decisions list) and this handoff with `CLAUDE.md`'s "Latest handoff" pointer. If it is not merged yet, it waits for the owner's word, as PR #30 did.
- **Branches kept on the owner's standing instruction:** `feat/backend-b3a-groups-access`, `feat/backend-b2-accounts`, `feat/dify-user-id`, `docs/accept-adrs-0022-0026`. Delete nothing without the owner's word.
- **The owner's browser checks are pending** for PRs #28, #29 and #31. The owner was remote and merged on the strength of the gates. The check lists are in each PR's Testing section. Offer them when the owner is at the machine.
- **The local Docker stack (`localhost:5300`)** runs an image built from `feat/backend-b3a-groups-access` at `05a736a1`. That is PR #31's code; the two commits after it change `vitest.config.ts` and docs only. The volume has the B3a migrations applied (10 in total): 4 apps, all `everyone`, and 1 account, the owner.
- **`vitest.config.ts` now excludes `tmp/**`** (owner, 2026-10-10), so plain `pnpm test`is the unit gate again. The B3a run used`pnpm test --exclude 'tmp/\*\*'`because`tmp/b3-research/` holds source clones with their own test files; those clones are still on disk.

## Records (read these, don't repeat them)

- **For the B3b plan:**
  - the spec `docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md`: §2 (the owner's 18 decisions), §3.2, §6–§8, §9's B3b row, §10, §13, §14;
  - its research `docs/superpowers/research/2026-10-09-backend-b3/` (start at the README).
- **What B3a built, which B3b builds on:**
  - **ADR-0027:** the data model as built, `visibleTo`, the two deactivation markers, the deviations 1–8, and the B3b notes. These say: the `ldap` provider calls `isActive` after the bind; an unknown username is answered in the same time as a wrong password; the sync writes only `directory` memberships and the directory marker. A dated note gives the migration copy and query plan.
  - **ADR-0028:** the shared sidebar.
- **Plan and run:**
  - the B3a plan `docs/superpowers/plans/2026-10-09-backend-b3a-groups-access.md`;
  - the run records `docs/superpowers/research/2026-10-09-backend-b3/b3a-execution/`: the ledger with every ruling and owner decision, `rulings.md`, the pre-flight scan, the reference check of the controller's rulings, the final review and the fix wave.
- **What stays open:** `CLAUDE.md` "Open follow-ups" (the "B3a leftovers" and i18n bullets hold the owner's deferred look and wording calls).

## B3b facts the spec does not say (from B3a's code)

- **ADR number.** The spec names B3b's record ADR-0028, but the sidebar took that number; B3b's directory record is **ADR-0029**.
- **Pieces to reuse, not rebuild:**
  - **Account status.** `isActive(markers)` in `lib/auth/account-status.ts` already fails closed on both markers. `users.directoryDeactivatedAt` exists (written by nothing yet), and so does the users page's status column with its "Deactivated" tag and tooltip. Spec §5's "Not in directory" status joins that column.
  - **Sign-in refusals.** `logSignInRefusal(context, reason, subject)` in `lib/error-log.ts`, with the literal union `SignInRefusalReason`, which B3b extends with its fixed codes.
  - **Timing.** `UNKNOWN_ACCOUNT_HASH` in `lib/auth/password.ts` is the pattern for the unknown-username timing.
  - **Memberships.** The `source` column (`manual`/`directory`), and the groups DAL's builders `manualMembersOf`/`removeManualMembers`, whose `directory` counterparts B3b adds.
  - **Database errors.** `isDuplicateEntry`/`isMissingReference` in `lib/data/db-errors.ts`.
- **The groups page** (`components/admin/groups/`) is where spec §6.5's "Directory groups" field goes. Its drawer owns its form in an inner `GroupForm`, and pickers use `drawerPopupContainer` (`components/admin/drawer-popup-container.ts`).
- **The login page** gets spec §6.3's tabs. B3a did not touch it.
- **Migrations.**
  - The single-table cascade defect of drizzle-kit rc.3 still applies: B3b's `user_group_directory_links` and `directory_sync_runs` are created in one migration, or each generated SQL is checked for `ON DELETE CASCADE`.
  - The `CHECK` constraint in spec §3.2 is new on this line.
  - `pnpm db:migrate` runs `drizzle-kit migrate`; the entrypoint runs `db/migrate.ts`.
- **Spec §14's open points are still open.** They are for B3b's plan or its pre-flight: AD's LDAP signing default, reaching the AD from Docker on WSL, `smblds`/OpenLDAP memory and certificates, `CHECK` with table-qualified names, croner across daylight-saving changes.

## How the owner wanted the run done (learned this session)

- **Docs, standards and reference projects for every decision, the controller's rulings included** (owner, repeated 2026-10-09).
  - Each ruling names its doc source and, where it goes beyond a doc, 2–3 reference projects. Repo precedent alone never counts.
  - A finding that names a documented route is taken, even when Minor (the run's rule R0).
- **Use the most capable model where it pays.** Fable for the hard reviews (authorization writes, deactivation, the final review) and for fix loops that reach round 4. Opus or Sonnet elsewhere, as the plan's models table says (owner, 2026-10-10).
- **Keep tasks lean** (owner, after Task 4b took an hour).
  - Implementers run only the Playwright specs their brief names; the full suite (~23 minutes) runs once, at the end.
  - No probes or scratch configs unless asked.
  - Nothing left running, nothing waiting on stdin: an implementer's stuck `cat` sat for 85 minutes.
- **No todo tool in this harness.** The owner asked for progress in the UI; post the task checklist in chat at each task boundary instead.
- **The owner changes design mid-run and expects it absorbed.**
  - The sidebar, its consistency with the chat ("whichever is the documented path") and the bottom trigger all came during Task 4b.
  - Relay such a change to the running implementer, append it to that task's brief, and record it in the ADR.
- **Usage limits pause the run.** The owner paused for the weekly limit and asked for a resume file.
  - The workspace's `RESUME.md` plus the ledger, with a memory pointer, was enough to resume without loss.
  - Do the same for B3b's run.
- **The owner is often remote.** They merge on the gates' strength and defer browser checks.

## Environment facts learned this session

- **Run workspace.** `.superpowers/sdd/2026-10-09-backend-b3a-groups-access/` is still on disk, git-ignored; its records are committed.
  - Its `implementer-contract.md`, `reviewer-contract.md`, `re-review-contract.md` and `rules.md` (R0–R10) are the starting point for B3b's run.
  - R8 is obsolete now that vitest excludes `tmp/**`.
- **Next's dev indicator** sits at the bottom-right (`next.config.ts` `devIndicators.position`), because at the bottom-left it intercepted the sidebar trigger's clicks under `next dev`, where e2e runs. In development it can cover a table's page-size changer in that corner.
- **One-off e2e failures.** Two failed once on a page's first compile under `next dev` (page-headers, items per page) and did not recur in the full run. Treat a single first-visit timeout as a compile effect only after a rerun passes.
- **Pre-flight review.** The Opus pre-flight that applied the plan to a scratch copy outside the repo (tsc, drizzle-kit, vitest, lint) found 9 Critical defects before Task 1. It is worth repeating for B3b's plan.
- **Upstream research (owner's question, research only, no work).** Dify 1.17's new Agent sandbox file system is exposed only by the Console API (`api/controllers/console/app/agent_app_sandbox.py`), not the Service API the hub uses. Notes in `tmp/dify-agent-fs/findings.md`, local scratch.

## Next steps

1. If `docs/accept-adrs-0027-0028` is not merged: push it and open a PR against `fork/overhaul`, then merge on the owner's word (merge commit).
2. Write the B3b plan with `superpowers:writing-plans` from the spec's §6–§8 and B3a's final code, on a new branch `feat/backend-b3b-directory` from `fork/overhaul`. It needs the owner's review before execution, and its execution starts with an Opus pre-flight review.
3. B3b ends with the owner's live check against their Active Directory over plain LDAP (spec §9).

## Suggested skills

- `superpowers:writing-plans`: the B3b plan.
- `find-docs` (Context7): ldapts 9.2, croner 10, next-auth v4 Credentials (several providers, thrown errors), Drizzle rc.3 (`check`, migrations), Vitest `projects` (the `pnpm test:ldap` suite).
- `antd`: the login `Tabs`, the directory status panel, the groups drawer's directory-group search.
- `adr-skill` (project copy `.claude/skills/adr-skill`): ADR-0029.
- `superpowers:brainstorming` only if the plan hits a decision the spec leaves open; the spec is approved, so do not re-open its §2.
- Later, for execution: `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`, `superpowers:finishing-a-development-branch`.

## Suggested kick-off prompt

> Read docs/superpowers/handoffs/2026-10-10-backend-b3a-execution.md, then CLAUDE.md, the B3 spec docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md (§2, §3.2, §6–§10, §13–§14), its research docs/superpowers/research/2026-10-09-backend-b3/ and ADR-0027. B3a is merged (PR #31). Write the B3b implementation plan with superpowers:writing-plans on a new branch feat/backend-b3b-directory from fork/overhaul, built on B3a's final code; its directory record is ADR-0029. Then stop for my review.
