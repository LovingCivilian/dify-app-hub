# Handoff — backend rework: brainstorm done, charter and B1 plan approved, execution not started

Date: 2026-10-07 · Line: `fork/overhaul` at `a70d3902` (matches `origin`) · Written at the owner's request at the end of the brainstorm and planning session.

## Where things stand

- The owner asked for a total backend rework of this line (the 2026-10-05 brief was input only). The brainstorm ran the full architectural path: four owner choices, seven design sections approved one by one, then the charter, then the B1 plan. Both documents were approved in chat ("go", "yes"). Nothing is committed and nothing is pushed.
- Untracked in the working tree (the plan's Task 1 Step 1 commits them as the first commit of the branch):
  - `docs/superpowers/specs/2026-10-07-backend-rework-charter.md` — the spec for B1 and B2 (§2 decisions, §4 architecture, §5 delivery plan, §6 records). Two sentences were amended after the plan's self-review so spec and plan agree (the DAL takes the verified actor as a parameter; the browser client lives at `lib/dify/browser.ts`).
  - `docs/dify-service-api-1.17.1.md` — the endpoint map the routes implement (36 operations, Dify 1.17.1 docs and controllers agree).
  - `docs/superpowers/plans/2026-10-07-backend-b1-dify-layer.md` — the B1 plan: 18 tasks, each test-first with its commit; header, global constraints, review focus (five), file map; the two deviations from the charter are explained in its header.
- Local research (not committed; `.superpowers/sdd/` is kept out of git as sub-project 3's survey was): `.superpowers/sdd/2026-10-07-backend-rework/{dify-endpoint-map.md,frontend-consumer-map.md,reference-projects.md,design-notes.md}`. The consumer map lists, per route, every frontend caller and the e2e specs that pin it; the plan's tasks name those specs.
- Machine state: nothing running (no `pnpm dev`, no stub, no Playwright); Docker: the app container is stopped, the local MySQL is up with its data, the e2e MySQL is down. The scheduled wake-up of this session was cancelled.

## What the next session does

1. Read `CLAUDE.md`, then the charter §2 and §4, then the plan's header and global constraints. Do not re-open the decisions (charter §2) or the sectioned design.
2. Execute the plan with `superpowers:subagent-driven-development` (the owner's chosen method: a fresh implementer per task, a fresh reviewer per task, then a whole-branch review on the most capable model before the PR). Task 1 creates `feat/backend-b1-dify-layer` from `fork/overhaul`, commits the three documents, adds zod.
3. Per task: the gates in the plan's global constraints (`pnpm exec next typegen && pnpm exec tsc --noEmit`, oxlint, oxfmt, `pnpm test`, the named Playwright specs). Commit per task with both trailer lines in one `-m`. Never push; the owner says when.
4. Task 18 ends with the full e2e run, the Docker gate (foreground build, old container down first, never restart a build the memory reaper killed), the owner's browser check against Dify 1.17.1 (the audio format outcome goes into ADR-0017's note), and the PR text held for the owner.
5. After B1 merges: B2 (accounts and admin) gets its own plan from the charter; B3 gets its own brainstorm; then frontend phase 2. See "After B1" below for where each stage's design lives and what its plan must pick up.

## After B1 — the rest of the programme (designed, not planned)

**B2, accounts and admin** (`feat/backend-b2-accounts`, branched from `fork/overhaul` after B1 merges). No plan exists yet: write it with `superpowers:writing-plans` from the charter; it is the spec (§6 says so: a separate spec only for B3 and F2). Where B2's design lives:
- Charter §4.2: the `users`, `setup` and `password-reset` DAL modules (actor parameter, as B1's `lib/data/apps.ts`); the typed session gains `role` (`types/next-auth.d.ts`, `lib/auth/options.ts` callbacks copy it; `verifySession()` returns it); `requireAdmin()` throws `AuthError('forbidden')`; the `(admin)` layout redirects a non-admin to `/apps`; admin-only surfaces (admin pages, every admin action, annotation list/update/delete — the one-line change on B1's annotation routes); the users drawer's role field; the last admin cannot be demoted or deleted; nobody deletes themselves; the actions `createUserAction`/`updateUserAction`/`deleteUserAction`, `createFirstAdmin`, `requestPasswordReset`, `resetPassword` (same token hashing, one-minute rate limit, transaction; nodemailer unchanged), `changePassword` in `app/actions.ts` (bumps `sessionVersion`, the client signs out to `/login?notice=password-changed`, the login page shows the notice from the flag; session `update()` is not used); the four forms on `useActionState` with `ActionResult` codes mapped to i18n keys (B1's `lib/action-result.ts`, `lib/action-failure.ts`, the users area's `user-errors.ts` pattern); `proxy.ts` keeps only the optimistic check (the HTTP self-fetch of `/api/init/status` goes; `lib/access.ts` drops `/api/init` from the ungated prefixes); the login page's server layout redirects to `/init` when no admin exists; the handlers `app/api/users/**`, `app/api/init/**`, `app/api/auth/{forgot-password,reset-password}/` are deleted, which closes the `/api/users/*` gap; session renewal stays as ADR-0018 documents it.
- Charter §4.4 (`users` row): `role` as `mysqlEnum('admin','user')` default `user`, the backfill makes every existing account `admin`, `updated_at` gets `$onUpdate`; one migration, verified on seeded rows as B1's Task 6 Step 5 does.
- Charter §4.6: e2e setup creates the admin through the `/init` form in the browser (the reused-server case is the redirect to `/login`), extra users through `e2e/fixtures/db.ts` with a bcrypt hash; new cases: a `user`-role account turned away from `/app-management` and every admin action, the password change ending in sign-out and a login with the new password, first run through the form; `e2e/auth.spec.ts`'s reset-token reuse asserts the UI.
- Charter §6: ADR-0024 (the Data Access Layer with Server Actions and roles; number reserved in `docs/decisions/README.md` by B1's Task 18), the dated note on ADR-0018 (actions verify the session themselves; the proxy no longer fetches the init status), `docs/auth-gate.md` rewritten, `CLAUDE.md`'s "Where things are" backend bullet loses its "still upstream-shaped until B2" list.
- Also B2's: `lib/data/users.ts` is rewritten (its two queries are the handlers' duplicates, ADR-0020's recorded limit), `lib/auth/password.ts` already holds the hashing and token helpers (B1 Task 2), and B1's e2e `auth.setup.ts` still posts `/api/init` — B2 changes that.

**B3, groups, per-app access and LDAP**: not designed. It needs its own brainstorm (`superpowers:brainstorming`, architectural path) and spec. Fixed by the charter §2 and §4.2: it builds on B2's role; groups, which apps a user or group may see (the `/apps` list and the chat's server lookup filter by it), the LDAP provider (next-auth v4 Credentials with `ldapjs`, a new dependency with its own ADR) with a role and group mapping; roles exist before LDAP because an LDAP login creates accounts on first sign-in.

**Frontend phase 2** (after B2): the list is the charter §5's F2 row and `CLAUDE.md`'s "Open follow-ups" after B1's Task 18 updates them: the `agent` mode in the chat (its closing `message` replaces the text; the backend accepts the mode from B1), a paused workflow run showing its form in the runner, tool icons from `meta` if wanted, the chat's Flex-spacing audit (ADR-0020), the Mermaid Strict Mode retest at the next X release (ADR-0017), RTL and the Arabic wording review (ADR-0005), the first-paint language from `Accept-Language`, the two `@ant-design/icons` majors, and the audio recording format if B1's check against Dify 1.17.1 refuses WebM. The brief's "Frontend areas, consolidated" table (`docs/superpowers/specs/2026-10-05-backend-rework-brief.md`) is the older view of the same list; B1 and B2 absorb its items 3, 4, 4b, 4c and 8.

## Things the plan relies on that are worth a second look while executing

- zod 4 API: `import * as z from 'zod'`, `z.object` strips unknown keys, `z.url({ protocol })`, `z.uuid()`, `z.flattenError`; the issue type may be `z.ZodError['issues']` rather than `z.core.$ZodIssue` (Task 5 says which fallback to use). Next's guide snippets show zod 3 syntax; follow v4.
- `RouteContext<'…'>` and `PageProps<'…'>` are generated types: run `next typegen` before `tsc`.
- `refresh()` from `next/cache` inside the Server Actions, called from the client inside `startTransition` (`use-action-transition.ts`), so the admin page re-renders in the same round trip without `router.refresh()`.
- vitest resolves `server-only` through the alias to Next's own empty module (Task 1); every server module under test imports it.
- The `is_enabled` migration: `drizzle-kit generate` may prompt about the column; answer "changed, not renamed", then hand-insert the `UPDATE … CASE WHEN is_enabled = 2 THEN 0 ELSE 1 END` before the `MODIFY`. Task 6 Step 5 verifies it on seeded rows on the e2e MySQL.
- The owner's `.env` must define `NEXTAUTH_SECRET` (`lib/env.ts` requires it at the first request); never print `.env` values.
- Dify's `icon_url` for an image icon is a signed link that expires (default 300 s): the DAL stores the bytes at create and sync time; the admin must sync existing apps once after the Docker gate to get their icons.
- `AGENTS.md` stays byte-identical to upstream; `CLAUDE.md` gets the backend updates in Task 18 (the exact edits are in the plan).

## Suggested skills

- `superpowers:subagent-driven-development` — the execution method (per-task implementer and reviewer).
- `superpowers:test-driven-development` and `superpowers:verification-before-completion` — every task's steps are test-first with explicit expected outputs.
- `superpowers:requesting-code-review` / `superpowers:receiving-code-review` — the per-task reviews and the whole-branch review before the PR (Task 18).
- `adr-skill` — Task 18 writes ADR-0022, 0023, 0025 (the plan holds their full text; `docs/decisions/README.md` says the skill's scripts must run from a temporary copy with `.cjs` extensions under this repo's `"type": "module"`).
- `antd`, `use-x-chat`, `x-request` — Tasks 12 to 16 touch the chat hooks and the admin forms.
- `find-docs` (Context7 `ctx7`) — zod 4, next-auth v4, Drizzle 1.0.0-rc.3 when a signature is in doubt; Next from the bundled docs under `node_modules/next/dist/docs/`.
- `superpowers:finishing-a-development-branch` — at the end of Task 18, before asking the owner about the push.

## Owner rules repeated from this session

- Brainstorm → spec → plan → subagent execution with a review per task; commit and push only when the owner says so; no handoff document unless asked (this one was asked for).
- Documented approaches only (ADR-0002), the sources named in each task report.
- Stop `pnpm dev` on 5300 before `pnpm test:e2e`; one `next dev` per checkout.
