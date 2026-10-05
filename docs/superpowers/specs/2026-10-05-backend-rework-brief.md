# Backend rework and the frontend areas it touches — brief for a future session

Date: 2026-10-05 · Status: **brief, not a spec** (input to a brainstorming session; nothing here is approved) · Written during the sub-project 2 execution session (branch `feat/chat-on-ant-design-x`), at the owner's request.

## Why this exists

The fork started as a translation of `lexmin0412/dify-app-hub` and kept its backend upstream-shaped so syncs stayed cheap (ADR-0003, ADR-0009, the "merge-friendly" paragraph in `CLAUDE.md`). The frontend has since been rebuilt (ADR-0008) and the owner's roadmap (LDAP, roles, password change, possibly another AI backend) diverges the backend anyway. On 2026-10-05 the owner said holding the backend back only to keep merging from upstream is no longer worth it. This brief lists what that decision unlocks, what it costs, and the frontend code that changes with it, so a later session can brainstorm → spec → plan → execute it (the process in `CLAUDE.md`).

The owner has **not** yet given the go-ahead; the first step of the future session is to confirm the decision and record it (see "Decision to record").

## Decision to record (first task of the future session)

- A new ADR superseding ADR-0009: the whole fork is fork-owned; upstream becomes a source of **cherry-picks** (Dify API tracking, security fixes), not routine merges. Keep `main` as the read-only upstream mirror; make `fork/main` the GitHub default branch (already an open follow-up in `CLAUDE.md`).
- A dated note on ADR-0003 (branch model simplified: no more "sync = merge main into fork/main"; `git fetch upstream` + `git cherry-pick` when wanted).
- `CLAUDE.md`: rewrite the "Merge-friendly with upstream" bullet; keep ADR-0002 (documented approaches only) untouched — it is about library docs, not upstream.
- The session's memory note "Fork translation, merge-friendly" becomes outdated and should be replaced.

## Backend items, in order of value

Each item names the backend files and the frontend areas that change with it. "Frontend area" means code that today carries a workaround or a documented limit because the backend was off-limits.

### 1. Admin Server Actions have no session check of their own (security)

- Backend: `app/(admin)/app-management/actions.ts` (upstream's). Add the server-side session check (`requireSessionUser()` from `lib/session-user.ts`, or a variant that throws instead of redirecting, since Server Actions are not pages) at the top of every action. Check `app/(admin)/user-management/` for the same pattern.
- Frontend affected: none directly; sub-project 3 (admin pages) should assume the actions are gated and stop relying on the layout gate alone.
- Source: ADR-0018 "Consequences" (noted as pre-existing in Task 2).

### 2. `/api/users/*` revoked-session gap (security)

- Backend: the two handlers that check only `!session` instead of `!session?.user?.id` (ADR-0006 verification item: "two `!session?.user?.id` edits").
- Frontend affected: none. Update ADR-0006's open box and `docs/auth-gate.md` "known limits".

### 3. Session typing: next-auth augmentation and a typed session callback

- Backend / shared: `types/next-auth.d.ts` is an ambient module declaration (a script file with `declare module 'next-auth'` and no top-level import), which replaces next-auth's own types instead of augmenting them; `lib/auth.ts` types its `session` callback as `any`. Turn the `.d.ts` into a module augmentation (`import 'next-auth'` or `export {}` at the top, then `declare module 'next-auth' { interface Session { user: … } }`) and type the callback.
- Frontend affected:
  - `components/providers/app-providers.tsx`: `type ServerSession = NonNullable<SessionProviderProps['session']> | null` can become `Session | null` from `next-auth` (recorded deviation in commit `8d1eeea2`).
  - `lib/session-user.ts`: `getCachedServerSession()` stops being `Promise<any>` (Task 2 deferred minor).
  - `proxy.ts:1`: the `// @ts-expect-error next-auth v4 jwt type resolution` should become removable — verify with `tsc`.
  - Any `useSession()` consumer that casts (`hooks/use-auth.ts`).
- Source: Task 2 review and re-review (ledger of the 2026-10-04/05 session), ADR-0018 commit body.

### 4. Stop routes for workflow and completion runs

- Backend: two proxy routes mirroring the existing `app/api/client/dify/[appId]/chat-messages/[taskId]/stop` pattern: `workflows/tasks/[taskId]/stop` → Dify `POST /workflows/tasks/{task_id}/stop`, and `completion-messages/[taskId]/stop` → `POST /completion-messages/{task_id}/stop` (Dify OpenAPI "Dify Service API"). `lib/dify-client.ts`: two methods next to `stopTask` (line ~211).
- Frontend affected: `components/chat/hooks/use-workflow-run.ts` (sub-project 2, Task 17): `stop()` aborts the fetch only; after the routes exist it also posts the stop with the run's `task_id` (spec §4.8 says the Dify run keeps going today). `e2e/fixtures/stub/` already serves the three stop endpoints; add an e2e assertion that the stop call is made. Dated note on ADR-0017.

### 4b. `GET /form/human_input/{form_token}` proxy route

- Backend: the proxy exposes only `POST /api/client/dify/[appId]/form/human_input/[formToken]`. Dify documents the select options (`option_source`), file restrictions (`allowed_file_types`, `allowed_file_extensions`, `allowed_file_upload_methods`) and `number_limits` of a human-input form only on `GET /form/human_input/{form_token}`; the stream (`human_input_required`) and history (`extra_contents`) `inputs` document just `type`, `default` and `output_variable_name`. Add the GET route next to the POST one (`lib/dify-client.ts` already has `getHumanInputForm`).
- Frontend affected: `components/chat/chat-view/chat-view.tsx` / `components/chat/message/human-input-form.tsx` (Task 13): fetch the form definition on `human_input_required` and on reopening a pending form, instead of relying on undocumented fields in the stream; ADR-0017 carries the dated note.
- Source: Task 13 review (2026-10-05 session ledger).

### 4c. `audio2text` proxy: audio type and file name

- Backend: `app/api/client/dify/[appId]/audio2text/route.ts` relabels the browser's WebM recording as `audio/wav` but keeps the file name `speech.webm`. Dify's OpenAPI lists `audio/mp3|m4a|wav|amr|mpga` for `/audio-to-text`. Verify against a real Dify whether the relabelled upload is accepted; if not, transcode or pick a format `MediaRecorder` can emit that Dify accepts, and name the part consistently.
- Frontend affected: `components/chat/hooks/use-speech-to-text.ts` and `speech-recording.ts` (Task 15) — the `mimeType` choice and the file name.
- Source: Task 15 review (2026-10-05 session ledger); speech to text was never run end to end in this session (Playwright cannot record audio).

### 5. Cookie renewal on page load (next-auth, optional)

- Context: passing the server session to `SessionProvider` (Task 2) skips the on-mount `/api/auth/session` fetch, so the 30-day JWT expiry no longer slides on every load and a revoked cookie is cleared only on tab focus or sign-in (ADR-0018, `docs/auth-gate.md`).
- Options to evaluate against next-auth v4 docs (Context7 `/websites/next-auth_js`): (a) accept (current); (b) `refetchInterval` on the provider (client-side, cheap, documented); (c) a server-side refresh is **not** a documented next-auth v4 App Router feature — do not build one.
- Frontend affected: `components/providers/app-providers.tsx` if (b).

### 6. Roadmap features (backend first, then frontend)

- LDAP login (new provider in `lib/auth.ts`, config), user groups / roles and permissions (schema + `lib/access.ts` + admin UI), account-menu "change password" (`/api/users/*` or an action + the `AccountDropdown` in `components/shell/`). Each is its own spec; sub-project 3 (admin, apps, auth pages) is where their UI lands, so the backend parts should exist before or alongside sub-project 3.

### 7. A second AI backend (only if decided)

- Not a current need. If it comes: a connector concept behind the proxy (the `dify_apps` row grows a `kind`), and on the frontend a `ChatBackend` interface at the `components/chat/provider/` seam (provider transforms, fetch router, history and conversation mappers), which is already the only place that reads Dify's event shapes. See the 2026-10-05 session's answer "is the switch easy" in the handoff.

### 8. `DifyApi` resolves Dify error bodies instead of rejecting

- Backend / shared: `lib/dify-client.ts` (`@ts-nocheck`, upstream's) returns Dify's JSON error envelope as a resolved value for non-OK answers on several methods (observed in Task 8: a refused `POST /conversation/{id}/name` still resolves, so the hook cannot tell success from failure). Make the client reject with a typed error (`{ code, message, status }`, the same shape `components/chat/provider/dify-fetch.ts` throws) and type the methods.
- Also: `app/api/client/dify/[appId]/conversation/[conversationId]/route.ts` (DELETE) always answers 200 whatever Dify said, so a refused delete looks successful to the sidebar (Task 16 finding); `useConversations().rename` had to learn the proxy's `{ code, data }` envelope (Task 16 fix) — a typed client would make both go away.
- Frontend affected: `components/chat/hooks/use-conversations.ts` (rename/delete/refresh error paths), `components/chat/chat-view/use-conversation-menu.tsx` (Task 16 checks the response envelope by hand until then), `components/chat/hooks/use-tts.ts` and the feedback/annotation calls (Task 14), `components/chat/hooks/use-workflow-run.ts` (Task 17 reads `Response` objects directly).
- Source: Task 8 report and review (2026-10-05 session ledger).

## Non-goals of the backend rework

- No change to the Dify end-user identity rule (ADR-0006: the signed-in email).
- No MySQL → Postgres move (ADR-0004 stands).
- No rewrite of the proxy; line-level hardening only, unless a connector is decided (item 7).

## Frontend areas, consolidated

| Area | File(s) | Why it changes |
| --- | --- | --- |
| Providers session type | `components/providers/app-providers.tsx` | item 3 (and 5b) |
| Session helpers | `lib/session-user.ts`, `hooks/use-auth.ts` | item 3 |
| Proxy type suppression | `proxy.ts:1` | item 3 |
| Workflow/completion stop | `components/chat/hooks/use-workflow-run.ts`, `e2e/workflow.spec.ts`, `e2e/completion.spec.ts` | item 4 |
| Conversation menu, footer, workflow runner | `components/chat/chat-view/use-conversation-menu.tsx`, `components/chat/hooks/{use-conversations,use-tts,use-workflow-run}.ts` | item 8 |
| Admin pages (sub-project 3) | `app/(admin)/**` | item 1 (assume gated actions), item 6 (roles UI) |
| Account menu | `components/shell/account-dropdown.tsx` | item 6 (change password) |
| Docs | ADR-0006, ADR-0017, ADR-0018 notes; `docs/auth-gate.md`; `CLAUDE.md` | every item |

## When to do it (recommendation from the 2026-10-05 session)

**After the sub-project 2 PR merges and before sub-project 3 starts.** Reasons: sub-project 2's plan and reviews run on "backend untouched" and should finish that way; sub-project 3 builds the admin, apps and auth pages, which are exactly the areas items 1, 3 and 6 touch, so it should build on the fixed backend rather than on today's workarounds; sub-project 4 (Tailwind/Lucide/Radix removal) is independent of the backend and can go either side. Items 1–4 are small (about a day of agent time, one PR, one ADR); item 6 is its own project per feature.

## How to run it

- `superpowers:brainstorming` with this brief → a spec under `docs/superpowers/specs/` → a plan under `docs/superpowers/plans/` → `superpowers:subagent-driven-development` with per-task review (the owner's standing preference: "as robust as possible, the more eyes the better").
- Branch from `fork/main`; PR to `fork/main` with `gh pr create -R LovingCivilian/dify-app-hub --base fork/main`.
- Documented approaches only (ADR-0002): next-auth v4 via Context7 `/websites/next-auth_js`, Next 16 bundled docs under `node_modules/next/dist/docs/` (Server Actions and auth: `01-app/02-guides/authentication.md`), Dify OpenAPI `https://raw.githubusercontent.com/langgenius/dify-docs/main/en/api-reference/openapi_service.json`.
- Tests: vitest for the handlers/helpers (mock pattern in `__tests__/session-user.test.ts`), the e2e stub already serves the stop endpoints.
- Commit trailers: both lines in ONE `-m` (separate `-m` flags leave only the last line parsed as a trailer).

## Open questions for the owner

1. Confirm the supersession of ADR-0009 and the cherry-pick model (or keep merging and do only items 1–4 as line-level edits).
2. Item 5: accept the current behaviour or add `refetchInterval`?
3. Order of the roadmap features in item 6 (LDAP first, or roles first?).

## Sources

`CLAUDE.md` (branch model, merge rules, open follow-ups); ADR-0003, 0006, 0009, 0017, 0018; `docs/auth-gate.md`; spec `2026-10-04-chat-on-ant-design-x-design.md` §4.8 and §12; the 2026-10-04/05 execution session's ledger (Task 2 and Task 4 reviews) and its handoff under `docs/superpowers/handoffs/`.
