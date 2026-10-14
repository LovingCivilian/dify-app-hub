---
status: proposed
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

The agent answers 401 (bad or expired token), 404 (unknown agent), 415 (not JSON) and 422 (invalid body) before any stream; the hub answers them as 502 `agent_auth_failed`, `agent_not_found` and `agent_rejected_input`, any other refusal as 502 `upstream_error`, and a refused connection or no answer as 503 `provider_unreachable`. In-stream `RUN_ERROR` codes (`usage_limit`, `rate_limited`, `busy`, `model_unavailable`, `agent_error`) pass through with their message, which the owner's agent makes safe to show; a time limit is `CUSTOM run_cancelled { reason: 'run_timeout' }` then `RUN_FINISHED`, stored as cancelled.

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
