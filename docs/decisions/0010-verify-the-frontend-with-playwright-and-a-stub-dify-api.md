---
status: accepted
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code sessions (harness implementation and reviews)
---

# Verify the frontend with Playwright against `next dev`, a throwaway MySQL and a stub Dify API

## Context and Problem Statement

The project had only vitest unit tests (node environment, no DOM). The overhaul changes layouts, providers and dark mode, which unit tests cannot see, and the owner verifies in a browser. A real Dify server cannot be part of a test run (credentials, cost, nondeterminism), and the developer's `.env` database must never be touched by tests. The Next.js Playwright guide documents `webServer` for starting the app under test.

## Decision Drivers

- No test switches in product code; the app must reach the fake backend through its normal configuration.
- Isolation from the developer's `.env`, database and Dify server.
- Deterministic runs on a 5 GB WSL machine with slow cold compiles.
- Documented Playwright usage only ([ADR-0002](0002-use-documented-library-approaches-only.md)).

## Considered Options

- Playwright with `webServer` running `next dev`, a compose MySQL on tmpfs, and a `node:http` stub Dify API seeded through the app's own `dify_apps` row.
- Playwright against the Docker image (`next start`) — too slow per run (2 min build) and no hot code.
- Mock the Dify client in product code behind an env flag — a test switch in product code.
- Headless Chromium scripts without a test runner (the earlier ad hoc repro method).

## Decision Outcome

Chosen option: the Playwright harness.

- `playwright.config.ts`: two `webServer`s — the stub (`e2e/fixtures/dify-stub.ts`, 127.0.0.1:5399) and `next dev -p 5301 -H 127.0.0.1` — both with `env` from `.env.e2e` (committed, test-only values; Next puts `process.env` above every `.env*` file, so the suite's `DATABASE_URL`/`NEXTAUTH_*` win). `globalSetup` starts `docker-compose.e2e.yml` (`mysql:8.4`, tmpfs, 127.0.0.1:3307) and runs `drizzle-kit migrate`. Readiness URL is `/api/auth/providers` because web servers start before `globalSetup` and `/api/health` returns 500 until MySQL is up.
- A `setup` project creates the admin through `POST /api/init`, inserts the stub app row (`apiBase` = stub URL) with `mysql2/promise`, signs in through the real login form and saves `storageState`; projects `desktop-light`, `desktop-dark` (`colorScheme`) and `mobile-light` (Pixel 7) depend on it.
- The stub answers the Dify endpoints the proxy forwards to with event shapes from Dify's OpenAPI (plain chat stream today; agent, chatflow, HITL, error and file streams arrive with the chat sub-project) and has a test-only `POST /__e2e/reset` that clears its state, used in `beforeEach` of the smoke spec because the chat has a pre-existing late-history race (sub-project 2 must fix it; the reset stays until then).
- Specs pin each plan's review-focus items with web-first, retrying assertions (`expect.poll`, `toHaveCSS`, `toBeVisible`); `networkidle` waits are not used. Screenshots go to git-ignored `e2e/screenshots/` for review in chat, not into git.

* Timeouts: `timeout` 120 s, `expect.timeout` 30 s, setup 180 s, because cold Turbopack compiles take 5–66 s on the owner's machine; `reuseExistingServer: !process.env.CI`; `workers: 1`.

### Consequences

- Good, because a fresh clone runs the whole stack with `pnpm test:e2e` and no secrets; the review screenshots come from the same run.
- Good, because the harness found real defects (unstyled production first paint, the chat race, a keyboard-unreachable header).
- Bad, because Next 16 allows one `next dev` per checkout: `pnpm dev` (5300) and `pnpm test:e2e` cannot run at the same time (fails loudly).
- Bad, because the stub is fork-maintained code that must track Dify's API; and the reset endpoint hides a product bug until sub-project 2.
- Bad, because `.env.e2e` holds a known admin password; the app binds 127.0.0.1 only, and the e2e tree is excluded from the Docker build context.

## Implementation Plan

- **Affected paths**: `playwright.config.ts`, `e2e/**` (fixtures, setup, specs), `docker-compose.e2e.yml`, `.env.e2e`, `vitest.config.ts` (excludes `e2e/**`), `.gitignore`, `.dockerignore`, `package.json` scripts `test:e2e`, `test:e2e:report`.
- **Dependencies**: `@playwright/test` (Chromium from `~/.cache/ms-playwright`), `tsx`, `mysql2`, Docker Compose.
- **Patterns to follow**: one spec per behaviour group; locators by role/placeholder/text; conditional skips via `test.skip(condition, reason)` or `test.step` + `step.skip`; signed-out tests via `test.describe` + `test.use({ storageState: { cookies: [], origins: [] } })`; new stub routes mirror Dify's OpenAPI shapes.
- **Patterns to avoid**: `waitForLoadState('networkidle')`; one-shot `evaluate` reads of computed styles; retries that mask bugs; test switches in product code; running `pnpm build` or a second `next dev` during a run.

### Verification

- [x] `pnpm test:e2e` from a cold stack: 49 passed / 3 skipped (PR #12).
- [x] Stub, MySQL and app bind 127.0.0.1 only; `.dockerignore` excludes `e2e/`, `playwright.config.ts`.
- [x] Sub-project 2 extends the stub (agent/chatflow/HITL/error/file streams, per-user scoping, body-parse hardening) and removes the need for the reset endpoint.

## More Information

Sources: foundation spec §2.3, plan Tasks 3–4 and 12, PR #12 Task 3/4/10/12 reviews, `CLAUDE.md` "Local testing → e2e suite", `docs/frontend-conventions.md` Status. Related: [ADR-0004](0004-keep-mysql-through-drizzle.md), [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md).

Note, 2026-10-05 (sub-project 2): the stub moved from `e2e/fixtures/dify-stub.ts` to `e2e/fixtures/stub/` (`server.ts`, `router.ts`, `scenarios.ts`, `events.ts`, `store.ts`, `apps.ts`, `assets.ts`; the Markdown samples stay in `e2e/fixtures/markdown-samples.ts`) and serves the catalogue the charter §4.6 and the chat spec §8.1 describe. Five apps by path prefix (`/v1` chat, `/v1/agent`, `/v1/chatflow`, `/v1/workflow`, `/v1/completion`), seeded as five `dify_apps` rows by `e2e/auth.setup.ts` from `STUB_APPS` (ids in `APP_IDS`); every event built after the OpenAPI schemas; scenarios chosen by the query text (echo, agent thoughts and messages, chatflow nodes and reasoning, `hitl` with the resume stream, `retry`, `nodefail`, `error`, `slow`, `files`, `cite`, `md:<sample>`); per-user and per-app storage; JSON bodies parsed with Dify's `400 invalid_param` on failure and unknown routes answered with Dify's 404 shape. `POST /__e2e/reset` and the smoke spec's `beforeEach` are gone: history and live replies share one store per conversation ([ADR-0017](0017-build-the-chat-on-ant-design-x.md)), and `e2e/chat-race.spec.ts` reopens a conversation and sends at once. The verification item above is done.

Note, 2026-10-10 ([ADR-0029](0029-sign-directory-accounts-in-over-ldap-and-keep-them-in-step-with-a-scheduled-sync.md)): `docker-compose.e2e.yml` gains two LDAP test directories under the profile `ldap`, started by name: `ldap-ad` (smblds, LDAPS) by the Playwright global setup, both by `pnpm test:ldap` (a Vitest project of its own). `.env.e2e` holds the `LDAP_*` block with the schedule off, so the login page shows its tabs in every spec; the local sign-in helpers choose 'Local account'. A test CA and server certificate are committed under `e2e/fixtures/ldap/tls/` with their regeneration script. The reset is `docker compose -f docker-compose.e2e.yml --profile ldap down -v`; a plain `down` leaves `ldap-ad` running (Docker "Using profiles with Compose").
