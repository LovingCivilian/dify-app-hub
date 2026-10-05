# Chat on Ant Design X — design (frontend overhaul, sub-project 2)

Date: 2026-10-04 · Status: draft for review · Branch: `feat/chat-on-ant-design-x` (from `fork/main` @ 11c3fb3d)

Governing documents: the charter (`2026-10-04-frontend-overhaul-charter.md`, §4 binding, §4.4 the chat mapping), ADR-0002 (documented approaches only), ADR-0008 (rebuild on antd 6 / X 2), ADR-0010 (Playwright + stub Dify), ADR-0011 (viewport-bound shells), ADR-0012 (alias block), ADR-0014 (header controls). Inputs from the foundation handoff ("Sub-project 2 inputs") are all addressed below. Research recorded in the charter is not repeated.

Library versions this spec was checked against: `@ant-design/x` 2.9.0, `@ant-design/x-sdk` 2.9.0, `@ant-design/x-markdown` 2.9.0, `antd` 6.6.5, `next` 16.3.4, `next-auth` 4.24. Dify API shapes come from `langgenius/dify-docs` → `en/api-reference/openapi_service.json` ("Dify Service API", schemas `ChunkChatEvent`, `ChunkWorkflowEvent`, `StreamEventBase` and the `StreamEvent*` family).

## 1. Goal and non-goals

**Goal.** Rebuild the `/chat/[appId]` page for every Dify app mode (chat, agent-chat, advanced-chat/chatflow, workflow, completion) on Ant Design X 2 and antd 6 the way their documentation prescribes, inside the user shell from sub-project 1, with no feature lost: conversations (list, new, rename, delete), opening statement and suggested questions, input-parameter form, streaming replies, reasoning, agent tool calls, chatflow node logs, human-in-the-loop (HITL) forms with continuation, retriever citations, files in and out, feedback, regenerate, annotation, text-to-speech, speech-to-text, next-question suggestions, the wide-screen toggle, the three deep-link URL parameters, and the workflow and completion runners.

**Also delivered**, because the chat is the first page to need them: a server-side session gate for the `(user)` and `(admin)` route groups, cookie-backed theme preference so the first HTML already has the right colour scheme, the viewport unit decision, the X locale for Arabic, the full stub Dify event catalogue, and the end of the chat's late-history race (and of the stub's test-only reset).

**Non-goals** (named so nobody drifts into them): the apps list, admin and auth pages (sub-project 3); removing the alias block, Tailwind, Lucide and Radix from the rest of the app (sub-project 4); RTL; roles or LDAP; the `/api/users/*` revoked-session gap; Dify's `chat_color_theme`; a conversation id in the URL; changes to backend files beyond the two named in §13.

## 2. Decisions this spec resolves

| Question (from the brief) | Decision | Source |
| --- | --- | --- |
| Late-history race | History loads through `useXChat`'s async `defaultMessages` keyed by `conversationKey`; a message sent while `isDefaultMessagesRequesting` goes through `queueRequest`, which the SDK flushes when the defaults land. Live reply and history share one store, so one can no longer wipe the other. The stub's `POST /__e2e/reset` and the smoke spec's `beforeEach` are deleted once the race e2e test passes. | use-x-chat skill (API: `conversationKey`, `defaultMessages`, `queueRequest`, `isDefaultMessagesRequesting`); implementation read in `x-sdk/es/x-chat/index.js` and `store.js` |
| Stub streams | One stub, five apps by path prefix; every event built from the OpenAPI schemas; scenarios chosen by query text; per-user scoping; body-parse hardening. | ADR-0010; `openapi_service.json` |
| X locale | `libs/x-locale.ts`: X's `en_US` and `zh_CN` plus a fork Arabic object of the public `xLocale` shape (20 strings), merged into the one `XProvider` as `{ ...antdLocale, ...xLocale }`. | X `XProvider` docs (COMPONENTS.md → XProvider); `@ant-design/x/es/locale/index.d.ts` |
| Gate design | Async server layouts in `(user)` and `(admin)` call `requireSessionUser()` (`getServerSession` + `redirect`); the proxy keeps gating navigations; client gates deleted; the shells server-render. | next-auth v4 "getServerSession in App Router"; Next `layout.md` (layouts do not re-render on navigation) |
| Dark first paint | Theme mode and last resolved scheme in two cookies read with `cookies()` in the root layout and passed to the providers; the `dark` body class is set on the server. | Next `cookies()` reference; antd `ConfigProvider.theme.algorithm` |
| 100vh vs 100dvh | `height: 100vh` then `height: 100dvh` in `shell.module.css` (cascade fallback). ADR-0011 gets a dated note. | ADR-0011 open item; CSS fallback cascade |
| One XProvider | Unchanged: the root stack only. The chat adds no provider; the providers e2e test (one `css-var-*` class) stays green. | ADR-0008 |
| PRs #7 and #8 | Closed as superseded; their behaviour is a requirement (§11), re-derived from the OpenAPI document and X's `Actions.Feedback` semantic slots, not copied from the diffs. | owner's instruction 2026-10-04 |
| App modes | Every mode, full page (owner's choice 2026-10-04). | — |
| Approach | Provider-centred rebuild (owner's choice 2026-10-04): one `AbstractChatProvider`, X components through `contentRender`, custom pieces on antd primitives. | ADR-0008 |

## 3. Architecture: routes, gate, first paint

### 3.1 Route group layouts become the gate

- `app/(user)/layout.tsx` and `app/(admin)/layout.tsx` become `async` server components: `await requireSessionUser()` then render `children` (user) or `<AdminShell>{children}</AdminShell>` (admin).
- `lib/session-user.ts` gains `requireSessionUser()`: `const session = await getServerSession(authOptions); if (!session?.user?.id) redirect('/login')`, placed outside any try/catch because `redirect()` throws. The missing `user.id` case covers revoked JWTs (ADR-0006), which closes the "revoked token still reaches pages" limit in `docs/auth-gate.md`. The layout cannot read the pathname (Next: layouts do not re-render on navigation and have no pathname), so this redirect carries no `callbackUrl`; the proxy, which runs on every request including client navigations, keeps adding it in the normal signed-out case. The layout check is defence in depth and the server-render enabler, not the primary gate.
- `getServerSession(authOptions)` is wrapped once in React's `cache()` (`lib/session-user.ts` → `getCachedServerSession`) so the root layout and a group layout share one call per request (one `sessionVersion` query, as the login layout already costs today).
- Deleted: `components/auth/auth-guard.tsx`. `hooks/use-auth.ts` keeps only `userId` (the email), read from `useSession()`; `isAuthorized`, `isLoading` and the unused `goAuthorize` go. `docs/auth-gate.md` is updated (where it lives, expected conflicts: `(user)/layout.tsx` now "keep the server gate").

### 3.2 Root layout feeds the providers

- `app/layout.tsx` (server) awaits `getCachedServerSession()` and `cookies()`, then renders `<AppProviders session={session} initialTheme={readThemeCookies(cookieStore)}>` with `className={initialTheme.resolved === 'dark' ? 'antialiased dark' : 'antialiased'}` on `<body>` so the legacy `dark:` utilities and the e2e `body.dark` wait are right from the first byte. Reading cookies opts every route into dynamic rendering; every page is already per-user behind the proxy, so nothing static is lost.
- `components/providers/app-providers.tsx`: `SessionProvider session={session}` (next-auth: "avoids flickering/session loading on first load", so the account dropdown is in the server HTML) and `ThemeContextProvider initialTheme={…}`.
- `lib/theme/theme-cookie.ts` (new, no React): cookie names `theme-mode` (`system` | `light` | `dark`) and `theme` (`light` | `dark`), `readThemeCookies(store)` tolerant of missing or junk values (defaults `system` + `light`), `writeThemeCookies(mode, resolved)` for the client (`document.cookie`, `Path=/; Max-Age=31536000; SameSite=Lax`, `Secure` when served over https). The theme context starts from `initialTheme`, keeps following `prefers-color-scheme` live for `system`, writes both cookies on every change, and reads the two old localStorage keys once when no cookie exists (one-time migration, then the keys are removed from `LocalStorageKeys`).
- Consequence: a user whose mode is `system` and whose OS switched scheme since the last visit gets one corrected paint after hydration; that is the only remaining flash and it is inherent (the server cannot see `prefers-color-scheme`).

### 3.3 Responsive layout by CSS, behaviour by hook

antd's `Grid.useBreakpoint()` returns its default (`{}`) on the server and on the first client render and only then subscribes in a layout effect (read in `antd/es/grid/hooks/useBreakpoint.js`), so any `isMobile ? A : B` markup paints the mobile branch first on desktop. Rule for sub-project 2 (and recorded in `docs/frontend-conventions.md`): markup that differs by breakpoint is rendered for both and switched with a CSS Module media query at antd's screen token value (`@media (max-width: 767px) /* screenSMMax */`), as charter §4.3.4 already allows; `Grid.useBreakpoint()` is used only for behaviour after hydration (which element a Drawer mounts, placements). Applied to `components/shell/app-header.tsx` (horizontal `Menu` vs mobile trigger, standard dropdowns vs `mobileMenu`) and to the chat's sider vs drawer button.

### 3.4 Viewport unit

`components/shell/shell.module.css`: `.root { height: 100vh; height: 100dvh; }` with a comment. Browsers without `dvh` keep `100vh`. ADR-0011 gets a dated note under "More Information" and its open verification box is ticked.

### 3.5 Chat routes

- `app/(user)/chat/[appId]/page.tsx` → server page: `const { appId } = await params; return <ChatWorkspace appId={appId} />`.
- `app/(user)/chat/page.tsx` → server page that lists enabled apps through the existing repository and `redirect()`s to `/chat/<first id>` or to `/apps` when there is none (today's "pick the first app" behaviour, without a client round-trip). The `/chat` URL stays valid (URLs never change).
- `app/(user)/chat/layout.tsx` keeps `force-dynamic` and passes children through.
- Pages keep rendering `UserShell` themselves (chat passes header slots), as the foundation left it.

## 4. Data layer

### 4.1 Message model

```ts
// components/chat/provider/message.ts
export interface DifyChatMessage {
	role: 'user' | 'assistant'
	content: string // answer text (message / agent_message / message_replace) or the user's query
	reasoning?: string // reasoning_chunk deltas joined
	reasoningDone?: boolean // reasoning_chunk.is_final
	thoughts?: AgentThought[] // agent_thought upserted by position
	workflow?: {
		runId?: string
		status: 'running' | 'paused' | 'finished' | 'failed'
		nodes: WorkflowNode[]
	}
	files?: MessageFile[] // message_file events, or message_files from history
	citations?: RetrieverResource[] // message_end.metadata.retriever_resources, or history
	humanInput?: HumanInputState // human_input_required (+ filled / timeout)
	error?: { code?: string; message: string; status?: number }
	ids: { messageId?: string; conversationId?: string; taskId?: string }
	createdAt?: number // StreamEventBase.created_at (seconds)
	feedback?: 'like' | 'dislike' | null
	inputs?: Record<string, unknown> // user message: the inputs sent with it (from history)
	aborted?: boolean // set by requestFallback on AbortError
}
```

History maps one Dify message (`GET /messages`, newest first) to two `DifyChatMessage`s with ids `<messageId>:q` and `<messageId>:a`; the array is reversed so the list reads oldest first. Workflow nodes for history come from the IndexedDB store (§4.10), because `/messages` carries none.

### 4.2 `DifyChatProvider`

`components/chat/provider/dify-chat-provider.ts` extends `AbstractChatProvider<DifyChatMessage, DifyChatInput, SSEOutput>` and implements only the three transforms (x-chat-provider skill: no `request` method, no status in the return value, `XRequest(…, { manual: true })`).

- `transformParams(requestParams, options)`: merges `options.params` with the request; sets `conversation_id` from the conversation's Dify id getter (empty for a new chat), `inputs` and `files` from the request, `response_mode: 'streaming'`, `user` from the request (the proxy overwrites it with the session email anyway). For a `resume` request it records the paused message (`this.resumeBase`) and passes `resume` through for the fetch router.
- `transformLocalMessage(requestParams)`: `{ role: 'user', content: query, files, inputs }`; returns `[]` for a `resume` request (the SDK accepts an array and adds no local bubble).
- `transformMessage({ originMessage, chunk })`: parses `chunk.data` (ignoring `[DONE]` and unparsable chunks), starts from `originMessage ?? this.resumeBase ?? emptyAssistant()`, and applies one event:

| Dify event (schema) | Effect on the message |
| --- | --- |
| `message` (`StreamEventChatMessage`) | append `answer` to `content`; set `ids`, `createdAt` |
| `agent_message` | same as `message` |
| `message_replace` | replace `content` |
| `reasoning_chunk` (`StreamEventChatReasoningChunk`) | append `data.reasoning`; `reasoningDone = data.is_final` |
| `agent_thought` | upsert `thoughts[]` by `position` (`id`, `tool`, `tool_input`, `observation`, `thought`, `message_files`) |
| `message_file` | push `{ id, type, url, belongs_to }` to `files` |
| `message_end` | `citations = metadata.retriever_resources`; keep ids |
| `workflow_started` | `workflow.runId = workflow_run_id`; `status = 'running'`; `nodes` reset unless `data.reason === 'resumption'` |
| `node_started` | push node `{ id, nodeId, type, title, status: 'running', index }` if absent |
| `node_finished` | update node: `status` (`succeeded`→`success`, else `error`), `inputs`, `outputs`, `process_data`, `elapsed_time`, `execution_metadata`, `error` |
| `node_retry` | mark node `retrying` with the attempt's `error`, keep it running |
| `workflow_finished` | `status = data.error ? 'failed' : 'finished'`; persist nodes (§4.10) |
| `workflow_paused` | `status = 'paused'` |
| `human_input_required` | `humanInput = { formToken, formContent, inputs, actions, defaults, expiresAt, workflowRunId, nodeId, state: 'pending' }` |
| `human_input_form_filled` | `humanInput.state = 'filled'`, keep `renderedContent`, `actionText` |
| `human_input_form_timeout` | `humanInput.state = 'expired'` |
| `error` (`StreamEventChatError`) | `error = { code, message, status }` |
| `ping`, `tts_message*`, `agent_log`, `iteration_*`, `loop_*`, `text_chunk` | ignored in chat |

Every event also refreshes `ids.messageId`, `ids.conversationId`, `ids.taskId` and `createdAt` from `StreamEventBase` when present. The provider holds no UI callbacks; what the UI needs (the server conversation id, the task id) is read from the message itself through `useXChat`'s `messages`.

### 4.3 `useXChat` wiring

`components/chat/hooks/use-dify-chat.ts` wraps `useXChat<DifyChatMessage, DifyChatMessage, DifyChatInput, SSEOutput>`:

- `conversationKey`: `<appId>:<difyId>` for server conversations, `<appId>:temp:<uuid>` for a new chat. The app prefix is required because the SDK's message store map is module-global (`chatMessagesStoreHelper`). The key never changes during the page session: when the first event brings a server id, the conversation item gets `difyId` (§4.4); the provider and the API calls read it from there. On a full reload every key is `<appId>:<difyId>`.
- `provider`: one `DifyChatProvider` per key from a `Map` cache (use-x-chat skill: "each conversation must have its own Provider instance"), created with `XRequest('/api/client/dify/<appId>/chat-messages', { manual: true, fetch: difyFetch, params })` where `difyFetch` (the documented `fetch` option) routes a `resume` request to `GET /api/client/dify/<appId>/workflow/<runId>/events` and everything else to `POST …/chat-messages`, and throws a `DifyRequestError` carrying Dify's `{ code, message, status }` when `response.ok` is false (XRequest's own JSON handler only recognises `success === false`).
- `defaultMessages: async ({ conversationKey }) => …`: `[]` for a temp key; otherwise `GET /conversation/<difyId>/messages?limit=20` mapped as in §4.1; `has_more` and the oldest id are kept in a ref for "load earlier".
- `requestPlaceholder`: `{ role: 'assistant', content: '' }` for normal sends (the bubble shows `loading`); for a `resume` request it returns the paused message unchanged so the HITL bubble keeps its content while the continuation connects.
- `requestFallback(params, { error, errorInfo, messageInfo })`: on `AbortError` return `messageInfo.message` with `aborted: true` (documented pattern); otherwise an assistant message with `error` from the `DifyRequestError` or a generic i18n text.
- Sending: `isDefaultMessagesRequesting ? queueRequest(key, params) : onRequest(params)`. Everything else uses the hook's returns: `messages`, `isRequesting` (per key), `abort`, `setMessage`, `setMessages`, `onReload`.
- Bubble items derive from `messages`: `key: id`, `role: message.role`, `content: message`, `loading: status === 'loading'`, `streaming: status === 'updating'` (x-components Pattern 3).

### 4.4 Conversations

`components/chat/hooks/use-conversations.ts` wraps `useXConversations` (x-sdk 2.9 exports it):

- `setConversations` from `GET /conversations?limit=100&sort_by=-updated_at` mapped to `{ key, label: name, difyId: id, updatedAt, inputs, group }`; `group` is one of four i18n labels (today, yesterday, last 7 days, older) for `Conversations groupable`.
- New chat: `addConversation({ key: tempKey, label: t('chat.default_conversation_name') }, 'prepend')` and `setActiveConversationKey`. At most one empty temp conversation exists; the `creation` button is disabled while it does.
- First reply of a temp conversation: when its first assistant message carries `ids.conversationId`, `setConversation(tempKey, { difyId })`; when the reply ends, the list is refreshed from Dify and merged by `difyId` so the server-generated name appears without changing the key.
- Rename → `POST /conversation/<id>/name`; delete → `DELETE /conversation/<id>`, then `removeConversation` and, if it was active, activate the first remaining or a new temp. Both through `App.useApp().modal.confirm` (rename with an antd `Form`), never the static `Modal.confirm` (antd lint rule).
- `?isNewCvst=1` starts a temp conversation after the list loads (kept behaviour).

### 4.5 Errors, abort, stop

- HTTP errors from the proxy → `DifyRequestError` → `requestFallback` → error bubble (`status: 'error'`).
- Stream `event: error` → `message.error` set; the SDK ends with `success`; the bubble renders from `message.error`.
- Cancel: `abort()` then `POST /chat-messages/<taskId>/stop` with the message's `ids.taskId`; the partial content stays with `aborted: true` and an "stopped" caption.
- `XRequest` retries are off (default) so a failed send never resends silently.

### 4.6 HITL

1. `human_input_required` arrives; Dify closes the stream after `workflow_paused`. The assistant bubble renders `HumanInputForm` (§5.3) from `message.humanInput`.
2. Submit → `POST /form/human_input/<formToken>` (existing proxy route) with `{ inputs, action, user }`.
3. On success the hook calls `onReload(assistantMessageId, { resume: { workflowRunId, message } })`. `onReload` is the SDK's documented "update this message with new returned data" call; the SDK adds no local bubble, sets the message `loading` with our placeholder (the paused message), and on the first chunk calls `transformMessage` without `originMessage` (read in `x-chat/index.js`), which is why `transformParams` stored `resumeBase`.
4. The resumed stream (`GET /workflow/<runId>/events?user=…`, documented as "resume the SSE stream after a pause") delivers `workflow_started` with `reason: resumption` (nodes kept), `human_input_form_filled` (form collapses to its summary), the remaining node and `message` events, `message_end`, `workflow_finished`.
5. Expiry: `human_input_form_timeout` or the countdown reaching zero disables the form and shows the expired state.

### 4.7 Message actions and app features

- Regenerate: `onRequest` with the preceding user message's `content`, `files` and the current inputs (a new turn; the `/chat-messages` body has no parent id, so a new Dify message is what history will show). Not `onReload`, to keep live and history views identical.
- Feedback: `POST /messages/<messageId>/feedbacks` with `rating` `like` | `dislike` | `null` (and `content` for a dislike reason), then `setMessage(id, …feedback)`. Hidden while `ids.messageId` is absent.
- Annotation: `POST /annotations` from an antd `Drawer` + `Form`, shown when `extConfig.annotation.enabled`.
- TTS: `POST /text2audio` → blob → `Audio`; `Actions.Audio status` runs `loading` → `running` → `default`, `error` on failure. Shown when `parameters.text_to_speech.enabled`.
- Speech to text: `Sender allowSpeech={{ recording, onRecordingChange }}` (the documented `SpeechConfig` form) around the existing `MediaRecorder` capture and `POST /audio2text`; shown when `parameters.speech_to_text.enabled`.
- Suggested questions after answer: when `parameters.suggested_questions_after_answer.enabled`, after a reply ends fetch `GET /messages/<messageId>/suggested` and render `Prompts` above the sender; cleared on the next send.
- Files out: `files` on the message, rendered by `MessageFiles` (§5.3); download through `GET /files/<id>/preview?as_attachment=true` for user files, direct URL for assistant files (today's rule).
- Files in: `Attachments` with antd `Upload`'s `customRequest` calling `POST /files/upload`; allowed types, extensions and count from `parameters.file_upload`; `onPasteFile` → `attachmentsRef.upload(file)`; items become `{ type, transfer_method: 'local_file', upload_file_id }` in the request.
- Deep links: `?sender_text=` prefills the sender; `?isKeepAll=true&<var>=<gzip>` prefills the inputs form through the existing `unParseGzipString`; both read with `useSearchParams` in the client workspace.

### 4.8 Workflow and completion runner

`components/chat/hooks/use-workflow-run.ts`: `run(inputs)` posts to `/workflows/run` or `/completion-messages` (existing `DifyApi`), iterates the response with `XStream` (x-sdk's documented SSE reader) and reduces `ChunkWorkflowEvent`s into `{ status, runId, taskId, nodes, outputs, text, files, error }` (`text_chunk` appends `data.text`; completion apps use `message`/`message_end`). `stop()` aborts the fetch through an `AbortController`; the Dify run itself keeps going, as it does today, because the workflow and completion stop endpoints have no proxy route and adding one is backend work outside this sub-project (§12). No `useXChat` here: a run is not a conversation and the view is not a bubble list.

### 4.9 App context and URL parameters

`components/chat/chat-workspace.tsx` (client) loads the app (`appService.getAppByID`), `GET /parameters` and `GET /site` (with the existing default fallback), creates the `DifyApi` for the signed-in email, and provides `AppContext` `{ app, parameters, site, difyApi, userId }`. It renders `ChatView`, `WorkflowView` or `CompletionView` by `app.info.mode`, plus `Spin` while loading, `Result` on failure and `Empty` for an unknown app. The zustand `useDifyChatStore` is deleted; its HITL and conversation fields are replaced by the message model and `useXConversations`.

### 4.10 Persistence

`hooks/useX/workflow-data-storage.ts` and `think-time-storage.ts` move to `components/chat/persistence/` unchanged in behaviour (zustand `persist` over IndexedDB). Keys stay `<appId>_<difyConversationId>_<messageId>_workflows`; the provider writes on `workflow_finished` (and on each node event, as today, so a reload mid-run keeps the nodes), the history mapper reads.

## 5. UI composition

### 5.1 Layout and mobile

- `ChatView` renders, inside `UserShell`, an antd `Layout` (nested layouts are documented) with `Layout.Sider` (`collapsible`, controlled `collapsed`, `collapsedWidth = token.controlHeightLG * 2`, `trigger={null}` with our own toggle button, `width` the one named constant `SIDEBAR_WIDTH = 280`, declared once with a comment, as X's own full-page pattern does) and `Layout.Content` holding the message column, the sender and the disclaimer. The sider has the app info block, the `Conversations` list and the collapse toggle; collapsed it shows the app icon, a new-chat icon button and a `Popover` with the list.
- Below `md`, a CSS Module media query hides the sider; the header's `mobileMenu` slot gets a `Button` (`aria-label={t('system.menu')}`) that opens an antd `Drawer` (placement start, `title={t('system.menu')}`) with the app info, `Conversations` and, at the bottom, `LanguageDropdown`, `ThemeDropdown` and `AccountDropdown`, so nothing the header hides on mobile is lost. The Drawer mounts its content on first open (antd default), so there is never a second `Conversations` instance in the DOM before it is needed.
- Wide-screen toggle stays in the header (`extra` slot, same accessible names); the message column is `max-width: 768px /* screenMD */` by default and unbounded when wide; state in `useLocalStorageState('dify-app-hub-wide-screen')` as today.
- Styling: antd components first; colocated CSS Modules with `var(--ant-*)` only; `theme.useToken()` for runtime values; no Tailwind, Lucide, hex or `!important` anywhere under `components/chat/`.

### 5.2 Component map (charter §4.4 made concrete)

| Feature | Component(s) | Notes and sources |
| --- | --- | --- |
| Conversation list | X `Conversations` (`items`, `activeKey`, `onActiveChange`, `groupable` with `label` render, `creation`, per-item `menu`) | COMPONENTS.md → Conversations; API `GroupableProps` |
| App info | antd `Avatar` (site icon: emoji text or image), `Typography.Text`, `Tag` | antd |
| Empty state | X `Welcome` (`icon`, `title` = app name, `description` = opening statement as Markdown, `variant="borderless"`) + `Prompts` (`items` from `suggested_questions`, `wrap`) | Pattern 1; shown when the conversation has no messages or always when `extConfig.conversation.openingStatement.displayMode === 'always'` |
| Input parameters | antd `Collapse` + `Form` (`Input`, `Input.TextArea`, `Select`, `InputNumber`, file control) | kept behaviour: required before first send; editable later only with `inputParams.enableUpdateAfterCvstStarts`; values from the conversation's `inputs` |
| Message list | X `Bubble.List` (`autoScroll`, stable `role` map, `items` as §4.3), `ref.scrollTo({ key })` after prepending older messages | COMPONENTS.md → Bubble; `BubbleListRef.scrollTo` |
| Avatars | `role.assistant.avatar` = site icon when `use_icon_as_answer_icon`, else `Avatar icon={<RobotOutlined/>}`; `role.user.avatar` = `Avatar icon={<UserOutlined/>}` | Pattern 1 ("keep roles stable") |
| Assistant content | `contentRender(message, info)` composing, in order: `Think` (reasoning; `loading`/`blink` while `!reasoningDone` and streaming), `ThoughtChain` (tool thoughts: `title` = tool, `collapsible` `content` = tool input and observation as code), `WorkflowLogs`, `MessageMarkdown`, `HumanInputForm` (when `humanInput.state === 'pending'`), `MessageFiles`, `Sources` (citations) | COMPONENTS.md → ThoughtChain / Think, Sources; Pattern 4 |
| User content | text + `MessageFiles` above | — |
| Error / aborted | antd `Alert type="error"` inside the bubble (`message.error`), secondary caption for `aborted` | antd |
| Footer | X `Actions` (`variant="borderless"`): regenerate (`RedoOutlined`), `Actions.Copy text`, annotate (`EditOutlined`, conditional), `Actions.Feedback value onChange styles={{ liked: { color: token.colorSuccess } }}` (dislike red is X's own `colorError`), `Actions.Audio status` (conditional), plus the creation time as `Typography.Text type="secondary"`. Rendered only for assistant messages with `status !== 'loading'`; disabled while `isRequesting`. | COMPONENTS.md → Actions; `ActionsFeedbackProps.styles` semantic slots `liked`/`disliked` |
| Sender | X `Sender` (`value`, `onChange`, `onSubmit`, `onCancel`, `loading`, `disabled`, `header`, `prefix`, `onPasteFile`, `allowSpeech`, `autoSize`, `ref.focus()` on conversation switch) with `Sender.Header` + `Attachments` (`items`, `customRequest`, `beforeUpload` type check, `maxCount`, `placeholder`, `getDropContainer`) and a `prefix` `Badge`-wrapped attach button | COMPONENTS.md → Sender, Attachments; Pattern 5 |
| Next suggestions | X `Prompts` above the sender | — |
| Load earlier | antd `Button type="link"` above the list while `has_more` | — |
| Disclaimer | `Typography.Text type="secondary"` under the sender (`site.custom_disclaimer` or default key) | — |

### 5.3 Kept custom, built from antd primitives and tokens

- `WorkflowLogs` (`components/chat/message/workflow-logs.tsx`): antd `Collapse` whose header shows the run status (`LoadingOutlined` spinning, `CheckCircleFilled` in `colorSuccess`, `CloseCircleFilled` in `colorError`), total time and tokens; one nested `Collapse` panel per node with `WorkflowNodeIcon` (`@ant-design/icons` by node type), title, status, `elapsed_time` and tokens, and `Descriptions` for inputs, process data and outputs rendered as code blocks. Used by chat bubbles and the workflow view.
- `HumanInputForm` (`components/chat/message/human-input-form.tsx`): antd `Card`-less bordered block (`Flex` with tokens) holding the form content as Markdown, an antd `Form` with controls per `type` from the OpenAPI (`paragraph` → `Input.TextArea`, `select` → `Select`, `file` / `file-list` → the existing `FileUpload` control), defaults from `resolved_default_values`, action `Button`s by `button_style` (`primary` → `type="primary"`, otherwise default), a `Statistic.Countdown` to `expiration_time`, disabled and expired states, and the filled summary (`renderedContent`, `actionText`).
- `MessageFiles` (`components/chat/message/message-files.tsx`): images in antd `Image.PreviewGroup`; other files as X `FileCard` (`name`, `byte`, `type`, `src`, `onClick` → download via the preview proxy for user files).
- `WorkflowNodeIcon`: node type → icon map, token colours.

### 5.4 Workflow and completion views

Same shell. antd `Row`/`Col` (`xs=24 md=12`): left the inputs `Form` (reusing the chat's input-parameter form without the Collapse) and a `Button type="primary" loading` to run, plus stop while running; right, for workflow apps `Empty` before the first run, then `WorkflowLogs` and `Tabs` (result: Markdown or files when `outputs` has one string value or `files`; detail: the `outputs` JSON in a code block with `Actions.Copy`); for completion apps the Markdown result with `Actions.Copy`; `Result status="error"` with the Dify error on failure.

### 5.5 Deleted with the page

`components/chat/chat-layout.tsx`, `chat-layout-wrapper.tsx`, `chatbox-wrapper.tsx`, `common-layout.tsx`, `main-layout.tsx`, `workflow-layout.tsx`, `params-config-editor.tsx`, `conversation-list/`, `message-sender/`, `chatbox/` (all of it, including `welcome-placeholder`, `message/*`, `thought-chain/`), `markdown-renderer/` (if the spike passes; otherwise restyled in place), `hitl-form/`, `hooks/useX/index.ts`, `hooks/useX/x-provider.ts`, `lib/core/store.ts`, `components/ui/tree-view` and any `components/ui/*`, `components/shared/lucide-icon` consumer left without users under `components/chat/`. Every Tailwind class and Lucide icon under `components/chat/` goes.

## 6. Markdown spike (first implementation task)

`MessageMarkdown` (`components/chat/message/message-markdown.tsx`) is the single entry point every bubble, welcome panel and workflow result uses; the spike decides what it wraps.

Criteria, each run against a recorded Dify sample kept in `e2e/fixtures/markdown-samples/` (shared with the stub):

1. Streaming: `streaming={{ hasNextChunk, enableAnimation: true }}`, `hasNextChunk` true while `status === 'updating'` and false on the final render; no broken tables or links mid-stream; the final content settles (STREAMING.md).
2. Fenced code: `components.code` receives `lang` and `block` (installed `ComponentProps`), routing `mermaid` → X `Mermaid`, `echarts` → the existing echarts block, `svg` → the existing SVG block, otherwise X `CodeHighlighter` with a copy action; inline code falls through.
3. Math: `config={{ extensions: Latex() }}` from `@ant-design/x-markdown/plugins/Latex` renders `$$…$$` and `\[…\]`, inside and outside lists.
4. Reasoning: `<think>` → X `Think` through `components`, open while streaming, closed with the elapsed label when done (the think-time store supplies the duration).
5. Raw HTML Dify injects: `<img>`, `<video>`, `<form data-format>` with `input`/`textarea`/`button`, `<button data-message>`, `<details>`; an explicit minimal `dompurifyConfig` (allowed tags and attributes listed in the code) and `components` mapping `form` and `button` to the existing post-back blocks (they call `onRequest`).
6. Images: Markdown images and allowed `<img>` render through antd `Image` with preview; content that starts with an image works (the regex workaround goes).
7. Links: `openLinksInNewTab`.
8. Theme: `themes/light.css` and `themes/dark.css` both loaded, root class `x-markdown-light` / `x-markdown-dark` from the theme context; code blocks and tables checked in both schemes.
9. Performance: a 300-chunk stream renders without React's maximum-update-depth error; `components` is a module-level constant.

Verdict rule: all nine pass → adopt `XMarkdown`, remove the `react-markdown` pipeline and its packages, record in ADR-0017. Any failure without a documented fix → keep `react-markdown` restyled with tokens, keep its plugins, record the failing criteria in ADR-0017 for a later retest. A fix needing a private API or a patched package counts as a failure (ADR-0002). The spike's code is throwaway unless it passes; its report lists each criterion with the sample and the result.

## 7. i18n and the X locale

- `libs/x-locale.ts`: `import enUS from '@ant-design/x/locale/en_US'`, `zhCN` likewise, `ar` as a fork object typed `xLocale` with all 20 strings in Modern Standard Arabic (Conversations.create, Sender.stopLoading/speechRecording, `Actions.*`, Bubble.editableOk/Cancel, `Mermaid.*`, `Folder.*`); `getXLocale(language)` with English fallback; `app-providers.tsx` passes `locale={{ ...getAntdLocale(lang), ...getXLocale(lang) }}` (XProvider docs). `__tests__/x-locale.test.ts` checks the three objects have identical key sets.
- New i18next keys (all three files, typed): conversation group labels, load earlier, stopped caption, HITL field and state labels, workflow run and result labels, sender hints, error texts; existing `chat.*`, `message.*`, `sender.*`, `hitl.*`, `workflow.*`, `annotation.*` keys are reused where the text is unchanged and deleted when their component goes. Accessible names of icon-only buttons come from keys (ADR-0014) and are e2e locator contracts.
- `docs/i18n-maintenance.md`: add the X locale file to "Adding a language" and remove the mention of the chat's language radio (gone with the mobile mega-menu).

## 8. Stub Dify API and e2e suite

### 8.1 Stub

`e2e/fixtures/dify-stub.ts` is split into `e2e/fixtures/stub/` (`server.ts`, `routes.ts`, `scenarios.ts`, `events.ts`, `store.ts`, `samples/`) and keeps one process on `E2E_DIFY_STUB_PORT`.

- Modes by path prefix: `/v1` (chat, the existing app) and `/v1/agent`, `/v1/chatflow`, `/v1/workflow`, `/v1/completion`, so the Playwright readiness URL and the seeded chat app keep working unchanged. `auth.setup.ts` seeds one `dify_apps` row per prefix: the existing chat app keeps its id (`APP_ID`) and its name "Stub app", so the foundation specs keep their locators; the four new rows are "Stub agent", "Stub chatflow", "Stub workflow" and "Stub completion" with ids `…0002` to `…0005` and matching `mode` values. `/info`, `/parameters` and `/site` answer per mode (the chatflow and agent parameters enable `suggested_questions_after_answer`, file upload and `retriever_resource`).
- Event builders typed after the OpenAPI schemas, every event with `task_id`, `message_id`, `conversation_id`, `created_at`. Scenarios by query text: default echo; `files` → `message_file` with a PNG the stub serves; `cite` → `message_end` with two `retriever_resources`; `error` → one `message` then `error`; `slow` → 40 chunks at 100 ms (for abort); `hitl` (chatflow) → nodes, `human_input_required`, `workflow_paused`, then the resume stream on `GET /workflow/<runId>/events`; `retry` (chatflow) → `node_retry`; agent default → two `agent_thought`s (one with a tool) and `agent_message`s; chatflow default → `workflow_started`, two nodes, `reasoning_chunk`s with `is_final`, `message`s, `message_end`, `workflow_finished`; workflow default → nodes, `text_chunk`s, `workflow_finished` with `outputs` and `files`; completion default → `message`s and `message_end`.
- Also served: `/files/upload`, `/files/<id>/preview`, `/messages/<id>/suggested` (two items when enabled), `/text-to-audio` (tiny WAV), `/audio-to-text` (`{ text }`), `/form/human_input/<token>` GET and POST, the three stop endpoints, `/workflows/run`, `/completion-messages`.
- Per-user storage (`Map<user, …>`); JSON bodies parsed in a try with Dify's `400 invalid_param` shape on failure; unknown routes 404 in Dify's error shape. `POST /__e2e/reset` is removed in the same task that lands the race test.

### 8.2 Specs (three projects as today; web-first assertions; role and name locators; no `networkidle`)

`chat.spec.ts` (send and stream; new, rename, delete; welcome and prompts incl. always-on; required inputs block sending; load earlier; regenerate; suggestions; copy), `chat-race.spec.ts` (reopen a stored conversation and send at once: history and reply both visible), `chat-agent.spec.ts`, `chat-chatflow.spec.ts` (nodes, reasoning, retry), `chat-hitl.spec.ts` (form, submit, continued answer, filled summary), `chat-errors.spec.ts` (error bubble; abort then stop), `chat-files.spec.ts` (upload → sent with the message; assistant image preview), `chat-feedback.spec.ts` (like green via `toHaveCSS` on `colorSuccess`, dislike with reason, hidden before id), `chat-mobile.spec.ts` (drawer opens, switches a conversation, shows the account menu), `workflow.spec.ts`, `completion.spec.ts`, `ssr-first-paint.spec.ts` (fetches `/apps` and `/chat/<id>` server HTML with `request.get`: with `theme=dark` the body carries `dark` and the inlined style has the dark `--ant-color-bg-layout`; the HTML already contains the header, the account button and both the desktop navigation and the mobile trigger markup, proving the shell server-renders and no breakpoint branch is chosen on the server), updated `smoke.spec.ts` (no reset), `providers.spec.ts` unchanged, `screenshots.spec.ts` adds chat, agent, chatflow-with-HITL, workflow and completion.

### 8.3 Unit tests (vitest, node)

Provider transforms per event (fixtures from the samples), history mapper, key helpers, `DifyRequestError` from a Response, theme cookie read/write, `requireSessionUser` (mocked `getServerSession` and `redirect`), stub scenario table, X locale key parity, i18n key parity (existing).

## 9. Documentation and decisions

- ADR-0016 "Store the theme preference in cookies so the server renders the right scheme" (new, accepted on merge).
- ADR-0017 "Build the chat on Ant Design X with a provider-centred data layer" (new): the message model, client keys with a Dify id field, `defaultMessages` + `queueRequest` for history, `onReload` for HITL continuation, regenerate as a new turn, the Markdown verdict with the spike results.
- ADR-0018 "Gate route groups on the server and let the proxy gate navigations" (new): supersedes the client gates; records the revoked-token fix and the callbackUrl limit.
- Dated notes: ADR-0011 (100dvh), ADR-0010 (reset retired, catalogue complete), ADR-0014 (mobile menu test done), ADR-0006 (page gap closed), ADR-0008 (sub-project 2 verification box).
- `docs/frontend-conventions.md` (status, the CSS-breakpoint rule, lint re-check), `docs/auth-gate.md`, `docs/i18n-maintenance.md`, `CLAUDE.md` decision lines and "Where things are" (chat), the foundation spec's "Spec drift" note resolved by a dated paragraph.

## 10. PR absorption

#7 and #8 are closed with a comment naming this PR. Requirements carried: every live assistant message exposes `ids.messageId` and `createdAt` from the stream (`StreamEventBase`), the time shows in the active language, feedback posts the Dify id and is hidden without one, a request-failed bubble shows no feedback; a selected like is `colorSuccess`, a selected dislike `colorError`, idle icons neutral, in both schemes.

## 11. Dependencies

Removed with the page: `react-infinite-scroll-component`, `react-photo-view`, `pure-react-router`, `@radix-ui/react-collapsible` and `@radix-ui/react-accordion` if the tree view was their last consumer (checked at removal time). Removed on a passing spike: `react-markdown`, `remark-gfm`, `remark-math`, `remark-breaks`, `rehype-katex`, `rehype-raw`, `react-syntax-highlighter`, `katex`, `hast`. Kept: `zustand`, `idb-keyval`, `echarts-for-react`, `ahooks`, `dayjs`, `dompurify` only if XMarkdown does not bring its own. No new dependency. `pnpm why` confirms each removal has no other importer.

## 12. Backend files touched

None under `app/api/**`, `db/**`, `services/`, `repository/`, `lib/auth.ts`, `lib/dify-client.ts` or `proxy.ts`. The fork-owned `lib/session-user.ts` gains `getCachedServerSession` and `requireSessionUser` (line-level additions next to `redirectSignedInUser`). `lib/dify-client.ts` stays `@ts-nocheck` and unchanged; the chat calls it as today.

## 13. File layout (new)

```
components/chat/
  chat-workspace.tsx            app loader + context + mode switch
  app-context.tsx
  provider/  dify-chat-provider.ts  message.ts  history.ts  keys.ts  provider-cache.ts  dify-fetch.ts
  hooks/     use-dify-chat.ts  use-conversations.ts  use-workflow-run.ts  use-suggestions.ts
  chat-view/ chat-view.tsx  conversation-sidebar.tsx  conversation-drawer.tsx  message-list.tsx
             assistant-content.tsx  message-footer.tsx  chat-sender.tsx  welcome-panel.tsx
             inputs-form.tsx  *.module.css
  message/   message-markdown.tsx  message-files.tsx  message-sources.tsx  workflow-logs.tsx
             workflow-node-icon.tsx  human-input-form.tsx  agent-thoughts.tsx  reasoning.tsx
             blocks/ (echarts, svg, form, button — kept from the old renderer, restyled)
  workflow-view/ workflow-view.tsx  *.module.css
  completion-view/ completion-view.tsx
  persistence/ workflow-data-storage.ts  think-time-storage.ts
lib/theme/theme-cookie.ts        libs/x-locale.ts (+ ar pack)
lib/session-user.ts              requireSessionUser, getCachedServerSession
e2e/fixtures/stub/               server.ts routes.ts scenarios.ts events.ts store.ts samples/
e2e/*.spec.ts                    as §8.2
docs/decisions/0016 0017 0018
```

## 14. Verification and definition of done

- `pnpm exec tsc --noEmit`, `pnpm exec oxlint`, `pnpm exec oxfmt --check`, `pnpm test` green.
- `pnpm test:e2e` green on `desktop-light`, `desktop-dark`, `mobile-light` with the specs in §8.2; screenshots reviewed in chat.
- `npx -y @ant-design/cli lint ./` at or below the baseline (75 findings / 1 error) and expected to fall (the chat's static `message.*` calls are gone).
- `git grep -nE 'lucide-react|className="[^"]*(flex|text-|bg-|border-)' components/chat` returns nothing; `git grep -- '--theme-' components/chat` returns nothing.
- Docker rebuild from the branch and the four curl checks (`/api/health` 200; `/apps` signed out → 307 with `callbackUrl`; `/api/client/apps` → 401; `antd-cssinjs` style present), plus a fifth: `curl -s -H 'Cookie: theme=dark; theme-mode=dark' localhost:5300/login | grep -c 'class="antialiased dark"'` → 1.
- The owner verifies in the browser against a real Dify server: each app mode, HITL, files, TTS/STT, dark mode first paint, mobile.
- ADRs 0016–0018 accepted, notes added, docs updated, handoff written under `docs/superpowers/handoffs/`.

## 15. Risks and how the plan handles them

- The SDK's reload path passes no `originMessage` on the first chunk: covered by `resumeBase` in the provider and a unit test; if a future x-sdk changes this, the test fails loudly.
- Module-global message stores: keys are app-prefixed; the provider cache and the stores are not cleared on app switch (memory grows with visited conversations within a page session, acceptable; a reload clears everything).
- Dify's resumed stream may omit the pre-pause text: handled by keeping the paused message; verified by the HITL e2e flow against the stub and by the owner against a real Dify.
- Markdown spike may fail: the fallback is a valid outcome and is itself fully specified (§6).
- Server-rendered shells plus `Grid.useBreakpoint()`: handled by the CSS rule (§3.3) and checked by `ssr-first-paint.spec.ts` (both breakpoint variants present in the server HTML) and the mobile screenshots.
- The theme cookie migration reads localStorage once; users who never revisit keep a stale localStorage value that nothing reads (harmless).

## 16. Sources consulted (per API decision)

`.claude/skills/use-x-chat/SKILL.md` and `reference/API.md`, `CORE.md` (conversationKey, defaultMessages, queueRequest, onReload, requestFallback, isDefaultMessagesRequesting; useXConversations); `.claude/skills/x-chat-provider/SKILL.md` (three transforms, manual request, provider per conversation, `fetch` and `callbacks` options); `.claude/skills/x-request/SKILL.md`; `.claude/skills/x-components/SKILL.md`, `reference/COMPONENTS.md`, `PATTERNS.md` (Patterns 1–5, 7), `API.md` (Bubble, Conversations, Sender, Attachments, Actions, Sources, ThoughtChain, Think, Welcome, Prompts, FileCard); `.claude/skills/x-markdown/*` (CORE, STREAMING, EXTENSIONS, API); installed types in `node_modules/@ant-design/x/es/{bubble,actions,locale,sender,attachments}`, `node_modules/@ant-design/x-sdk/es/{x-chat,x-conversations,chat-providers,x-request}`, `node_modules/@ant-design/x-markdown/es/XMarkdown/interface.d.ts`; antd: `Layout`/`Sider`, `Grid.useBreakpoint` (`antd/es/grid/hooks/useBreakpoint.js`), `Upload.customRequest`, `Image.PreviewGroup`, `App.useApp`, `Statistic.Countdown`; Next bundled docs: `02-guides/authentication.md` (layouts and auth checks), `03-api-reference/03-file-conventions/layout.md`, `03-api-reference/04-functions/cookies.md`, `02-guides/preventing-flash-before-hydration.md`; next-auth v4: `configuration/nextjs` (getServerSession in server components), `getting-started/client` (SessionProvider `session` prop); Dify: `openapi_service.json` as cited inline.

## Deviations during execution (2026-10-05)

The plan's execution changed this spec in the places below; where they disagree, the code and the cited record win. ADR-0017 carries the detail for the data layer and the components; the other items are recorded in the commit bodies named (`git log 11c3fb3d..` on this branch).

- **History page order (§4.1).** Dify's `GET /messages` returns each page oldest first (the OpenAPI "newest first" describes the paging direction), so the history mapper keeps a page's order and does not reverse it; `first_id` is the oldest loaded message. [ADR-0017](../../decisions/0017-build-the-chat-on-ant-design-x.md) note of 2026-10-05 (Task 7), commit `025bff8f`.
- **`100dvh` (§3.4).** As specified (`100vh` then `100dvh`); the production CSS minifier keeps the `100vh` fallback only for browser targets without `dvh`, which is harmless (found in the Task 3 review; the Docker check of Task 20 confirms the build). Commit `5e2febcd`, ADR-0011 note of 2026-10-04.
- **Breakpoint switch (§3.3).** Mobile first with a single query: the mobile variant shows by default and `@media (min-width: 768px /* screenMD */)` shows the desktop one and hides the mobile one, so the two are exact complements at fractional widths; the max-width 767 / min-width 768 pair in §3.3 left a sub-pixel gap where both showed. Recorded in `docs/frontend-conventions.md` §4.3.4 and commit `eff79d6f`; the header's own CSS still uses the pair (sub-project 3).
- **Dependencies (§11).** `react-syntax-highlighter` (and its types) stays: the dark code style passes Prism `oneDark` through `CodeHighlighter`'s `highlightProps`, and X has no dark style of its own. The ECharts block hardens every fence option before drawing it (`hardenEChartsOption`, ECharts Security Guidelines). ADR-0017 (Markdown verdict, Implementation Plan), commit `23cc5daf`.
- **Mobile drawer (§5.1).** The header's mobile button is named `system.menu`; the Drawer it opens is titled `chat.conversations_menu` ("Conversations menu") instead of `system.menu`. ADR-0014 note of 2026-10-05, commit `b20835ff`.
- **antd 6 names (§5.2, §5.3).** The HITL countdown is `Statistic.Timer` (`Statistic.Countdown` is deprecated in antd 6) and every `Alert` takes `title` (its `message` prop is deprecated). Commits `2df4d7e6`, `77bb00ba`.
- **Feedback (§5.2, §10).** X 2.9.0 colours neither feedback choice by default, and `Actions.Feedback`'s choices are unnamed `span`s the keyboard cannot reach; like and dislike are antd `Button`s rendered through `Actions`' documented `actionRender`, named through i18next keys, with `aria-pressed` and the selected colour (`colorSuccess`, `colorError`) through `style` ([ADR-0014](../../decisions/0014-header-controls-click-triggered-named-through-i18next.md)). ADR-0017 note of 2026-10-05 (Task 14), commit `31e36872`.
- **Assistant content (§5.2).** `AssistantContent` takes an `extra` slot (the human input form is passed in by the view) instead of an `onResume` callback. Commit `77bb00ba`.
- **Workflow output (§4.8).** When a workflow run's `outputs` holds a single string, it replaces the text streamed by `text_chunk` (the OpenAPI example streams partial chunks before the full output; the old layout did the same). Commit `03cf5ec3`.
- **Language cookie (new §3.2 item).** The UI language is the `i18next` cookie read in the root layout, like the theme (`<html lang>` and `initialLanguage` on the server, a per-request i18next clone, react-i18next `useSSR` on the client), so the server renders the visitor's language and the shells hydrate without a mismatch. ADR-0005 and ADR-0016 notes of 2026-10-05, `docs/i18n-maintenance.md`, commit `1ce5f90d` (Task 18b).
- **Stub apps (§8.1).** The stub's agent app has a required `Topic` text input (the "required inputs block sending" case of §8.2), so every spec that sends on it fills the field first; the chatflow app is seeded with the always-on welcome (`openingStatementDisplayMode: 'always'`) so that case is covered. Commit `92dc5d9f`.
