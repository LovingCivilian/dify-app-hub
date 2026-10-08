# B1 follow-ups (after the final review and its fix wave)

What B1 leaves open, by area: every FOLLOW-UP verdict of the whole-branch review (Minor 9-11 and the deferred-item triage; the numbers in brackets are the ledger lines it cites, `ledger.md` in this folder) and the run's other recorded follow-ups. Line numbers are those of the tree after the fix wave. Items marked B2, B3 or F2 belong to that step of the programme (charter §5); the rest wait for a bounded change or the step that next touches the file.

## Server

- `lib/dify/errors.ts:47` `difyErrorFromResponse`: a non-OK status outside 400-599 (and `difyErrorResponse` with a null-body status, `lib/dify/errors.ts:39`) would make `Response.json` throw; map such statuses to `502 upstream_error` (review Minor 9; [180], [181], [189]; unreachable today).
- `app/api/apps/[appId]/icon/route.ts:24`: `private, max-age=86400` keeps a synced icon stale for up to a day; `private, no-cache` with the ETag, or a version on the `{ kind: 'image' }` DTO (review Minor 10; [294]; ADR-0023 "Icon staleness").
- `lib/data/apps.ts:188` `readIconBytes`: the whole body is buffered before the size check; read through a reader and stop at `cap + 1` (review Minor 11; [243]).
- `lib/dify/schemas.ts:44-45,59-60`: `z.url()` accepts `javascript:`, `file:` and `data:` in `files[].url` and the human-input file mapping; `z.url({ protocol: /^https?$/ })` ([225]).
- `lib/dify/client.ts:62` `segment()` guards nothing and leaves `.`/`..`; the route-level `parsePathParams` is the only guard; a structural test that every route with a second dynamic segment calls `parsePathParams` ([274], [210]).
- `lib/env.ts:31`: `z.url()` accepts `localhost:5300`, `javascript:` and `ftp:` for `APP_URL` ([154]).
- `lib/dify/browser.ts:43` `readDifyError` re-parses Dify's envelope with an inline shape; move `DifyErrorBody` to `lib/dify/types` so the browser and the server share one ([192]).
- `lib/dify/errors.ts:3`: `DifyError`'s module imports `lib/auth/session` for `errorResponseFrom`'s `AuthError` branch, so every importer loads next-auth and the database; move that branch to `lib/dify/route.ts` ([193]).
- `lib/dify/client.ts:172`: an abort before Dify's headers (the browser left) logs "Dify request failed" and builds a 502 nobody receives; skip the log when `init.signal?.aborted` ([211], [270]).
- `lib/dify/client.ts:193`: the 502 for an unreadable OK body is not logged; one `console.error` ([215]).
- `lib/dify/types/events.ts:37`, `lib/dify/types/human-input.ts:4,11,24`: `'literal' | string` unions collapse to `string` (F2; [191]).
- Proxy body limit: uploads and audio above 10 MB are cut by the proxy's documented body buffer (`experimental.proxyClientMaxBodySize`, pre-existing); raise it to Dify's upload limits if needed (ledger, Task 18 carry).
- `lib/dify/client.ts:44`: `Range`/`If-Range` are not forwarded by the preview and remote-file routes, so seeking into media that has not downloaded waits for the download (RFC 9110 §14.2 allows it); forward `Range` and pass a 206 with `Content-Range` if seeking matters (ADR-0023).
- `lib/dify/remote-file.ts:28`: only the API base's origin passes, while Dify builds file links from `FILES_URL`; a configured files origin if the owner's Dify sets `FILES_URL` to another origin (Dify Cloud does); the bare `/files/` prefix on a subpath deployment folds into the same change ([293]; ADR-0023).

## Chat

- `components/chat/hooks/use-workflow-run.ts:36,127`: unmounting and `reset()` abort the stream without posting Dify's stop, so leaving the page mid-run leaves the Dify run running (ledger, Task 18 carry).
- `components/chat/hooks/dify-errors.ts:37` `failureText`: `forbidden` and `icon_not_found` join the app's mapped codes when B2 lets them reach a screen (B2). Done in B2 (`docs/superpowers/plans/2026-10-08-backend-b2-accounts.md`): mapped to `chat.error_forbidden` and `chat.error_icon_not_found`.
- Dify's `provider_response_latency` and token counts from `GET /messages` are not shown in the chat; a quick item of frontend phase 2 (F2; ledger, owner 2026-10-07).
- A study of per-message metadata Dify does not keep, or keeps where the Service API does not return it (thinking time, the separated reasoning text, run summaries, per-node timings), stored on the hub by message id, deferred until after B1-B3 and F2 (owner, 2026-10-07; CLAUDE.md). Today the reasoning text and the nodes are kept per browser (ADR-0017 notes of 2026-10-08).
- `components/chat/provider/history.ts:60` `toThought` still sets `task_id: ''` although `AgentThought.task_id` is optional ([326]).
- `components/chat/chat-view/assistant-content.tsx:60` shows the raw `error.code`; the run, chat and upload hooks store already-translated text that does not follow a later language switch ([333]).
- Answer Markdown mapping (F2; [372]): the mapped `a` loses XMarkdown 2.9.0's streaming fade; `MarkdownLink` and `MarkdownSource` drop other sanitised attributes; `<track>`, `srcset`, `<audio>` and `<video poster>` are not routed.
- `components/chat/chat-view/conversation-sidebar.tsx:44`: `AppAvatar` is exported from the sider and imported by two siblings (its own file); `withGivenLinks` belongs in `chat-view/file-types.ts`; a `null` icon falls back to the first letter in the chat but to the mode icon in the gallery ([366]).
- `components/chat/app-unavailable.tsx:19`: the `Button href` is a plain full-page link; wrap it in `next/link` ([316]).
- Human input order (ADR-0017 note of 2026-10-08):
  - A run whose continuation this browser did not receive keeps the node data it stored last, so a node can spin after a reload next to a submitted form. That happens when the tab is closed right after an answer, when Stop or a dropped stream ends the continuation, when another recipient answers the form, and for data stored before the fix. GET /messages has no node data, and the Service API replays nodes only for an unfinished run. Two options:
    - a display rule in `components/chat/message/display-workflow.ts`, so that a run whose form was submitted, or a finished run, shows no spinning node (the node's real status is not known);
    - the message metadata study.
  - While a refused answer's stream stays open, the Sender is busy (`components/chat/chat-view/chat-view.tsx` `submitting`).
  - x-sdk 2.9.0 moves a reply whose stream ends by abort or error to the end of the list with a new id, so a form answered on an older message moves it at its next pause. Regenerate and annotate then pair it with the wrong question (`components/chat/chat-view/message-actions.ts` `questionOf`; finding the question by Dify message id would fix it).
  - Accepted: Dify's replay is stored event by event like a live run, about 2N+2 IndexedDB writes for a run of N nodes per answer (`components/chat/hooks/use-dify-chat.ts` `onWorkflowUpdate`).

## Admin

- `components/admin/apps/annotations-panel.tsx:19` imports `failureText` from `components/chat`; move it next to `lib/dify/browser.ts` ([386]).
- `app/api/dify/[appId]/apps/annotations/route.ts:23`: creating an annotation needs only a signed-in user; the role gate and the app's `enableAnnotation` setting are B2's decision (B2; ledger [290]). Done in B2 (`docs/superpowers/plans/2026-10-08-backend-b2-accounts.md`; ADR-0024, decision j): list, update and delete need admin rights; create needs them unless the app enables annotations.
- `locales/ar/translation.json:291`: the Arabic `app_setting.api_base_invalid` puts `http://`/`https://` right before Arabic text; re-check it when RTL lands (bidi isolation or a reworded sentence; ADR-0005).

## Tests

- `lib/mail.ts:22-27`: the SMTP TLS mapping (465, 587, `useTls` false) and the `env()` cache have no direct tests ([155]).
- `__tests__/auth-options.test.ts`: no test calls `authorize` (missing credentials, unknown email, wrong password, the returned shape) (B2; [171]). Done in B2 (`docs/superpowers/plans/2026-10-08-backend-b2-accounts.md`): `authorizeCredentials` is exported and tested for each case.
- `__tests__/action-failure.test.ts`, `__tests__/dify-errors.test.ts`: `toActionFailure(AuthError('unauthorized'))`, `errorResponseFrom`'s `AuthError` bodies, a non-Error throw, `toBody()` and `isAppMode` are untested ([190]).
- `__tests__/dify-schemas.test.ts:107`: the range cases assert only `ok === false`, not the named parameter ([227]).
- `__tests__/dify-routes-app-upstream.test.ts:84`: the `console.error` spy is restored in the body, not `afterEach`, and the log is not asserted ([263]).
- `__tests__/dify-routes-chat.test.ts:79`, `__tests__/dify-routes-run.test.ts:77,95,155`: `expect.any(AbortSignal)` does not prove the request's own signal is forwarded; the 401-first order is checked on `chat-messages` only; the form GET's 412/404 and the events 404 are untested ([271], [280]).
- `__tests__/dify-browser.test.ts:133`: one 403 Response reused for three calls; several methods without URL or verb assertions; `lib/dify/browser.ts` repeats the server client's URL helpers ([308]).
- `__tests__/chat-page.test.ts:53`: `not.toContain('apiBase')` checks only the mock; the `/chat` index page is untested ([318]).
- e2e: no failure mock for rename, delete, feedback rollback, annotation or text-to-audio ([327]); `e2e/chat-hitl.spec.ts:141` cannot fail on a failed form GET (`waitForRequest`), and a failed stop is swallowed without a trace ([349]); `e2e/admin-apps.spec.ts` cleans up by `CREATED_APP.name`, not a project-named row ([386]).

## Docs and operations

- A separate user-content host for the files the routes serve (OWASP's first-choice control for uploads); B1 serves them on the app's origin with `nosniff`, forced attachment outside an inline list and a sandbox CSP (ADR-0023).
- `db/migrations/**/snapshot.json` are not oxfmt-clean; add them to `.oxfmtrc.json`'s `ignorePatterns` ([245]).
- Several Markdown records under `docs/` are not oxfmt-clean, including pre-B1 specs and plans. They were committed without the lint-staged hook, which is not installed in this checkout, and oxfmt is not idempotent on the B1 plan. Install the hooks (`pnpm prepare`/husky) or add `docs/superpowers/**` to `ignorePatterns`. Decided 2026-10-08 not to reformat the approved records in B1.
- Arabic RTL layout as a whole (ADR-0005; CLAUDE.md "i18n").
