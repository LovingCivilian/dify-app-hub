# AGENTS.md — AI App Hub (`fork/overhaul`)

The guide for every coding agent working on this line; Claude Code reads it through `CLAUDE.md`'s `@AGENTS.md` import. The repository started as a fork of `lexmin0412/dify-app-hub`; this line is our own and takes nothing from upstream (ADR-0022, note of 2026-10-12). Decisions are Architecture Decision Records in `docs/decisions/` (index: `docs/decisions/README.md`) — read the accepted ones for an area before changing it.

## Branch model (ADR-0019: two product lines)

- **`fork/overhaul` is this product line** (the antd 6 / Ant Design X rebuild, now the provider-agnostic AI App Hub). Feature branches start from `fork/overhaul`; PRs target it: `gh pr create -R LovingCivilian/dify-app-hub --base fork/overhaul …`, `gh pr merge <n> -R LovingCivilian/dify-app-hub --merge` (merge commits, history kept). Stack a branch on another only when it needs unmerged work. Branch names follow the Conventional Branch spec: `<type>/<description>` with this line's commit types `feat/`, `fix/`, `chore/` and `docs/`, in lowercase letters, digits and single hyphens (`feat/backend-b2-accounts`). A merged branch is deleted on GitHub and locally. `gh pr merge <n> -R LovingCivilian/dify-app-hub --merge --delete-branch` deletes only the GitHub branch (with `-R`, `gh` leaves the local checkout alone; seen on 2026-10-08), so `git branch -d <name>` always follows. Without `gh`, it is `git push origin --delete <name>` and `git branch -d <name>`. The merge commit keeps the branch's commits in the base's history, and the PR's **Restore branch** brings it back (ADR-0019 note of 2026-10-08).
- `fork/main` and `main` belong to the other product line, which lives in `~/repos/dify-app-hub-main` with its own guide. Never merge `fork/overhaul` into `fork/main`, and never bring anything from `main`, `fork/main` or upstream into this line.
- The GitHub default branch is `fork/main`.
- Local folders: each line has its own folder on this machine, a git worktree of the same repository. This line lives in `~/repos/dify-app-hub` (the main worktree). Start the agent in the folder of the line you work on. Git refuses to check out a branch in both folders. Each folder has its own git-ignored `.env`, `.env.development.local` and `node_modules`, and its own Docker stack, so nothing in one folder touches the other.

## How to work here

- Documented, standard approaches only — no custom mechanisms or workarounds (ADR-0002). Check the library's current docs before using an API, even a familiar one; when a wanted behaviour has no documented way, say so instead of hacking around it. The owner asks "does this follow docs?" and expects a per-piece answer with sources.
- Looking things up: Context7 first. When its snippets are shallow or a page needs a real browser, crawl4ai is installed for the user with pipx, outside the repository (per machine, on `PATH` from `~/.local/bin`): `crwl <url> -o markdown --bypass-cache` prints the page as markdown (`crawl4ai-doctor` is its health check); a plain fetch is fine for plain pages. For architectural decisions the docs leave open, look at how two or three well-known, well-architected projects on the same stack do it (Context7 indexes repositories; crawl4ai for a specific file) and cite them beside the docs; the docs still win on what a library supports.
- The line is our own (ADR-0022): backend and frontend follow their stack's current documentation. Backend conventions: ADR-0023 (one route per Dify operation, the typed client, the envelope, the Data Access Layer with the verified actor, Server Actions returning `ActionResult`), ADR-0024 (roles, the rank map, the admin gates in the layout, the pages, the actions and the DAL), ADR-0025 (zod). The endpoint map the routes implement is `docs/dify-service-api-1.17.1.md`.
- Decisions (ADR-0015): a decision that changes a pattern, adds a dependency or reverses a plan gets an ADR in the same PR (the `adr-skill`). A handoff document is written only when the owner asks for one (saved under `docs/superpowers/handoffs/`). Work that spans sessions hands off through its spec's progress section instead (the provider hub: §0 of `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md`): before a session stops, that section, the running record and the pushed branch hold everything the next session needs. This file holds rules, commands and a folder-level layout, under 200 lines: status belongs in specs and plans, follow-ups in GitHub issues, decisions in ADRs.
- Database migrations (Drizzle, ADR-0031): change `db/schema/*.ts`, run `pnpm db:generate --name <name>` (`--custom` for a data migration), read the generated SQL in `db/migrations/` before committing it, and never run `drizzle-kit push`, which changes the database without a reviewable migration. The container's entrypoint applies migrations; `next dev` does not (see "Quick dev loop").
- Node is the version in `.nvmrc` (22, the same as the Docker image); `nvm use` picks it up.
- Before a commit: `pnpm exec next typegen && pnpm exec tsc --noEmit` (`RouteContext` and `PageProps` are generated types: a fresh checkout fails tsc without typegen, and CI runs no tsc), `pnpm exec oxlint <files>`, `pnpm exec oxfmt --check <files>`, `pnpm test` (vitest, node environment — no DOM tests; layout changes are verified by the e2e suite and the browser), and `pnpm test:db` when the schema or the data layer changed (a live PostgreSQL, ADR-0031). lint-staged runs oxfmt/oxlint on commit.
- Commits: conventional (`feat|fix|docs|chore(scope): …`), in English.
- PR descriptions follow `.github/PULL_REQUEST_TEMPLATE.md` (Overview / Changes table / Testing / Related Issue), in English, and name the ADRs they implement.
- `.env` and `.env*.local` are git-ignored and never committed; never print their values. The owner's email is not sent to any service other than this app.
- Frontend work follows `docs/frontend-conventions.md` (charter: `docs/superpowers/specs/2026-10-04-frontend-overhaul-charter.md`) and `.claude/rules/frontend.md`. Before touching a component, check antd's and Ant Design X's current docs: antd through its `antd` skill and CLI (`antd doc`, `antd demo`, `antd token`), Ant Design X through its skills (`use-x-chat`, `x-chat-provider`, `x-request`, `x-markdown`, `x-components`). The skills are installed globally for every agent with the `skills` CLI (`npx skills add … -g`).

## Layout

- `app/`: the route groups `(auth)` (login, forgot and reset password), `(admin)` (app, user and group management, settings) and `(user)` (apps, chat), each with its own layout; `(admin)` and `(user)` gate on the server (ADR-0018), and server pages load the first paint and hand trimmed props to client components (ADR-0020). `app/api/` holds only the routes `__tests__/api-routes.test.ts` pins.
- `components/`: client components by area (`providers/` with the single client provider stack, `shell/`, `apps/`, `admin/`, `auth/`, `chat/` (the Dify chat until Part 3), `shared-chat/` (the AG-UI chat on the hub's store, ADR-0033), `provider-ui/`, the client provider registry: labels, fallback icons, form sections and `ProviderChat`, ADR-0032); token-only CSS Modules, and antd's `reset.css` is the only global CSS (ADR-0021).
- `lib/`: server-side modules: `env.ts` (ADR-0025), `auth/` (ADR-0006, ADR-0024), `data/` (the data access layer, ADR-0024), `providers/` (the provider ids, document schemas, server registry and route guard, with `dify/` as the Dify layer and `agui/` as the AG-UI one; ADR-0023, ADR-0032, ADR-0034), `chat/` (the shared chat's server side: turns, the run session, the routes' guard and the purge; ADR-0033), `http/` (the response envelope and request helpers), `settings/` (ADR-0030) and `directory/` (ADR-0029).
- `db/`: the Drizzle schema and migrations on PostgreSQL 18 (ADR-0031).
- Tests: `__tests__/` (Vitest; `__tests__/db/` and `__tests__/ldap/` are projects of their own) and `e2e/` (Playwright with a stub Dify API, ADR-0010).
- `docs/`: `decisions/` (the ADRs and their index), `superpowers/` (specs, plans and their research), the operator guides (`auth-gate.md`, `ldap.md`, `settings.md`, `i18n-maintenance.md`), `frontend-conventions.md` (frontend rules and status) and `dify-service-api-1.17.1.md` (the endpoint map the Dify routes implement).

## Backlog

Follow-ups are GitHub issues labelled `fork/overhaul`: `gh issue list -R LovingCivilian/dify-app-hub --label fork/overhaul`.

## Local testing

### Docker stack (the real check before merging)

`docker-compose.local.yml` (project `ai-app-hub-local`) builds the image from the checkout and runs it with PostgreSQL 18 (service `postgres`, volume `pgdata`, ADR-0031) on `http://localhost:5300`, settings from `.env` (`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `DATABASE_URL=postgres://…@postgres:5432/…`). The `fork/main` folder runs its own stack beside it (project `dify-app-hub-main-local` on `127.0.0.1:5310`, MySQL `127.0.0.1:3316`; that line stays on MySQL); never build both folders' images at the same time. Rebuild from the branch under test:

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml up -d --build app   # ~2 min, 80 s of it is next build
```

Take the old app container down first: this WSL machine has ~5 GB RAM and builds were killed otherwise. PostgreSQL and its volume stay up, so the admin login and data survive. If a build is killed for memory, do not restart it unprompted. The owner verifies in the browser; report the curl checks (`/api/health` 200, `/apps` signed out → 307 `/login?callbackUrl=%2Fapps`, `/api/dify/<an app id>/parameters` signed out → 401 with `{"code":"unauthorized",…}`, `/api/client/apps` signed out → the same 401 (the proxy denies every unknown `/api/*` path before routing, so the deleted route is not a 404 to a signed-out curl), `/api/users` and `/api/init/status` signed out → the same 401 envelope (deny by default; both handlers are deleted), `/api/branding/logo` signed out → 404 `{"code":"not_found",…}` while `BRANDING_MODE` is unset (the brand routes are public, ADR-0030; a 401 would mean the proxy's public list lost them), `POST /api/apps/<an AG-UI app id>/runs`, `GET /api/apps/<an AG-UI app id>/conversations` and `POST /api/apps/<an AG-UI app id>/conversations/<any UUID>/runs/<any UUID>/stop` signed out → the same 401 envelope (ADR-0033), `/init` on the set-up local database → 307 to `/login`, `curl -s localhost:5300/login | grep -c 'href="/forgot-password"'` → 0 while SMTP is off (the login page hides the link, ADR-0024), and `curl -s localhost:5300/login | grep -c 'id="antd-cssinjs"'` → 1). After a change to the database layer or a compose file, also: the app's log shows `Database migration complete` once and `docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app` prints `0`; `/init` signed out answers 200 on an empty volume until the owner exists, then 307 to `/login`; after `docker compose -f docker-compose.local.yml restart postgres`, `/api/health` answers 200 again (the pool's error listener).

Deployment (owner, 2026-10-07): production is a dedicated 16 GB Docker server running the hub and Dify on one Docker network. Give the hub container a memory limit (512 MB–1 GB); uploads are its memory spike, because Next's proxy buffers request bodies up to 10 MB (`proxyClientMaxBodySize`). Scale out to several hub containers before growing one. Before running several, move the migrations into a one-shot `migrate` service (ADR-0031: `migrate()` takes no lock).

### Quick dev loop (no image build)

```bash
docker compose -f docker-compose.local.yml stop app   # frees port 5300; PostgreSQL keeps running
pnpm dev                                              # http://localhost:5300, hot reload
```

PostgreSQL is published on `127.0.0.1:5432` only, and the git-ignored `.env.development.local` overrides `DATABASE_URL` to `postgres://…@127.0.0.1:5432/…` for `next dev` (Next's load order: `.env.development.local` over `.env`; Docker builds never read it). Port 5300 is kept so `NEXTAUTH_URL` and the session cookie keep working. Schema changes need `env $(grep DATABASE_URL .env.development.local) pnpm db:migrate` by hand; only the container's entrypoint runs migrations automatically. Dev mode skips `next build`, the standalone server and the entrypoint, so still do one Docker rebuild before merging. Next 16 allows one `next dev` per checkout, so stop `pnpm dev` (5300) before `pnpm test:e2e` and vice versa (the second one fails loudly with "Another next dev server is already running").

### LDAP test directories (ADR-0029)

`pnpm test:ldap` runs the directory suite (a Vitest project of its own) against two test directories in `docker-compose.e2e.yml` (profile `ldap`: `ldap-ad` smblds on 127.0.0.1:10636/10389, `ldap-openldap` on 13890/16360); it starts and stops them. `pnpm test:e2e` starts `ldap-ad` with PostgreSQL. The test CA is committed in `e2e/fixtures/ldap/tls/` (`generate.sh` remakes it).

### Database test project (ADR-0031)

`pnpm test:db` runs `__tests__/db/*.db.test.ts`, a Vitest project of its own like `pnpm test:ldap`, against the e2e compose's `postgres` on 127.0.0.1:5433, in its own database `hub_dal`, which its global setup drops, recreates and migrates; afterwards it stops and removes the e2e `postgres` container, whose tmpfs database goes with it. Run it when the schema or the data layer changes, never beside `pnpm test:e2e`, which uses the same server.

### e2e suite (ADR-0010)

`pnpm test:e2e` runs the Playwright suite (three projects: `desktop-light`, `desktop-dark`, `mobile-light`). It has its own environment, `.env.e2e` (test-only values, committed), and never touches the `.env` database or port 5300: a throwaway PostgreSQL from `docker-compose.e2e.yml` on 127.0.0.1:5433 (project `ai-app-hub-e2e`; `docker compose -f docker-compose.e2e.yml --profile ldap down -v` resets it and the test directories (a plain `down` leaves `ldap-ad` running); `next.config.ts` puts Next's dev indicator at the bottom-right, `devIndicators.position`, so it does not cover the sidebar trigger, ADR-0028), a stub Dify API (`e2e/fixtures/stub/`, port 5399, five apps by path prefix, scenarios chosen by the query text) and the app under `next dev` on 127.0.0.1:5301, with a 4 GB heap cap in its `NODE_OPTIONS` (without one, `next dev` restarts its server near its memory limit mid-run and the page under test reloads; ADR-0010 note of 2026-10-14). Screenshots go to the git-ignored `e2e/screenshots/`; the HTML report opens with `pnpm test:e2e:report`. Browser evidence comes from this suite, never from the owner's instance or a real Dify server.

## Next.js bundled docs

The block below is managed by `next dev` (`node_modules/next/dist/docs/01-app/02-guides/ai-agents.md`). Keep it, and read the bundled docs it points to before using a Next.js API.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
