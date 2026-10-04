# CLAUDE.md — fork conventions and decisions

This is a personal fork of [lexmin0412/dify-app-hub](https://github.com/lexmin0412/dify-app-hub) (`upstream`), hosted at `LovingCivilian/dify-app-hub` (`origin`). `AGENTS.md` is upstream's and still applies (database migrations, `.cii-assessment.md` before commits, no dev server needed for verification, debugging rules). This file records what the fork decided on top of it, so a new session does not re-litigate it.

## Branch model

- `main` is an untouched mirror of `upstream/main`. Never commit to it.
- `fork/main` is the integration branch: upstream + every accepted fork feature. Deploy and test from it.
- Feature branches start from `fork/main`; PRs target `fork/main`. Stack a branch on another one only when it needs work that has not merged yet (then the PR targets the parent branch; GitHub retargets it once the parent merges and is deleted).
- On a fork `gh` targets the parent repo by default: always `gh pr create -R LovingCivilian/dify-app-hub --base fork/main …`, and `gh pr merge <n> -R LovingCivilian/dify-app-hub --merge` (merge commits, history kept). Merged branches may be deleted afterwards.
- Upstream sync: `git fetch upstream && git checkout main && git merge --ff-only upstream/main`, then `git checkout fork/main && git merge main` and resolve conflicts there. Expected conflicts and the after-merge checks are listed in `docs/auth-gate.md` and `docs/i18n-maintenance.md`.
- The GitHub default branch is still `main` (not switched yet).

## How to work here

- Documented, standard approaches only — no custom mechanisms or workarounds. Check the library's current docs through Context7 (`ctx7`) before using an API, even a familiar one; when a wanted behaviour has no documented way, say so instead of hacking around it. The user asks "does this follow docs?" and expects a per-piece answer with sources.
- Looking things up: Context7 first (`npx ctx7@latest library …` then `docs …`, at most three commands per question). When its snippets are shallow or a page needs a real browser, crawl4ai is installed in the repo's `.venv`: `.venv/bin/crwl <url> -o markdown --bypass-cache` prints the page as markdown (verified on ant.design and nextjs.org docs; `crawl4ai-doctor` is its health check). WebFetch is fine for plain pages. The venv is per machine (no `pyproject.toml`), git-ignored by its own `.gitignore` and excluded from the Docker build context by `.dockerignore`.
- Merge-friendly with upstream: line-level edits inside upstream files, new behaviour in fork-owned files, upstream file paths never moved. Keep upstream-shaped files close to upstream (e.g. `components/layout/admin-header-title.tsx` differs only by `t()` strings).
- Process: brainstorm first (a short in-chat design for bounded changes, a spec + plan under `docs/superpowers/` for bigger ones), get an explicit yes, then implement test-first. Larger features run subagent-driven with per-task review — the user wants "as robust as possible, the more eyes the better".
- Before a commit: `pnpm exec tsc --noEmit`, `pnpm exec oxlint <files>`, `pnpm exec oxfmt --check <files>`, `pnpm test` (vitest, node environment — no DOM tests, so layout changes are verified by build + browser). lint-staged runs oxfmt/oxlint on commit.
- Commits: conventional (`feat|fix|docs|chore(scope): …`), English, with the attribution trailers the session supplies (`Co-Authored-By` and `Claude-Session` — the user chose to keep the session link). Commit and push only when asked.
- PR descriptions follow `.github/PULL_REQUEST_TEMPLATE.md` (Overview / Changes table / Testing / Related Issue), in English.
- `.env` and `.env*.local` are git-ignored and never committed; never print their values. The user's email is not sent to any service other than this app.

## Decisions taken

### Internationalisation (done: app UI; `i18n/app-ui`, `i18n/arabic`, merged)

- All UI text goes through i18next keys in `locales/{en,zh,ar}/translation.json`; keys are typed (`types/i18next.d.ts`), languages are listed in `i18next.config.ts` and `libs/i18n.ts`. Checklist for a new language: `docs/i18n-maintenance.md`.
- Arabic is Modern Standard Arabic with Arabic-Indic digits: Ant Design locale `ar_EG` (the only Arabic pack antd ships), Day.js locale `ar` plus the official `preParsePostFormat` plugin, dates via `Intl` with `ar-SA-u-ca-gregory-nu-arab` (`libs/format-date.ts`). Locale wiring lives in `libs/antd-locale.ts` and `hooks/use-html-lang.ts`.
- "Text first, RTL later": right-to-left layout is a separate follow-up, not started.
- The language switcher (`components/chat/i18n-switcher`, Lucide `languages` icon) sits in the header's right icon group, order `language · theme · GitHub · account`, on admin, chat and `/apps`.
- Remaining translation sub-projects, not started: server-side messages and e-mails; docs/README. Translating code comments was dropped.

### Login for everyone (step 1 done: `auth/login-for-all`, merged; design `docs/superpowers/specs/2026-10-03-login-for-all-users-design.md`, maintenance `docs/auth-gate.md`)

- Every page and every `/api/*` route needs the app's own NextAuth credentials login; deny by default. Public: `/login`, `/forgot-password`, `/reset-password`, `/init`, `/api/auth`, `/api/init`, `/api/health`. Classification in `lib/access.ts`, enforcement in `proxy.ts` plus a session check inside every `app/api/client/*` handler.
- The Dify end-user id is the signed-in account's **email**, set **server-side** (`getSessionUserId()` in `lib/session-user.ts`); the browser-supplied `user` is ignored everywhere. This replaces upstream's browser-fingerprint identity (upstream's "dual auth" proposal was not adopted).
- Landing page after login: `/apps`. Log out lives in the account menu (`components/auth/account-menu.tsx`).
- Left in place on purpose, unused: the fingerprint page `app/(user)/auth/page.tsx`, the `x-user-id` header in `lib/dify-client.ts`, `getUserIdFromRequest` in `lib/api-utils.ts`.
- Signed-in visitors are redirected from `/login` and `/forgot-password` to `/apps` by the pages' server layouts (`redirectSignedInUser()`); `/reset-password` stays reachable while signed in because the emailed link is the only way a non-admin changes their password. Revisit when the account menu gets "change password".
- No LDAP, no roles or permissions yet — those are later steps on top of this base.
- Known limits: a revoked JWT passes the page gate (`getToken`) until it expires, while the Dify routes reject it; upstream's `/api/users/*` checks only `!session` (two one-line edits to `!session?.user?.id` would close it); the layout redirect cannot honour `?callbackUrl=`.

### Infrastructure

- MySQL stays (the app is MySQL-only through Drizzle; Postgres was considered and rejected).
- The Ant Design / Ant Design X look is left as upstream has it (adopting the X components was sized and dropped).

## Local testing

### Docker stack (the real check before merging)

`docker-compose.local.yml` (project `dify-app-hub-local`) builds the image from the checkout and runs it with MySQL on `http://localhost:5300`, settings from `.env`. Rebuild from the branch under test:

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml up -d --build app   # ~2 min, 80 s of it is next build
```

Take the old app container down first: this WSL machine has ~5 GB RAM and builds were killed otherwise. MySQL and its volume stay up, so the admin login and data survive. If Claude Code kills a build for memory, do not restart it unprompted. The user verifies in the browser; report the curl checks (`/api/health` 200, `/apps` signed out → 307 `/login?callbackUrl=%2Fapps`, `/api/client/apps` → 401).

### Quick dev loop (no image build)

```bash
docker compose -f docker-compose.local.yml stop app   # frees port 5300; MySQL keeps running
pnpm dev                                              # http://localhost:5300, hot reload
```

MySQL is published on `127.0.0.1:3306` only, and the git-ignored `.env.development.local` overrides `DATABASE_URL` to point there for `next dev` (Next's load order: `.env.development.local` over `.env`; Docker builds never read it). Port 5300 is kept so `NEXTAUTH_URL` and the session cookie keep working. Schema changes need `env $(grep DATABASE_URL .env.development.local) pnpm db:migrate` by hand; only the container's entrypoint runs migrations automatically. Dev mode skips `next build`, the standalone server and the entrypoint, so still do one Docker rebuild before merging.

Without Chrome MCP tools, browser evidence can be produced with the headless Chromium in `~/.cache/ms-playwright/` against a throwaway stack (own MySQL, admin created through `POST /api/init`, fake Dify API) — never against the user's instance or real Dify server.

## Frontend overhaul (in progress — start here in a new session)

The frontend is being rebuilt on antd 6 / Ant Design X 2 per their docs and Next 16's App Router conventions. Decisions, conventions and the delivery plan: `docs/superpowers/specs/2026-10-04-frontend-overhaul-charter.md` (approved). Sub-projects 0 (tooling) and 1 (foundation and shells): spec `docs/superpowers/specs/2026-10-04-frontend-foundation-design.md` (approved), plan `docs/superpowers/plans/2026-10-04-frontend-foundation.md`.

Next action: once the plan's PR is merged, create a worktree branch `feat/frontend-foundation` from `fork/main` and execute the plan with `superpowers:subagent-driven-development` (the user chose subagent-driven; implementers on the cheap/mid tier per the plan's execution notes, reviewers mid tier, final review on the most capable model). Expect two rulings (login-form locators, the mobile card click) — record them in the ledger. Sub-projects 2 (chat), 3 (admin/app list/auth pages) and 4 (Tailwind/Lucide/Radix removal) each get their own spec and plan afterwards.

Research already done and recorded in the charter (do not redo): antd 6 exposes its tokens as `--ant-*` CSS variables on `<App>`'s root (aliases must be declared on `.ant-app`, not `:root`); the X site has no `llms.txt` but ships `@ant-design/x-skill`; antd serves every docs page as Markdown (`https://ant.design/components/<name>.md`, `design.md`, `llms.txt`); ProComponents does not support antd 6; `antd-style` is not used (App Router SSR caveat, second provider).

## Open follow-ups

- Switch the GitHub default branch to `fork/main`; delete merged branches (`i18n/app-ui`, `i18n/arabic`, `auth/login-for-all`, `fix/language-switcher-placement`).
- Auth: the `/api/users/*` revoked-session gap above; `app/(user)/layout.tsx` renders children for one frame when unauthenticated (gate on `isLoading || !isAuthorized`); `goAuthorize` in `hooks/use-auth.ts` is unused; the proxy test relies on the undocumented `x-middleware-next` header; spec §3 still shows `?? null` for `userId`.
- i18n: user review of the Arabic wording (countdown plurals, terminology); RTL layout; translation sub-projects 2 and 3.
- Later steps the user has named: LDAP login, user groups / roles and permissions, an account-menu "change password".

## Next.js bundled docs

The block below is managed by `next dev` (see `node_modules/next/dist/docs/01-app/02-guides/ai-agents.md`). It lives here rather than in upstream's `AGENTS.md` so that file stays identical to upstream; Next leaves `AGENTS.md` alone while this file holds the block. Keep it, and read the bundled docs it points to before using a Next.js API.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
