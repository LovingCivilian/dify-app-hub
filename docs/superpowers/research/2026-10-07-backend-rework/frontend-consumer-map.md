# Backend consumer map for dify-app-hub (branch fork/overhaul)

Repo root is `/home/madany/repos/dify-app-hub/`. Paths in the body are relative to that root; the last section lists every cited file with its absolute path. Line numbers point at the call or check.

## 0. Facts that apply to every route
- **Proxy gate (`proxy.ts:68-81`).** Without a next-auth token, every `/api/*` path except `/api/auth`, `/api/init` and `/api/health` answers `401 {error:'Unauthorized'}`. Route handlers return the same body through `unauthorizedResponse()` (`lib/session-user.ts:29`).
- **Dify user id.** Every `/api/client/dify/*` handler sets Dify's `user` from `getSessionUserId()`, which is the session email. The `user` the browser sends in a query or body is overridden.
- **`x-user-id` header.** `lib/dify-client.ts:26` sends `x-user-id` from localStorage `__DC__USER_ID`. No route reads it: `getUserIdFromRequest` in `lib/api-utils.ts:115` has no callers.
- **Two route response shapes.**
  - "Envelope" means `createDifyApiResponse` (`lib/api-utils.ts:102`): `{ code: <HTTP status>, data }`, with the HTTP status equal to `code`.
  - "Passthrough" means `createDifyResponseProxy` (`lib/api-utils.ts:57`) or a raw `NextResponse.json(difyBody, {status})`: Dify's own body and status.
- **`lib/dify-client.ts` starts with `// @ts-nocheck`** (line 1). It reads `options.appId`, which `IDifyApiOptions` in `lib/api/client.ts:307` does not declare.
- **Three different things are called `XRequest`:**
  - the class in `lib/api/base-request.ts`;
  - `BaseRequest` imported under the alias `XRequest` in `lib/dify-client.ts:5`;
  - x-sdk's `XRequest`, used in `components/chat/hooks/use-dify-chat.ts:233`.

## 1. The two request helpers
**`lib/api/base-request.ts`, class `XRequest`**
- `baseRequest` (`:24-44`) adds `Authorization: Bearer <apiKey>` and copies the `X-Version` header into `DIFY_INFO.version`.
- It **throws `UnauthorizedError` only on 401** (`:39-42`). Every other status resolves.
- `get`/`post`/`jsonRequest` return `result.json()`, so they reject only when the body is not JSON. `baseRequest` and `delete` return the raw `Response`.
- Only `lib/api/client.ts` (`DifyApi`, `:417` and `:431`) uses it. That `DifyApi` is used as a value only by the admin components `app-form-drawer.tsx`, `annotations-panel.tsx` and `app-actions.tsx`, which call Dify **directly**, not `/api` (§6).
- `UnauthorizedError` is re-exported (`lib/api/index.ts:1`) but nothing catches it by type.

**`lib/helpers/base-request.ts`, class `BaseRequest`**
- **Never throws on status.** `get`/`post`/`put` resolve `result.json()` for any status; `baseRequest` and `delete` resolve the raw `Response`.
- It drops `undefined` params, merges the constructor's headers, sets `Content-Type: application/json` on JSON calls and on `delete`, and sends a JSON body on DELETE.
- Users:
  - `lib/dify-client.ts:36,47`: baseURL `/api/client/dify/${appId}`. This is the chat client.
  - `services/app.ts:9`: baseURL `/api/client`.
  - `lib/core/utils.ts:13` (`genDifyRequestByRequestConfig`): no callers.

## 2. Who imports `lib/dify-client.ts` and `lib/api/client.ts`
Both are used, by different parts of the app.

**`lib/dify-client.ts`** (the chat client; its `DifyApi` targets `/api/client/dify/[appId]/*`)
- Value import: `components/chat/chat-workspace.tsx:10` (`createDifyApiInstance`).
- Type-only imports: `components/chat/app-context.tsx:6`, `hooks/use-conversations.ts:6`, `hooks/use-suggestions.ts:5`, `hooks/use-dify-chat.ts:18`, `hooks/use-tts.ts:5` (all under `components/chat/`).
- Methods nobody calls: `getAppInfo` (:53), `getAppMeta` (:60), `sendMessage` (:173), `getWorkflowResult` (:343, path `/workflows/run/<id>`, which has no route), `getHumanInputForm` (:381, GET; the route has POST only).

**`lib/api/client.ts`** (through the `@/lib/api` barrel; its `DifyApi` calls Dify directly)
- Value import of `DifyApi`: `components/admin/apps/app-form-drawer.tsx:9`, `annotations-panel.tsx:19`, `app-actions.tsx:9`.
- Types defined in `client.ts` and imported elsewhere:
  - `IGetAppInfoResponse`: `app-form-values.ts:1`, `app-record.ts:1`
  - `IAnnotationItem` and `IGetAnnotationListResponse`: `app-record.ts:1`, `annotation-form-modal.tsx:7`, `annotations-panel.tsx:19`
  - `IConversationItem`: `chat/hooks/use-conversations.ts:5`, `chat/provider/conversations.ts:3`
  - `lib/dify-client.ts:2,8-19` re-exports types from it.
- Every other `@/lib/api` import in `components/chat/**` is a type from `lib/api/types.ts` (`IFile`, `IFileType`, `IAgentThought`, `IRetrieverResource`), not from `client.ts`.
- `createDifyApiInstance` in `lib/api/client.ts:767` has no callers.

## 3. Map by backend route (sorted)

### `/api/auth/[...nextauth]` (next-auth 4.24)
- `components/auth/login-form.tsx:37`: `signIn('credentials', {email, password, redirect:false})`.
  - Requests made: GET `/api/auth/providers`, GET `/api/auth/csrf`, then POST `/api/auth/callback/credentials` (form-urlencoded, `json:true`).
  - Reads `result?.error` and shows "login failed". A throw shows "login error".
- `login-form.tsx:43`: `getSession()` does GET `/api/auth/session`. A truthy session leads to `router.push(getSafeCallbackUrl(callbackUrl))`.
- `components/shell/account-dropdown.tsx:44`: `signOut({callbackUrl:'/login'})` does GET `/api/auth/csrf`, POST `/api/auth/signout`, then a full page load.
- `account-dropdown.tsx:50`: `useSession()` reads `session.user.email`.
- `hooks/use-auth.ts:9`: `useSession()` gives `userId = session.user.email`. `chat-workspace.tsx:30,34` waits for it.
- `components/providers/app-providers.tsx:92`: `<SessionProvider session={session}>`, seeded from `app/layout.tsx:22`. With the default `refetchOnWindowFocus`, it does GET `/api/auth/session` on `visibilitychange`.

### `/api/auth/forgot-password`, POST
- `components/auth/forgot-password-form.tsx:18`: raw fetch with JSON `{email}`. Checks `response.ok` only (`:23`) and ignores the body.

### `/api/auth/reset-password`, POST
- `components/auth/reset-password-form.tsx:47`: raw fetch with `{token, password, confirmPassword}`. Checks `response.ok` (`:52`).
- Status 400 sets the expired state; the message comes from `resetFailureKey(status)` (`components/auth/auth-failure.ts:2`). The body is ignored.

### `/api/client/apps`, GET
- `components/chat/chat-workspace.tsx:38` calls `appService.getAppByID(appId)`, which runs `services/app.ts:15` (`BaseRequest.get('/apps')`, no status check).
- It **expects a bare `IDifyAppItem[]`** and calls `appList?.find(...)` (`services/app.ts:21`).
- The route returns a bare array through `createSafeApp`: `apiBase` real, `apiKey: '******'`.
- A JSON object instead of an array (for example the 401 `{error}`) makes `.find` throw a TypeError. `chat-workspace.tsx:57` catches it and shows the error Result with an empty message. An `undefined` result gives the "missing" state.

### `/api/client/apps/[id]`, GET
- No frontend caller.

### `/api/client/dify/[appId]/annotations`, POST
- `components/chat/chat-view/annotation-drawer.tsx:52`: `difyApi.createAnnotation({question, answer})` (`lib/dify-client.ts:118-123`, `BaseRequest.post`).
- **Expects the envelope.** `annotationError` (= `wrappedIdError`, `dify-errors.ts:94-100,107`) counts it as success only if `200≤code<300` and `data.id` is a string. Otherwise it runs `envelopeError(data, code)` and toasts the message or the generic text.

### `/api/client/dify/[appId]/audio2text`, POST multipart
- `components/chat/hooks/use-speech-to-text.ts:68`: `api.audio2Text(file)` (`lib/dify-client.ts:310-321`: fields `file` and `user`, then `.json()` then **`.data`**, so the envelope is unwrapped).
- `transcriptionError` (`dify-errors.ts:141`) needs a string `text`; otherwise `envelopeError(data)`. `:71` reads `.text`.
- Wired in `chat-view.tsx:213`.

### `/api/client/dify/[appId]/chat-messages`, POST, read as SSE
- `use-dify-chat.ts:233-240` builds x-sdk `XRequest(url, {manual, fetch: createDifyFetch(appId), params:{response_mode:'streaming'}})` inside `DifyChatProvider`.
- Body built by `dify-chat-provider.ts:319-333`: `{query, inputs, files, response_mode:'streaming', auto_generate_name:false, conversation_id}`.
- The actual request is `components/chat/provider/dify-fetch.ts:52-57`, a raw fetch POST with an abort signal.
- **`:58` checks `response.ok`.** When it is false, `readDifyError` (`:17-29`) parses `{code?, message?, error?}` into `DifyRequestError(status, code, message ?? error ?? statusText)`.
- When it is OK, the Response goes back to x-sdk `XRequest`, which **picks its parser from `Content-Type`**: `text/event-stream` means SSE; `application/json` means one JSON chunk (an error only if `success===false`); anything else throws (x-sdk 2.9.0 `es/x-request/index.js:142-154`).
- Each SSE frame goes through `parseEvent` and `applyEvent` (`dify-chat-provider.ts:87ff`).
- A failure goes to `requestFallback` and `fallbackMessage` (`use-dify-chat.ts:200`), which stores `{code, message, status}` on the message.

### `/api/client/dify/[appId]/chat-messages/[taskId]/stop`, POST
- `use-dify-chat.ts:342`: `api.stopTask(taskId).catch(() => undefined)` (`lib/dify-client.ts:211-215`, body `{user}`).
- The result is ignored; the stream is aborted first (`:340`). Triggered from `chat-view.tsx:664`.

### `/api/client/dify/[appId]/completion-messages`, POST, read as SSE
- `use-workflow-run.ts:63`: `difyApi.completion({inputs})` (`lib/dify-client.ts:352-364`, raw Response; body `{inputs, response_mode:'streaming', user}`).
- **`:70` checks `!response.ok || !response.body`.** In that case it calls `response.json()` and `envelopeError(body, status)`, which expects the passthrough Dify body `{code, message, status}`. The proxy's own `{error}` yields an empty message.
- Otherwise `:81` reads the body with `XStream` (no content-type check), then `parseEvent` and `reduceRunEvent`.
- Triggered from `workflow-view.tsx:71`.

### `/api/client/dify/[appId]/conversation/[conversationId]`, DELETE
- `use-conversations.ts:230`: `difyApi.deleteConversation(difyId)` (`lib/dify-client.ts:128-132`, `BaseRequest.delete` with JSON body `{user}`, raw Response).
- **`:231` checks `response.ok`.** When false, `response.json()` and `envelopeError(body, status)` are thrown.
- Route fact: it answers `200 {code:200, data:{}}` after proxying, whatever Dify's status (`route.ts:30-41`). Only the proxy's own 401, 404 and 500 reach the `!ok` branch.
- Triggered from `use-conversation-menu.tsx:146`, which toasts the message.

### `/api/client/dify/[appId]/conversation/[conversationId]/messages`, GET
- `use-dify-chat.ts:96`, inside `fetchPage`: `difyApi.listMessages(difyId, {first_id, limit:20})` (`lib/dify-client.ts:137-168`; query `user, conversation_id, first_id?, limit`).
- **Expects Dify's raw page, not the envelope:** `{data: HistoryMessage[], has_more}`. When `data` is not an array, `:99` throws `envelopeError(answer)` built from the raw Dify error body.
- `history-paging.ts:20-28` reads `has_more` and `data[0].id`.
- `HistoryMessage` fields used (`provider/history.ts:87-103`): `id, conversation_id, inputs, query, answer, message_files, feedback.rating, status, error, agent_thoughts, retriever_resources, extra_contents, created_at`.
- Three callers:
  - `defaultMessages` (`:262-272`, through `loadLatestPage` at `:144`);
  - `retryHistory` (`:378-394`, from `chat-view.tsx:603`);
  - `loadEarlier` (`:353-371`, from `message-list.tsx:77`, which shows a generic toast on failure).

### `/api/client/dify/[appId]/conversation/[conversationId]/name`, POST
- `use-conversations.ts:178`: `renameConversation({conversation_id, name})` (`lib/dify-client.ts:94-113`, body `{name, user}`).
  - **Expects the envelope.** `renameError` (`dify-errors.ts:114`) needs `200≤code<300` and a string `data.id`; otherwise it throws `DifyRequestError`. Triggered from `use-conversation-menu.tsx:126`.
- `use-conversations.ts:205`: `renameConversation({conversation_id, auto_generate:true})`.
  - `:209` runs `renameError`. `:210` reads **`answer.data.name`**, which must be a non-empty string that is not the placeholder.
  - Triggered from `chat-view.tsx:107` as `generateName(key).then(refresh)`.

### `/api/client/dify/[appId]/conversations`, GET
- `use-conversations.ts:90`: `listConversations({limit:100, sort_by:'-updated_at'})` (`lib/dify-client.ts:82-89`; query `user, limit, last_id?, sort_by?`).
- **Expects Dify's raw page, not the envelope:** `{data: IConversationItem[]}`. When `data` is not an array, `:96` stores `envelopeError(answer)` as `error`; `chat-view.tsx:184-189` toasts it.
- Item fields read: `id, name, updated_at, inputs` (`provider/conversations.ts:38-49`).
- Called on first load (`:124`), after `generateName` (`chat-view.tsx:107`) and when a reply ends (`chat-view.tsx:175`).

### `/api/client/dify/[appId]/feedback`
- No frontend caller.

### `/api/client/dify/[appId]/files/[fileId]/preview`, GET
- `components/chat/message/message-files.tsx:74`: `difyApi.filePreview({file_id, as_attachment:true})` (`lib/dify-client.ts:369-376`, raw Response).
- **`:78` checks `response.ok`.** Then it reads `response.blob()` and the `Content-Disposition` header (`filename*=UTF-8''` or `filename=`).

### `/api/client/dify/[appId]/files/upload`, POST multipart
- `use-dify-upload.ts:77`: `difyApi.uploadFile(file)` (`lib/dify-client.ts:220-231`: `.json()` then **`.data`**, so the envelope is unwrapped).
- `uploadAnswerError` (`dify-errors.ts:134`) needs a string `data.id`; otherwise `envelopeError(data)`.
- On success the Dify file object becomes the antd item's `response`. `file-upload.tsx:100` and `sender-attachments.tsx:98` read `item.response.id` as `upload_file_id`.
- Used by `file-upload.tsx:84` and `sender-attachments.tsx:55`.

### `/api/client/dify/[appId]/form/human_input/[formToken]`, POST
- `chat-view.tsx:316`: `difyApi.submitHumanInput(token, {inputs, action, user})` (`lib/dify-client.ts:388-393`).
- **Envelope.** `humanInputSubmitError` (`dify-errors.ts:35-52`) counts success as `2xx` with neither `data.error` nor a top-level `error`.
- On failure, `data.error` is **Dify's error body as a JSON string**; it is parsed and passed to `envelopeError(parsed, code)`.
- After an accepted submit, the resume goes to the `/workflow/[taskId]/events` route below (`chat-view.tsx:324`).

### `/api/client/dify/[appId]/info`, `/api/client/dify/[appId]/meta`
- No frontend callers.

### `/api/client/dify/[appId]/messages/[messageId]/feedbacks`, POST
- `chat-view.tsx:399`: `createMessageFeedback({messageId, rating:'like'|'dislike'|null, content})` (`lib/dify-client.ts:252-274`).
- `feedbackError` (`dify-errors.ts:85-91`) needs **`{code:2xx, data:{result:'success'}}`**.
- On failure it parses `data.detail` (Dify's error text) as JSON and runs `envelopeError(parsed, code)`. The optimistic rating is rolled back.

### `/api/client/dify/[appId]/messages/[messageId]/suggested`, GET
- `use-suggestions.ts:41-49`: `getNextSuggestions({message_id})` (`lib/dify-client.ts:236-247`).
- **Expects `{code, data: string[]}`.** It takes `result.data` if that is an array and keeps the strings; anything else gives `[]`, and a rejection gives `null`.
- Enabled by `parameters.suggested_questions_after_answer.enabled` (`chat-view.tsx:195`).

### `/api/client/dify/[appId]/parameters`, GET
- `chat-workspace.tsx:51`: `difyApi.getAppParameters().then(toAppParameters)` (`lib/dify-client.ts:67-69`).
- **Expects the raw Dify body, not the envelope.** `components/chat/app-answers.ts:78-83` requires a `user_input_form` array; otherwise it throws `envelopeError(answer)`, which the error Result shows.

### `/api/client/dify/[appId]/site`, GET
- `chat-workspace.tsx:52`: `difyApi.getAppSiteSetting()` (`lib/dify-client.ts:75-77`, which **unwraps `.data`**).
  - `toSiteSetting` (`app-answers.ts:89-93`) uses it if `title` is a string; otherwise, or on rejection, it uses `DEFAULT_APP_SITE_SETTING`.
  - `site.title` and `site.description` are read in `chat-view.tsx:532`, `conversation-sidebar.tsx:43,57-58`, `welcome-panel.tsx:21` and `workflow-view.tsx:81`.
- `components/apps/app-icon.tsx:43`: raw `fetch` followed by `response.json()` with **no ok check**.
  - `app-icon-kind.ts:16-30` reads **the envelope's `answer.data`**: `icon_type` `emoji` with `icon` (and `icon_background`), `image` with `icon_url`, or `link` with `icon`. Anything else, or a rejection, gives the mode icon.
  - `AppIcon` renders once per card (`components/apps/app-card.tsx:38`) and once per admin table row (`components/admin/apps/app-management.tsx:80`).

### `/api/client/dify/[appId]/text2audio`, POST
- `use-tts.ts:67`: `difyApi.text2Audio({text})` (`lib/dify-client.ts:279-304`, raw Response, body `{text, user}`).
- `audioAnswerError` (`dify-errors.ts:121-126`) counts success as `response.ok` **and** a Content-Type without `json`. Otherwise it runs `response.json()` and `envelopeError(body, status)`.
- Then `:70` calls `response.blob()` and plays it. Used by `message-footer.tsx:75`.

### `/api/client/dify/[appId]/workflow/[taskId]/events`, GET, read as SSE
- `dify-fetch.ts:45-51`: raw fetch, used when the request body has `resume` (`use-dify-chat.ts:346-349` calls `onReload`).
- `!ok` goes to `readDifyError`. OK responses need `Content-Type: text/event-stream` for x-sdk `XRequest`, as with `chat-messages`.

### `/api/client/dify/[appId]/workflows/run`
- **POST, read as SSE:** `use-workflow-run.ts:62`, `difyApi.runWorkflow({inputs})` (`lib/dify-client.ts:326-338`). Handled exactly like `completion-messages` (`:70-81`).
- **GET** (`?id=`): no caller.

### `/api/health`, GET
- No frontend caller; only the e2e harness uses it.

### `/api/init`, POST
- `components/auth/init-form.tsx:30`: raw fetch with `{name, email, password}`.
- `:35` checks `response.ok` and then goes to `/login?email=`. Otherwise `initFailureKey(status)`; a 400 also goes to `/login`. The body is ignored.

### `/api/init/status`, GET
- `proxy.ts:85` (middleware, on every gated page request) reads `data.initialized` (`:86-87`). A falsy value redirects to `/init`; errors are ignored.

### `/api/users`
- **POST:** `components/admin/users/user-form-drawer.tsx:50`, raw fetch with `{name, email, password}`. `:55` checks `response.ok`.
  - Failures map through `userErrorKey(status, 'create')` (`user-errors.ts:7-16`): 401 → session_expired, 404 → not_found, 400 → email_in_use, anything else → operation_failed.
  - The body is ignored. Success calls `router.refresh()`.
- **GET:** no frontend caller; the server page uses `lib/data/users`.

### `/api/users/[id]`
- **PUT:** `user-form-drawer.tsx:50`, same handling with action `'update'`.
- **DELETE:** `components/admin/users/user-management.tsx:61`. `:62` checks `response.ok` and uses `userErrorKey(status, 'delete')` (400 → cannot_delete_self). Success calls `router.refresh()`.

## 4. Server Actions in `app/(admin)/app-management/actions.ts` (`'use server'`)
- **`listApp({isMask})` (`:14`).** Server-side only: `app/(admin)/app-management/page.tsx:10` with `isMask:true`. `maskApiKey4AppConfig` (`utils.ts:8`) sets `apiKey:'app-***'`, and `toAdminAppRows` trims the result.
- **`getApp(id)` (`:30`).** Not masked, so it returns the real key.
  - Called from `components/admin/apps/use-app-record.ts:140` (edit and annotation drawers) and `app-actions.tsx:30` (sync).
  - Expects `IDifyAppItem | null`: `null` → not_found; a throw → operation_failed.
- **`createApp(item)` (`:45`).** Called from `app-form-drawer.tsx:82`. Any resolution counts as success (the return value is unused); a rejection ("Failed to add app") → save_failed.
- **`updateApp(item)` (`:52`).** Called from `app-form-drawer.tsx:77` and `app-actions.tsx:38`. **It resolves `{success:false, message}` on failure and does not reject.** Callers check `isFailedUpdate` (`app-record.ts:171`).
- **`deleteApp(id)` (`:41`).** Called from `app-actions.tsx:59`. Resolution means success; a rejection → delete_failed.
- Every success path calls `router.refresh()`.
- `repository/app.ts` and `app/(admin)/app-management/utils.ts` are also `'use server'`, so their exports are action endpoints. No client code imports them.

## 5. `lib/data/*`, `repository/*` and session calls from server pages and layouts
- `app/(user)/apps/page.tsx:13`: `getAppList` (`repository/app.ts:55`) then `toAppSummaries` (`components/apps/app-summary.ts:16`), which keeps enabled apps and passes `id, info.{name, description, mode, tags}`.
- `app/(user)/chat/page.tsx:10`: `getAppList`, then a redirect to the first enabled app or to `/apps`.
- `app/(admin)/app-management/page.tsx:10`: `listApp` (§4).
- `app/(admin)/user-management/page.tsx:9`: `listUsers` (`lib/data/users.ts:125`: `id, name, email, createdAt, updatedAt`) plus `getCachedServerSession`, which gives `currentUserId = session.user.id`.
- `app/init/page.tsx:12`: `hasUsers` (`lib/data/users.ts:139`); if users exist, redirect to `/login`.
- Session gates:
  - `requireSessionUser`: `app/(user)/layout.tsx:6`, `app/(admin)/layout.tsx:7`, `apps/page.tsx:12`, `app-management/page.tsx:9`, `user-management/page.tsx:8`.
  - `redirectSignedInUser`: `app/(auth)/login/layout.tsx:6`, `app/(auth)/forgot-password/layout.tsx:5`.
  - `app/layout.tsx:22`: `getCachedServerSession`, passed to `SessionProvider`.
- `app/(auth)/forgot-password/page.tsx:6` calls `isMailConfigured()`.
- `app/(user)/chat/[appId]/page.tsx` reads no data; the client `ChatWorkspace` fetches `/api/client/apps`.
- `app/api/apps.ts` is not a `route.ts`, so Next does not route it.

## 6. Calls that bypass the app backend (browser to Dify, `lib/api` `DifyApi`, needs the real key from `getApp`)
- `app-form-drawer.tsx:64-70`: `getAppInfo()` does GET `${apiBase}/info` with the Bearer key, under `.catch(()=>undefined)`. `isAppInfo` (`app-record.ts:167`) needs a string `name`; otherwise "dify_unreachable".
- `app-actions.tsx:35`: the same call; it throws if the answer is not app info.
- `annotations-panel.tsx`:
  - `:51` creates the `DifyApi`;
  - `:58` `getAnnotationList` does GET `/apps/annotations?page&limit&keyword`; `isAnnotationPage` needs a `data` array and a numeric `total`;
  - `:79` `updateAnnotation` (PUT) and `:80` `createAnnotation` (POST); `isAnnotationItem` needs a string `id`;
  - `:93` `deleteAnnotation`, which checks `response.ok`.

## 7. Error-body parsers and the shape each expects
| Parser | Expected input |
|---|---|
| `readDifyError` (`dify-fetch.ts:17`) | Non-OK Response with JSON `{code?, message?, error?}` |
| `envelopeError` (`dify-errors.ts:11`) | Dify's raw error body `{status?:number, code?:string, message?:string}`, plus a fallback status |
| `toDifyError` (`:21`) | Anything; a non-`DifyRequestError` becomes status 0 with an empty message |
| `humanInputSubmitError` (`:35`) | `{code, data:{error?: '<Dify JSON text>'}}` or `{error}` |
| `feedbackError` (`:85`) | `{code, data:{result:'success'} \| {error, detail:'<Dify JSON text>'}}` |
| `annotationError` / `renameError` (`:94-114`) | `{code, data:{id} \| <Dify error body>}` |
| `audioAnswerError` (`:121`) | The Response itself; a JSON content-type or `!ok` counts as an error |
| `uploadAnswerError` (`:134`) | The unwrapped `data` (with `id`) |
| `transcriptionError` (`:141`) | The unwrapped `data` (with `text`) |
| `toAppParameters` (`app-answers.ts:78`) | Raw body with a `user_input_form` array |
| `toSiteSetting` (`app-answers.ts:89`) | Unwrapped `data` with `title` |
| `toAppIconKind` (`app-icon-kind.ts:16`) | The envelope, reading `.data` |
| `userErrorKey`, `resetFailureKey`, `initFailureKey` | Status only; the body is ignored |

## 8. Client-side consumers of `IDifyAppItem` / `requestConfig`
**Chat side** (the full item from GET `/api/client/apps`, with the key masked as `'******'`)
- `chat-workspace.tsx`: `app.id` (`:44`), `...app.requestConfig` (`:46`; `lib/dify-client` ignores `apiBase`/`apiKey`), `app.info.mode` (`:115`).
- `app-context.tsx:11` types the context value as `IDifyAppItem`.
- `chat-view.tsx`: `app.id` (`:90`, `:98`), `inputParams.enableUpdateAfterCvstStarts` (`:117`), `extConfig.conversation.openingStatement.displayMode` (`:465`), `info.name` (`:532`), `extConfig.annotation.enabled` (`:696`).
- `inputs-collapse.tsx:59`: `inputParams.enableUpdateAfterCvstStarts`.
- `user-content.tsx:36`: `answerForm.enabled` and `answerForm.feedbackText`.
- `conversation-sidebar.tsx:43,57-58`: `info.name`, `info.description`.
- `welcome-panel.tsx:21`: `info.name`.
- `message-footer.tsx:79`: `extConfig.annotation.enabled`.
- `file-upload.tsx:91` and `message-files.tsx:53`: **`requestConfig.apiBase`**, passed to `completeFileUrl` (`utils-index.ts:47`).
- `use-workflow-run.ts:31` and `workflow-view.tsx:126`: `info.mode`. `workflow-view.tsx:81`: `info.name`.
- `services/app.ts:21`: `id`.

So the browser needs `id`, `info.{name, mode, description}`, `requestConfig.apiBase`, `inputParams.enableUpdateAfterCvstStarts`, `extConfig.conversation.openingStatement.displayMode`, `extConfig.annotation.enabled` and `answerForm.{enabled, feedbackText}`. The chat never reads `apiKey`, `isEnabled` or `info.tags`.

**Admin side** (the full unmasked item from `getApp`)
- `app-form-values.ts:34-53` (`toAppFormValues`) reads the same settings plus `requestConfig.apiKey` and `isEnabled`. `:56-76` (`fromAppFormValues`) builds the saved item.
- `app-form-drawer.tsx:29,107`; `annotations-panel.tsx:39,51`; `app-actions.tsx:35-38`; `annotations-drawer.tsx:21`; `app-settings-fields.tsx:11` (form paths `:52-133`); `app-record.ts:18`.

**Trimmed shapes** (not `IDifyAppItem` on the client)
- `AdminAppRow` (`admin-app-row.ts:37-44`) and `AppSummary` (`app-summary.ts:4-13`).

## 9. e2e specs that assert on backend behaviour
- **`auth.setup.ts:9-12`**: POST `/api/init` status is one of 200, 201, 400.
- **`harness.spec.ts:5`**: GET `/api/health` returns 200.
- **`auth.spec.ts`**
  - `:18` a wrong password shows "Login failed" (credentials callback).
  - `:27` the proxy adds a callbackUrl, and login lands on it.
  - `:45` `/init` sends an initialised instance to `/login` (`hasUsers`).
  - `:70` POST `/api/users` creates the user; the reset flow goes to `/login`; reusing the token gets **status 400** (`:105-108`) and the UI shows the expired message.
- **`admin-users.spec.ts`**
  - `:18` create, PUT and DELETE through `/api/users`; a duplicate email shows "already in use" (400).
  - `:72` seeds through `/api/users`; the signed-in admin's own row has no Delete.
  - `:95` `listUsers` dates render.
- **`admin-apps.spec.ts`**
  - `:58` sync: `getApp`, then Dify `/info`, then `updateApp`.
  - `:72` `deleteApp`.
  - `:112` create through Dify `/info` and `createApp`; the row icon comes from `/site` `data.icon_url`; edit uses `getApp`/`updateApp` and `isEnabled` persists.
  - `:144` a Dify 404 body on `/info` keeps the drawer open.
  - `:161` the drawer is filled from the `getApp` record.
  - `:204`, `:250` annotations through Dify directly.
- **`apps.spec.ts`**
  - `:19` the `/apps` SSR list shows enabled apps and hides disabled ones.
  - `:32` the emoji icon comes from the `/site` envelope; an app without a site gets the mode icon.
- **`ssr-first-paint.spec.ts`**
  - `:175` a signed-out GET `/apps` gets **307** to `/login?callbackUrl=%2Fapps`.
  - `:215` and `:225` the SSR HTML has the apps and no `app-e2e` key (`getAppList`, `listApp` with `isMask`).
  - `:234` the SSR user table comes from `listUsers`.
  - `:164` the session is in the SSR HTML.
- **`shell.spec.ts:51`**: `signOut` ends on `/login` with a full page load.
- **`smoke.spec.ts`**: `:69` signed-out redirect; `:75` the full chat chain answers from the stub.
- **`chat.spec.ts`**
  - `:127` and `:157` suggestions (`/suggested` envelope).
  - `:257` paging (`first_id`, `limit` 20, `has_more`).
  - `:355` a raw Dify 404 history body shows "Conversation Not Exists." with a retry.
  - `:375` rename and delete persist across a reload (`/name`, DELETE, `/conversations`).
  - `:508` the POST `/chat-messages` body has `auto_generate_name === false` (`:518`), and `data.name` from `/name` with `auto_generate` reaches the list.
- **`chat-errors.spec.ts`**: `:17` an SSE `error` event shows, live and from history `status:error`; `:32` a **POST to `/chat-messages/<task>/stop` is made** (`:38-45`).
- **`chat-feedback.spec.ts`**
  - `:60` POST `/feedbacks` body `{rating:'like'}`, **`response.ok()` true** (`:76-77`), kept after a reload.
  - `:90` dislike with content, then `rating:null`.
  - `:130` the same from the keyboard.
  - `:205` POST `/text2audio` body `{text}` (`:215-220`).
  - `:233` POST `/annotations` body `{question, answer}` (`:244-253`) and the success toast.
- **`chat-files.spec.ts`**
  - `:77` and `:106` read the `/files/upload` response **`.json().data.id`** (`:90`, `:118`); the `/chat-messages` body `files[0]` carries `upload_file_id`, `transfer_method:'local_file'` and `type:'document'`.
  - `:130` no upload POST for a refused type.
  - `:147` no chat POST while an upload is held.
  - `:181` a mocked `415 {code:415, data:{code, message, status}}` shows Dify's message on the card.
  - `:210` `parameters` toggles for files and speech.
- **`chat-hitl.spec.ts`**
  - `:45` a submit (POST `/form/human_input`) and the `/workflow/<run>/events` SSE resume continue in the same bubble.
  - `:74` a pending form from history (`extra_contents`).
  - `:90` exactly one POST.
  - `:114` a mocked `412 {code:412, data:{error:'<Dify JSON>'}}` shows "Submission failed: This form has expired."
- **`chat-race.spec.ts`**: `:16` the GET `…/messages` response comes before the POST `…/chat-messages` request; `:64` the queued-send guard.
- **`workflow.spec.ts`**
  - `:18` the `/workflows/run` SSE result.
  - `:39` stop makes `/workflows/run` a failed request.
  - `:66` an SSE error event.
  - `:75` **a non-OK passthrough body `{code, message, status}`** shows "topic is not valid."
- **`completion.spec.ts`**: `:14` SSE result; `:35` stop makes `/completion-messages` a failed request; `:49` an SSE error event.
- **`chat-chatflow.spec.ts`** (`:27`, `:49`, `:70`) and **`chat-agent.spec.ts:10`**: SSE event handling, plus history after a reload in `:49`.
- **Only indirect** (the chat must load; no backend assertion of their own): `chat-markdown`, `chat-mobile`, `chat-header`, `chat-layout`, `page-headers`, `providers`, `screenshots`.

## Absolute file index
/home/madany/repos/dify-app-hub/lib/api/base-request.ts
/home/madany/repos/dify-app-hub/lib/helpers/base-request.ts
/home/madany/repos/dify-app-hub/lib/api/client.ts
/home/madany/repos/dify-app-hub/lib/api/index.ts
/home/madany/repos/dify-app-hub/lib/dify-client.ts
/home/madany/repos/dify-app-hub/lib/api-utils.ts
/home/madany/repos/dify-app-hub/lib/session-user.ts
/home/madany/repos/dify-app-hub/lib/data/users.ts
/home/madany/repos/dify-app-hub/lib/core/utils.ts
/home/madany/repos/dify-app-hub/services/app.ts
/home/madany/repos/dify-app-hub/repository/app.ts
/home/madany/repos/dify-app-hub/proxy.ts
/home/madany/repos/dify-app-hub/app/layout.tsx
/home/madany/repos/dify-app-hub/app/api/apps.ts
/home/madany/repos/dify-app-hub/app/(admin)/app-management/actions.ts
/home/madany/repos/dify-app-hub/app/(admin)/app-management/utils.ts
/home/madany/repos/dify-app-hub/app/(admin)/app-management/page.tsx
/home/madany/repos/dify-app-hub/app/(admin)/user-management/page.tsx
/home/madany/repos/dify-app-hub/app/(admin)/layout.tsx
/home/madany/repos/dify-app-hub/app/(user)/layout.tsx
/home/madany/repos/dify-app-hub/app/(user)/apps/page.tsx
/home/madany/repos/dify-app-hub/app/(user)/chat/page.tsx
/home/madany/repos/dify-app-hub/app/(user)/chat/[appId]/page.tsx
/home/madany/repos/dify-app-hub/app/(auth)/login/layout.tsx
/home/madany/repos/dify-app-hub/app/(auth)/forgot-password/layout.tsx
/home/madany/repos/dify-app-hub/app/(auth)/forgot-password/page.tsx
/home/madany/repos/dify-app-hub/app/init/page.tsx
/home/madany/repos/dify-app-hub/app/api/client/dify/[appId]/conversation/[conversationId]/route.ts
/home/madany/repos/dify-app-hub/components/chat/chat-workspace.tsx
/home/madany/repos/dify-app-hub/components/chat/app-context.tsx
/home/madany/repos/dify-app-hub/components/chat/app-answers.ts
/home/madany/repos/dify-app-hub/components/chat/utils-index.ts
/home/madany/repos/dify-app-hub/components/chat/provider/dify-fetch.ts
/home/madany/repos/dify-app-hub/components/chat/provider/dify-chat-provider.ts
/home/madany/repos/dify-app-hub/components/chat/provider/conversations.ts
/home/madany/repos/dify-app-hub/components/chat/provider/history.ts
/home/madany/repos/dify-app-hub/components/chat/hooks/dify-errors.ts
/home/madany/repos/dify-app-hub/components/chat/hooks/history-paging.ts
/home/madany/repos/dify-app-hub/components/chat/hooks/use-conversations.ts
/home/madany/repos/dify-app-hub/components/chat/hooks/use-dify-chat.ts
/home/madany/repos/dify-app-hub/components/chat/hooks/use-suggestions.ts
/home/madany/repos/dify-app-hub/components/chat/hooks/use-tts.ts
/home/madany/repos/dify-app-hub/components/chat/hooks/use-dify-upload.ts
/home/madany/repos/dify-app-hub/components/chat/hooks/use-speech-to-text.ts
/home/madany/repos/dify-app-hub/components/chat/hooks/use-workflow-run.ts
/home/madany/repos/dify-app-hub/components/chat/chat-view/chat-view.tsx
/home/madany/repos/dify-app-hub/components/chat/chat-view/annotation-drawer.tsx
/home/madany/repos/dify-app-hub/components/chat/chat-view/use-conversation-menu.tsx
/home/madany/repos/dify-app-hub/components/chat/chat-view/message-list.tsx
/home/madany/repos/dify-app-hub/components/chat/chat-view/message-footer.tsx
/home/madany/repos/dify-app-hub/components/chat/chat-view/file-upload.tsx
/home/madany/repos/dify-app-hub/components/chat/chat-view/sender-attachments.tsx
/home/madany/repos/dify-app-hub/components/chat/chat-view/inputs-collapse.tsx
/home/madany/repos/dify-app-hub/components/chat/chat-view/user-content.tsx
/home/madany/repos/dify-app-hub/components/chat/chat-view/conversation-sidebar.tsx
/home/madany/repos/dify-app-hub/components/chat/chat-view/welcome-panel.tsx
/home/madany/repos/dify-app-hub/components/chat/message/message-files.tsx
/home/madany/repos/dify-app-hub/components/chat/workflow-view/workflow-view.tsx
/home/madany/repos/dify-app-hub/components/apps/app-icon.tsx
/home/madany/repos/dify-app-hub/components/apps/app-icon-kind.ts
/home/madany/repos/dify-app-hub/components/apps/app-card.tsx
/home/madany/repos/dify-app-hub/components/apps/app-summary.ts
/home/madany/repos/dify-app-hub/components/admin/apps/app-management.tsx
/home/madany/repos/dify-app-hub/components/admin/apps/app-actions.tsx
/home/madany/repos/dify-app-hub/components/admin/apps/app-form-drawer.tsx
/home/madany/repos/dify-app-hub/components/admin/apps/annotations-panel.tsx
/home/madany/repos/dify-app-hub/components/admin/apps/annotations-drawer.tsx
/home/madany/repos/dify-app-hub/components/admin/apps/annotation-form-modal.tsx
/home/madany/repos/dify-app-hub/components/admin/apps/app-settings-fields.tsx
/home/madany/repos/dify-app-hub/components/admin/apps/use-app-record.ts
/home/madany/repos/dify-app-hub/components/admin/apps/app-record.ts
/home/madany/repos/dify-app-hub/components/admin/apps/app-form-values.ts
/home/madany/repos/dify-app-hub/components/admin/apps/admin-app-row.ts
/home/madany/repos/dify-app-hub/components/admin/users/user-management.tsx
/home/madany/repos/dify-app-hub/components/admin/users/user-form-drawer.tsx
/home/madany/repos/dify-app-hub/components/admin/users/user-errors.ts
/home/madany/repos/dify-app-hub/components/auth/login-form.tsx
/home/madany/repos/dify-app-hub/components/auth/init-form.tsx
/home/madany/repos/dify-app-hub/components/auth/forgot-password-form.tsx
/home/madany/repos/dify-app-hub/components/auth/reset-password-form.tsx
/home/madany/repos/dify-app-hub/components/auth/auth-failure.ts
/home/madany/repos/dify-app-hub/components/shell/account-dropdown.tsx
/home/madany/repos/dify-app-hub/components/providers/app-providers.tsx
/home/madany/repos/dify-app-hub/hooks/use-auth.ts
/home/madany/repos/dify-app-hub/e2e/auth.setup.ts
/home/madany/repos/dify-app-hub/e2e/auth.spec.ts
/home/madany/repos/dify-app-hub/e2e/admin-users.spec.ts
/home/madany/repos/dify-app-hub/e2e/admin-apps.spec.ts
/home/madany/repos/dify-app-hub/e2e/apps.spec.ts
/home/madany/repos/dify-app-hub/e2e/harness.spec.ts
/home/madany/repos/dify-app-hub/e2e/smoke.spec.ts
/home/madany/repos/dify-app-hub/e2e/ssr-first-paint.spec.ts
/home/madany/repos/dify-app-hub/e2e/shell.spec.ts
/home/madany/repos/dify-app-hub/e2e/chat.spec.ts
/home/madany/repos/dify-app-hub/e2e/chat-errors.spec.ts
/home/madany/repos/dify-app-hub/e2e/chat-feedback.spec.ts
/home/madany/repos/dify-app-hub/e2e/chat-files.spec.ts
/home/madany/repos/dify-app-hub/e2e/chat-hitl.spec.ts
/home/madany/repos/dify-app-hub/e2e/chat-race.spec.ts
/home/madany/repos/dify-app-hub/e2e/chat-chatflow.spec.ts
/home/madany/repos/dify-app-hub/e2e/chat-agent.spec.ts
/home/madany/repos/dify-app-hub/e2e/workflow.spec.ts
/home/madany/repos/dify-app-hub/e2e/completion.spec.ts
