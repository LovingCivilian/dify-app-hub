# Handoff — frontend foundation (sub-projects 0 and 1) → next session

Date: 2026-10-04 · Branch: `feat/frontend-foundation` (24 commits on `fork/main` @ 904121b9) · Written by the executing session for a fresh agent.

## What the next session is for

1. Run the merge gate and merge the foundation PR into `fork/main` (section "Merge gate").
2. Open the small follow-up PR the user approved: project-level `adr-skill`, `docs/decisions/` bootstrap, migration of `CLAUDE.md` → "Decisions taken" into MADR records, a scoped `.claude/rules/frontend.md` (section "Follow-up PR").
3. Start sub-project 2 (chat) with `superpowers:brainstorming` → spec → `superpowers:writing-plans`, from `fork/main` once the foundation is on it (section "Sub-project 2 inputs").

## State of the work

- All 12 plan tasks are implemented, each with a task review and, where needed, a fix round; a whole-branch review on the most capable model returned "ready with fixes", the fix wave landed, and its scoped re-review is clean. Nothing is parked.
- Verified on the final tree: `pnpm exec tsc --noEmit`, `pnpm exec oxlint`, `pnpm exec oxfmt --check`, vitest 127/127, `pnpm test:e2e` 49 passed / 3 skipped (the 3 skips are by design), antd lint 74 findings / 1 error (baseline 75 / 1), production first paint verified (`<style id="antd-cssinjs">` present after the `@ant-design/cssinjs` fix).
- Not run this session, on the user's instruction (dev loop only): the Docker image rebuild. It is the remaining merge gate.
- The user's `pnpm dev` on port 5300 was stopped during the session (Next 16 allows one `next dev` per checkout; the e2e suite needs 5301) and restarted at the end, serving this branch.

## Where things are (read these, do not duplicate them)

- Charter: `docs/superpowers/specs/2026-10-04-frontend-overhaul-charter.md` (§4 conventions are binding; §5 delivery plan).
- Foundation spec: `docs/superpowers/specs/2026-10-04-frontend-foundation-design.md` — diverges from what was built in four places the approved plan resolved (see "Spec drift"); update it or note the drift before sub-project 2 relies on it.
- Plan executed: `docs/superpowers/plans/2026-10-04-frontend-foundation.md`.
- Working reference for frontend code: `docs/frontend-conventions.md` (conventions, lint baseline with re-check commands, status incl. stub scope and the overlay rule).
- Project rules and structure: `CLAUDE.md` → "Decisions taken → Frontend overhaul", "Local testing → e2e suite / Quick dev loop", "Open follow-ups".
- Skills in the repo: `.claude/skills/{antd,x-components,use-x-chat,x-chat-provider,x-request,x-markdown}` — read the matching one before touching a component.
- Commit history on the branch: conventional messages; every deviation from the plan has its reason in the commit body.

## Decisions taken during execution (why, not what — the code shows what)

- Per-page server layouts stay under `app/(auth)/` for `redirectSignedInUser()`; a server group layout has no pathname, and `/reset-password` must stay reachable signed in.
- Shells are viewport-bound (`height: 100vh`, `Layout.Content` scrolls) so the chat keeps its bounded sidebar + messages view; this is what the deleted `PageLayout` did.
- Header dropdowns use `trigger={['click']}` (antd's hover trigger is not keyboard-openable and antd warns against it on touch); the theme trigger is named "Theme" (`system.theme`), the mobile nav trigger "Menu" (`system.menu`, new key in en/zh/ar).
- `@ant-design/cssinjs` was raised across a major (^1.24 → ^2.1.2) because antd's Next.js guide requires the app's copy to match the one inside antd; the old pin made `AntdRegistry` extract nothing, so production first paint on `fork/main` is unstyled today.
- The stub Dify API has a test-only `POST /__e2e/reset` because the chat has a pre-existing race: a message sent while a reopened conversation's history is loading is wiped when the history arrives. Sub-project 2 must fix the race; the reset stays until then.
- The fork's `--theme-*` and the shadcn variables are aliases of `--ant-*` tokens on `.ant-app`; they do not reach antd overlays (portals), so sub-projects 2–3 must not use legacy classes inside Modal/Drawer/Dropdown content.
- Deferred on purpose (old page bodies, exempt until sub-projects 2–4): double content padding, clipped admin table on mobile, stray "0" on tag-less app cards, login logo image warning, `AuthCard`'s unused `title` prop, the white canvas before the shell paints in dark mode (gate design question, see below), `100vh` vs `100dvh`, two `@ant-design/icons` majors in the tree.

## Merge gate (before merging the PR)

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml up -d --build app      # ~2 min; watch memory on the 5 GB machine
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5300/api/health            # 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:5300/apps  # 307 → /login?callbackUrl=%2Fapps
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5300/api/client/apps       # 401
curl -s http://localhost:5300/login | grep -c 'id="antd-cssinjs"'                   # 1 (first paint styled)
```

Then `gh pr merge <n> -R LovingCivilian/dify-app-hub --merge`, delete the branch, and `git checkout fork/main && git pull`.

## Follow-up PR (approved by the user on 2026-10-04)

- `npx skills add skillrecordings/adr-skill` at project level (own commit; the user-level copy is already installed at `~/.agents/skills/adr-skill`).
- `node ~/.agents/skills/adr-skill/scripts/bootstrap_adr.js --dir docs/decisions` (MADR 4.0 index + first ADR), then one ADR per entry of `CLAUDE.md` → "Decisions taken" (i18n, login for everyone, infrastructure, frontend overhaul), leaving one-line pointers in `CLAUDE.md`.
- `.claude/rules/frontend.md` with `paths: ["app/**", "components/**"]` pointing at `docs/frontend-conventions.md` and the skills; keep `CLAUDE.md` under 200 lines.
- End-of-session handoffs: the user-level `handoff` skill (`/handoff "<purpose>"`), saved under `docs/superpowers/handoffs/`.

## Sub-project 2 inputs (chat)

Carry these into the brainstorm and spec:

- Fix the late-history race (disable the sender until history loads, or drop late history responses) and add an e2e test that reopens a conversation and sends at once; then the stub reset can go.
- Extend `e2e/fixtures/dify-stub.ts`: agent (`agent_thought`/`agent_message`), chatflow (`workflow_*`, `node_*`), HITL, error and file streams from Dify's OpenAPI; per-user scoping; body-parse hardening.
- Charter §4.4 component mapping (Conversations, Bubble.List, Sender, Actions, ThoughtChain, Sources, XMarkdown spike); `XProvider` gets no X locale today (X ships en_US/zh_CN only, no Arabic).
- Gate design (also affects sub-project 3): `(admin)` uses `AuthGuard`, `(user)` uses `useAuth`; neither carries `callbackUrl`, both hide the shell until the session resolves, so shells never server-render and dark-mode users see a white canvas first. Options: server-side session check in the group layouts (next-auth `getServerSession` + `redirect`, the pattern `redirectSignedInUser()` already uses) or render the client gate inside the shell.
- Providers e2e test 2 counts `css-var-*` classes on the chat page after the sender mounts; keep it green when adding X components (one `XProvider` only).

## Spec drift to reconcile (doc-only)

Spec says / branch has: `ThemeModeProvider` moved to `components/providers/` / `ThemeContextProvider` stays in `lib/theme`; an `I18nProvider` component / i18n by module import plus `useHtmlLang()` in the providers; `(user)` layout renders `UserShell` / the apps page and chat layouts render it (the chat passes header slots); shadcn blocks "stay for now" / aliased with the `--theme-*` variables; stub covers the full stream catalogue / plain chat only.

## Suggested skills for the next session

`superpowers:brainstorming` (sub-project 2 design), `superpowers:writing-plans`, `superpowers:subagent-driven-development` (execution), `antd` and `x-components` / `use-x-chat` / `x-chat-provider` / `x-request` / `x-markdown` (repo skills), `adr-skill` (follow-up PR), `handoff` (end of session). Documentation lookups: Context7 (`npx ctx7@latest …`), Next's bundled docs under `node_modules/next/dist/docs/`, crawl4ai in `.venv` for pages.

## Environment notes

- e2e: `pnpm test:e2e` (ports 5301 / 3307 / 5399, `.env.e2e`, test-only values); stop `pnpm dev` first (one `next dev` per checkout). The throwaway MySQL container `dify-app-hub-e2e-mysql` may still be up; `docker compose -f docker-compose.e2e.yml down` resets it.
- Cold Turbopack compiles on this machine take 5–20 s per route (up to ~66 s for the first page); Playwright `timeout` is 120 s, `expect.timeout` 30 s, setup 180 s.
- No secrets in this document; `.env` and `.env*.local` are never read or printed.
