---
status: accepted
date: 2026-10-08
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (B2 identity research, first PR after B2)
---

# Use the account's permanent id as the Dify end user

## Context and Problem Statement

Every Dify Service API call the hub makes carries a `user` string, set on the server ([ADR-0006](0006-require-login-everywhere-and-use-the-email-as-dify-end-user-id.md), [ADR-0023](0023-build-the-dify-layer-as-one-route-per-operation.md)). Since ADR-0006 that string was the signed-in account's email. Dify 1.17.1 turns the string into an end user per app on first use (`api/services/end_user_service.py`: the lookup is `tenant_id`, `app_id` and `session_id == user`, and a miss creates an `end_users` row with `session_id = external_user_id = user`) and binds every conversation, message, file and workflow run to that row (`services/conversation_service.py` lists and reads by `from_end_user_id`). Dify has no API that renames an end user, merges two or moves a conversation between them (no write to `end_users.session_id` or to an existing `from_end_user_id` in the Service API, console API, web API or CLI commands). Matching is byte-exact on PostgreSQL, Dify's Docker default (`docker/.env.example` `DB_TYPE=postgresql`; PostgreSQL compares strings by their bytes under a deterministic collation). Langfuse receives the same string as the trace `userId` (Dify's Langfuse provider sets `user_id = end_user.session_id` for message traces and passes the end user's `session_id` as the workflow traces' `user_id`).

The email is a poor key for that history:

- an admin can edit it (B2, [ADR-0024](0024-keep-the-apps-own-data-behind-a-data-access-layer-with-server-actions-and-gate-the-admin-surface-by-role.md) decision a: the session refreshes the email from the row on every request), and the next request then selects a new end user, so the person's conversations leave their chat list;
- a letter-case-only edit does the same, because the hub compares emails case-insensitively (`utf8mb4_0900_ai_ci`) while Dify matches bytes;
- accounts are hard-deleted, so a new account that takes a former email inherits that person's history;
- B3's LDAP directories change and reuse `mail` outside the hub.

Dify's own guide answers the question: "Dify never authenticates it, so pick a stable value per person, such as an account ID, and send it consistently." OpenID Connect Core §5.7 and Microsoft Entra say the same about email. The owner decided on 2026-10-08 to switch now, before production use and before B3 creates accounts, as a clean cut: the Dify apps hold only test conversations, so nothing is migrated. Which string should the hub send as the Dify `user`?

## Decision Drivers

- Filter by person in Dify's logs and in Langfuse.
- No history lost when an email changes, none inherited when an email is reused.
- Documented approaches only ([ADR-0002](0002-use-documented-library-approaches-only.md)): Dify's end-user guide; no surgery on Dify's database, which would break the hub's Service-API-only boundary (ADR-0023).
- Personal data: no direct identifier in Dify's `end_users` rows, Dify's logs or Langfuse traces where a pseudonym does the job (GDPR Art. 4(5)).
- One small change at the one place the `user` is set (`lib/dify/route.ts`).

## Considered Options

- Keep the email and guard edits and reuse.
- The account's permanent id, `users.id`.
- A frozen copy of the email, taken when the account is created.
- A composite handle, `<id>:<email at creation>`.
- Move or re-label the history in Dify's database when the email changes.

## Decision Outcome

Chosen option: the account's permanent id (owner's decision, 2026-10-08), as a clean cut, because it is what Dify's guide advises, it meets both goals by construction, and it needs no new column, no migration and no rule the hub cannot enforce (a directory's `mail` changes outside the hub).

- `resolveDifyRoute` (`lib/dify/route.ts`) sets `DifyRouteContext.user` to `actor.id`, the verified session's account id, instead of `actor.email`. It is the only place the Dify `user` is set: the 18 route files that send one take it from `resolved.ctx` (17 through `resolved.ctx.user`, `chat-messages/route.ts` by destructuring `{ dify, user }`), and the browser's `user` stays stripped by the schemas.
- `users.id` is a `varchar(36)` UUID v4 created at insert (`db/schema/users.ts` `$defaultFn(generateUuidV4)`; first run, `lib/data/setup.ts`, `crypto.randomUUID()`). No UPDATE in the code base writes it (`lib/data/users.ts` `updateUser` sets name, email, role and the password; the password changes set the hash and the session version), and a deleted account's id is never handed out again.
- The users page (`components/admin/users/user-management.tsx`) shows each account's id in a "Dify user ID" column (`admin_users.dify_user_id`) as an antd `Typography.Text` with `copyable` (the copied text is the full id, `copyable.text`) and `ellipsis` (its tooltip shows the full id), bounded to `16ch` by `user-management.module.css`; the copy tooltips come from i18next (`common.copy`, `common.copied`), since antd's Arabic pack calls "Copied" "نقل" ("moved"). The owner copies it into Dify's log search or Langfuse's user filter. The table search matches the id as well as the name and email (`matchesQuery`), so an id copied from Dify's logs or Langfuse finds the person even though the cell shows only its start. The trade-off: a short query of hex digits also matches ids, so it can bring up accounts whose name and email do not contain it (about 12 % of rows for two characters, under 1 % from three), and a lone `-` matches every row.
- Clean cut: no data migration and no grandfathering column. The research's recommendation (`docs/superpowers/research/2026-10-08-dify-user-identity.md` §8) was a frozen `dify_user` column back-filled with the current emails; its clean-cut variant, which the owner chose, sends `users.id` directly.

### Consequences

- Good, because an email edit, a letter-case edit, a deleted account's email taken again and, in B3, a directory `mail` change no longer move or leak anyone's Dify history; B2's decision a (the email follows the row) no longer affects Dify.
- Good, because Langfuse keeps one `userId` per person across apps and across email changes (Dify's own `from_end_user_id` differs per app), so per-person cost and usage do not split.
- Good, because no email reaches Dify or Langfuse: the email-to-id map stays in the hub, which is pseudonymisation in GDPR Art. 4(5)'s sense. The id stays personal data while the hub can map it (Recital 26), and conversation content can still identify people; Langfuse's documented erasure handle (`userId`) works with the id.
- Bad, because Dify's logs ("End User or Account" shows the session id) and Langfuse show an opaque id. The owner looks it up on the users page and copies it from there; Dify's conversation-log search matches a substring of the session id, its workflow-log keyword search the first 30 characters (still unique for a UUID), and Langfuse filters by `user:<id>` or opens `/project/{projectId}/users/{userId}`.
- Bad, because of the clean cut: test conversations created under emails are no longer listed in the hub. They stay in Dify's logs and Langfuse under the email.
- Neutral, because `sys.user_id` in Dify workflows and chatflows is the end user's `session_id`, now the id; no app uses it for identity today (owner, 2026-10-08).
- Neutral, because `fork/main` still sends the email (its own line, ADR-0019). If both hubs point at the same Dify apps, a person no longer shares history between them.

## Implementation Plan

- **Affected paths**: `lib/dify/route.ts` (the `user`), `lib/auth/session.ts` (the `SessionUser` comment), `components/admin/users/user-management.tsx` and `user-management.module.css`, `locales/{en,zh,ar}/translation.json` (`admin_users.dify_user_id`, `common.copy`, `common.copied`), `lib/dify/client.ts` (a comment), `docs/frontend-conventions.md` (the `ch` width exception), `__tests__/dify-route.test.ts` and `__tests__/dify-routes-{chat,files,run}.test.ts`, `e2e/admin-users.spec.ts`, `docs/auth-gate.md`, `CLAUDE.md`, the notes on ADR-0006 and ADR-0024.
- **Dependencies**: none.
- **Patterns to follow**: the Dify `user` comes only from `resolveDifyRoute` (`resolved.ctx.user`); every new account path (B3's create-on-first-sign-in included) inserts a fresh `users.id`; a directory account is linked to its hub row by the directory's immutable key, stored beside the row.
- **Patterns to avoid**: sending the email, the name or anything an admin or a directory can change as the Dify `user`; updating or reusing `users.id`; linking LDAP accounts by `mail`, `userPrincipalName`, `sAMAccountName` or the DN; editing Dify's database to move history.
- **Configuration**: none.
- **Migration steps**: none (clean cut). An installation that holds real history under emails would need the research's grandfathering column instead (§8 of the research record).

### Verification

- [x] `__tests__/dify-route.test.ts` expects `user` to be the account id (`u1`), not the email; the route suites (`dify-routes-chat`, `-files`, `-run`) expect every client call to carry the account id (17 tests failed against the email, then passed).
- [x] `git grep -n "actor.email\|\.email" -- lib/dify app/api` finds no path that sends the email to Dify (only the inherited forgot-password handler, which does not call Dify).
- [x] `e2e/admin-users.spec.ts` on the three projects: the owner's row shows the start of its id (read from MySQL), the ellipsis tooltip shows the whole id, and the row has a "Copy" button; searching for the owner's full id keeps the owner's row; the chat, workflow and other stub specs pass with the id as the stub's end user (2026-10-08, on the tree of `bed7eaac`: `admin-users`, `ssr-first-paint` and the 17 specs that use the stub, 401 passed, 14 skipped (device-only), 0 failed in 18.4 min).
- [ ] The owner's check against a real Dify and Langfuse: a new conversation's Dify log row and Langfuse trace show the account id from the users page.

## Pros and Cons of the Options

### Keep the email and guard edits and reuse

- Good, because Dify's logs and Langfuse stay readable.
- Bad, because the email edit B2 ships would have to go (the own row included), a never-reuse list of every former email would be needed, and neither guard can hold for B3, where the directory changes and reuses `mail`.
- Bad, because it goes against Dify's guide, OIDC Core §5.7 and Entra.

### The account's permanent id

- Good, because it is what Dify's guide advises and what two of the reference chat apps send: LibreChat's Langfuse `userId` defaults to its internal user id (`packages/api/src/langfuse/identity.ts`, `DEFAULT_USER_ID_FIELD = 'id'`), Lobe Chat's is `users.id`, a key separate from its unique email (`packages/database/src/schemas/user.ts`).
- Good, because it needs one changed line and no schema change.
- Bad, because the id is opaque in Dify and Langfuse; the users page is the lookup.

### A frozen copy of the email at creation

- Good, because it is readable at creation and could keep existing history (a back-fill with the current email).
- Bad, because it goes stale after an edit, and a reused email collides with the frozen value, which then needs tombstones and a fallback that becomes the id anyway; a frozen `mail` from a directory drifts the same way.

### A composite handle, `<id>:<email at creation>`

- Good, because it is readable and unique.
- Bad, because the email half must be frozen (or this is the first option), it puts the email in two more systems, it needs a length cap (Dify's `session_id` is `String(255)`), and no reference project uses it.

### Move or re-label the history in Dify's database

- Bad, because there is no documented route: no Dify API renames or moves an end user, so it is SQL on another product's database with its credentials, outside the Service-API-only boundary (ADR-0023); Langfuse keeps the old `userId` on existing traces regardless (it documents no rename), and it does nothing against reuse. Rejected.

## More Information

Follow-ups (the owner's future features):

- A link from the users page to each person's Langfuse user page (`https://<host>/project/{projectId}/users/{userId}`, the deep link Langfuse documents), which needs the Langfuse URL and project id as settings.
- Passing the person's email and username to Dify apps that declare such inputs: Dify only passes inputs an app declares (`core/app/apps/base_app_generator.py` builds `user_inputs` from the app's variables), and a User Input node's "Hidden & Pre-Filled" fields are documented for values the end user never sees (and are "not secret").
- For B3: link LDAP accounts by `entryUUID` (RFC 4530: "An entry's UUID is immutable") or Active Directory's `objectGUID` ("never changes, even if the object is renamed or moved"), never `mail`.

The users page: the id sits in its own narrow column rather than as a third line under the email. Measured on the `mobile-light` project (Pixel 7, 412 px wide, a 380 px table region that already scrolls sideways at 815 px), the full id under the email widened the User column from 180 to 314 px and the table by 134 px, and the line would carry no label; the column widened the table by 157 px, keeps its header as the label and its copy button inside the first view (its right edge at 335 px), and leaves the rows two lines tall. antd's `copyable` switches the ellipsis to JavaScript measuring, so the cell holds the cut text and the ellipsis tooltip the whole id.

The charter: this record supersedes the Identity row of the backend rework charter's §2 (`docs/superpowers/specs/2026-10-07-backend-rework-charter.md`, line 24: "The Dify `user` is the signed-in email, set on the server (ADR-0006)"). The charter is left unedited, because staging it would let the pre-commit formatter rewrite the whole file. The row's other half stands: the tracing fields (`X-Trace-Id`, `trace_session_id`) are still not forwarded, and the account id, not the email, now attributes conversations.

Research record: `docs/superpowers/research/2026-10-08-dify-user-identity.md` (options, the reference survey, the LDAP table, privacy).

Sources: dify-docs `main` `4c06be15`: `en/api-reference/guides/end-user-identity.mdx` (docs.dify.ai/en/api-reference/guides/end-user-identity), `en/self-host/use-dify/monitor/logs.mdx`, `en/self-host/use-dify/monitor/integrations/integrate-langfuse.mdx`, `en/self-host/use-dify/nodes/user-input.mdx`; Dify 1.17.1 (`8387590a`), `api/`: `services/end_user_service.py`, `models/model.py` (`EndUser`), `services/conversation_service.py`, `controllers/service_api/wraps.py`, `controllers/console/app/conversation.py`, `repositories/workflow_app_log_query_repository.py`, `core/app/apps/{workflow,advanced_chat}/app_generator.py`, `core/app/apps/base_app_generator.py`, `core/ops/ops_trace_manager.py`, `providers/trace/trace-langfuse/src/dify_trace_langfuse/langfuse_trace.py`, `docker/.env.example`; PostgreSQL "Collation Support"; Langfuse docs `observability/features/users`, `observability/features/filter-search-bar`, `administration/data-deletion`, `security/manage-personal-data`, discussion #1154 ("`user_id` is purely a string field"); OpenID Connect Core 1.0 §5.7; Microsoft Entra `id-token-claims-reference` and `howto-troubleshoot-upn-changes`; Microsoft Learn "Using objectGUID to bind to an object"; RFC 4530 §2.4; GDPR Art. 4(5) and Recital 26; LibreChat `e1dfc104`, Lobe Chat `60334f2b`; antd 6.6.5 Typography (`copyable`, `ellipsis`; `@ant-design/cli doc Typography`, demo "Ellipsis"); mysql2 "TypeScript Example with RowDataPacket" (the e2e's typed `SELECT`). Related: [ADR-0006](0006-require-login-everywhere-and-use-the-email-as-dify-end-user-id.md) (its Dify end-user bullet is superseded by this record; its login rules stand), [ADR-0023](0023-build-the-dify-layer-as-one-route-per-operation.md), [ADR-0024](0024-keep-the-apps-own-data-behind-a-data-access-layer-with-server-actions-and-gate-the-admin-surface-by-role.md) (decision a).
