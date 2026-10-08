# Dify Service API endpoint map (app-token API, Dify 1.17.1)

Scope: every route served by `api/controllers/service_api` that authenticates with an **app** API key
(`Authorization: Bearer app-…`), as documented by the Dify docs OpenAPI (`openapi_service.json`, dify-docs `main`
at commit `7801fc28`, 2026-09-22) and as actually served by Dify tag **1.17.1** (commit `8387590a`). Knowledge
(`dataset-…` token) endpoints are out of scope; they are listed only where they share the namespace.

Conventions used below:

- **Base path**: the Flask blueprint is mounted at `/v1` (`service_api/__init__.py`), so every path is `/v1<path>`.
  Docs base URL: `https://api.dify.ai/v1` (self-hosted: your own API host + `/v1`).
- **Modes**: `chat` (Chatbot), `agent-chat` (Legacy Agent, ReAct), `advanced-chat` (Chatflow), `workflow`,
  `completion` (Text Generator), and `agent` (the *new* Agent app, `AppMode.AGENT`, 1:1 with a roster Agent; SSE only).
  `AppMode` in 1.17.1 also has `channel` and `rag-pipeline`, which no Service API app endpoint serves.
- **Source gate** = the `app_model.mode` check in the 1.17.1 controller (the error it raises when it fails).
  **Docs "Available for"** = the mode list the OpenAPI operation description states. Where they differ, both are given.
- **`user`** column: where the end-user id is read from (`validate_app_token(fetch_user_arg=…)` in `wraps.py`):
  `JSON` body field, `query` string, or multipart `form` field; `req` = required (missing → 400 `invalid_param`,
  message "Arg user must be provided."), `opt` = optional (omitted → Dify's shared default end user; the docs call it
  `DEFAULT-USER`). "—" = the endpoint takes no end-user context (it runs as the workspace owner account).
- Every authenticated endpoint can also return 401 `unauthorized` (missing/invalid bearer token) and 403 `forbidden`
  (app deleted, app status abnormal, "The app's API service has been disabled", or workspace archived); these are not
  repeated per row.
- Timestamps in responses are Unix epoch seconds unless noted. IDs are UUID strings.

## 1. Endpoint table

### 1.1 Application metadata

| Method & path | Modes (source gate / docs) | `user` | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET /` | none (no auth; `security=[]`) | — | — | `{welcome:"Dify OpenAPI", api_version:"v1", server_version}` — **not in the docs OpenAPI**; useful for detecting the server version | — |
| `GET /info` | no gate / all six | — | — | `{name, description, tags[], mode, author_name}` | 400 `app_unavailable` |
| `GET /parameters` | no gate / all six | — | — | `Parameters`: `opening_statement, suggested_questions[], suggested_questions_after_answer{enabled}, speech_to_text{enabled}, text_to_speech{enabled, voice, language, autoPlay}, retriever_resource{enabled}, annotation_reply{enabled}, more_like_this{enabled}, user_input_form[], sensitive_word_avoidance{enabled}, file_upload{…}, system_parameters{image_file_size_limit, video_file_size_limit, audio_file_size_limit, file_size_limit, workflow_file_upload_limit}` (see §2.1 for `file_upload` and `user_input_form`) | 400 `app_unavailable`; 400 `agent_not_published` (`agent` apps) |
| `GET /meta` | no gate / all six | — | — | `{tool_icons: {<tool name>: <url string> \| {background, content}}}` (empty for `agent` apps per docs) | 400 `app_unavailable` |
| `GET /site` | no gate / all six | — | — | `Site`: `title, chat_color_theme, chat_color_theme_inverted, icon_type (emoji\|image), icon, icon_background, icon_url (computed signed URL when icon_type=image), description, copyright, privacy_policy, input_placeholder, custom_disclaimer, default_language, show_workflow_steps, use_icon_as_answer_icon` | 403 `forbidden` (no site row or workspace archived) |

### 1.2 Chat family (`chat`, `agent-chat`, `advanced-chat`, `agent`)

| Method & path | Modes (source gate / docs) | `user` | Request | Response | Errors |
|---|---|---|---|---|---|
| `POST /chat-messages` | source: `chat, agent-chat, advanced-chat, agent` else 400 `not_chat_app` / docs: Chatflow, Agent, Chatbot, Legacy Agent | JSON req | `application/json`: `inputs` (object, **required**), `query` (string, required), `files[]` (optional; items `{type: document\|image\|audio\|video\|custom, transfer_method: remote_url\|local_file, url \| remote_url (legacy alias) \| upload_file_id}`), `response_mode` (`streaming`\|`blocking`; omitted → blocking, except `agent` apps which always stream; `blocking` on an `agent` app → 400 `bad_request`), `conversation_id` (omit/empty → new), `auto_generate_name` (default true), `workflow_id` (`advanced-chat` only: run a published version; Cloud Sandbox → 403), hidden: `trace_session_id`, `trace_id` (see §2.4) | blocking: `application/json` `ChatCompletionResponse` `{event:"message", task_id, id, message_id, conversation_id, mode, answer, metadata{usage{…}, retriever_resources[]}, created_at}` — **or**, when a Chatflow pauses for Human Input, the paused shape `{event:"workflow_paused", task_id, id, message_id, conversation_id, mode, answer, metadata, created_at, workflow_run_id, data{… status:"paused", paused_nodes[], reasons[]}}` (source `ChatBlockingResponse`, not in docs). streaming: `text/event-stream` (§3) | 400 `app_unavailable`, `not_chat_app`, `conversation_completed`, `provider_not_initialize`, `provider_quota_exceeded`, `model_currently_not_support`, `completion_request_error`, `bad_request` (draft workflow / bad `workflow_id` / blocking on agent), `invalid_param`, `agent_not_published`; 403 `workflow_version_execution_not_allowed`; 404 `not_found` (conversation / workflow); 429 `too_many_requests`, `rate_limit_error`; 500 `internal_server_error` |
| `POST /chat-messages/{task_id}/stop` | same gate / same docs | JSON req | `{user}` — must equal the `user` of the original request; a mismatch is silently ignored (200 anyway) | `{"result":"success"}` (docs list no body) | 400 `not_chat_app`, `invalid_param` |
| `GET /messages/{message_id}/suggested` | same gate / same docs | query req | — | `{result:"success", data: string[]}` | 400 `not_chat_app`, `bad_request` ("Suggested Questions Is Disabled."); 404 `not_found`; 500 |
| `GET /conversations` | same gate / same docs | query opt | query: `last_id` (cursor), `limit` (1–100, default 20), `sort_by` (`created_at, -created_at, updated_at, -updated_at`; default `-updated_at`) | `{limit, has_more, data: [{id, name, inputs{}, status, introduction, created_at, updated_at}]}` | 400 `not_chat_app`; 404 `not_found` (bad `last_id`) |
| `DELETE /conversations/{conversation_id}` | same gate / same docs | JSON opt | `{user}` (body on a DELETE) | **204** empty | 400 `not_chat_app`; 404 `not_found` |
| `POST /conversations/{conversation_id}/name` | same gate / same docs | JSON opt | `{name?, auto_generate?: bool (default false; true ignores name), user?}` | `SimpleConversation` (same item shape as the list) | 400 `not_chat_app`, `invalid_param` (auto_generate on an empty conversation); 404 `not_found` |
| `GET /conversations/{conversation_id}/variables` | source: `chat, agent-chat, advanced-chat` (**not** `agent`) / docs: Chatflow, Chatbot, Legacy Agent | query opt | query: `last_id`, `limit` (1–100), `variable_name` (letters, digits, `-_.` only) | `{limit, has_more, data: [{id, name, value_type, value (string, JSON-encoded for complex types), description, created_at, updated_at}]}` | 400 `not_chat_app`, `invalid_param`; 404 `not_found` |
| `PUT /conversations/{conversation_id}/variables/{variable_id}` | same as above | JSON opt | `{value: <any, must match value_type>, user?}` | one variable item | 400 `not_chat_app`, `bad_request` (type mismatch); 404 `not_found` (conversation or variable) |
| `GET /messages` | source: 4 chat modes / docs: Chatflow, Agent, Chatbot, Legacy Agent | query opt | query: `conversation_id` (**required**), `first_id` (cursor, older page), `limit` (1–100, default 20) | `{limit, has_more, data: [MessageListItem]}`; item: `id, conversation_id, parent_message_id, inputs{}, query, answer, feedback{rating}\|null, retriever_resources[], created_at, agent_thoughts[{id, chain_id, message_id, position, thought, tool, tool_labels, tool_input, created_at, observation, files[]}], message_files[{id, type, url, belongs_to, filename, mime_type, size, transfer_method, upload_file_id}], message_tokens, answer_tokens, total_tokens, provider_response_latency, total_price, currency, status (normal\|error), error, extra_contents[{type:"human_input", workflow_run_id, form_definition, form_submission_data, submitted}]` | 400 `not_chat_app`; 404 `not_found` (conversation / `first_id`) |

### 1.3 Completion (`completion`)

| Method & path | Modes (source gate / docs) | `user` | Request | Response | Errors |
|---|---|---|---|---|---|
| `POST /completion-messages` | source: `completion` else 400 **`app_unavailable`** (the `not_completion_app` class exists but is unused) / docs: Text Generator | JSON req | `inputs` (**required**; the prompt text usually goes in `inputs.query`), `query` (legacy, default ""), `files[]`, `response_mode` (omitted → blocking), hidden `trace_session_id`/`trace_id` | blocking: `CompletionResponse` `{event:"message", task_id, id, message_id, mode:"completion", answer, metadata{usage, retriever_resources}, created_at}`; streaming: SSE (§3) | 400 `app_unavailable`, `provider_not_initialize`, `provider_quota_exceeded`, `model_currently_not_support`, `completion_request_error`, `invalid_param`, `conversation_completed`; 404 `not_found`; 429 `too_many_requests`; 500 |
| `POST /completion-messages/{task_id}/stop` | same | JSON req | `{user}` (must match; mismatch silently ignored) | `{"result":"success"}` | 400 `app_unavailable`, `invalid_param` |

### 1.4 Workflow (`workflow`; some also `advanced-chat`)

| Method & path | Modes (source gate / docs) | `user` | Request | Response | Errors |
|---|---|---|---|---|---|
| `POST /workflows/run` | source: `workflow` only else 400 `not_workflow_app` / docs: Workflow | JSON req | `inputs` (**required**; file-type variables are arrays of `{type, transfer_method, url\|upload_file_id}`), `files[]` (system file input), `response_mode` (omitted → blocking), hidden `trace_session_id`/`trace_id` | blocking: `{task_id, workflow_run_id, data{id, workflow_id, status (succeeded\|failed\|stopped\|partial-succeeded), outputs{}, error, elapsed_time, total_tokens, total_steps, created_at, finished_at}}` — **or** paused: `data.status:"paused"`, plus `data.paused_nodes[]`, `data.reasons[{TYPE, form_id, node_id, node_title, form_content, inputs[], actions[], display_in_ui, resolved_default_values{}, form_token, approval_channels[], expiration_time, message}]` (source `WorkflowBlockingResponse` union; docs only show the finished shape). streaming: SSE (§3) | 400 `not_workflow_app`, `provider_not_initialize`, `provider_quota_exceeded`, `model_currently_not_support`, `completion_request_error`, `invalid_param` (missing user, unpublished workflow); 403 `trigger_workflow_service_mode_unavailable` (workflow starts from a trigger node); 429 `too_many_requests`, `rate_limit_error`; 500 |
| `POST /workflows/{workflow_id}/run` | source: `workflow` only / docs: Workflow | JSON req | same body as `/workflows/run`; `workflow_id` = a published version id (from `workflow_id` in run responses) | same as `/workflows/run` | as above plus 400 `bad_request` (draft / bad id format), 403 `workflow_version_execution_not_allowed` (Cloud Sandbox), 404 `not_found` (workflow) |
| `POST /workflows/tasks/{task_id}/stop` | source: `workflow` only / docs: Workflow | JSON req | `{user}` — required but **not checked** against the run's creator (source: `set_stop_flag_no_user_check` + graph-engine stop command) | `{"result":"success"}` | 400 `not_workflow_app`, `invalid_param` |
| `GET /workflows/run/{workflow_run_id}` | source: `workflow, advanced-chat` else 400 `not_workflow_app` / docs: Chatflow, Workflow | — | — | `{id, workflow_id, status, inputs (docs: raw JSON string; source type allows dict/list/str/…), outputs{} ({} while paused), error, total_steps, total_tokens, created_at, finished_at, elapsed_time}` | 400 `not_workflow_app`; 404 `not_found` |
| `GET /workflows/logs` | no gate / docs: Chatflow, Workflow | — | query: `keyword`, `status` (`succeeded\|failed\|stopped`), `created_at__before`, `created_at__after` (ISO 8601), `created_by_end_user_session_id`, `created_by_account` (docs: account **email**; source field doc: account **ID**), `page` (1–99999), `limit` (1–100) | `{page, limit, total, has_more, data: [{id, workflow_run{id, version, status, triggered_from, error, elapsed_time, total_tokens, total_steps, created_at, finished_at, exceptions_count}, details, created_from, created_by_role, created_by_account{id, name, email}\|null, created_by_end_user{id, type, is_anonymous, session_id}\|null, created_at}]}` | 400 `invalid_param` |
| `GET /workflow/{workflow_run_id}/events` (**singular** `workflow`) | source: `workflow, advanced-chat` else 400 `not_workflow_app` / docs: Chatflow, Workflow | query req | query: `user` (must equal the run's creator, else 404), `include_state_snapshot` (bool, default false: replay executed nodes' status first), `continue_on_pause` (bool, default false: keep the stream open across several `workflow_paused`) | `text/event-stream`: same event schemas as the original run; a finished run yields a single `workflow_finished` then closes | 400 `not_workflow_app`; 404 `not_found` (unknown run, other app, not created by an end user, or `user` mismatch) |

### 1.5 Human input (HITL) — paths are exactly as asked

| Method & path | Modes (source gate / docs) | `user` | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET /form/human_input/{form_token}` | no mode gate; form must belong to this app and be a web-app ("Service API surface") recipient / docs: Chatflow, Workflow | — | — | `{form_content (rendered Markdown), inputs[{type: paragraph\|select\|file\|file-list, output_variable_name, default{type: constant\|variable, selector[], value}, option_source{…} (select), allowed_file_types[], allowed_file_extensions[], allowed_file_upload_methods[], number_limits (file-list)}], resolved_default_values{}, user_actions[{id, title, button_style: primary\|default\|accent\|ghost}], expiration_time}` | 404 `not_found`; 412 `human_input_form_submitted`, `human_input_form_expired` |
| `POST /form/human_input/{form_token}` | same | JSON req | `{inputs: {<output_variable_name>: string \| {transfer_method:"local_file", upload_file_id} \| {transfer_method:"remote_url", url\|remote_url} \| [file mappings]}, action: <user_actions[].id>, user}` | **`{}`** (200); the run resumes on the chosen action branch | 400 `bad_request` (recipient type invalid), `invalid_form_data`; 404 `not_found`; 412 `human_input_form_submitted`, `human_input_form_expired` |

`form_token` arrives in the `human_input_required` SSE event (`data.form_token`; `null` means Email delivery, which the
API cannot drive). Forms are one-shot: the first submission wins regardless of `user`.

### 1.6 Files, audio, feedback, end users

| Method & path | Modes (source gate / docs) | `user` | Request | Response | Errors |
|---|---|---|---|---|---|
| `POST /files/upload` | no gate / all six | form opt | `multipart/form-data`: `file` (exactly one part; filename required, no `/` or `\`), `user` | **201** `FileResponse`: `{id, reference (null), name, size, extension, mime_type, created_by (end-user id), created_at, preview_url, source_url, original_url, user_id (null), tenant_id, conversation_id, file_key (null)}` | 400 `no_file_uploaded`, `too_many_files`, `filename_not_exists_error`, `file_extension_blocked`, `invalid_param`; 413 `file_too_large` (docs: `message` currently empty); 415 `unsupported_file_type` (part has no MIME type) |
| `GET /files/{file_id}/preview` | no gate / docs: Chatflow, Chatbot, Legacy Agent, Text Generator | query opt (no effect on access) | query: `as_attachment` (bool) | binary body, `Content-Type` = file MIME (`application/octet-stream` + `Content-Disposition: attachment; filename*=UTF-8''…` when `as_attachment=true`), `Content-Length`, `Accept-Ranges: bytes` for audio/video, `Cache-Control: public, max-age=3600`; HTML is forced to download. Access is by app/message ownership, not by `user` | 403 `file_access_denied`; 404 `file_not_found` |
| `POST /audio-to-text` | no gate / all six | form opt | `multipart/form-data`: `file` (mp3, mpga, m4a, x-m4a, wav, amr; ≤ 30 MB), `user` | `{text}` | 400 `app_unavailable`, `no_audio_uploaded`, `speech_to_text_disabled`, `provider_not_support_speech_to_text`, `provider_not_initialize`, `provider_quota_exceeded`, `model_currently_not_support`, `completion_request_error`; 413 `audio_too_large`; 415 `unsupported_audio_type`; 500 |
| `POST /text-to-audio` | no gate / all six | JSON opt | `{message_id? (wins over text), text?, voice? (from parameters.text_to_speech.voice), streaming? (ignored), user?}` | binary audio; `Content-Type` one of `audio/aac, audio/flac, audio/mp4, audio/mpeg, audio/ogg, audio/wav, audio/webm` (sniffed; `audio/mpeg` fallback); chunked when the provider streams | 400 `app_unavailable`, `invalid_param` (TTS off / no text / no voice), `provider_not_initialize`, `provider_quota_exceeded`, `model_currently_not_support`, `completion_request_error`; 500 |
| `POST /messages/{message_id}/feedbacks` | no gate / docs: Chatflow, Chatbot, Legacy Agent, Text Generator | JSON req | `{rating: "like"\|"dislike"\|null (null revokes), content?, user}` | `{"result":"success"}` | 400 `invalid_param`; 404 `not_found` |
| `GET /app/feedbacks` (**singular** `app`) | no gate / docs: Chatflow, Chatbot, Legacy Agent, Text Generator | — | query: `page` (≥1), `limit` (1–101, default 20) | `{data: [{id, app_id, conversation_id, message_id, rating, content, from_source (user\|admin), from_end_user_id, from_account_id, created_at, updated_at}]}` (timestamps are strings here) | — |
| `GET /end-users/{end_user_id}` | no gate / all six | — | — | `{id, tenant_id, app_id, type ("service-api"), external_user_id (= the `user` you sent), name, is_anonymous, session_id, created_at, updated_at}` | 404 `end_user_not_found` |

### 1.7 Annotations (plural `apps`)

| Method & path | Modes (source gate / docs) | `user` | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET /apps/annotations` | no gate / docs: Chatflow, Chatbot, Legacy Agent | — | query: `page` (≥1), `limit` (≥1; docs: capped at 100), `keyword` | `{data: [{id, question, answer, hit_count, created_at}], has_more, limit, total, page}` | — |
| `POST /apps/annotations` | same | — | `{question, answer}` | **201** annotation item | — |
| `PUT /apps/annotations/{annotation_id}` | same (+ `edit_permission_required` on the owner account) | — | `{question, answer}` | annotation item | 403 `forbidden`; 404 `not_found` |
| `DELETE /apps/annotations/{annotation_id}` | same | — | — | **204** empty | 403 `forbidden`; 404 `not_found` |
| `POST /apps/annotation-reply/{action}` (`enable`\|`disable`) | same | — | `{score_threshold (float), embedding_provider_name, embedding_model_name}` — all three required even for `disable` | `{job_id, job_status: waiting\|processing}` (async) | 400 `invalid_param` |
| `GET /apps/annotation-reply/{action}/status/{job_id}` | same | — | — | `{job_id, job_status: waiting\|processing\|completed\|error, error_msg}` | 400 `invalid_param` ("The job does not exist.") |

### 1.8 In the same namespace but not app-token

| Method & path | Auth | Notes |
|---|---|---|
| `GET /workspaces/current/models/model-types/{model_type}` | **dataset** token (`validate_dataset_token`) | `model_type ∈ text-embedding, rerank, llm, tts, speech2text, moderation`; returns `{data: [provider-with-models]}`. Documented under "Models"; an app key gets 401. |
| `/datasets/**` (29 operations) | dataset token | Knowledge API; out of scope. |

Counts: 36 app-token operations on 32 paths (plus `GET /` and the dataset-token models endpoint). The docs OpenAPI's
app-token operations are exactly these 36; nothing in it is missing from 1.17.1 and nothing in 1.17.1 is missing from it
except `GET /`.

## 2. Shapes worth knowing

### 2.1 `/parameters` details the docs under-document (source `controllers/common/fields.py`)

- `file_upload` (source `FileUploadObject`): top-level `enabled, number_limits, allowed_file_types[document|image|audio|video|custom], allowed_file_extensions[], allowed_file_upload_methods[remote_url|local_file]` **plus** the legacy `image{enabled, number_limits, detail, transfer_methods[]}` object. The docs schema shows only `image{…}`.
- `user_input_form[]` items are single-key objects keyed by control type, one of `text-input, select, paragraph, number, external_data_tool, file, file-list, checkbox, json_object` (docs mention only `text-input, paragraph, select`); each config has `variable, label (both required), description, required, hide, default, type, max_length, options[], allowed_file_types, allowed_file_extensions, allowed_file_upload_methods, json_schema, config`.

### 2.2 `files[]` item (chat / completion / workflow requests, source `service_api/schema.py`)

`{type: document|image|audio|video|custom, transfer_method: remote_url|local_file, url | remote_url (legacy alias) | upload_file_id}`; `upload_file_id` is required for `local_file` and also accepted with `remote_url` for persisted references. The docs' completion/workflow schema shows the two-variant form without `type`; the chat schema and the source require `type`.

### 2.3 Blocking responses can be "paused"

Chatflow (`/chat-messages`) and Workflow (`/workflows/run`, `/workflows/{id}/run`) blocking calls return the paused
union member when a Human Input node is reached (§1.2, §1.4). Treat `event == "workflow_paused"` (chat) or
`data.status == "paused"` (workflow) as "resume later via `/workflow/{workflow_run_id}/events`".

### 2.4 Tracing inputs hidden from the docs schema (source `core/helper/trace_id_helper.py`)

Accepted by `/chat-messages`, `/completion-messages`, `/workflows/run`, `/workflows/{id}/run`:

- external trace id: header `X-Trace-Id`, else query `trace_id`, else JSON `trace_id`, else OTel context / `traceparent`; `^[A-Za-z0-9_-]{1,128}$`.
- trace session id: header `X-Trace-Session-Id`, else query/JSON `trace_session_id` (1–200 chars; invalid → 400).

Both are forwarded to the tracing integrations (Langfuse etc.); a proxy wanting per-person attribution should pass them through.

## 3. Streaming (SSE)

Wire format (source `BaseAppGenerator.convert_to_event_stream`, `libs/helper.compact_generate_response`): HTTP 200,
`Content-Type: text/event-stream`. Dict events are written as `data: {json}\n\n`; string events as `event: <name>\n\n`
— so **`ping` is a bare `event: ping` frame with no `data:` line**. Chatflow and Workflow streams open with a `ping`,
then one roughly every 10 s. Parse `data:` lines, dispatch on the JSON `event` field, ignore everything else.

Event names — source `StreamEvent` enum (`core/app/entities/task_entities.py`, 29 values): `ping, error, message,
message_end, tts_message, tts_message_end, message_file, message_replace, agent_thought, agent_message,
workflow_started, workflow_paused, workflow_finished, node_started, node_finished, node_retry, iteration_started,
iteration_next, iteration_completed, loop_started, loop_next, loop_completed, text_chunk, text_replace,
reasoning_chunk, agent_log, human_input_required, human_input_form_filled, human_input_form_timeout`.
The docs list the same names except **`text_replace`** (source only).

Per endpoint (docs enums):

| Endpoint | Documented events | Terminal event(s) |
|---|---|---|
| `POST /completion-messages` (`ChunkCompletionEvent`) | `message, message_end, message_file, tts_message, tts_message_end, message_replace, error, ping` | `message_end`, or `error` |
| `POST /chat-messages` (`ChunkChatEvent`) | all 28 docs names; by mode: **Chatbot** `message…→message_end`; **Legacy Agent** `agent_thought` + `agent_message…→message_end`; **Agent** `agent_message` + `agent_thought` → one closing `message` with the complete answer (do not append) → `message_end` (its metadata never has `retriever_resources`); **Chatflow** `workflow_started → node_*/iteration_*/loop_*/agent_log/text_chunk/reasoning_chunk` alongside `message` chunks → success: `message_end` then `workflow_finished`; failure: `workflow_finished{status:"failed"}` then `error` (no `message_end`); pause: `human_input_required` then `workflow_paused` | `message_end` (+ `workflow_finished` for Chatflow), `workflow_paused`, or `error` |
| `POST /workflows/run`, `POST /workflows/{id}/run` (`ChunkWorkflowEvent`) | `workflow_started, node_started, node_finished, node_retry, iteration_started, iteration_next, iteration_completed, loop_started, loop_next, loop_completed, reasoning_chunk, text_chunk, workflow_finished, tts_message, tts_message_end, workflow_paused, agent_log, human_input_required, human_input_form_filled, human_input_form_timeout, error, ping` | `workflow_finished`, `workflow_paused`, or `error` |
| `GET /workflow/{run_id}/events` | same schemas as the originating run; a resumed run carries `human_input_form_filled` or `human_input_form_timeout` then the remaining node events; closes at each `workflow_paused` unless `continue_on_pause=true`; a finished run emits one `workflow_finished` | as above |

Common fields: chat-family events carry top-level `task_id, message_id, conversation_id, created_at` (`error` lacks
`task_id`); workflow-app events carry `task_id, workflow_run_id`. Workflow/node/HITL events nest their payload under
`data` and, except `agent_log`, carry a top-level `workflow_run_id`. Key payloads (docs schemas):

- `message` / `agent_message`: `answer`. `message_replace`: `answer`, (`reason` on Chatflow). `message_file`: `id, type, belongs_to, url`.
- `agent_thought`: `id, position, thought, tool, tool_input (JSON string), observation, message_files[]`.
- `message_end`: `id, metadata{usage, retriever_resources, annotation_reply?}`, `files[]` (completion).
- `tts_message` / `tts_message_end`: `audio` (base64 chunk).
- `workflow_started`: `data{id, workflow_id, inputs, reason, created_at}`. `node_started`: `data{id, node_id, node_type, title, index, predecessor_node_id, inputs, iteration_id, loop_id, extras, created_at}`. `node_finished`/`node_retry`: `data{… status, outputs, error, elapsed_time, execution_metadata, process_data, files, finished_at (+retry_index)}`; workflow-app variants add `inputs_truncated, outputs_truncated, process_data_truncated`.
- `text_chunk`: `data{text, from_variable_selector}`. `reasoning_chunk`: `data{reasoning, node_id, is_final, message_id (null for workflow apps)}` (LLM nodes with `reasoning_format: separated`).
- `workflow_finished`: `data{id, workflow_id, status (succeeded|failed|partial-succeeded|stopped), outputs, error, elapsed_time, total_tokens, total_steps, exceptions_count, files, created_by, created_at, finished_at}`.
- `workflow_paused`: `data{workflow_run_id, status:"paused", paused_nodes[], reasons[], outputs, elapsed_time, total_tokens, total_steps, created_at}`.
- `human_input_required`: `data{form_id, form_token (null = email delivery), node_id, node_title, form_content, inputs[], actions[], display_in_ui, resolved_default_values, expiration_time}`.
- `human_input_form_filled`: `data{node_id, node_title, action_id, action_text, rendered_content, submitted_data}`. `human_input_form_timeout`: `data{node_id, node_title, expiration_time}`.
- `error`: `status, code, message` (same codes as §4); HTTP status stays 200. A node failure instead surfaces as `node_finished`/`workflow_finished` with `status: "failed"`.
- Agent apps (docs `guides/agent.mdx`): runs are capped (1 h default via `APP_MAX_EXECUTION_TIME` / `WORKFLOW_MAX_EXECUTION_TIME` / `DIFY_AGENT_RUN_TIMEOUT_SECONDS`, 500 model requests) and close with an `error` whose code is `agent_run_limit_exceeded`; `agent_message` deltas are batched (~0.5 s).

`task_id` (from any stream event) is what the stop endpoints take; `workflow_run_id` is the persistent run record for
`/workflows/run/{id}` and `/workflow/{id}/events`.

## 4. Error body

Every error is the three-field envelope (`libs/exception.py` `BaseHTTPException.data`, `libs/external_api.py`
`register_external_error_handlers`, docs `guides/errors.mdx`):

```json
{ "code": "invalid_param", "message": "user is required", "status": 400 }
```

- `code` is `error_code` of the raised `BaseHTTPException`; for plain Werkzeug exceptions it is the snake_cased class name (`NotFound` → `not_found`, `BadRequest` → `bad_request`, `Forbidden` → `forbidden`, `Unauthorized` → `unauthorized`, `InternalServerError` → `internal_server_error`). `status` mirrors the HTTP status; `message` is the description.
- A bare `ValueError` in a controller becomes 400 `{code:"invalid_param", message:str(e)}`; a 400 whose message is a `{field: reason}` mapping becomes `{code:"invalid_param", message, params:"<field>", status:400}`.
- `AppInvokeQuotaExceededError` → 429 `too_many_requests`; `PluginRuntimeError` → 502 `plugin_runtime_error` with `details{request_id, lambda_request_id?}`; any other exception → 500 (`code` defaults to `unknown`, `message` "Internal Server Error").
- 401 responses add `WWW-Authenticate: Bearer realm="api"`. Statuses in use on app endpoints: 200, 201, 204, 400, 401, 403, 404, 412 (HITL form state), 413, 415, 429, 500, 502; 503 `service_unavailable` is Knowledge/Cloud-only.
- Mid-stream failures do not change the HTTP status; they arrive as an `error` event with the same `code` values.
- Retry guidance (docs): retry `too_many_requests`, 500 and network failures with backoff; `rate_limit_error` (Cloud plan quota) and the four provider codes (`provider_not_initialize`, `provider_quota_exceeded`, `model_currently_not_support`, `completion_request_error`) are configuration/quota problems and do not clear on retry.

## 5. Versioning caveats

- **Nothing in the docs OpenAPI is newer than 1.17.1.** All 36 app-token operations resolve to routes in tag 1.17.1 (`__init__.py` imports `annotation, app, audio, completion, conversation, file, file_preview, human_input_form, message, site, workflow, workflow_events` plus `end_user`). The docs JSON carries no version markers (`x-mint` holds only page hrefs/titles; the only `deprecated` flags are on Knowledge operations).
- Route history (checked against tags 1.11.0, 1.12.0, 1.13.0, 1.14.0, 1.16.0, 1.17.0): `/end-users/{id}` first appears in **1.13.0**; `/form/human_input/{form_token}` (GET+POST) and `/workflow/{workflow_run_id}/events` first appear in **1.14.0** (absent in 1.13.0); every other path already exists in 1.11.0. Between 1.17.0 and 1.17.1 only URL-variable names changed (`<uuid:c_id>` → `<uuid:conversation_id>`, `/workflow/<task_id>/events` → `<workflow_run_id>`), not the paths. A proxy for a ≥ 1.14 server can expose the whole map; for < 1.14 hide the HITL and events routes, for < 1.13 also `/end-users`.
- `agent` (new Agent app) mode exists in 1.17.1 (`AppMode.AGENT`); it is SSE-only on `/chat-messages`, and `/parameters` can answer 400 `agent_not_published` for it. Conversation variables are not available for `agent` apps (source gate).
- Cloud-only behaviours documented but inert on self-hosted: 429 `rate_limit_error` (workflow execution quota), 403 `workflow_version_execution_not_allowed` (Sandbox plan on `workflow_id` pinning / run-by-id), 503 `service_unavailable` (Knowledge vector space).
- `GET /v1/` returns `server_version` without auth and can drive feature detection.
- HITL event names (`human_input_required`, `human_input_form_filled`, `human_input_form_timeout`, `workflow_paused`) are present in the 1.17.1 enum; their introduction version was not checked separately (they ship with the 1.14.0 HITL routes).

## 6. Docs vs source discrepancies (both recorded)

| Topic | Docs (OpenAPI `main` @ 7801fc28) | Source (1.17.1) |
|---|---|---|
| Mode availability of `/files/{id}/preview`, `/app/feedbacks`, `/messages/{id}/feedbacks`, annotations, `/workflows/logs`, HITL form | restricted "Available for" lists (see table) | no `app_model.mode` check; any valid app token is accepted (data may just be empty) |
| `/completion-messages` on a non-completion app | 400 `app_unavailable` | same (`NotCompletionAppError`/`not_completion_app` is defined but never raised) |
| `/parameters.file_upload` | only `image{…}` documented | also `enabled, number_limits, allowed_file_types, allowed_file_extensions, allowed_file_upload_methods` (§2.1) |
| `user_input_form` control types | `text-input, paragraph, select` | nine types incl. `number, file, file-list, checkbox, json_object, external_data_tool` |
| Blocking Chatflow/Workflow response | only the finished shape | discriminated union with a paused shape (§2.3) |
| Stop endpoints and message feedback 200 body | no body documented | `{"result":"success"}` |
| `/workflows/logs?created_by_account` | "creator's account email" | field doc says "account ID" (value passed straight to the service) |
| `/workflows/run/{id}.inputs` | "raw JSON string" | typed `dict \| list \| str \| int \| float \| bool \| None` |
| `files[]` item on completion/workflow | two-variant schema without `type` | `type` required (`INPUT_FILE_ITEM_SCHEMA`) |
| SSE event `text_replace` | not documented | in `StreamEvent` enum |
| `/workflows/tasks/{id}/stop` `user` | required, "need not match" | required (`invalid_param` if absent), not checked (`set_stop_flag_no_user_check`) |
| Tracing (`X-Trace-Id`, `X-Trace-Session-Id`, `trace_id`, `trace_session_id`) | absent (SkipJsonSchema) | accepted on the four generation endpoints (§2.4) |
| `GET /v1/` | absent | `{welcome, api_version, server_version}` |

## 7. Sources

Docs (langgenius/dify-docs, branch `main`; `openapi_service.json` last changed in commit
`7801fc28b3abe3ae99aee9f949092ec67c5681ed`, 2026-09-22):

- https://raw.githubusercontent.com/langgenius/dify-docs/main/en/api-reference/openapi_service.json (the only OpenAPI file; `https://api.github.com/repos/langgenius/dify-docs/contents/en/api-reference` lists just it and `guides/`)
- https://raw.githubusercontent.com/langgenius/dify-docs/main/en/api-reference/guides/{get-started,end-user-identity,errors,streaming,human-input-flow,chat,chatflow,agent,completion,workflow}.mdx (rendered at https://docs.dify.ai/en/api-reference/guides/…)

Dify source, tag `1.17.1` (commit `8387590ace4a094de812b7847fc6a4c3a27cd52b`), under `api/`:

- `controllers/service_api/__init__.py`, `index.py`, `wraps.py`, `schema.py`
- `controllers/service_api/app/{app,site,completion,conversation,message,file,file_preview,audio,annotation,human_input_form,workflow,workflow_events,error}.py`
- `controllers/service_api/end_user/end_user.py`, `controllers/service_api/workspace/models.py`
- `controllers/common/{fields,controller_schemas,human_input,errors}.py`, `controllers/web/error.py`
- `core/app/entities/task_entities.py` (`StreamEvent`), `core/app/apps/base_app_generator.py`, `core/helper/trace_id_helper.py`
- `libs/exception.py`, `libs/external_api.py`, `libs/helper.py`, `services/errors/app.py`
- `models/model.py` (`AppMode`), `fields/{file_fields,annotation_fields,message_fields,conversation_fields,end_user_fields}.py`
- Route-history checks: the same `service_api` controllers at tags `1.17.0`, `1.16.0`, `1.14.0`, `1.13.0`, `1.12.0`, `1.11.0` (https://raw.githubusercontent.com/langgenius/dify/<tag>/api/controllers/service_api/…); tag list from https://api.github.com/repos/langgenius/dify/git/matching-refs/tags/1.1

Raw downloads and the extraction scripts are kept beside this file under `downloads/` and `scripts/`
(`openapi-app-dump.txt`, `openapi-descriptions.txt` are the parsed views of the OpenAPI).
