---
status: accepted
date: 2026-10-07
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (backend rework brainstorm and B1)
---

# Validate request bodies, action inputs and the environment with zod

## Context and Problem Statement

The backend rework needs per-operation allowlists for the Dify routes (unknown keys stripped, `400 invalid_param` naming the fields), validated Server Action inputs with field errors, and a parsed server environment. The repo had no validation library; the inherited handlers destructured request bodies and trusted them. [ADR-0015](0015-record-decisions-as-adrs-and-session-handoffs.md) asks for an ADR when a dependency is added.

## Decision Drivers

- Next's forms and authentication guides validate action input with zod, and its Server Actions guide names it for shape checks ("Schema validation (zod or similar)").
- One library for routes, actions and the environment; typed schemas (`z.infer`).
- A current major with a documented API ([ADR-0002](0002-use-documented-library-approaches-only.md)).

## Considered Options

- zod 4.
- Hand-written type guards (the inherited `isRecord`/`isAppInfo` style).
- valibot or another schema library.

## Decision Outcome

Chosen option: zod 4 (`import * as z from 'zod'`; `z.object` strips unknown keys, `z.strictObject` refuses them; `safeParse`; `z.flattenError` for field errors; `{ error }` messages; `z.url()`, `z.uuid()`, `z.coerce`, `z.discriminatedUnion`, `z.preprocess`). Schemas live in `lib/dify/schemas.ts` (routes), beside each `actions.ts` (actions: `app/(admin)/app-management/schemas.ts`) and in `lib/env.ts` (environment). Next's guide snippets show zod 3 syntax (`invalid_type_error`, `.flatten()`); this line follows the v4 API. The environment's `'true' | 'false'` flags (`SMTP_ENABLED`, `SMTP_USE_TLS`) go through `z.preprocess` (trimmed, lower-cased, a blank value read as absent, so `.default` applies): a stray `SMTP_ENABLED=` or `TRUE` no longer fails every request, while a required variable or a flag that is neither value still does.

### Consequences

- Good, because a route's or action's input is one readable schema, tested on its own, and the types follow from it.
- Bad, because zod runs in the browser bundle wherever a schema is imported by value from a client component. One place does so on purpose: the admin form's API Base rule (`components/admin/apps/api-base-rule.ts`) runs the action's own `appInputSchema.shape.apiBase`, so the browser and the server accept the same values (Docker service names such as `http://api:5001/v1`, which antd's `type: 'url'` refuses), and the app-management bundle carries zod. Everything else on the client imports only inferred types (`import type`).
- Neutral, because the frontend's own form validation stays antd `Form` rules (that one through an antd `validator`); zod validates on the server.

## Implementation Plan

- **Affected paths**: `package.json` (`zod` ^4), `lib/dify/schemas.ts`, `lib/env.ts`, `app/(admin)/app-management/schemas.ts`, `components/admin/apps/api-base-rule.ts`, their tests.
- **Patterns to follow**: `safeParse` and a result, never a thrown ZodError across a boundary; name the failing paths in the refusal; `z.object` for input (strip), `z.strictObject` only where unknown keys must be refused (none in B1).
- **Patterns to avoid**: zod 3 idioms (`invalid_type_error`, `.strict()`, `error.flatten()`); schemas imported by value into client components, except a field rule that must accept exactly what its action accepts.

### Verification

- [x] `__tests__/dify-schemas.test.ts`, `env.test.ts`, `app-management-schemas.test.ts`, `api-base-rule.test.ts` pass.
- [x] `pnpm why zod`: the app (and `drizzle-orm`, through its optional peer) resolve one copy, 4.6.5; a second copy, 4.4.3, sits only under the dev-only `eslint-plugin-react-hooks` (through `eslint-config-next`) and never reaches the app.

## Alternatives Considered

- Hand-written guards: rejected; they are what the inherited code had, untyped and untested at the edges.
- valibot: rejected; Next's guides and the surveyed projects use zod.

## More Information

Sources: zod 4 docs (Context7 `zod`, current major); Next 16.3 bundled docs `02-guides/forms.md`, `02-guides/authentication.md`, `02-guides/server-actions.md`; the reference survey `docs/superpowers/research/2026-10-07-backend-rework/reference-projects.md` (`nextjs/saas-starter` `validatedAction`). Related: [ADR-0023](0023-build-the-dify-layer-as-one-route-per-operation.md).
