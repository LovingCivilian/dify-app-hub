# Whole-branch review — feat/backend-b1-dify-layer (698e6870..ddeb6dd4), Fable, 2026-10-08

Verdict: **With fixes.** 0 Critical, 1 Important, Minor 2-8 fix before merge, Minor 9-11 follow-up.

Checks the reviewer ran: `tsc --noEmit` exit 0; `pnpm test` 955/955 in 81 files; `oxfmt --check` clean on 101 files;
`oxlint` on the same set exit 0 (summary line not captured).

## Important

1. **A blank or mis-cased SMTP flag takes the whole app down** (`lib/env.ts:5,11`).
   - `flag = z.enum(['true','false'])` with `.default('false')`. The default applies only when the key is absent.
   - So `SMTP_ENABLED=` (blank), `True`, `TRUE` or `1` fail the enum, `env()` throws `EnvError`, and every request 500s.
   - Before B1, `lib/mail.ts` read `=== 'true'`, so anything else meant "mail off" and the app ran.
   - Fix (zod 4 `z.preprocess`, documented): normalise `''` to absent and lower-case before the enum, e.g.
     `z.preprocess(v => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : undefined), flag.default('false'))` for
     `SMTP_ENABLED` and `SMTP_USE_TLS`.
   - Add both cases to `__tests__/env.test.ts`, and fold in the keys assertion (deferred item 156).

## Minor, fix before merge

2. **`lib/dify/route.ts:31-35`:** `verifySession()`/`getAppAccess()` run outside any try. A DB or `EnvError` failure escapes to
   Next's empty-body 500 instead of the envelope, for all 25 routes. Fix: wrap the two calls and return
   `{ ok: false, response: errorResponseFrom(error, 'resolveDifyRoute') }`, with one test in `dify-route.test.ts`.
3. **`components/chat/hooks/use-workflow-run.ts:29-33,109-120`:** `stop()` reads `taskId` from `latest`, which is written in a
   layout effect after the commit. A Stop between the first parsed event and its commit, or before any event, posts nothing.
   - Fix as Dify's own chat hook does: write `taskIdRef.current = event.task_id` where events are parsed (react.dev allows refs
     in handlers), read it in `stop()`, and drop the `latest`/`useLayoutEffect` pair.
   - Reword the "nothing runs on Dify to stop" comment: the run exists, only its id is unknown to the client.
4. **`components/chat/utils-index.ts:6`:** a Chinese doc comment in a file this plan touched. Translate it. The untouched
   `components/chat/persistence/*` and `hooks/use-latest.ts` can join the same comment-only sweep.
5. **`lib/dify/client.ts:269`:** `fetchRemoteFile` has no origin check of its own. Ruling C already edits this function (the
   bearer by path), so add the `url.origin !== new URL(base).origin` refusal there too. `__tests__/dify-client.test.ts:362`,
   which pins the bearer on a root `/files/` URL, must flip.
6. **`components/chat/chat-view/conversation-sidebar.tsx:44-60`:** `AppAvatar` renders an `<img>` without `alt`. Fix:
   `alt={alt ?? name}`.
7. **`components/admin/apps/annotations-panel.tsx:99`:** `remove` shows the generic `common.delete_failed` while `save` uses
   `failureText`. Make it `failureText(error, t, t('common.delete_failed'))`.
8. **`components/admin/apps/use-action-transition.ts:27`:** the unused `export { startTransition }`. Remove it.

## Minor, follow-up (record, do not fix in B1)

9. `lib/dify/errors.ts` `difyErrorFromResponse`: a non-OK status outside 400-599 would make `Response.json` throw (unreachable
   today). Follow-up: map such statuses to `502 upstream_error`.
10. `app/api/apps/[appId]/icon/route.ts:24`: `max-age=86400` keeps a synced icon stale for a day in a browser that cached it (a
    charter §4.4 choice). Follow-up: `private, no-cache` with the ETag, or a version on the `{ kind: 'image' }` DTO. Add a note
    to ADR-0023.
11. `lib/data/apps.ts:179-193`: `readIconBytes` buffers the whole body before the size check. Follow-up: read through a reader
    and stop at `cap + 1`.

Unverified (checks skipped on the controller's instruction): whether Next adds `Cache-Control` to dynamic Route Handler answers
in production. `node_modules/next/dist/server/send-payload.js:60-61` sets it from `getCacheControlHeader(cacheControl)` only when
the handler set none; the dev server sets `no-cache, must-revalidate`; `cdn-caching.md` documents the value for dynamic *pages*
only. The explicit `private` on file answers is right either way.

## Deferred-item triage (the ledger's line numbers, as listed in deferred-items.md)

Section 1 (pre-decided), all confirmed:
- 345: Cache-Control private on `filePassthrough`.
- 354: the bearer only for API-base `/files/` links, none for `icon_url`. The e2e stub checks the bearer on neither path, so
  only the owner's check catches a wrong split; `dify-client.test.ts:362` must flip.
- 356: CSP `sandbox` except PDF.
- 399 (1)-(6): all six. `config/index.ts` has no importer and still names `/api/client`; `docker/entrypoint.sh:4,10` confirmed.
- 411: the four wording fixes.

Section 2:
- 209 client-side origin guard: **FIX** (issue 5).
- 225 `z.url({ protocol: /^https?$/ })` on `files[].url`/HITL: FOLLOW-UP.
- 242 the icon fetch's bearer: resolved by ruling C (**FIX**).
- 260 `/site` `icon_url` and `/meta` `tool_icons` passthrough: DROP, no consumer renders them.
- 274 client `segment()` guards nothing: FOLLOW-UP. A structural test that every segmented route calls `parsePathParams` is
  cheap insurance.
- 358 the stop comment and stop-before-task-id: **FIX** (issue 3).
- 400 Chinese comments: **FIX** `components/chat/utils-index.ts:6`; FOLLOW-UP or the same sweep for `persistence/*` and
  `hooks/use-latest.ts`.

Section 3:
- 152 `db:seed`: DROP (deleted).
- 153 SMTP strictness: **FIX** (Important 1).
- 154 `z.url()` for `APP_URL`: FOLLOW-UP.
- 155 SMTP TLS mapping and caching tests: FOLLOW-UP.
- 156 `env.test` keys assertion: fold into Important 1's tests.
- 157 keys reported in two rounds: DROP.
- 161 plan-text staleness: DROP.
- 169 English on a mid-chat 401: DROP (resolved by `failureText`).
- 170, 172, 173 shim items: DROP (the shim is gone; the proxy keeps its own envelope literal).
- 171 `authorize` tests: FOLLOW-UP (B2).
- 180/181/189 null-body statuses: FOLLOW-UP (issue 9).
- 190 missing error-helper tests: FOLLOW-UP.
- 191 `'literal' | string` unions: FOLLOW-UP (F2).
- 192 `DifyErrorBody` re-parsed inline in `browser.ts`: FOLLOW-UP (move the shape to `lib/dify/types`).
- 193 `DifyError` pulls in `lib/auth/session`: FOLLOW-UP (move the `AuthError` branch of `errorResponseFrom` to `route.ts`).
- 194 `unstable_rethrow`: DROP.
- 210 `segment()` leaves `.`/`..`: FOLLOW-UP (with 274).
- 211/270 abort-before-headers log noise: FOLLOW-UP (skip the log when `init.signal?.aborted`).
- 215 the unreadable-OK-body 502 is unlogged: FOLLOW-UP (one `console.error`).
- 226 `upload_file_id` not UUID-strict: DROP.
- 227 range tests assert only `ok === false`: FOLLOW-UP.
- 231 a remote item with no url: DROP.
- 243 `readIconBytes` whole-body read: FOLLOW-UP (issue 11).
- 244 `icon_type: image` without `icon_url`: DROP.
- 245 snapshot.json not oxfmt-clean: FOLLOW-UP (`.oxfmtrc.json` ignorePatterns).
- 254 a WAF 403 clears the icon: DROP.
- 262 `resolveDifyRoute` outside the try: **FIX** (issue 2).
- 263 spy restore and log assertion: FOLLOW-UP.
- 271, 280 route-test sharpness: FOLLOW-UP.
- 293 the bare `/files/` prefix on subpath deployments: DROP for this deployment; fold into the `FILES_URL` follow-up.
- 294 icon staleness: FOLLOW-UP (issue 10).
- 295 `If-None-Match` list forms: DROP.
- 299 `/files/..;/console`: DROP.
- 308 browser-client test sharpness and URL-helper duplication: FOLLOW-UP.
- 315 `chat-workspace` effect keyed on `app`: DROP (depend on `app.id` when next touched).
- 316 `app-unavailable` `Button href` without `next/link`: FOLLOW-UP.
- 317 e2e seed `is_enabled = 2`: DROP (fixed).
- 318 `chat-page.test` weakness and `/chat` index untested: FOLLOW-UP.
- 326 `toThought` `task_id: ''`: FOLLOW-UP.
- 327 e2e failure mocks for rename/delete/feedback/TTS: FOLLOW-UP.
- 328 decompression noise: DROP.
- 333 already-translated text stored in state: FOLLOW-UP.
- 348 the `latest` ref and `useLayoutEffect`: **FIX** with 358 (issue 3).
- 349 the HITL e2e cannot fail on a failed form GET, and the stop failure is swallowed: FOLLOW-UP.
- 366 `AppAvatar` alt: **FIX** (issue 6); the rest of 366 is FOLLOW-UP.
- 372 markdown mapping notes: FOLLOW-UP (F2).
- 386:
  - the `startTransition` export: **FIX** (issue 8);
  - `remove`'s generic text: **FIX** (issue 7);
  - the icon version: FOLLOW-UP;
  - `app.info_missing`: DROP;
  - `failureText` imported from components/chat into admin: FOLLOW-UP (move it next to `lib/dify/browser.ts`);
  - `admin-app-row.test` green before: DROP;
  - the `admin-apps.spec` cleanup by name: FOLLOW-UP;
  - hydration warnings on the auth pages: DROP.

## Declined to judge

- Chinese strings in `app/api/users/**`, `app/api/init`, `app/api/auth/{forgot,reset}-password` (B2 deletes them).
- The `/api/users/*` gap and the proxy's self-fetch of init status (B2).
- `AppDto.apiBase` reaching every signed-in account on `/app-management` (roles in B2).
- Annotation list/update/delete open to any signed-in user (charter, B1).
- A mid-chat 401 without a sign-in link (ADR-0023's "no 401 redirect").
- One DB query per request in the `jwt` callback (ADR-0018).
- Next's compression over SSE (pre-existing).
- The 10 MB body limit, Range, the `FILES_URL` origin, the lockfile's sass suffixes and WebM audio (all ruled or follow-ups).
- `e2e/auth.spec.ts`'s duplicated hash (ruling F1).
- Two UUID generators (style).
- `__mocks__/empty.js` not excluded by `.dockerignore` (harmless).
- `.dockerignore`'s Chinese comments (not a plan file).
