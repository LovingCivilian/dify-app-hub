---
status: proposed
date: 2026-10-07
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (backend rework brainstorm and B1)
---

# Build the Dify layer as one Route Handler per Service API operation, a typed server client and a pass-through contract

## Context and Problem Statement

The inherited proxy (`app/api/client/dify/[appId]/**`) answered three shapes (`{ code, data }`, bare JSON, raw streams), re-pumped streams through hand-written `ReadableStream`s, relabelled audio parts, had no stop routes for workflow and completion runs and no `GET /form/human_input`, and its two clients (`lib/dify-client.ts` under `@ts-nocheck`, `lib/api/client.ts` calling Dify from the browser with the app's key) resolved Dify's error bodies as values, so the chat kept thirteen shape-specific parsers. Dify 1.17.1's Service API was mapped from the docs' OpenAPI and the controllers (`docs/dify-service-api-1.17.1.md`: 36 operations on 32 paths, the docs and the source agreeing). How should the app front that API?

## Decision Drivers

- Each route forwards exactly what the API defines; Dify's status and error bodies reach the browser unchanged; the end-user id is set on the server ([ADR-0006](0006-require-login-everywhere-and-use-the-email-as-dify-end-user-id.md)).
- Documented Next.js shapes only ([ADR-0002](0002-use-documented-library-approaches-only.md)): the Backend for Frontend guide (Route Handlers as the public API layer; Server Actions for mutations, dispatched sequentially; proxying with validation first).
- Neither the Dify host nor the key reaches the browser.
- One parser on the frontend.

## Considered Options

- One Route Handler per Dify operation under `app/api/dify/[appId]/<Dify path>`, a fork-owned `server-only` typed client, Dify's envelope passed through, the app's own refusals in the same envelope.
- One catch-all handler with an allowlist table.
- Route Handlers for streams and reads, Server Actions for Dify's mutations.
- The official `dify-client` package (3.1.0) as the server client.

## Decision Outcome

Chosen option: one route per operation with a typed client (owner's choice, 2026-10-07).

- Routes: `app/api/dify/[appId]/<Dify path>/route.ts`, Dify's paths and verbs (singular `workflow/{id}/events`, plural `apps/annotations`): 24 files for the 27 operations a screen uses or a recorded follow-up needed, plus `files/remote` for the file links Dify hands out (25 route files, 28 handlers); the deferred operations are listed in the charter §4.1. Each handler: session (401) → app (404, 403 when disabled) → validation (`lib/dify/schemas.ts`, zod, unknown keys stripped, `400 invalid_param` naming the paths) → one client call → the answer. `RouteContext` types the params; no segment config (`GET` handlers are not cached since Next 15).
- Client: `lib/dify/client.ts`, one function per operation typed from the map (`lib/dify/types`), `user` placed where Dify reads it, the bearer from the app row, `DifyError` on a non-OK or non-JSON answer, `upstream_unreachable` (502) on a network failure, streams and binaries returned as the upstream `Response` with its status and the meaningful headers.
- Contract: Dify's status and body verbatim (201 upload, 204 delete, `{"result":"success"}` stops, `{}` form submit, 412 form states, SSE, audio); the app's own refusals as `{ code, message, status }` with `unauthorized` (401), `app_not_found` (404), `app_disabled` (403), `invalid_param` (400), `upstream_error` (Dify's status, or 502 for an unreadable OK answer), `upstream_unreachable` (502), `internal_error` (500), plus `forbidden` (403, an `AuthError('forbidden')`, reachable once B2 adds roles) and `icon_not_found` (the icon route's 404, also for an unknown app). The proxy's 401 uses the same envelope.
- Browser: `lib/dify/browser.ts`, one client that rejects with `DifyRequestError` on a non-OK answer; x-sdk's `fetch` option sits on top of it. File links Dify hands out load through `GET …/files/remote?url=` (the app's Dify origin under `/files/` only); the stored app icon through `GET /api/apps/[appId]/icon`.
- Data: `lib/data/apps.ts` is the `server-only` Data Access Layer for apps. Its functions take the verified `actor: SessionUser` as their first parameter (the entry point verifies once; React cache does not dedupe inside Route Handlers, so an in-DAL re-verification would double the session read per chat request), return DTOs without the key (the chat's without the base), and store the Dify icon at create and sync time: `/site`'s `icon_url` for an image is a signed link that expires (`FILES_ACCESS_TIMEOUT`, default 300 s), so the bytes are fetched once, capped at 1 MB, and kept on the row. The admin writes are thin Server Actions (`createAppAction`, `updateAppAction`, `deleteAppAction`, `syncAppAction`) returning `ActionResult` and ending in `refresh()`; a blank key on update keeps the stored one, which never returns to the browser.

### Consequences

- Good, because the route tree is the allowlist and the contract, each route has a vitest suite, and the frontend keeps one error parser (`components/chat/hooks/dify-errors.ts` shrank to three helpers: `toDifyError`, `failureText`, `humanInputFailureText`).
- Good, because the recorded follow-ups landed: the workflow and completion stops reach Dify, the human-input form is read by GET, the audio part is forwarded as recorded, the icon lives on the row, the chat page loads its app on the server ([ADR-0020](0020-load-page-data-on-the-server.md)'s exception closed).
- Good, because no screen reaches the Dify host: message files and the Dify file links inside answer Markdown go through the remote-file route, the app icon comes from the row (details below).
- Bad, because 25 small route files replace the old proxy's 22; a new operation is a new file plus a client function, a schema and a test.
- Bad, because the audio format is decided by the owner's Dify: a WebM recording is forwarded as such; if 1.17.1 refuses it, the recording format changes on the frontend (recorded in ADR-0017's notes once verified).
- Bad, because a `401 unauthorized` from a Dify route means either "no session" (the app's refusal) or "Dify refused the app key" (Dify's own `unauthorized`); the envelope cannot tell them apart. No B1 code redirects on a 401, so a wrong key never sends a user to `/login`; a future 401 → `/login` handler must check the session first.
- Bad, because the routes do not forward `Range`/`If-Range`: a media range request gets the full file with a 200 (RFC 9110 §14.2 lets a server ignore `Range`), so seeking into media that has not downloaded yet waits for the download (follow-up).
- Bad, because the remote-file route accepts only the API base's origin, while Dify builds file links from its `FILES_URL`: a Dify whose `FILES_URL` origin differs from the API base (Dify Cloud: `upload.dify.ai` against `api.dify.ai`) gets 400 for those links. A default self-hosted Dify (empty `FILES_URL`) emits relative `/files/` links, which pass. A configured files origin is the follow-up if the owner's check needs it.
- Neutral, because the deferred operations (run by version id, run detail, logs, conversation variables, app feedbacks, end users, annotation-reply settings, the version root) have the map as their reference and no route. The blocking-response and paused shapes (`ChatCompletionResponse`, the paused unions, `workflow_paused` data) are not typed either, because nothing consumes them; the paused workflow form is frontend phase 2.
- Neutral, because `chatMessagesBody` accepts exactly the charter's six fields: `workflow_id` (a Chatflow version pin) is not taken from the browser, which would let users run replaced versions; a server-side pin per app is the path if one is ever wanted. The `ChatMessageRequest` type keeps the map's field (the schema is the allowlist).
- Neutral, because the admin actions are called through `startTransition` from antd Form `onFinish` (Next `02-guides/server-actions.md`, `01-getting-started/07-mutating-data.md`: an action invoked from an event handler inside `startTransition`; the Form owns validation per `.claude/rules/frontend.md`), not through `useActionState` as the charter's §4.2 words it; `fieldErrors` are not mapped onto the Form in B1.

## Implementation Plan

- **Affected paths**: `app/api/dify/**`, `app/api/apps/[appId]/icon/route.ts`, `lib/dify/{client,errors,schemas,route,remote-file,browser}.ts`, `lib/dify/types/`, `lib/data/apps.ts`, `lib/auth/`, `lib/env.ts`, `lib/action-result.ts`, `lib/action-failure.ts`, `app/(admin)/app-management/{actions,schemas}.ts`, `app/(user)/chat/[appId]/page.tsx`, `components/chat/**`, `components/apps/**`, `components/admin/apps/**`, `db/schema/apps.ts` and its migration, `e2e/fixtures/stub/apps.ts`, `e2e/auth.setup.ts`, the specs.
- **Dependencies**: `zod` ([ADR-0025](0025-validate-with-zod.md)).
- **Patterns to follow**: a new Dify operation = a type in `lib/dify/types`, a client function, a schema, a route file with the five steps, a browser-client method, a test per layer; a dynamic segment besides `appId` goes through `parsePathParams` right after `resolveDifyRoute`; a binary file answer goes through `filePassthrough`; entry points verify the session once and pass the actor to the DAL; errors are codes, never a route's text.
- **Patterns to avoid**: a `{ code, data }` wrapper; reading `user` from the client; calling Dify from the browser; a Dify host in anything the browser loads; a DAL function without an actor; `process.env` outside `lib/env.ts`.

### Verification

- [x] `__tests__/dify-*.test.ts` (client, errors, schemas, route, the route suites, the remote-file rule, browser client, x-sdk fetch), `data-apps.test.ts`, `data-apps-sync.test.ts`, `app-icon-route.test.ts`, `app-management-actions.test.ts`, `action-failure.test.ts`: the five-step order, the envelope, the `user` placement, the stream passthrough, the file headers, the icon cap, the remote-file origin check.
- [x] Each route-touching task ran the e2e specs the consumer map names on the three projects, with the new cases (both stops, the form GET, the icon route, the disabled app page, the remote-file image, Dify file links in answer Markdown).
- [x] The controller's rulings during B1 were checked against official docs and standards (`docs/superpowers/research/2026-10-07-backend-rework/b1-execution/doc-verification.md`: MDN, react.dev, RFC 9110/9111, RFC 3986, WHATWG URL and Fetch, CSP3, OWASP, zod, Drizzle, Next; none contradicted) and the architectural ones compared with well-known projects (`…/b1-execution/reference-check.md`: Hono, Open WebUI, Dify's own code, Outline, Discourse, Mastodon, GitHub raw, next/image, LobeChat, documenso, Vercel AI SDK).
- [ ] The full e2e suite on the final tree (Task 18, Step 8).
- [ ] The Docker gate of `CLAUDE.md` with the new curl checks; the owner's browser check against Dify 1.17.1, audio included.

## Pros and Cons of the Options

### One route per operation with a typed client

- Good, because it is the shape of the Backend for Frontend guide's public endpoints and of Dify's own Next.js template (`langgenius/webapp-conversation`: one Route Handler per endpoint).
- Bad, because of the file count.

### A catch-all handler with an allowlist table

- Good, because one file.
- Bad, because the table becomes a hand-written router carrying the per-operation `user` placement, mode gates and shapes, apart from the types.

### Server Actions for Dify's mutations

- Good, because it follows the mutation guidance literally.
- Bad, because the chat would use two transports, actions run one at a time per client, and these mutations revalidate nothing of the app's own data.

### The official `dify-client` 3.1.0

- Good, because it is maintained by Dify.
- Bad, because its answers are untyped `JsonObject`s and it has no human-input form, events stream or logs; it would need wrapping anyway.

## More Information

Contract details settled during B1 (each ruling with its reason in `docs/superpowers/research/2026-10-07-backend-rework/b1-execution/ledger.md`):

- **Errors.** An OK Dify answer whose body cannot be read (an HTML page, an empty or truncated body) becomes `502 upstream_error` (RFC 9110 §15.6.3), since a 2xx carrying an envelope would be taken as data; a non-OK answer keeps Dify's status. A network failure is `502 upstream_unreachable` with the fixed message "Dify is unreachable."; the cause is logged on the server only, because Node's fetch error message carries the URL and the `user` query. `DifyError` keeps only code, message and status, so Dify's extra `params` (on `400 invalid_param`) and `details` (on `502 plugin_runtime_error`) do not reach the browser.
- **Passthrough.** Exactly four upstream headers are forwarded: `Content-Type`, `Content-Disposition`, `Content-Length` and `Accept-Ranges`. `Content-Length` is dropped when the upstream answer has a `Content-Encoding`, because undici decodes the body (Fetch Standard: a decoded body no longer matches the length). Dify's `Cache-Control` (`public, max-age=3600` on a preview) is never forwarded. If a buffering reverse proxy such as nginx is ever put in front of the hub, the SSE answers need its buffering off (`X-Accel-Buffering: no`).
- **User content on the app's origin.** The file preview, remote-file and text-to-audio routes answer through `filePassthrough` (`lib/dify/client.ts`): `X-Content-Type-Options: nosniff` always; `Content-Disposition: attachment` (Dify's filename kept) for any media type outside image/png, image/jpeg, image/gif, image/webp, `audio/*`, `video/*`, application/pdf and text/plain, and for any comma-listed `Content-Type` (Fetch "extract a MIME type" takes the last value); `Content-Security-Policy: sandbox` on every answer except `application/pdf` (Outline's split, since Chrome's PDF viewer does not render under it); `Cache-Control: private` (MDN `Cache-Control`: `private` for user-personalised content, especially sessions managed through cookies; dropping Dify's `public` alone does not keep it out of a shared cache). The icon route sends `nosniff` and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` (GitHub raw's pattern) with `Cache-Control: private, max-age=86400` and an ETag. OWASP's first-choice control for uploads is a separate user-content host; that is a deployment-level follow-up.
- **The remote-file route** (`lib/dify/remote-file.ts`). Only the app's API-base origin, under `/files/` or `<base path>/files/`; an encoded `%2F`, `%5C` or `%25` in the path and userinfo are refused (400), and `fetchRemoteFile` refuses redirects (`redirect: 'error'`), so the route never serves another origin. The app's bearer is sent only for links under the API base path (Dify's Service API preview, which needs the key); root `/files/…` signed links get no bearer, nor does the DAL's fetch of the signed `icon_url`: Dify checks the signature there, not the key.
- **Path segments.** Every dynamic segment besides `appId` is validated by one shared schema (`pathSegment` in `lib/dify/schemas.ts`: RFC 3986 unreserved characters, 1 to 256 long, never `.` or `..`) through `parsePathParams`, after `resolveDifyRoute` and before any body read. It is not UUID-strict: the stub's `file-<uuid>` and `ft-<uuid>` ids are not UUIDs and the map gives no form-token format. The admin actions check app ids with strict `z.uuid()` (a non-UUID id answers `not_found`). Two id rules, on purpose.
- **The DAL** (`lib/data/apps.ts`). Reads use one explicit column list without the key and the icon bytes (`hasIconImage` through ``sql<boolean>`… IS NOT NULL`.mapWith(Boolean)``); credentials come only through `getAppAccess` (and the internal `readAccess` for update and sync). Only a 403 from `/site` means "no site" and clears the icon; any other Dify error keeps the stored icon and reports `partial: true`. Writes validate Dify's mode with `isAppMode`. `toActionFailure` (`lib/action-failure.ts`) logs a `DifyError` (status, code, message) and an unexpected throw on the server, then maps them to `dify_unreachable` and `operation_failed`. The migration's backfill is idempotent: `CASE WHEN is_enabled IN (0, 2) THEN 0 ELSE 1 END`.
- **Admin form.** The API Base field validates with the action's own schema (`appInputSchema.shape.apiBase` through an antd `validator` rule, `components/admin/apps/api-base-rule.ts`), so Docker service names such as `http://api:5001/v1` pass in both places (antd's `type: 'url'` refuses them).
- **Text a user reads.** `failureText` (`components/chat/hooks/dify-errors.ts`) maps the app's own codes (`unauthorized`, `app_not_found`, `app_disabled`, `upstream_error`, `upstream_unreachable`) to translated `chat.error_*` keys. Dify's codes, `invalid_param` included (Dify uses it for its own refusals too), keep Dify's message; an empty message or `internal_error` falls back to the caller's generic text. The admin annotations panel uses it too. `forbidden` and `icon_not_found` join the mapped codes when B2 lets them reach a screen.
- **No Dify host in the browser.** Message files and the Dify file links inside answer Markdown (`img`, `video`/`source`, `a`: a relative `/files/…` link, or an absolute link with a `/files/` path carrying `timestamp`, `nonce` and `sign`; `components/chat/message/file-link.ts`) go through `/api/dify/<app>/files/remote`; the app icon comes from the row (`/api/apps/<id>/icon`). `/site`'s `icon_url` and `/meta`'s `tool_icons` still pass through those two routes, but no B1 screen renders them. Links an LLM writes to other hosts stay as written.

Sources: `docs/dify-service-api-1.17.1.md` (built from the dify-docs OpenAPI at `7801fc28` and the 1.17.1 controllers at `8387590a`); Next 16.3 bundled docs `02-guides/backend-for-frontend.md`, `02-guides/data-security.md`, `02-guides/authentication.md`, `02-guides/server-actions.md`, `01-getting-started/07-mutating-data.md`, `03-api-reference/03-file-conventions/route.md`, `04-functions/fetch.md` ("Memoization does not apply in Route Handlers"), `04-functions/refresh.md`, `02-guides/upgrading/version-15.md`; Dify 1.17.1 `controllers/common/fields.py` (`Site.icon_url` through `graphon.file.helpers.get_signed_file_url`) and `configs/feature/__init__.py` (`FILES_ACCESS_TIMEOUT`); the reference survey `docs/superpowers/research/2026-10-07-backend-rework/reference-projects.md` (`nextjs/saas-starter`, `create-t3-app`, `vercel/platforms`, `langgenius/webapp-conversation`, documenso); the B1 run records `docs/superpowers/research/2026-10-07-backend-rework/b1-execution/` (`ledger.md`, `doc-verification.md`, `reference-check.md`). Charter: `docs/superpowers/specs/2026-10-07-backend-rework-charter.md` §4.1 to §4.5; plan: `docs/superpowers/plans/2026-10-07-backend-b1-dify-layer.md`. The DAL with Server Actions and roles for the app's other data (users, first run, password reset) is ADR-0024's, reserved for B2; its B1 half is the apps module above. Related: [ADR-0006](0006-require-login-everywhere-and-use-the-email-as-dify-end-user-id.md), [ADR-0017](0017-build-the-chat-on-ant-design-x.md), [ADR-0018](0018-gate-route-groups-on-the-server.md), [ADR-0020](0020-load-page-data-on-the-server.md), [ADR-0022](0022-treat-the-overhaul-line-as-fully-fork-owned.md).
