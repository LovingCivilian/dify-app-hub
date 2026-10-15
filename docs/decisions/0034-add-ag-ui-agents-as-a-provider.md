---
status: accepted
date: 2026-10-14
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code sessions (Part 2 brainstorm, `part2-proxy-stop-identity.md`, Part 2 spec and 2a plan)
---

# Add AG-UI agents as a provider

## Context and Problem Statement

[ADR-0032](0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md) made apps provider-neutral, with Dify as the first provider and a checklist for the next. The owner's agents are a separate Python service (Pydantic AI over AG-UI) that never sees the browser or NextAuth, trusts only the hub's server, and verifies every request itself (running record decision 45; the owner gave its contract on 2026-10-14). AG-UI leaves authentication to the binding: "AG-UI defines no credential" (spec 1.0, transports), and it defines no health or discovery endpoint.

The questions: what an AG-UI app stores, how the hub proves who the user is to the agent, how Test connection checks an agent, and how far the provider set should be configurable by admins.

## Decision Drivers

- Documented approaches only ([ADR-0002](0002-use-documented-library-approaches-only.md)).
- ADR-0032's checklist and its rules: zod documents parsed on every write and read, write-only secrets, a provider fixed at creation, saving never calls the provider.
- The agent can verify identity and role itself; a secret that leaks from the network path must not let anyone act as any user (the owner: "anyone holding the static secret can claim to be any user, roles can't be passed in a way the agent can trust, and the secret never expires").
- Minimal disclosure: no email or name leaves the hub (AGENTS.md: the owner's email goes to no other service).
- Test connection must not start a model run.

## Considered Options

The agent's credentials:

- A per-request signed JWT (HS256, a per-app secret) as the only auth header
- A static bearer plus a plain user-id header (Open WebUI's and LibreChat's default)
- Forwarding the user's own token (CopilotKit's self-hosted examples; the hub has session cookies, not tokens an agent can verify)

Test connection:

- POST an invalid `RunAgentInput` (`{}`) and read the status
- A framework health route (`/health`, `/ping`, `/ok`, `/info`)
- A minimal real run

Admin-defined providers:

- The registry and standard protocols only (AG-UI now, OpenAI-compatible next); an exotic backend gets a small AG-UI shim beside it
- An admin-configured "HTTP template" provider in the app settings

## Decision Outcome

Chosen: the per-request JWT, the `{}` probe, and the registry with standard protocols.

### The documents

`settings`: `agentUrl` (an http(s) URL of at most 500 characters, the full endpoint the hub POSTs to) and `audience` (1–255 characters, the JWT `aud`). `secrets`: `jwtSecret`, 32–512 characters after trimming, used as its UTF-8 bytes. Write-only, as Dify's key: the admin DTO carries `secretsSet: { jwtSecret }`, and a blank field on Edit keeps the stored value. Later slices add `askUser` (2b) and the attachment settings (2c) with zod defaults, so a document written now still parses. The chat DTO carries none of these in 2a.

### The JWT

`jose`'s `SignJWT` (its HMAC example), minted fresh for every upstream request (each run and each Test connection): header `{ alg: 'HS256', typ: 'JWT' }`; `sub` the account's permanent id ([ADR-0026](0026-use-the-accounts-permanent-id-as-the-dify-end-user.md)), `iat` now, `exp` now + 60 s (the owner's agent allows 10 s of clock skew), `iss` `AGENT_JWT_ISSUER` (default `nextjs-bff`), `aud` the app's audience, `auth_source` `local` or `ldap`, `roles` `[role]`. No name, no email; the NextAuth token is never forwarded. It is the only auth header (`Authorization: Bearer <JWT>`), beside `Content-Type: application/json` and `Accept: text/event-stream`; no browser header is forwarded (CopilotKit's rule: server-set headers win). Open WebUI's `X-OpenWebUI-User-Jwt` and the IETF Transaction Tokens draft carry identity the same way: a short-lived signed token the receiver verifies.

### Errors before the stream

The agent answers 401 or 403 (a refused token), 404 (unknown agent), 415 (not JSON) and 422 (invalid body) before any stream; the hub answers them as 502 `agent_auth_failed`, `agent_not_found` and `agent_rejected_input`, any other refusal as 502 `upstream_error`, and a refused connection or no answer as 503 `provider_unreachable`. In-stream `RUN_ERROR` codes (`usage_limit`, `rate_limited`, `busy`, `model_unavailable`, `agent_error`) pass through with their message, which the owner's agent makes safe to show; a time limit is `CUSTOM run_cancelled { reason: 'run_timeout' }` then `RUN_FINISHED`, stored as cancelled.

### Test connection, the hub's own convention

`POST agentUrl` with body `{}` (valid JSON, an invalid `RunAgentInput`) and a fresh JWT whose `sub` is the admin running it, given up after 10 s (`AbortSignal.timeout`). 422 or 400: reachable (the token passed and the body was refused before any run); 401 or 403: key refused; 404: agent not found; 415 or another 4xx: upstream error; a refused connection, the timeout or a 5xx: unreachable; a 2xx event stream: the body is cancelled at once and the result is reachable with the warning "ran on invalid input". No error body is read. No AG-UI document describes a reachability check; this one follows the spec's rule that refused input gets "a plain HTTP error status with no stream" (`part2-proxy-stop-identity.md` §5). The body is `{}` and not broken JSON because FastAPI decodes JSON before its auth dependencies run, so broken JSON would answer 422 without checking the token.

### The rule of decision 52

The browser contract is AG-UI; backends plug in through the provider registry and standard protocols. An admin-configured "HTTP template" provider for text-only APIs is kept as an idea for later (running record, "Ideas kept for later"); admin-uploaded adapter code (Open WebUI's Pipe functions) is not adopted.

### Consequences

- Good: the agent verifies identity, source and role on every request; a token expires in a minute.
- Good: Test connection works for any spec-following agent without a model call.
- Bad: each app has a shared secret to rotate on both sides; it is plain text in `apps.secrets` until the encryption follow-up (decision 8).
- Bad: an agent that validates its body before its auth answers 422 to a bad token, so Test connection then proves reachability only (the caveat is in `docs/agui-agents.md`).

## Implementation Plan

- Affected paths: `lib/providers/agui/` (`schema.ts`, `jwt.ts`, `test-connection.ts`, `chat.ts`, `provider.ts`), `lib/providers/{ids,schemas,registry,connection,caller}.ts`, `lib/env.ts` (`AGENT_JWT_ISSUER`), `lib/auth/session.ts` (`SessionUser.source`), `components/provider-ui/agui/form-section.tsx`, the `agui_provider` migration (the CHECK), `docs/agui-agents.md`.
- Dependency: `jose` 6.2.12, exact (no dependencies of its own).

### Verification

- `__tests__/agui-jwt.test.ts` (claims checked with `jwtVerify` and a fixed clock), `__tests__/agui-test-connection.test.ts` (one case per row above), `__tests__/agui-chat.test.ts` (headers, body, each pre-stream status).
- `e2e/agui-admin.spec.ts`: an admin adds an AG-UI app with Test connection; `e2e/agui-chat.spec.ts`: the stub verifies the JWT as the owner's service does and answers 401 otherwise.

## More Information

- Spec §2; plan `docs/superpowers/plans/2026-10-14-part-2a-agui-core.md` (plan calls P1, P2, P4, P5).
- jose `SignJWT` and `jwtVerify` (https://github.com/panva/jose); PyJWT `jwt.decode` for the agent side (`docs/agui-agents.md`).
- Running record decisions 45 and 52; memory `agent-service-contract`.

### Note, 2026-10-14 (accepted on the owner's word; their check follows)

Part 2a passed every gate on `feat/agui-core` (`413a0fe6`): tsc, oxlint, oxfmt, the antd lint at 0, the i18next checks, `pnpm test` (2,178), `pnpm test:db` (91), `pnpm test:ldap` (51) and the e2e suite on three projects (662 passed, 0 failed). It also passed the Docker gate on the owner's local stack: one `Database migration complete`, RestartCount 0, the six migration rows, and no AG-UI client code in the browser bundle. The owner, working remotely and unable to test in a browser, asked to go on without their check: "let's proceed nonetheless … I will test it in the morning … accept the ADR, push the PR, open the issues" (2026-10-14). The record is accepted on that word. The owner's browser check on the local stack follows before the merge, and a problem it finds becomes a fix on the branch. Follow-ups: #66, #67, #68, #69.

### Note, 2026-10-15 (Part 2b, human in the loop)

Part 2b lets an agent stop and ask the user (spec §6; plan `docs/superpowers/plans/2026-10-14-part-2b-agui-hitl.md`, plan calls P1–P8, P14 and P17; running record decisions 46, 47, 50 and 62). The agent contract of this record is unchanged except `RunAgentInput.tools`, and `docs/agui-agents.md` describes all of it for agent authors ("Asking the user", "Interrupts", "State and activity").

**The hub's `ask_user` tool** (decision 46: the full-stack template's design, advertised by the hub). An AG-UI app's settings gain `askUser`, a boolean with the zod default `false`, so a document 2a wrote still parses; the admin form shows it as "Ask the user" in a Conversation settings section, and the chat DTO carries it (`AguiChatFields`), still without the URL, audience or secret. The chat adapter reads the switch now, on every run (`ChatAdapter.hubTools(settings)`, P1): while it is on, the run advertises `ask_user` in `RunAgentInput.tools`; off, it sends `tools: []` as 2a did. It is off by default because Pydantic AI fails every run of an agent that already has a tool of that name (`UserError`, `toolsets/combined.py`). The name and the arguments are the template's (`backend/app/agents/tools/ask_user_tool.py`, release 0.2.21): `{ questions: [{ question, options = [], allow_custom = true }] }`. The arguments are untrusted (AG-UI "Tool calls", Security: validated against the declared schema) and read with zod: 1–10 questions of 1–500 characters after trimming, at most 10 options of 1–200 characters after trimming, unknown keys dropped (P2); the tool's JSON Schema states the same limits. The answer is one `tool` message per call whose content is the template's `format_answers` transcript (`Q: …` and `A: …` per question, `(skipped)`, `(no answer)`), a string because 0.x agents accept only string content; the browser builds it and the server stores it as sent (at most 32,000 characters, a free answer at most 2,000; P3). Arguments that fail the schema show "The agent asked an invalid question" with Dismiss, and the server answers that call with a `tool` message whose `error` is `invalid_arguments`, whatever the browser sent. A pending call counts as open only while the app's switch is on now (decision 62's fourth answer, as CopilotKit, assistant-ui and the template decide it): a question still waiting when the switch goes off is answered `not_available` by the next run, and an answered call always renders. Several calls in one run are one card that steps through their questions in call order, each call answered by its own transcript (P4).

**The interrupt answers.** An approval is an interrupt with `reason: 'tool_call'` and a `toolCallId` (AG-UI concepts › Interrupts, "Tool-bound interrupts"); the gated call's card shows Approve and Reject, its arguments read-only. The payload follows the interrupt's own `responseSchema` (P5): the schema's first required boolean property, else its first boolean property, else the spec's `approved`, set to `true` or `false`; Reject adds `reason: 'Rejected by the user'` when the schema declares a string `reason`. That covers `approved` (Pydantic AI, Strands, Mastra) and `accepted` (Microsoft Agent Framework) alike (`part2-hitl-state-files.md` §1.3), and the server accepts only one of the two payloads the rule builds. A `confirmation` without a `responseSchema` shows Yes and No, which answer a bare `true` or `false` (P6; the reason taxonomy's "`responseSchema` optional; boolean default"), so a resume payload is an object or a boolean. Any other interrupt whose `responseSchema` is flat gets a form (P7, the owner's "Types and bounds", decision 62): properties of `type` string, number, integer or boolean, or an `enum` of strings or numbers, with `title`, `description`, `default`, `minLength`/`maxLength`, `minimum`/`maximum` and `required`; lengths count code points (JSON Schema Validation 2020-12 §6.3.1). Any other keyword, a nested object or array, or no schema on an interrupt that is not a confirmation leaves the message and Cancel only (P8). The browser and the server share these rules (`lib/chat/interrupt-answers.ts`, client-safe), and the server checks each resolved payload with them (`payloadAccepted`) before the run starts. The decisions wait in the browser until the last open item, an interrupt or a question, has one, and can be changed until then (decision 62's third answer; CopilotKit's `useInterrupt` waits the same way); they go as one run whose `resume[]` covers every interrupt of the continued run ("The resume list MUST cover every interrupt"). An interrupt past its `expiresAt` offers only Dismiss, which answers it `cancelled`; the browser judges expiry with `@ag-ui/client` 1.0.2's rule (`new Date(expiresAt) <= now`, copied client-safe, P14) and the server re-checks with `isInterruptExpired`. No form library is added (spec §6.3). The hub reads only the 1.0 interrupt outcome of `RUN_FINISHED`, so a LangGraph agent needs `emit_interrupt_outcome=True` (`part2-hitl-state-files.md` Implications B.3).

**The plan state and activity cards** (decision 47). A state that parses as `{ steps: [{ description, status }] }` with at least one step shows as a plan panel above the composer: "Plan 2/5" (completed steps), a progress bar and vertical `Steps`, with `pending` → wait, `in_progress` → process, `completed` → finish, `blocked` → error and any other status → wait (P17); it is the shape of AG-UI's Dojo `agentic_generative_ui` and Pydantic AI's example. State of any other shape is not shown to users, and users never edit state. An `activity` message renders read-only in its turn as a card titled with its `activityType`: an object whose values are strings, numbers, booleans or null as `Descriptions`, anything else as indented JSON in `CodeHighlighter`, cut at 10,240 characters with a note. Everything an agent sends renders as text, never HTML (spec §6.4).

Verification: `__tests__/chat-ask-user.test.ts`, `__tests__/chat-interrupt-answers.test.ts`, `__tests__/chat-plan-state.test.ts`, `__tests__/shared-chat-activity-view.test.ts`, `__tests__/chat-answers.test.ts`, `__tests__/agui-chat.test.ts` (the advertised tools), and `e2e/agui-hitl.spec.ts` on three projects against the stub's human-in-the-loop scenarios.

### Note, 2026-10-15 (the look)

The cards described above (the gated call's Approve and Reject, the interrupt card, "Plan 2/5", the activity card) take one look on the owner's review, AI Elements' `Tool` on an antd Collapse, with a bordered box only around the action or the choice made, and the sent answers stay in view after a reload: [ADR-0035](0035-show-the-shared-chats-tool-calls-and-requests-as-one-card-and-record-the-sent-answers.md). The plan panel reads "Plan" with a "1/3" badge that turns "Completed"; the rules for answers, payloads and expiry above are unchanged.
