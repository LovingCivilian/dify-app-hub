# CLAUDE.md — fork conventions and pointers

This is a personal fork of [lexmin0412/dify-app-hub](https://github.com/lexmin0412/dify-app-hub) (`upstream`), hosted at `LovingCivilian/dify-app-hub` (`origin`). `AGENTS.md` is upstream's and still applies (database migrations, `.cii-assessment.md` before commits, no dev server needed for verification, debugging rules). This file holds the line's working rules and pointers; the decisions themselves are Architecture Decision Records in `docs/decisions/` (index: `docs/decisions/README.md`) — read the accepted ones for an area before changing it, and do not re-litigate them.

## Branch model (ADR-0019: two product lines)

- `main` is an untouched mirror of `upstream/main`. Never commit to it.
- `fork/main` (this line) is the line-level product: upstream + every accepted line-level fork feature. Deploy and test from it.
- `fork/overhaul` is a second product line (since 2026-10-06): the frontend overhaul (antd 6 / Ant Design X rebuild), branched from this history at `11c3fb3d`. It never merges into `fork/main`, and `fork/main` work reaches it only by cherry-pick. It has its own rules, the overhaul-only ADRs and its handoffs (ADR-0019 for this two-line model; until PR #15 merges, ADR-0016–ADR-0018 sit on its branch; ADR-0019 is on both lines); work on this line-level app happens here.
- Feature branches start from `fork/main`; PRs target `fork/main`. Stack a branch on another one only when it needs work that has not merged yet (then the PR targets the parent branch; GitHub retargets it once the parent merges and is deleted).
- On a fork `gh` targets the parent repo by default: always `gh pr create -R LovingCivilian/dify-app-hub --base fork/main …`, and `gh pr merge <n> -R LovingCivilian/dify-app-hub --merge` (merge commits, history kept). Merged branches may be deleted afterwards.
- Upstream sync: `git fetch upstream && git checkout main && git merge --ff-only upstream/main`, then `git checkout fork/main && git merge main` and resolve conflicts there. Expected conflicts and the after-merge checks are listed in `docs/auth-gate.md` and `docs/i18n-maintenance.md`. After each sync `pnpm why @ant-design/cssinjs` must show one version (ADR-0013: upstream still pins `^1.24.0`).
- The GitHub default branch is `fork/main`.
- Local folders: each line has its own folder on this machine, a git worktree of the same repository. This line lives in `~/repos/dify-app-hub-main`; `fork/overhaul` lives in `~/repos/dify-app-hub` (the main worktree). Start Claude Code in the folder of the line you work on; feature branches for this line are created in this folder. Git refuses to check out a branch in both folders. Each folder has its own git-ignored `.env`, `.env.development.local`, `node_modules` and `.venv`, and its own Docker stack (below), so nothing in one folder touches the other. Claude Code's auto memory is shared by both folders (it is per repository).

## How to work here

- Documented, standard approaches only — no custom mechanisms or workarounds (ADR-0002). Check the library's current docs through Context7 (`ctx7`) before using an API, even a familiar one; when a wanted behaviour has no documented way, say so instead of hacking around it. The user asks "does this follow docs?" and expects a per-piece answer with sources.
- Looking things up: Context7 first (`npx ctx7@latest library …` then `docs …`, at most three commands per question). When its snippets are shallow or a page needs a real browser, crawl4ai is installed in the repo's `.venv`: `.venv/bin/crwl <url> -o markdown --bypass-cache` prints the page as markdown (verified on ant.design and nextjs.org docs; `crawl4ai-doctor` is its health check). WebFetch is fine for plain pages. The venv is per machine (no `pyproject.toml`), git-ignored by its own `.gitignore` and excluded from the Docker build context by `.dockerignore`.
- Merge-friendly with upstream: line-level edits inside upstream files, new behaviour in fork-owned files, upstream file paths never moved. Keep upstream-shaped files close to upstream (e.g. `components/layout/admin-header-title.tsx` differs only by `t()` strings).
- Process: brainstorm first (a short in-chat design for bounded changes, a spec + plan under `docs/superpowers/` for bigger ones), get an explicit yes, then implement test-first. Larger features run subagent-driven with per-task review — the user wants "as robust as possible, the more eyes the better".
- Decisions and handoffs (ADR-0015): a decision that changes a pattern, adds a dependency or reverses a plan gets an ADR in the same PR (`/adr-skill`, project copy in `.claude/skills/adr-skill`; its scripts are CommonJS and crash under this repo's `"type": "module"`, so run them from a temporary copy of the skill with the scripts renamed to `.cjs`, then check the index row in `docs/decisions/README.md` by hand); a session ends with a handoff under `docs/superpowers/handoffs/` (user-level `handoff` skill). Keep this file to rules and pointers.
- Ant Design and Ant Design X: before touching their components, read the matching skill in `.claude/skills/` (`antd` with its `@ant-design/cli` commands, `x-components`, `use-x-chat`, `x-chat-provider`, `x-request`, `x-markdown`). The X skills describe X 2.9.0; this line runs antd 6.4.3 and X 2.7.0 (`pnpm-lock.yaml`), so pass `--version 6.4.3` to `antd info`/`doc`/`demo`/`token` and check X APIs against the installed `node_modules` types.
- Before a commit: `pnpm exec tsc --noEmit`, `pnpm exec oxlint <files>`, `pnpm exec oxfmt --check <files>`, `pnpm test` (vitest, node environment — no DOM tests, so layout changes are verified by build + browser). lint-staged runs oxfmt/oxlint on commit.
- Commits: conventional (`feat|fix|docs|chore(scope): …`), English, with the attribution trailers the session supplies (`Co-Authored-By` and `Claude-Session` — the user chose to keep the session link). Commit and push only when asked.
- PR descriptions follow `.github/PULL_REQUEST_TEMPLATE.md` (Overview / Changes table / Testing / Related Issue), in English, and name the ADRs they implement.
- `.env` and `.env*.local` are git-ignored and never committed; never print their values. The user's email is not sent to any service other than this app.

## Decisions (one line each; the ADR has the why, the alternatives and the verification)

- ADR-0001 Decisions are recorded as ADRs in `docs/decisions/`.
- ADR-0002 Use documented library approaches only, verified against current docs.
- ADR-0003 (superseded by ADR-0019) Two-branch fork model.
- ADR-0004 Keep MySQL through Drizzle (Postgres considered and rejected).
- ADR-0005 i18n with typed i18next keys; Arabic is Modern Standard Arabic with Arabic-Indic digits (`ar_EG`, Day.js `ar`, `Intl` `ar-SA-u-ca-gregory-nu-arab`); text first, RTL later; maintenance in `docs/i18n-maintenance.md`.
- ADR-0006 The app's own login on every page and API, deny by default (`lib/access.ts`, `proxy.ts`); the Dify end-user id is the signed-in email set server-side; landing page `/apps`; no LDAP or roles yet; maintenance and known limits in `docs/auth-gate.md` and the ADR (the `/api/users/*` gap is listed in the ADR only).
- ADR-0007 The Ant Design / Ant Design X look stays as upstream has it (in force on this line; superseded only on `fork/overhaul`).
- ADR-0013 `@ant-design/cssinjs` stays pinned to the range `antd` depends on (one copy, or `AntdRegistry` extracts no first-paint styles); re-align it on every antd bump (`pnpm why @ant-design/cssinjs` must show one version).
- ADR-0015 Decisions are MADR ADRs in `docs/decisions/`; session state goes to handoff documents; this file stays short.
- ADR-0019 Two product lines: `fork/main` (this line: upstream + line-level mods, merges `main`) and `fork/overhaul` (the frontend overhaul, cherry-pick only); never merged into each other.

## Where things are

- i18n: locales in `locales/{en,zh,ar}/translation.json`, typed keys in `types/i18next.d.ts`, languages in `i18next.config.ts` and `libs/i18n.ts`, locale wiring in `libs/antd-locale.ts` and `hooks/use-html-lang.ts`, dates in `libs/format-date.ts`. The language switcher (`components/chat/i18n-switcher`) sits in the header's right icon group, order `language · theme · GitHub · account`, on admin, chat and `/apps`.
- Auth: classification in `lib/access.ts`, enforcement in `proxy.ts` and inside every `app/api/client/*` handler, the server-side Dify user in `lib/session-user.ts`; log out lives in the account menu (`components/auth/account-menu.tsx`).
- Specs and plans: `docs/superpowers/specs/`, `docs/superpowers/plans/` (upstream's own May 2026 records are inherited history); handoffs go to `docs/superpowers/handoffs/`.

## Local testing

### Docker stack (the real check before merging)

`docker-compose.local.yml` (project `dify-app-hub-main-local`) builds the image from the checkout and runs it with its own MySQL on `http://127.0.0.1:5310`, settings from `.env`. Use `127.0.0.1`, not `localhost`: the overhaul folder's stack serves `localhost:5300`, and cookies are not isolated by port (RFC 6265 §8.5), so the two sign-ins would overwrite each other's session cookie under one host name. `NEXTAUTH_URL` in this folder's `.env` is `http://127.0.0.1:5310`. Rebuild from the branch under test:

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml up -d --build app   # ~2 min, 80 s of it is next build
```

Take the old app container down first: this WSL machine has ~5 GB RAM and builds were killed otherwise. MySQL and its volume stay up, so the admin login and data survive. If Claude Code kills a build for memory, do not restart it unprompted. The user verifies in the browser; report the curl checks (`/api/health` 200, `/apps` signed out → 307 `/login?callbackUrl=%2Fapps`, `/api/client/apps` → 401, and `curl -s 127.0.0.1:5310/login | grep -c 'id="antd-cssinjs"'` → 1, ADR-0013; the same paths on `127.0.0.1:5310`). Never build both folders' images at the same time.

### Quick dev loop (no image build)

```bash
docker compose -f docker-compose.local.yml stop app   # frees port 5310; MySQL keeps running
pnpm dev                                              # http://127.0.0.1:5310, hot reload
```

MySQL is published on `127.0.0.1:3316` only, and the git-ignored `.env.development.local` overrides `DATABASE_URL` to point there for `next dev` (Next's load order: `.env.development.local` over `.env`; Docker builds never read it). Port 5310 is kept so `NEXTAUTH_URL` and the session cookie keep working; the `dev` script's `PORT=5310` is this line's one edit to upstream's `package.json` line (upstream uses 5300), an expected conflict if upstream ever changes that line. Schema changes need `env $(grep DATABASE_URL .env.development.local) pnpm db:migrate` by hand; only the container's entrypoint runs migrations automatically. Dev mode skips `next build`, the standalone server and the entrypoint, so still do one Docker rebuild before merging.

Without Chrome MCP tools, browser evidence can be produced with the headless Chromium in `~/.cache/ms-playwright/` against a throwaway stack (own MySQL, admin created through `POST /api/init`, fake Dify API) — never against the user's instance or real Dify server.

## Open follow-ups

- Delete merged branches (`i18n/app-ui`, `i18n/arabic`, `auth/login-for-all`, `fix/language-switcher-placement`).
- Auth: the `/api/users/*` revoked-session gap (ADR-0006); `app/(user)/layout.tsx` renders children for one frame when unauthenticated (gate on `isLoading || !isAuthorized`); `goAuthorize` in `hooks/use-auth.ts` is unused; the proxy test relies on the undocumented `x-middleware-next` header; spec §3 still shows `?? null` for `userId`.
- i18n: user review of the Arabic wording (countdown plurals, terminology); RTL layout; translation sub-projects 2 and 3; Ant Design X ships no Arabic strings (its built-in labels stay English/Chinese).
- Later steps the user has named: LDAP login, user groups / roles and permissions, an account-menu "change password".

## Next.js bundled docs

The block below is managed by `next dev` (see `node_modules/next/dist/docs/01-app/02-guides/ai-agents.md`). It lives here rather than in upstream's `AGENTS.md` so that file stays identical to upstream; Next leaves `AGENTS.md` alone while this file holds the block. Keep it, and read the bundled docs it points to before using a Next.js API.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- antd-cli setup start -->

## Ant Design CLI Skill

Use the installed Ant Design skill at `.claude/skills/antd/SKILL.md` before working on Ant Design code in this repository.

The skill teaches agents when and how to call `@ant-design/cli` commands such as `antd info`, `antd doc`, `antd demo`, `antd token`, `antd semantic`, and `antd changelog`.

<!-- antd-cli setup end -->
