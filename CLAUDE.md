# CLAUDE.md — fork conventions and pointers

This is a personal fork of [lexmin0412/dify-app-hub](https://github.com/lexmin0412/dify-app-hub) (`upstream`), hosted at `LovingCivilian/dify-app-hub` (`origin`). `AGENTS.md` is upstream's and still applies (database migrations, `.cii-assessment.md` before commits, no dev server needed for verification, debugging rules). This file holds the fork's working rules and pointers; the decisions themselves are Architecture Decision Records in `docs/decisions/` (index: `docs/decisions/README.md`) — read the accepted ones for an area before changing it.

## Branch model (ADR-0019: two product lines)

- `main` is an untouched mirror of `upstream/main`. Never commit to it.
- **This file describes `fork/overhaul`**, the frontend-overhaul product (antd 6 / Ant Design X rebuild): it started at `11c3fb3d` and holds sub-projects 0–2 onward. Overhaul feature branches start from `fork/overhaul`; PRs target it: `gh pr create -R LovingCivilian/dify-app-hub --base fork/overhaul …`, `gh pr merge <n> -R LovingCivilian/dify-app-hub --merge` (merge commits, history kept). Stack a branch on another only when it needs unmerged work. Merged branches may be deleted afterwards.
- `fork/main` is the other product: upstream + the line-level fork modifications only (i18n, login for everyone, header fixes), reset to `3d8e628e` on 2026-10-06. It keeps its own `CLAUDE.md`, the merge-friendly rules and the old chat; PRs #7 and #8 belong there. Never merge `fork/overhaul` into it.
- Updates: `fork/main` merges `main` after an upstream sync (`git fetch upstream && git checkout main && git merge --ff-only upstream/main`, then `git checkout fork/main && git merge main`). `fork/overhaul` takes no routine merges from `main` or `fork/main`; wanted commits are picked with `git cherry-pick -x`, frontend fixes are re-implemented in the overhaul's structure (ADR-0009).
- The GitHub default branch is `fork/main`.

## How to work here

- Documented, standard approaches only — no custom mechanisms or workarounds (ADR-0002). Check the library's current docs through Context7 (`ctx7`) before using an API, even a familiar one; when a wanted behaviour has no documented way, say so instead of hacking around it. The user asks "does this follow docs?" and expects a per-piece answer with sources.
- Looking things up: Context7 first (`npx ctx7@latest library …` then `docs …`, at most three commands per question). When its snippets are shallow or a page needs a real browser, crawl4ai is installed in the repo's `.venv`: `.venv/bin/crwl <url> -o markdown --bypass-cache` prints the page as markdown (`crawl4ai-doctor` is its health check). WebFetch is fine for plain pages. The venv is per machine (no `pyproject.toml`), git-ignored by its own `.gitignore` and excluded from the Docker build context by `.dockerignore`.
- Backend files stay upstream-shaped until the backend rework decides otherwise (line-level edits inside upstream files, new behaviour in fork-owned files, upstream file paths never moved), which keeps cherry-picks from upstream cheap. The frontend (`app/` pages, `components/`, `hooks/`, styles) is fork-owned (ADR-0009).
- Process: brainstorm first (a short in-chat design for bounded changes, a spec + plan under `docs/superpowers/` for bigger ones), get an explicit yes, then implement test-first. Larger features run subagent-driven with per-task review — the user wants "as robust as possible, the more eyes the better".
- Decisions and handoffs (ADR-0015): a decision that changes a pattern, adds a dependency or reverses a plan gets an ADR in the same PR (`/adr-skill`, project copy in `.claude/skills/adr-skill`); a session ends with a handoff under `docs/superpowers/handoffs/` (user-level `handoff` skill, give it the path). Keep this file to rules and pointers, under 200 lines.
- Before a commit: `pnpm exec tsc --noEmit`, `pnpm exec oxlint <files>`, `pnpm exec oxfmt --check <files>`, `pnpm test` (vitest, node environment — no DOM tests; layout changes are verified by the e2e suite and the browser). lint-staged runs oxfmt/oxlint on commit.
- Commits: conventional (`feat|fix|docs|chore(scope): …`), English, with the attribution trailers the session supplies (`Co-Authored-By` and `Claude-Session` — the user chose to keep the session link). Commit and push only when asked.
- PR descriptions follow `.github/PULL_REQUEST_TEMPLATE.md` (Overview / Changes table / Testing / Related Issue), in English, and name the ADRs they implement.
- `.env` and `.env*.local` are git-ignored and never committed; never print their values. The user's email is not sent to any service other than this app.
- Frontend work follows `docs/frontend-conventions.md` (charter: `docs/superpowers/specs/2026-10-04-frontend-overhaul-charter.md`) and `.claude/rules/frontend.md`. Before touching a component, read the matching skill in `.claude/skills/` (`antd`, `x-components`, `use-x-chat`, `x-chat-provider`, `x-request`, `x-markdown`).

## Decisions (one line each; the ADR has the why, the alternatives and the verification)

- ADR-0002 Use documented library approaches only, verified against current docs.
- ADR-0003 (superseded by ADR-0019) Two-branch fork model.
- ADR-0004 Keep MySQL through Drizzle (Postgres considered and rejected).
- ADR-0005 i18n with typed i18next keys; Arabic is Modern Standard Arabic with Arabic-Indic digits (`ar_EG`, Day.js `ar`, `Intl` `ar-SA-u-ca-gregory-nu-arab`); RTL is a separate follow-up; maintenance in `docs/i18n-maintenance.md`.
- ADR-0006 The app's own login on every page and API, deny by default (`lib/access.ts`, `proxy.ts`); the Dify end-user id is the signed-in email set server-side; landing page `/apps`; no LDAP or roles yet; maintenance and known limits in `docs/auth-gate.md`.
- ADR-0007 (superseded) The antd/X look was left as upstream had it.
- ADR-0008 Rebuild the frontend on antd 6 / Ant Design X 2 per their docs: one `XProvider` + `App` at the root, route groups, token-only CSS Modules, sub-projects 0–4 (0, 1 and 2 done).
- ADR-0009 The frontend is fork-owned; upstream syncs take the backend only.
- ADR-0010 Playwright e2e against `next dev`, a throwaway MySQL and a stub Dify API; no test switches in product code.
- ADR-0011 Shells are viewport-bound (`height: 100vh` then `100dvh`, the content region scrolls).
- ADR-0012 Legacy `--theme-*`/shadcn variables are aliases of `--ant-*` tokens on `.ant-app` until sub-project 4; they do not reach antd overlays.
- ADR-0013 `@ant-design/cssinjs` stays pinned to the version inside `antd` (one copy, or `AntdRegistry` extracts no first-paint styles).
- ADR-0014 Header controls are click-triggered and named through i18next; legacy classes stay out of overlays.
- ADR-0015 Decisions are MADR ADRs in `docs/decisions/`; session state goes to handoff documents; this file stays short.
- ADR-0016 Store the theme preference in cookies so the server renders the right scheme (`theme-mode` + `theme`, read in `app/layout.tsx`); the UI language follows the same pattern (`i18next` cookie, ADR-0005 note).
- ADR-0017 Build the chat on Ant Design X with a provider-centred data layer: one `DifyChatProvider`, `useXChat` per conversation key (history through `defaultMessages`, early sends queued), X components through `contentRender`. Markdown verdict: `XMarkdown` adopted (spike 27/27), the react-markdown pipeline removed, `react-syntax-highlighter` kept for the dark code style.
- ADR-0018 Gate route groups on the server and let the proxy gate navigations: `requireSessionUser()` in the `(user)` and `(admin)` layouts, the client gates deleted, the shells server-render.
- ADR-0019 Two product lines: `fork/main` (upstream + line-level mods, merges `main`) and `fork/overhaul` (this overhaul, cherry-pick only); never merged into each other; ADR numbers after 0019 are per line (`docs/decisions/README.md`).

## Where things are

- Structure after sub-project 2: `components/providers/app-providers.tsx` (the single client provider stack: `I18nextProvider` → `InitialLanguage` → `SessionProvider` → `ThemeContextProvider` → `XProvider` → `App`, inside `AntdRegistry` in `app/layout.tsx`, which reads the session and the theme and language cookies); `components/shell/` (`app-header` with language, theme and account dropdowns, `admin-shell`, `user-shell`, `auth-card`, token-only CSS Modules); route groups `app/(auth)` (login, forgot-password, reset-password), `app/(admin)` (app-management, user-management), `app/(user)` (apps, chat), each with its own layout (`(user)` and `(admin)` gate on the server); `app/globals.css` holds the alias block.
- Chat (`/chat/[appId]`, every app mode, ADR-0017): `components/chat/chat-workspace.tsx` (app loader, mode switch) and `app-context.tsx`; `provider/` (`DifyChatProvider`, message model, history mapper, keys, fetch); `hooks/` (`use-dify-chat`, conversations, workflow run, upload, speech, TTS, suggestions); `chat-view/` (sider and mobile drawer, message list, footer, sender, inputs form); `message/` (`message-markdown.tsx` + `markdown/`, workflow logs, HITL form, files, sources, reasoning); `workflow-view/` (workflow and completion runners); `persistence/` (zustand stores for run data and think times).
- Specs and plans: `docs/superpowers/specs/`, `docs/superpowers/plans/` (upstream's own May 2026 records are inherited history). Conventions, lint baseline and status: `docs/frontend-conventions.md`. Latest handoff: `docs/superpowers/handoffs/2026-10-05-chat-on-ant-design-x-execution.md` (sub-project 2 executed, PR #15 open, owner verification list, rulings, follow-ups); previous: `2026-10-04-chat-on-ant-design-x-plan.md` (planning record), `2026-10-04-frontend-foundation.md`.
- Next frontend step: sub-project 3 (admin, app list, auth pages) needs its own spec and plan (brainstorming first); its inputs include `LucideIcon` in `app/(user)/apps/page.tsx` and antd's static `message`/`Modal` calls in the admin pages (antd lint). Sub-project 4 (Tailwind/Lucide/Radix and alias-block removal) follows. Sub-project 2 (chat): spec `docs/superpowers/specs/2026-10-04-chat-on-ant-design-x-design.md` (its deviations paragraph at the end), plan `docs/superpowers/plans/2026-10-04-chat-on-ant-design-x.md`. Research already recorded in the charter (do not redo): antd 6 exposes tokens as `--ant-*` CSS variables on `<App>`'s root; the X site ships `@ant-design/x-skill`; antd serves every docs page as Markdown (`https://ant.design/components/<name>.md`); ProComponents does not support antd 6; `antd-style` is not used.

## Local testing

### Docker stack (the real check before merging)

`docker-compose.local.yml` (project `dify-app-hub-local`) builds the image from the checkout and runs it with MySQL on `http://localhost:5300`, settings from `.env`. Rebuild from the branch under test:

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml up -d --build app   # ~2 min, 80 s of it is next build
```

Take the old app container down first: this WSL machine has ~5 GB RAM and builds were killed otherwise. MySQL and its volume stay up, so the admin login and data survive. If Claude Code kills a build for memory, do not restart it unprompted. The user verifies in the browser; report the curl checks (`/api/health` 200, `/apps` signed out → 307 `/login?callbackUrl=%2Fapps`, `/api/client/apps` → 401, and `curl -s localhost:5300/login | grep -c 'id="antd-cssinjs"'` → 1).

### Quick dev loop (no image build)

```bash
docker compose -f docker-compose.local.yml stop app   # frees port 5300; MySQL keeps running
pnpm dev                                              # http://localhost:5300, hot reload
```

MySQL is published on `127.0.0.1:3306` only, and the git-ignored `.env.development.local` overrides `DATABASE_URL` to point there for `next dev` (Next's load order: `.env.development.local` over `.env`; Docker builds never read it). Port 5300 is kept so `NEXTAUTH_URL` and the session cookie keep working. Schema changes need `env $(grep DATABASE_URL .env.development.local) pnpm db:migrate` by hand; only the container's entrypoint runs migrations automatically. Dev mode skips `next build`, the standalone server and the entrypoint, so still do one Docker rebuild before merging. Next 16 allows one `next dev` per checkout, so stop `pnpm dev` (5300) before `pnpm test:e2e` and vice versa (the second one fails loudly with "Another next dev server is already running").

### e2e suite (ADR-0010)

`pnpm test:e2e` runs the Playwright suite (three projects: `desktop-light`, `desktop-dark`, `mobile-light`). It has its own environment, `.env.e2e` (test-only values, committed), and never touches the `.env` database or port 5300: a throwaway MySQL from `docker-compose.e2e.yml` on 127.0.0.1:3307 (`docker compose -f docker-compose.e2e.yml down` resets it), a stub Dify API (`e2e/fixtures/stub/`, port 5399, five apps by path prefix, scenarios chosen by the query text) and the app under `next dev` on 127.0.0.1:5301. Screenshots go to the git-ignored `e2e/screenshots/`; the HTML report opens with `pnpm test:e2e:report`. Without Chrome MCP tools, browser evidence comes from this suite, never from the user's instance or a real Dify server.

## Open follow-ups

- Delete merged branches (`i18n/app-ui`, `i18n/arabic`, `auth/login-for-all`, `fix/language-switcher-placement`, the overhaul's merged doc and foundation branches).
- Auth: the `/api/users/*` revoked-session gap (ADR-0006); the proxy test relies on the undocumented `x-middleware-next` header; the server gate's limits (ADR-0018: no `callbackUrl` on the layout redirect, a token revoked mid-session is caught at the next hard load, the cookie is renewed only on tab focus or sign-in).
- i18n: user review of the Arabic wording (countdown plurals, terminology, the X pack `libs/x-locale-ar.ts`); RTL layout; translation for sub-project 3; a visitor without the language cookie gets one English paint (reading `Accept-Language` on the server would remove it).
- Frontend: old page bodies (double padding, clipped admin table on mobile, stray "0" tag, login logo image warning); two `@ant-design/icons` majors in the tree; chat: a workflow app that pauses for human input shows "Paused" without a form, the first Mermaid diagram draws blank under dev Strict Mode (ADR-0017).
- After sub-project 4, last (owner, 2026-10-06; not before): the backend rework on `fork/overhaul`, `docs/superpowers/specs/2026-10-05-backend-rework-brief.md` (supersede ADR-0009 for this line; admin Server Action checks, the `/api/users/*` gap, stop and human-input-form proxy routes, the `audio2text` type).
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
