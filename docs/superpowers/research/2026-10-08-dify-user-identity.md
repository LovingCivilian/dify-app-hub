> Committed copy (2026-10-08) of the research behind [ADR-0026](../../decisions/0026-use-the-accounts-permanent-id-as-the-dify-end-user.md), first written as `tmp/b2-dify-user-identity.md`; its pinned sources were scratch copies in `tmp/identity-research/`, not committed.

# Dify end-user identity: email vs a stable id (B2 research, 2026-10-08)

Research record for the owner. No code and no tracked file changed. Scratch copies of every source quoted here are in `tmp/identity-research/` (`dify/` holds a sparse clone of Dify tag 1.17.1, commit `8387590a`, plus the dify-docs pages at `main` `4c06be15`; `langfuse/`, `ldap/` and `refs/` hold the other downloads).

## 0. Short answer

- Dify ties every conversation, message, file and workflow run to the `user` string you send. It has **no API that renames an end user, merges two of them or moves a conversation between them**. That holds for the Service API, the console API and the CLI commands. So the identity has to be right on the way in.
- Dify's own docs answer the question directly: _"Dify never authenticates it, so pick a stable value per person, such as an account ID, and send it consistently."_ (§1.1). OIDC Core §5.7, Microsoft Entra and Microsoft's AD docs say the same about email: it can change and can be reused, so it must not be the key (§4). Two of the reference chat apps, LibreChat and Lobe Chat, send their immutable internal id (§5).
- Langfuse receives exactly the same string. Dify sends the end user's `session_id`, which is our `user`, as the trace `user_id` (§2). Langfuse has no user entity: `userId` is "purely a string field", with no display name (§3). An opaque id therefore shows as an opaque id in both places. The readable mapping has to live in the hub.
- **Recommendation:** send an immutable per-account id (option B), stored in its own column that nothing ever updates. Back-fill that column with each existing account's current email, so no existing history moves. Every account created afterwards gets its `users.id`. The hub's users page shows each account's Dify id, and the owner pastes it into Dify's or Langfuse's search. Doing this inside B2 costs one migration and one changed line at the single choke point, `lib/dify/route.ts:52`. B3 then links LDAP accounts by `entryUUID` or `objectGUID`, never by `mail`. Details in §8.

## 1. Dify 1.17.1: how `user` becomes an end user

### 1.1 Docs

`en/api-reference/guides/end-user-identity.mdx` (dify-docs `main` `4c06be15`; rendered at docs.dify.ai/en/api-reference/guides/end-user-identity):

> "Most app endpoints take a `user` field: your own identifier for the end user a call acts on behalf of. Dify never authenticates it, so pick a stable value per person, such as an account ID, and send it consistently." "Dify starts tracking a new `user` the first time it appears" "**Conversations**: listing, history, renaming, and deletion all operate on that user's conversations only." "**Files**: an upload belongs to the uploading user, and referencing it under a different `user` fails." "Keep one `user` per person across every call in a flow—upload, send, stop, and resume all check it." "Traffic through the API and Dify's hosted web app keep separate identities"

The repo's endpoint map `docs/dify-service-api-1.17.1.md` already records parts of this:

- the `user` column convention: where `user` is read from, and that omitting it gives `DEFAULT-USER` (lines 19–22);
- `GET /end-users/{end_user_id}`, read-only, returning `external_user_id (= the user you sent), name, session_id` (line 96, first present in 1.13.0 per line 208);
- the hidden tracing inputs `X-Trace-Id` and `X-Trace-Session-Id` (§2.4, lines 136–143, and line 229: "absent (SkipJsonSchema)" in the docs).

It does not record how the end user is created, the per-app scope, the logs UI or the Langfuse mapping. Those are below.

### 1.2 Source: creation, scope, columns

- `api/controllers/service_api/wraps.py` L133–155 (`validate_app_token(fetch_user_arg=…)`): `user` is read from the query, the JSON or the form, then `EndUserService.get_or_create_end_user(app_model, user_id)`.
- `api/services/end_user_service.py` L47–102: the lookup is `EndUser.tenant_id == tenant_id, EndUser.app_id == app_id, EndUser.session_id == user_id`. When nothing matches, Dify creates `EndUser(tenant_id, app_id, type=SERVICE_API, is_anonymous=(user_id == "DEFAULT-USER"), session_id=user_id, external_user_id=user_id)`. So one person has **one `end_users` row per app**, created on first use, and the string is stored twice, as `session_id` and `external_user_id`.
- `api/models/model.py` L2112–2142 (`EndUser`, table `end_users`): `id` UUID (Dify's own key), `tenant_id`, `app_id`, `type`, `external_user_id String(255)`, `name String(255)`, `session_id String(255) NOT NULL`. There are indexes on `(session_id, type)` and `(tenant_id, session_id, type)` and **no unique constraint**. **The Service API never sets `name`**: no write path in `api/controllers/service_api` or `api/services` assigns it for Service API users. `GET /end-users/{id}` (`controllers/service_api/end_user/end_user.py` L16–57) only reads.
- Matching is byte-exact on Dify's database. The Dify Docker default is PostgreSQL (`docker/.env.example` L75 `DB_TYPE=postgresql`), and PostgreSQL "considers strings to be equal only if they consist of the same byte sequence" under a deterministic collation (postgresql.org/docs/current/collation.html). The hub's `users.email` compares case-insensitively (`utf8mb4_0900_ai_ci`, ADR-0024 "No email normalisation"). So an admin edit that only changes letter case (`Jane@` → `jane@`) also moves the Dify identity.

### 1.3 Source: how conversations and messages are scoped

- `models/model.py` L1183–1185: `Conversation.from_source`, `from_end_user_id` (= `end_users.id`), `from_account_id`. L1512–1513: the same on `Message`. Files carry `created_by` = the end-user id (endpoint map line 90). Workflow runs carry `created_by` (`workflow_app_log_query_repository.py` L103).
- `services/conversation_service.py` L52–59 (list) and L176–180 (get, which rename, delete and message history go through): `Conversation.from_source == "api"` and `Conversation.from_end_user_id == user.id`.
- Consequence: history is bound to the `end_users` row that the string selects. A new string selects or creates a different row, and the old history drops out of the hub's chat list. The same old string, sent by someone else, selects the old row and its history.

### 1.4 Source: what Dify's logs show and search

- Docs `en/self-host/use-dify/monitor/logs.mdx`: "**End User or Account** shows a session ID for web app and API usage, or the team member's account for usage inside Dify." "To find a conversation, search words from its messages or the end user's session ID. To find a workflow run, search its inputs or outputs, or paste the run ID."
- Source, chat-family logs: `web/app/components/app/log/list-utils.ts` L307 `const endUser = log.from_end_user_session_id || log.from_account_name`. The console query `api/controllers/console/app/conversation.py` L245–271 matches the keyword with `ilike` against messages, the conversation name and `from_end_user_session_id`, which is a substring match.
- Source, workflow logs: `web/app/components/app/workflow-log/list.tsx` L187–191 shows `created_by_end_user.session_id`. `api/repositories/workflow_app_log_query_repository.py` L93–113: `keyword[:30]` is `ilike`-matched against `inputs`, `outputs` **and** the creator's `session_id`, which the docs do not mention. L122–131: the exact filter `created_by_end_user_session_id` (also on the Service API `GET /workflows/logs`, endpoint map line 69).
- So the user column shows exactly our string, and searching any substring of it finds that person's rows. A UUID works as well as an email. Only the first 30 characters of a workflow-log keyword are used, and 30 hex characters of a UUID are still effectively unique.

### 1.5 Renaming, merging, moving: none

- `grep` over `api/controllers` (service_api, console, web), `api/services` and `api/commands` at the tag finds no code that updates `end_users.session_id`, `external_user_id` or `name` after creation, and none that writes `from_end_user_id` on an existing conversation or message. The only such write in the services is `message_service.py` L254, which sets it on a newly created feedback row. `api/commands/*` never mentions `EndUser`.
- The only way to "move" history is SQL on Dify's own database (§7, option F).

### 1.6 Other notes

- Dify's own signed-in web app keys end users by the account **email**: `services/webapp_auth_service.py` L116–121 `"session_id": account.email`. The reference-projects research found this. Dify's first-party web app therefore has the same rename and reuse weakness. That is not a reason to copy it, because the API docs above advise "an account ID".
- `sys.user_id` in workflows and chatflows is the end user's `session_id` (`core/app/apps/workflow/app_generator.py` L664–667, `advanced_chat/app_generator.py` L701–704), so our string also appears in workflow run inputs.
- App inputs only reach Dify if the app declares them: `core/app/apps/base_app_generator.py` L139–141 builds `user_inputs` only `for var in variables`. "Hidden & Pre-Filled" input fields are a documented feature of the User Input node (`nodes/user-input.mdx` L110–119: "you supply the value, end users never see the field, and the workflow still receives it"; "Hidden fields are **not secret**").

## 2. Dify's Langfuse integration (1.17.1)

The provider now lives at `api/providers/trace/trace-langfuse/src/dify_trace_langfuse/langfuse_trace.py`, not `core/ops/langfuse_trace/`. It writes through Langfuse's ingestion API with `langfuse>=4.2.0,<5` (`pyproject.toml`; `langfuse_client.ingestion.batch`, L496).

- **Message traces** (chat, agent and completion apps), L298–335: `user_id = message_data.from_account_id`. When the message has `from_end_user_id`, Dify loads the `EndUser` and sets `user_id = end_user_data.session_id; metadata["user_id"] = user_id`. Also `session_id = message_data.conversation_id` and `tags = ["message", conversation_mode]`.
- **Workflow and chatflow traces**, L123–170: `user_id = trace_info.metadata.get("user_id")`. That value comes from `TraceQueueManager(app_id, user_id=user.session_id)` (`advanced_chat/app_generator.py` L200–201 and L297–299; `workflow/app_generator.py` L191–193), through `core/app/workflow/layers/persistence.py` L492–500, into `ops_trace_manager.py` L885–898 (`"user_id": user_id`). Also `session_id = conversation_id`, tags `["message","workflow"]` or `["workflow"]`, and `input = workflow_run_inputs`, which holds the declared inputs and `sys.*` keys (`sys.user_id` included).
- **Dify's docs agree** (`monitor/integrations/integrate-langfuse.mdx`, workflow table): "user_session_id → user_id". Message metadata lists "from_end_user_id - Sending user's ID".
- **Metadata** (`ops_trace_manager.py` L970–992 for messages, L885–905 for workflows): `conversation_id, from_end_user_id, from_account_id, app_id, tenant_id, user_id, status, ls_provider, ls_model_name, …`. `from_end_user_id` is Dify's **per-app** `end_users.id`. It differs in every app, so it is no use for filtering by person across apps.
- **Nothing the hub sends reaches metadata or tags through a documented field.** The only caller-supplied value is `trace_session_id` (`X-Trace-Session-Id`, 1–200 chars, `core/helper/trace_id_helper.py` L76–78), which lands as `metadata["trace_session_id"]` (`ops_trace_manager.py` L903–905, L990–992). It is undocumented (the docs schema skips it; a dify-docs code search finds no mention), and it means a _session_. The charter already declines to forward it (charter line 24).
- Declared app inputs reach Langfuse only in workflow and chatflow trace `input`. Message traces take `inputs = message_data.message` (`ops_trace_manager.py` L946), the prompt, not the inputs object.
- Side note: conversation-name generation traces use `user_id = trace_info.tenant_id` (L446–454), so the hub's Dify-generated conversation names show up in Langfuse under the workspace id, not the person.

**Answer to question 2:** Langfuse `userId` is our `user` string, never Dify's internal UUID. Langfuse `sessionId` is the conversation id. Tags are fixed by Dify. Metadata carries Dify ids plus `user_id` (our string again).

## 3. Langfuse

- Users (langfuse.com/docs/observability/features/users): "Just propagate the `userId` attribute across observations. This can be a username, email, or any other unique identifier." The Users view gives per-user token usage, cost, trace count and feedback, with a deep link `https://<hostname>/project/{projectId}/users/{userId}`. Traces filter by user with `user:<value>` in the v4 filter bar (a bare term "defaults to contains"; `user:=` matches exactly), or with `userId` in the public API.
- **No user entity.** A Langfuse maintainer wrote (github.com/orgs/langfuse/discussions/1154, open): "Currently `user_id` is purely a string field in Langfuse." The docs and the OpenAPI define no display name or user attributes. Discussion #7139 ("Add Setting User Name") was closed without a documented feature. Not confirmed as available.
- Metadata (features/metadata): "You can filter by metadata keys in the Langfuse UI and API". The v4 filter bar takes `metadata.<key>:<value>`. A bare word "searches across ids, names, input, and output", **not metadata**. Dashboards cannot group by a metadata field (open request, discussion #10833).
- Tags (features/tags): max 200 characters, filterable, "can't be added or edited in the UI after they're created". The docs keep tags apart from "user" and "session".
- Sessions: "group traces that are part of the same user interaction". Dify fills them with the conversation id.
- Privacy (langfuse.com/security/manage-personal-data): "add userIds to tracing data to facilitate efficient deletion". Data deletion (docs/administration/data-deletion): traces can be deleted "by `userId` for a data deletion request". Langfuse has no documented way to rename a `userId` on existing traces.
- Practical consequence. With `userId = <uuid>`, the owner looks up the uuid in the hub, then opens `/users/<uuid>` or types `user:<uuid>`. With `userId = <email>`, the owner types the email. With an email in metadata beside a uuid (not reachable through Dify, §2), `metadata.user_email:=…` would work for filtering but not in the Users view or the dashboards.
- Self-hosted Langfuse v3 receives security patches through January 2027, and `GET /api/public/traces` is deprecated on Cloud (OpenAPI note). Neither affects which identity to choose, since Dify writes through ingestion.

## 4. LDAP and Active Directory identifiers (input for B3)

| Attribute | Stable on rename | Stable on move | Reused after deletion | Readable | Source |
| --- | --- | --- | --- | --- | --- |
| `entryUUID` | yes: "An entry's UUID is immutable" | yes inside the directory | no: "unique in space and time" | no | RFC 4530 §2.4; OpenLDAP Admin Guide 2.6 §18.1.1.1 ("can function as a reliable identifier of the entry") |
| `objectGUID` | yes: "never changes, even if the object is renamed or moved" | yes within the forest | no | no (16 bytes; the string form needs MS-DTYP's little-endian swap of the first three groups) | learn.microsoft.com a-objectguid, using-objectguid-to-bind-to-an-object, object-names-and-identities |
| `objectSid` | yes | **no**: on a domain move "a new SID is created", the old one goes to `sIDHistory` | no | no | a-sidhistory, naming-properties |
| `sAMAccountName` | admin-changeable ("should not change") | unique per domain only | not stated | yes (≤ 20 chars) | a-samaccountname, naming-properties |
| `userPrincipalName` | admin- or owner-changeable; changes with a name or suffix change | no | yes (Entra: "can also be reused over time") | yes | a-userprincipalname; Entra howto-troubleshoot-upn-changes |
| `mail` | no | no | yes | yes (multi-valued, case-insensitive) | RFC 4524 §2.16; OIDC Core §5.7 |
| `uid` | not guaranteed | not guaranteed | not guaranteed | yes (multi-valued) | RFC 4519 §2.39 |
| DN | no | no | yes: "a new object may be identified by a DN that previously identified another … object" | yes | RFC 4530 §1 |

- OIDC Core 1.0 §5.7: "an Issuer MAY re-use an email Claim Value across different End-Users at different points in time, and the claimed email address for a given End-User MAY change over time. Therefore, other Claims such as email, phone_number, preferred_username, and name MUST NOT be used as unique identifiers for the End-User". `sub` is "locally unique and never reassigned".
- Microsoft Entra id-token reference: email "is mutable over time. Never use it for authorization or to save data for a user". "Your application mustn't use human-readable data to identify a user." Entra UPN-change guide: "We recommend developers use the user objectID as the immutable identifier, rather than UPN or email addresses", and "If the application uses JIT provisioning, it can create a new user profile". JIT provisioning is exactly B3's create-on-first-sign-in.
- Entra Connect sourceAnchor (plan-connect-design-concepts): "an attribute immutable during the lifetime of an object"; "Shouldn't be based on user's name because these can change"; "userPrincipalName, mail, and targetAddress aren't even possible to select". `ms-DS-ConsistencyGuid` is an anchor attribute kept separate from login names and back-filled from `objectGUID` when empty. That is the same shape as the `dify_user` column in §8.
- `entryUUID` is an operational attribute, so it must be requested by name (RFC 4511). next-auth's LDAP tutorial uses the typed DN as identity and puts the password in the JWT. It shows wiring only and is not a pattern to copy.

## 5. Reference projects

| Project (pinned) | Identity sent to Dify or Langfuse | Kind |
| --- | --- | --- |
| LibreChat `e1dfc104` | Langfuse `userId` = internal user id by default (`packages/api/src/langfuse/identity.ts:26 DEFAULT_USER_ID_FIELD = 'id'`); email or IdP id only as opt-in (`config.ts:3663-3677`); extra fields as `librechat.user.*` metadata; OpenAI `user: user?.id` | immutable id, email optional in metadata |
| Lobe Chat `60334f2b` | Langfuse `userId` = `users.id`, a text PK separate from the unique `email` (`packages/database/src/schemas/user.ts:11,13`); provider `user`/`safety_identifier` = the same id | immutable id |
| Open WebUI pipelines `039f9c54` | Langfuse `user_id` = email (`langfuse_filter_pipeline.py:159,169-174`); Open WebUI's UUID in metadata `user_id` (inferred across repos) | email, id in metadata |
| Dify web app 1.17.1 | signed-in web-app user: `session_id = account.email` | email (same weakness) |
| webapp-conversation `33085b66` | `user_${APP_ID}:<cookie uuid>` (`app/api/utils/common.ts:6-14`) | anonymous session id |

OpenAI's `safety_identifier`: "a string that uniquely identifies each user … We recommend hashing their username or email address, in order to avoid sending us any identifying information." A hash of the email is still not stable when the email changes.

## 6. Privacy (brief)

- GDPR Art. 4(5): pseudonymisation is processing so that data "can no longer be attributed to a specific data subject without the use of additional information, provided that such additional information is kept separately". Recital 26: pseudonymised data "should be considered to be information on an identifiable natural person". Recital 28: it "can reduce the risks". Recital 29 allows it "within the same controller" with the key kept separately. Art. 25(1) and Art. 32(1)(a) name pseudonymisation as a measure.
- With the email as `user`, every Dify `end_users` row, every Dify log row and every Langfuse trace carries a direct identifier. An erasure request (Art. 17, with Art. 19 for recipients) must then reach each system.
- With a hub id as `user`, the email to id map stays in the hub, which is pseudonymisation in Art. 4(5)'s sense. Deleting the hub row removes the link. Conversation content can still identify people, and the id stays personal data while the hub can map it. Langfuse's documented erasure handle (`userId`) works with either choice. Dify's logs docs warn: "Logs contain complete user conversations and may include sensitive information".
- Both systems are self-hosted here, so this is a by-design consideration (Art. 25), not a third-country transfer.

## 7. Options against the two goals

Goals: (G1) filter by person in Dify's logs and in Langfuse; (G2) no history lost on an email change, none inherited on email reuse.

|  | What Dify logs and Langfuse show | Email change | Delete, then reuse the email | B3 / LDAP | Migration of existing history | ADR-0006 and charter fit | Docs fit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A** keep email, guard edits and reuse | email (readable) | must be forbidden, or loses history (a case-only edit too, §1.2) | needs a never-reuse list of every former email (soft delete or tombstones) | directory mail changes and reuse happen outside the hub, so the guard cannot hold | none | unchanged; removes the email edit B2 ships (own row included) | against Dify docs §1.1, OIDC §5.7, Entra |
| **B** immutable `users.id` (UUID) | UUID; readable only through the hub | nothing happens | new account, new UUID, no inheritance | JIT row gets a new UUID; the directory link is `entryUUID`/`objectGUID`; renames are harmless | grandfather (§8), clean cut, or Dify SQL | new ADR supersedes ADR-0006's identity bullet (its "hash rejected" alternative was about readability); charter line 24 changes | matches Dify docs, OIDC, Entra, LibreChat, Lobe Chat |
| **C** readable immutable handle (username) | handle (readable) | nothing happens | needs a never-reuse list of handles | `sAMAccountName`/`uid`/UPN are changeable, so the handle would be a frozen copy that drifts and can collide | as B | new field, form and rules in B2, plus a new ADR | partly: readable names are what OIDC and Entra advise against as keys |
| **D** frozen email at creation (`dify_user` never updated) | email at creation; stale after a change | nothing happens | collides with the frozen value; needs tombstones and a fallback value, which becomes B or E | frozen `mail` at first sign-in drifts, and directory reuse collides | **none** (back-fill with the current email) | small; keeps readability at creation | still a human-readable key, with the stale value as its cost |
| **E** composite `<id>:<email at creation>` | readable and unique | nothing happens (the email part must be frozen, or this is A) | id part keeps it unique | as D for the readable half; the id half is safe | for existing accounts, only grandfathering avoids loss | new ADR; length cap needed: 36 + 1 + email ≤ 255 (Dify `String(255)`), so emails ≤ 218 | not a pattern any reference uses; PII in two systems |
| **F** move or re-label Dify history on change | whatever the key is | needs SQL on Dify's database: `UPDATE end_users SET session_id=…, external_user_id=… WHERE type='service-api' AND session_id=<old>` per app | does not address reuse | each directory change would need surgery | n/a | breaks the hub's Service API-only boundary (charter §2, ADR-0023) and needs Dify DB credentials | **no documented route** (§1.5); Langfuse traces keep the old `userId` regardless |
| **G1** readable email in Langfuse metadata or tags | uuid plus metadata | n/a | n/a | n/a | n/a | charter declines the tracing inputs | only via the undocumented `trace_session_id`, or by the hub writing to Langfuse itself; rejected |
| **G2** hidden "Hidden & Pre-Filled" input with the email | email in workflow/chatflow trace `input`, found by Langfuse's bare search and Dify's workflow-log keyword search | input follows the current email (display only) | n/a | n/a | n/a | needs a per-app convention and a hub feature that fills a reserved variable | documented Dify feature, but only workflow and chatflow apps, and per app |
| **G3** hub lookup: the users page shows each account's Dify id (copy), searchable; optional Langfuse deep link `/project/{projectId}/users/{id}` | the bridge for B | n/a | n/a | same | n/a | inside the hub's own admin surface (ADR-0024) | Langfuse documents the deep link |

On F: recommend against. It is undocumented database surgery on another product, it cannot fix Langfuse, and it does not address reuse.

## 8. Recommendation

**Adopt B, with a frozen column and a grandfathering back-fill, plus G3.** This meets G2 by construction. It meets G1 through the id plus the hub lookup: the owner pastes the id into Dify's search box (substring `ilike`, §1.4) or opens Langfuse's `/users/<id>`. Per-person Langfuse cost also stops splitting when an email changes. It is what Dify's own API docs advise.

### Before B2 merges (recommended; the owner decides)

B2 is the accounts sub-project and ships the email edit, so the identity rule belongs with it. The grandfathered set also stops growing once this lands. The change is one task:

1. Migration: `users.dify_user varchar(255)`. First nullable, then `UPDATE users SET dify_user = email` (grandfather), then `NOT NULL` with a unique index `users_dify_user_key`. Each database (local, e2e, production) runs it once through the entrypoint as usual.
2. DAL: every insert (`createUser`, `createOwner`, B3's JIT later) sets `dify_user` to the new row's `id`. No update path writes it. A test pins that `updateUser` never touches it, and since accounts are hard-deleted, a deleted account's value is never handed out again.
3. Session: add `dify_user` to the row read the `jwt` callback already does on every request (ADR-0024 decision a), and carry it on the actor. `lib/dify/route.ts:52` changes `user: actor.email` to `user: actor.difyUser`. It is the only place the Dify `user` is set; the 17 route files that send one read `resolved.ctx.user`.
4. Users page (G3): a "Dify user id" column with copy, matched by the table search.
5. Tests: `__tests__/dify-route.test.ts` (L17, L92), `dify-routes-chat.test.ts` (L38), `auth-options.test.ts`, the `data-users*` tests, and a schema/migration SQL test like `users-schema.test.ts`. The e2e stub keys by whatever string arrives (`e2e/fixtures/stub/store.ts` L59–60), so it needs no change.
6. Records: a new ADR-0026 "Use an immutable per-account id as the Dify end-user id", superseding ADR-0006's identity bullet only (login everywhere and the server-set `user` stay). A note on ADR-0024 withdraws decision a's "Bad" consequence. Also update charter line 24, `docs/auth-gate.md` and the CLAUDE.md ADR list.

**Migration of existing Dify history under this option:** nothing in Dify changes. Each existing account keeps sending exactly the string Dify already holds, its current email, so every conversation, file and run stays in its chat list, and Langfuse keeps one `userId` per existing person. From then on, an email edit only changes the display email, and an account created later with a former email gets a fresh UUID instead of the old history. What stays imperfect:

- Existing accounts show their frozen email in Dify and Langfuse even after a later email edit.
- History already orphaned by an earlier email edit stays orphaned. Only Dify SQL could reunite it.
- Logs mix emails (old accounts) and UUIDs (new ones).

**Clean-cut variant** (if the existing Dify history is test data, which the owner knows): back-fill `dify_user = id` instead, or drop the column and send `users.id`. All formats are then uniform and no email reaches Dify or Langfuse. The old conversations leave the hub's chat lists, though they remain in Dify's logs and Langfuse under the email.

Note: `fork/main` also sends the email (`~/repos/dify-app-hub-main/lib/session-user.ts` L8–18). If both lines point at the same Dify apps, grandfathered accounts keep sharing history across the two hubs. New overhaul accounts would not.

**Minimum if B2 merges unchanged:** no code is needed; ADR-0024 already records the consequence. Until the change lands, though, admins should not edit emails or reuse a deleted account's email. Do the change as the first PR after B2, before any production use and before B3 creates accounts.

### In B3

- Link an LDAP account to its hub row by the directory's immutable key: `entryUUID` (RFC 4530, requested by name) or `objectGUID` (AD; one documented string form with the byte-order swap). Store it with the directory it came from, in the spirit of OIDC's `iss`+`sub`. Never link by `mail`, UPN, `sAMAccountName` or the DN.
- A JIT-created account gets `dify_user = id` like any other. A directory mail change updates `users.email` for display only.
- Decide in B3's brainstorm what happens when a local account and an LDAP account share an email (link, refuse, or keep apart).
- Optional, owner's call: the Langfuse deep link in G3 (needs the Langfuse host and project id as settings), and G2 for workflow apps where a readable email in traces is worth the per-app convention.

## 9. Not confirmed

- Whether Langfuse now offers a user display name: discussion #7139 is marked resolved without a documented feature.
- Whether the v3 self-hosted sidebar's metadata filter supports "contains" (the API does).
- What Dify's enterprise SSO web-app token carries.
- That LibreChat's `id` is the Mongo ObjectId.
- Whether `slapadd` keeps `entryUUID` across an OpenLDAP rebuild.
- How much real history the owner's Dify holds under emails. This decides grandfathering versus a clean cut.

## 10. Sources (pinned)

- Dify 1.17.1 (`8387590a`), https://github.com/langgenius/dify/blob/1.17.1/api/…: `controllers/service_api/wraps.py`, `services/end_user_service.py`, `models/model.py`, `services/conversation_service.py`, `services/message_service.py`, `controllers/service_api/end_user/end_user.py`, `fields/end_user_fields.py`, `controllers/console/app/conversation.py`, `repositories/workflow_app_log_query_repository.py`, `core/ops/ops_trace_manager.py`, `core/helper/trace_id_helper.py`, `core/app/workflow/layers/persistence.py`, `core/app/apps/{workflow,advanced_chat}/app_generator.py`, `core/app/apps/base_app_generator.py`, `services/webapp_auth_service.py`, `providers/trace/trace-langfuse/src/dify_trace_langfuse/langfuse_trace.py` and `pyproject.toml`; `web/app/components/app/log/list-utils.ts`, `web/app/components/app/workflow-log/list.tsx`; `docker/.env.example`.
- dify-docs `main` `4c06be15`: `en/api-reference/guides/end-user-identity.mdx`, `en/self-host/use-dify/monitor/logs.mdx`, `en/self-host/use-dify/monitor/integrations/integrate-langfuse.mdx`, `en/self-host/use-dify/nodes/user-input.mdx`. Context7 `/langgenius/dify-docs`.
- Langfuse: langfuse.com/docs/observability/features/{users,metadata,tags,sessions,filter-search-bar,full-text-search,masking}, /docs/observability/data-model, /docs/administration/data-deletion, /security/manage-personal-data, OpenAPI `web/public/generated/api/openapi.yml`, discussions #1154, #7139, #10833. Context7 `/langfuse/langfuse-docs`.
- LDAP and AD: RFC 4530, 4511, 4519, 4524; OpenLDAP Admin Guide 2.6 §11.2 and §18.1.1.1; Microsoft Learn adschema `a-objectguid`, `a-objectsid`, `a-sidhistory`, `a-samaccountname`, `a-userprincipalname`, AD "Using objectGUID to bind", "Object Names and Identities", "User Naming Attributes", MS-DTYP 2.3.4.2; Entra `id-token-claims-reference`, `howto-troubleshoot-upn-changes`, `plan-connect-design-concepts`; OpenID Connect Core 1.0 §2 and §5.7; next-auth tutorial `ldap-auth-example`.
- References: LibreChat `e1dfc104`, Lobe Chat `60334f2b`, open-webui/pipelines `039f9c54`, open-webui `8bd8b4fa`, webapp-conversation `33085b66`; OpenAI safety best practices and the `safety_identifier` API reference.
- GDPR (gdpr-info.eu; eur-lex 2016/679): Art. 4(5), 17, 19, 25(1), 32(1)(a); Recitals 26, 28, 29. PostgreSQL docs "Collation Support".
- This repo: ADR-0006, ADR-0024 (decision a, "No email normalisation"), charter `docs/superpowers/specs/2026-10-07-backend-rework-charter.md` line 24, `docs/dify-service-api-1.17.1.md` (lines 19–22, 69, 90, 96, 136–143, 208, 229), `lib/dify/route.ts:52`, `db/schema/users.ts`.
