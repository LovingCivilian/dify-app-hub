# Reference check: B1 Dify layer decisions against real projects

Checked 2026-10-07 against the live repositories (GitHub trees API + raw files; short SHA = the commit read) and
live response headers (`curl -I`). This complements the docs/spec check run by another agent; it only says how
well-known projects solve the same problem. It reuses `../2026-10-07-backend-rework/reference-projects.md` where
that survey already answers (webapp-conversation's route shapes).

Repositories read: langgenius/dify `5a733bd5` (API, `web/`, Node SDK), langgenius/webapp-conversation `33085b66`,
lobehub/lobehub (was lobe-chat) `dc9cd248`, vercel/chatbot `c2f8235e`, vercel/ai `fab95c1a`, calcom/cal.diy (where
`calcom/cal.com` now redirects) `54343aa6`, documenso/documenso `2fa64495`, outline/outline `6e6eaf6b`,
gitlabhq/gitlabhq `0ab7ab5b`, mastodon/mastodon `320d1342`, discourse/discourse `1ea80f2c`, vercel/next.js
`c6f8ac72`, ant-design/x `8b76d6a2` (installed `@ant-design/x-sdk` 2.9.0), honojs/hono `5f36607f`,
open-webui/open-webui `8bd8b4fa`, pallets/werkzeug `main`.

| Decision | Projects checked | Verdict |
|---|---|---|
| A. Upstream passthrough (route per operation, session first, body as is, header allowlist, no Cache-Control) | Hono `proxy()`, Open WebUI, Dify webapp-conversation, LobeChat, Vercel AI SDK / chatbot, Dify `web/` | **ALIGNED**. Sub-item to reconsider: drop `accept-ranges`, because neither the hub nor Dify serves byte ranges. Optional: add `no-cache` and `X-Accel-Buffering: no` to SSE answers |
| B. Shared `pathSegment` schema for dynamic segments, 400 | Dify API (Werkzeug converters), Dify Node SDK, webapp-conversation, Outline, Vercel chatbot, documenso, cal.com | **DIFFERS-BUT-SOUND**. The common style is one schema per id kind (`z.uuid()` where the id is a UUID). Ours is safer for ids placed in an upstream URL path |
| C. Remote-file route with an origin and path allowlist, no redirects | Next.js image optimizer `remotePatterns`, Dify `core/file/remote_fetcher.py` + `ssrf_proxy`, LobeChat `ssrf-safe-fetch` | **ALIGNED** on the checks (stricter than next/image). **RECONSIDER** the origin source: Dify builds file links from `FILES_URL` (e.g. `upload.dify.ai` on Dify Cloud), not the service API origin |
| D. Serving user files: nosniff, an inline allowlist, attachment otherwise, a sandbox CSP on the icon, no CSP on previews | Outline, Discourse, GitLab Workhorse, Mastodon, GitHub raw (live), Next image optimizer, Dify `file_response.py`, LobeChat / cal.com avatars | Allowlist, nosniff and icon CSP: **ALIGNED**. No CSP on previews: **RECONSIDER**. Send `Content-Security-Policy: sandbox` on every file answer except PDF (Outline's split) |
| E. Translated text for the app's own codes, Dify's message for Dify's codes, generic fallback | LobeChat, documenso, cal.com, Dify `web/`, Vercel chatbot | **ALIGNED** |
| F. Stop: one request plus a state flip, latest state through a ref, no side effects in the updater | Dify `web/` chat hooks and text-generation hooks, Ant Design X `useXChat`, Vercel AI SDK `Chat.stop`, LobeChat store | **ALIGNED**. Optional: record the task id when the event is parsed, or show Stop only once a task id exists, as Dify does |

---

## A. Proxying Dify through Route Handlers

What we built: one `route.ts` per Dify operation. `resolveDifyRoute` checks the session, then the app, then its
credentials. `passthrough()` = `new Response(upstream.body, { status, headers })` with an allowlist
(`content-type`, `content-disposition`, `content-length` unless `content-encoding` was present, `accept-ranges`).
Cache-Control is never forwarded. The request's `signal` goes to the upstream fetch.

Projects:

- **honojs/hono `src/helper/proxy/index.ts` @5f36607f.** `proxy()` is Hono's documented proxy helper, and Hono is
  the server under documenso's `apps/remix/server`. It returns `new Response(res.body, { status: res.status,
  statusText, headers })` after deleting the hop-by-hop headers and the headers named in `Connection`. Then:
  `if (resHeaders.has('content-encoding')) { resHeaders.delete('content-encoding'); resHeaders.delete('content-length') }`
  ("Content-Length is the size of the compressed content"). Its docs example also removes `Set-Cookie` by hand.
  It uses a denylist, so everything else (Cache-Control, Set-Cookie) passes.
- **open-webui `backend/open_webui/routers/openai.py` @8bd8b4fa.** An LLM stream passthrough:
  `StreamingResponse(stream_wrapper(response, passthrough=True), status_code=response.status,
  headers=_clean_proxy_headers(response.headers))`, with `_STRIP_PROXY_HEADERS = {'content-encoding',
  'content-length', 'transfer-encoding', 'server', 'date'}`. The comment cites aiohttp#4462: the client has already
  decoded the body, so forwarding the encoding header breaks clients. This is a denylist too.
- **langgenius/webapp-conversation `app/api/chat-messages/route.ts` @33085b66** (Dify's own Next.js template, from
  the earlier survey). It returns `new Response(res.data as any)`: the body only. Status and headers are lost, so an
  upstream 4xx reaches the browser as 200. There is no session check (a cookie session id only).
- **LobeChat `src/app/(backend)/webapi/chat/[provider]/route.ts` @dc9cd248.** A `checkAuth` wrapper runs first, and
  `signal: req.signal` goes to the upstream call (the same as ours). The answer is re-emitted rather than passed
  through: `packages/model-runtime/src/utils/response.ts` `StreamingResponse` sets `Cache-Control: no-cache`,
  `Content-Type: text/event-stream` and `X-Accel-Buffering: no` ("for Nginx: disable chunk buffering").
- **vercel/ai `packages/ai/src/ui-message-stream/ui-message-stream-headers.ts` @fab95c1a.** Sets
  `cache-control: no-cache`, `connection: keep-alive` and `x-accel-buffering: no` ("disable nginx buffering").
  vercel/chatbot `app/(chat)/api/chat/route.ts` @c2f8235e answers with `createUIMessageStreamResponse`, so it
  re-emits and does not pass through. It parses the body before `auth()`; ours checks the session first.
- **langgenius/dify `web/`** has no API Route Handlers (only `web/app/auth/refresh/route.ts` and `web/proxy.ts`).
  The browser calls Dify's API directly, so Dify's main front end is not a BFF reference. webapp-conversation is.

Verdict: **ALIGNED.** Handing back the upstream body and status unchanged, and the `content-encoding` →
drop-`content-length` rule, match Hono and Open WebUI. Our allowlist is stricter than their denylists: both would
forward an upstream `Set-Cookie` or `Cache-Control` unless the caller strips it. Checking the session first in each
route matches LobeChat's `checkAuth` wrapper.

- **Reconsider `accept-ranges` (small).** Dify adds `Accept-Ranges: bytes` for audio and video
  (`api/controllers/service_api/app/file_preview.py`, `_RANGE_MEDIA_TYPES`). It answers with a Flask `Response`
  over `storage.load_stream(...)` (`services/message_file_preview_service.py`): no `make_conditional`, no 206.
  The hub forwards neither `Range` (request) nor `Content-Range` (answer). So the hub advertises byte ranges that
  nobody serves. Drop `accept-ranges` from `PASSTHROUGH_HEADERS`, or carry `Range`/`Content-Range`/206 end to end
  if Dify ever honours them. Outline's commit 110c3327 ("fix: Byte range handling for media in Safari", #13695)
  shows what Safari media playback needs from a file route.
- **Optional, for SSE answers.** Every project that emits SSE itself (LobeChat, the AI SDK) sets
  `Cache-Control: no-cache` and `X-Accel-Buffering: no`. These would be the hub's own headers, not forwarded ones,
  so they do not conflict with "never forward Cache-Control". They matter only if a buffering reverse proxy
  (nginx) may sit in front of the hub. Dify's own SSE (`api/libs/helper.py` `compact_generate_response`) sends only
  `text/event-stream`, so nothing is lost by the allowlist.

## B. Validating dynamic route segments

What we built: every segment except `appId` is checked against
`pathSegment = /^(?!\.{1,2}$)[A-Za-z0-9._~-]{1,256}$/`, with a 400 `invalid_param` on failure, then
`encodeURIComponent` before it goes into the Dify URL. Body ids use `z.uuid()`. `appId` only reaches a database
lookup.

Projects:

- **Dify's API itself (`api/controllers/service_api/app/*.py` @5a733bd5).** Werkzeug converters per id kind:
  `/conversations/<uuid:conversation_id>`, `/messages/<uuid:message_id>/feedbacks|suggested`,
  `/files/<uuid:file_id>/preview`, `/apps/annotations/<uuid:annotation_id>` (strict 8-4-4-4-12 hex; no match
  gives 404). `<string:...>` (Werkzeug `[^/]+`) is used for `/chat-messages/<string:task_id>/stop`,
  `/completion-messages/<string:task_id>/stop`, `/workflows/tasks/<string:task_id>/stop`,
  `/workflow/<string:workflow_run_id>/events` and `/form/human_input/<string:form_token>`.
- **Dify Node SDK (`sdks/nodejs-client/src/client/chat.ts`, `validation.ts`) and webapp-conversation
  (`app/api/conversations/[conversationId]/name/route.ts`, `app/api/messages/[messageId]/feedbacks/route.ts`).**
  The SDK only calls `ensureNonEmptyString(taskId, 'taskId')` and then builds `path: \`/chat-messages/${taskId}/stop\``.
  There is no encoding and no character check, and `new URL(base + path)` would resolve a `..`. The template passes
  the route param to the SDK unchecked.
- **Outline `server/utils/zod.ts` @6e6eaf6b.** Shared helpers, one per id kind:
  `zodIdType = () => z.union([z.string().regex(UrlHelper.SLUG_URL_REGEX), z.uuid()])`, `zodShareIdType`, and plain
  `z.uuid()` in the route schemas (e.g. `server/routes/api/attachments/schema.ts`). The validate middleware
  answers 400.
- **vercel/chatbot `app/(chat)/api/chat/schema.ts` @c2f8235e.** The body `id: z.uuid()`. The `DELETE ?id=` in
  `api/chat/route.ts` is only checked for presence (`if (!id) bad_request:api`) before a database query.
- **documenso `apps/remix/server/api/files/files.types.ts` @2fa64495.** Hono
  `sValidator('param', z.object({ envelopeId: z.string().min(1), envelopeItemId: z.string().min(1) }))`. API v1
  ids are `z.number()`.
- **cal.com (`calcom/cal.diy` @54343aa6).** `apps/web/app/api/avatar/[uuid]/route.ts` uses
  `z.object({ uuid: z.string().transform(k => k.split('.')[0]) })` and a 400 with `error.validation.<code>`. API v2
  (NestJS) uses `@Param('eventTypeId', ParseIntPipe)` for numbers and an unchecked `@Param('bookingUid') string`
  for uids.

Verdict: **DIFFERS-BUT-SOUND.** The common style is one schema per id kind: `z.uuid()` where the id is a UUID
(Outline, chatbot, Dify's own converters), and a slug regex or `min(1)` otherwise. The database-bound projects get
away with `min(1)` because Prisma and Drizzle parameterise the query. Our segments go into an upstream URL path.
There, only a character rule and the `.`/`..` refusal stop a segment from rewriting the path. None of the
Dify-ecosystem references (the SDK, the template) do this, so ours is the safer choice. Optional tightening: use
`z.uuid()` for the conversation, message, file and annotation ids to mirror Dify's `<uuid:...>` converters (an
early 400 instead of Dify's 404). That means changing the e2e stub's `file-<uuid>` ids. Keep `pathSegment` for
`task_id`, `workflow_run_id` and `form_token`, which are `string` in Dify.

## C. The remote-file route

What we built: `resolveRemoteFileUrl` parses relative links against the API origin and requires the same origin,
http(s), no userinfo, no `%2F`/`%5C`/`%25` in the path, and a path under `/files/` or `<base>/files/`. The fetch
uses `redirect: 'error'`.

Projects:

- **Next.js image optimizer (`packages/next/src/shared/lib/match-remote-pattern.ts`,
  `packages/next/src/server/image-optimizer.ts` @c6f8ac72).** An allowlist on protocol, hostname (picomatch glob),
  port, pathname (picomatch with `dot: true` on the parsed `url.pathname`) and exact `search`. It refuses `//`
  protocol-relative URLs, non-http(s) schemes and `url.length > 3072`. It resolves DNS and refuses private IPs
  unless `dangerouslyAllowLocalIP`. It **follows** up to 3 redirects (`maximumRedirects: 3`): `fetchExternalImage`
  recurses on `Location` and re-checks only private IPs, not `remotePatterns`. It has no rule against encoded
  separators.
- **Dify `api/core/file/remote_fetcher.py` @5a733bd5.** This is how Dify recognises its own file links.
  `_is_dify_file_origin` compares `(scheme, hostname.lower(), port or default)` with the origins of `FILES_URL` and
  `INTERNAL_FILES_URL`. Then come anchored path patterns:
  `^/files/(?P<file_id>[a-fA-F0-9-]+)/(file-preview|image-preview)$`,
  `^/files/tools/(?P<file_id>[a-fA-F0-9-]+)(\.[^/]*)?$` and `^/files/datasources/...`, followed by a check of the
  `timestamp/nonce/sign` signature. Anything else goes through `core/helper/ssrf_proxy.py`, where all outbound HTTP
  passes the Squid `ssrf_proxy` container (`docker/ssrf_proxy/`).
- **LobeChat `packages/ssrf-safe-fetch/index.ts` @dc9cd248.** Fetches arbitrary URLs through
  `request-filtering-agent` (denies private and metadata IPs, with an env allowlist). This is a different problem
  (an open URL), solved by IP filtering, not an origin allowlist.

Verdict: **ALIGNED** on the mechanism. It has the same shape as Dify's own `_is_dify_file_origin` (origin tuple,
then a `/files/` path) and is stricter than next/image in two places: redirects are refused rather than followed
unchecked, and encoded separators are refused. An exact single-origin allowlist is the strongest form available
when the target set is known, which is why the IP-filtering approaches (LobeChat, Dify's Squid proxy) are not
needed here.

- **Reconsider where the origin comes from.** Dify builds file links from `FILES_URL` (`AliasChoices("FILES_URL",
  "CONSOLE_API_URL")` in `api/configs/feature/__init__.py`), not from the service API URL. On Dify Cloud the links
  are `https://upload.dify.ai/files/<id>/file-preview?timestamp=...` and
  `https://upload.dify.ai/files/tools/<id>.xsl?...` (quoted in langgenius/dify issues #28105 and #22688), while the
  API base is `https://api.dify.ai/v1`. The hub answers 400 to every such link. A self-hosted Dify with an empty
  `FILES_URL` emits relative `/files/...` links, which resolve against the API origin, so it works there. Change:
  accept a configured files origin (deployment env or per app, defaulting to the API base origin), like Dify's
  `{FILES_URL, INTERNAL_FILES_URL}` set. Also do not send `Authorization: Bearer <app key>` to it: Dify's `/files/`
  routes authenticate by URL signature (`api/controllers/files/upload_file_delivery.py`), and today `request()`
  adds the key to every fetch, which would leak it once the files origin can differ.
- **Optional tightening.** Anchor the path the way Dify does (`/files/<uuid>/(file-preview|image-preview)`,
  `/files/tools/<id>.<ext>`, and the service API's `<base>/files/<uuid>/preview`) instead of accepting any
  `/files/` prefix.

## D. Serving user-uploaded files from the hub's origin

What we built:

- `X-Content-Type-Options: nosniff` on every file answer.
- `inline` only for png, jpeg, gif, webp, `audio/*`, `video/*`, pdf and text/plain. Anything else, or any
  content-type with a comma in it, becomes `attachment` (Dify's filename kept).
- The stored icon gets `default-src 'none'; style-src 'unsafe-inline'; sandbox`.
- Previews get no CSP.

Projects:

- **Outline `server/storage/files/BaseStorage.ts` @6e6eaf6b.** `safeInlineContentTypes = ["application/pdf",
  "image/png", "image/jpeg", "image/gif", "image/webp"]` plus `FileHelper.isAudio/isVideo`
  (`/^audio\/[!#$%&'*+.^\w\`|~-]+$/i`, anchored, so a parameter or a comma list fails) are inline; everything else
  is attachment. "SVGs are purposefully not included here as they can contain JS."
  `plugins/storage/server/api/files.ts` (last change fedbf28a) sends `Content-Security-Policy: sandbox` on every
  file except PDF. PDF gets `default-src 'self'; object-src 'self'; base-uri 'none';` ("Safari will not render PDFs
  in an embed if the sandbox directive is used"). Our inline list is Outline's plus `text/plain`.
- **Discourse `app/controllers/uploads_controller.rb` @1ea80f2c, `send_file_local_upload`.** `attachment` unless
  `FileHelper.is_inline_safe?`. In `lib/file_helper.rb` that list is images minus SVG ("SVG cannot safely be shown as
  a document"), plus pdf, video and audio. It sends `Content-Security-Policy: sandbox;` on **every** local upload,
  PDFs included. The check is by extension.
- **GitLab Workhorse `workhorse/internal/headers/content_headers.go` @0ab7ab5b.** It detects the type from the
  bytes (`http.DetectContentType`, with a special case for SVG) instead of trusting the declared type, and forces
  `text/*` to `text/plain`. Inline is allowed only for `image/*` (SVG excluded), `text/*`, `video/*` and pdf.
  Everything else is attachment with `application/octet-stream`; an SVG keeps its type so `<img>` still works.
- **Mastodon `dist/nginx.conf` @320d1342, `location ^~ /system/`** (uploads): `X-Content-Type-Options nosniff`
  and `Content-Security-Policy "default-src 'none'; form-action 'none'"`. Media is also transcoded on upload.
- **GitHub.** User content lives on a separate origin (`raw.githubusercontent.com`, `*.githubusercontent.com`).
  Live headers on 2026-10-07: `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`,
  `x-content-type-options: nosniff`, `x-frame-options: deny`. An `.svg` is served as `image/svg+xml` under the same
  CSP.
- **Next.js image optimizer defaults (`packages/next/src/shared/lib/image-config.ts` @c6f8ac72):**
  `contentSecurityPolicy: "script-src 'none'; frame-src 'none'; sandbox;"`, `contentDispositionType: 'attachment'`,
  `dangerouslyAllowSVG: false`.
- **Dify `api/controllers/common/file_response.py` @5a733bd5.** A denylist: `enforce_download_for_html` turns only
  `text/html`, `application/xhtml+xml` and `.html/.htm` into attachment + `application/octet-stream` + nosniff.
  `api/controllers/files/upload_file_delivery.py` also makes SVG an attachment on `/files/<id>/file-preview`. The
  service API `/v1/files/<id>/preview` (`service_api/app/file_preview.py`) applies only the HTML rule and sends
  `Cache-Control: public, max-age=3600`. So Dify lets SVG, XML or XSL (Dify Cloud links include `.xsl` tool files)
  through inline on the endpoint the hub proxies. The hub must not rely on Dify's own policy, and it does not.
- **Weaker examples.** LobeChat `src/app/(backend)/webapi/user/avatar/[id]/[image]/route.ts` serves
  `image/svg+xml` from the app origin with no nosniff and no CSP. cal.com `apps/web/app/api/avatar/[uuid]/route.ts`
  avoids the problem by converting SVG avatars to PNG and always answering `image/png`.

Verdict:

- **Inline allowlist, nosniff, the comma rule: ALIGNED.** This is the same shape as Outline, Discourse and GitLab,
  and stricter than Dify's own denylist. Trusting the declared type inside an allowlist plus nosniff is safe
  (a non-image declared as `image/png` cannot run). GitLab's byte sniffing is a different but not required choice.
- **The icon CSP: ALIGNED.** It is byte-identical to GitHub raw's policy.
- **No CSP on previews: RECONSIDER.** Every comparable self-hosted project puts a CSP on user-file answers:
  Outline (`sandbox` except PDF), Discourse (`sandbox` including PDF), Mastodon (`default-src 'none'`) and Next
  (`sandbox`). The stated reason, the PDF viewer, applies to `application/pdf` only. Change: in `filePassthrough`,
  send `Content-Security-Policy: sandbox` on every answer whose media type is not `application/pdf`. For PDF, send
  nothing, or Outline's `default-src 'self'; object-src 'self'; base-uri 'none'`. Check PDF, audio and video
  rendering in the e2e suite. A separate user-content origin (GitHub) remains the gold standard but is out of scope
  for a single-origin hub.
- **Cache-Control on files: DIFFERS-BUT-SOUND.** References cache session-gated files freely: documenso
  `files.helpers.ts` uses `public, max-age=31536000, immutable`, Outline `max-age=604800, immutable`, and Dify
  `public, max-age=3600`. Dropping the header is the most conservative choice; the cost is that previews are
  re-downloaded every time. If that matters, `private, max-age=3600` keeps the browser cache and still bars shared
  caches, as the hub's own icon route does with `private`.

## E. Error text in the UI

What we built: `failureText`. The app's own codes (`unauthorized`, `app_not_found`, `app_disabled`,
`upstream_error`, `upstream_unreachable`) map to i18n keys. Dify's codes show Dify's message. `internal_error` and
empty messages show the caller's translated fallback.

Projects:

- **LobeChat `src/features/Conversation/Error/index.tsx` @dc9cd248, `useErrorContent`.**
  `message: businessMessage || translatedMessage || rawErrorMessage`. `translatedMessage` comes from
  `getRuntimeErrorMessage(t, errorType, ...)` (`src/utils/locale/runtimeErrorMessage.ts`, keys
  `error:response.<X>` / `modelRuntime:<X>`), and only when `hasLocalizedErrorMessage(errorType)`. An error with no
  type shows the raw upstream message, and the raw body is available as details. On the server,
  `src/utils/errorResponse.ts` `createErrorResponse(errorType, body)` sends `{ body, errorType }` with the status
  from the code spec.
- **documenso `apps/remix/app/components/forms/password.tsx` @2fa64495.** `AppError.parseError(err)`, then
  `match(error.code).with(AppErrorCode.INCORRECT_PASSWORD, () => msg\`Current password is incorrect.\`)...`
  with `.otherwise(() => msg\`We encountered an unknown error...\`)`, rendered through Lingui `_()`. `CODE_STYLE.md`
  ("Error Parsing on Frontend") also shows the other half: a translated title plus `description: error.message`
  (the server's own text).
- **cal.com `apps/web/modules/auth/login-view.tsx` @54343aa6.**
  `errorMessages = { [ErrorCode.IncorrectEmailPassword]: t("incorrect_email_password"), ... }` and
  `setErrorMessage(errorMessages[res.error] || t("something_went_wrong"))`. Elsewhere toasts show the raw
  `error.message` (17 `showToast(error.message` call sites).
- **Dify `web/service/fetch.ts` @5a733bd5.** `const errorMessage = errorData?.message || errorData?.error;
  notifyRequestError(request, errorMessage)` shows the API's message verbatim. Codes only drive control flow
  (`web/service/base.ts`: `web_sso_auth_required` / `unauthorized` → re-auth, `already_setup`). The fallback is
  the English `'Server Error'`.
- **vercel/chatbot `lib/errors.ts` @c2f8235e.** `ChatbotError(code)` → `getMessageByErrorCode(code)`, English
  text built on the server. `visibilityBySurface` keeps database errors to the log.

Verdict: **ALIGNED.** This is LobeChat's split (the app's own error types localised, the upstream's raw message
otherwise) and documenso's (known codes → translated text, else a translated fallback). Dify's own UI shows Dify's
message verbatim, so the hub shows Dify users what Dify itself would. Notes:

- `lib/dify/errors.ts` already emits `forbidden` (AuthError), and the icon route emits `icon_not_found`. Neither is
  in `APP_CODE_KEYS`. Add them when B2 makes them reachable from the chat (LobeChat keeps one locale key per error
  type the app itself emits).
- The hub's own `invalid_param` answers ("Invalid request: ...", English) share Dify's code, so they show in
  English. That is acceptable only because the UI never sends an invalid request on purpose.

## F. Stop: one request plus a state flip

What we built (current `components/chat/hooks/use-workflow-run.ts`):

- An `AbortController` per run, held in a ref.
- `latest` is a ref mirrored in `useLayoutEffect`.
- `stop()` aborts, reads `status` and `taskId` from `latest.current`, and sets `'stopped'` with a functional update.
  It posts Dify's stop outside the updater, once, and only when a task id is known.

Projects:

- **Dify chat `web/app/components/base/chat/chat/hooks.ts` @5a733bd5.** `taskIdRef = useRef('')` is written in the
  stream callback when the event is parsed (`if (taskId) taskIdRef.current = taskId`, l. 638). `handleStop`
  (l. 527) sets `hasStopRespondedRef`, calls `handleResponding(false)`, then
  `if (stopChat && taskIdRef.current && !pausedStateRef.current) stopChat(taskIdRef.current)`, then aborts the
  AbortController refs. The side effects stay outside updaters, and the task id comes from a ref.
- **Dify text generation (completion and workflow, our exact case)**,
  `web/app/components/share/text-generation/result/hooks/use-result-run-state.ts` (last change a84c2d36).
  `handleStop` reads `currentTaskId` from state through the closure (useCallback deps) and guards with
  `isStopping`. It runs `await stopWorkflowMessage(...)` / `stopChatMessageResponding(...)`, then
  `abortControllerRef.current?.abort()`. The Stop control is only offered when `isResponding && currentTaskId`, so
  there is no Stop before a task id exists.
- **Ant Design X `packages/x-sdk/src/x-chat/index.ts` @8b76d6a2 (installed 2.9.0).**
  `abort: () => requestHandlerRef.current?.abort()`. The ref is assigned during render
  (`requestHandlerRef.current = provider?.request`). `XRequest.abort()` calls `this.abortController.abort()`, and
  the message status becomes `'abort'` in the request's error path. There is no server-side stop.
- **Vercel AI SDK `packages/ai/src/ui/chat.ts` @fab95c1a.** `stop = async () => { for (const c of
  this.pendingMessagePreparations) c.abort(); this.activeResumeRequest?.abortController.abort();
  this.activeResponse?.abortController.abort(); }` works on mutable instance fields, not React state. The status
  returns to `'ready'` in the `AbortError` catch. `packages/react/src/use-chat.ts` keeps a `latestRef` "refreshed on
  every render" (written during render) to avoid stale closures. There is no server stop request; servers rely on
  the request's abort signal.
- **LobeChat `src/store/chat/slices/agentRun/actions/entries/conversationControl.ts`.** `stopGenerateMessage`
  reads the current state with the zustand getter (`this.#get()`) and calls `cancelOperations(...)`, which aborts
  the operations' controllers outside `set`.

Verdict: **ALIGNED.** All of them keep the abort and the network call outside state updaters and read the latest
value from a mutable holder (a ref, an instance field, a store getter). Ours writes its ref in a layout effect,
which follows react.dev's "no refs during render" rule; X and the AI SDK write theirs during render. Only Dify,
the one backend here with a task-level stop API, posts a server stop, and we match it.

- **Optional, the gap compared with Dify.** `latest` mirrors *committed* state. A task id parsed from the first
  event but not yet committed is invisible to `stop()`. The Stop button shows as soon as the run is `running`, before
  any task id. A click in that window aborts the stream without Dify's stop. Dify closes this window both ways: the
  chat hook writes `taskIdRef` when the event is parsed, and text generation only offers Stop once `currentTaskId`
  is set. Either fits: set a `taskIdRef` inside the read loop, or show the button only once `state.taskId` exists.
  The comment "nothing runs on Dify to stop" is also inexact: the run exists on Dify once the POST is accepted;
  only its id is not yet known to the client.
