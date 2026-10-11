# Provider hub: charter

Date: 2026-10-11 · Status: draft for the owner's review · Scope: the `fork/overhaul` line (ADR-0019). It turns "Dify App Hub" into "AI App Hub", a hub for all of the company's AI apps, whatever their provider.

The running record of the brainstorm, with every decision and the owner's words, is `docs/superpowers/research/2026-10-11-provider-hub/README.md`. Where this charter and that record disagree, the later dated entry wins.

## 1. Goal

The hub fronts Dify apps today, and its tables, routes, admin form and chat are shaped after Dify. The goal is a hub where Dify is one provider among several:

- Adding an app first asks for the provider (Dify, AG-UI, OpenAI-compatible APIs later). The form then shows a shared part and that provider's part.
- The backend is modular. A provider-neutral core holds the app record, access, the route guard, the registry and the shared chat. Each provider is a module that owns what is specific to it.
- Every provider's chat runs through one shared chat API that speaks AG-UI to the browser. The hub stores the message history of every provider.

## 2. Decisions already taken (do not re-open)

Each was taken by the owner on 2026-10-11. The numbers refer to the running record.

| Topic | Decision |
| --- | --- |
| Slicing (1, 12) | This charter plus four parts, each with its own spec, plan, branch and PR to `fork/overhaul`, run in order: **Part 0** PostgreSQL and the product rename, **Part 1** the neutral core, **Part 2** the shared chat on AG-UI plus the AG-UI provider, **Part 3** Dify moved onto the shared chat. Each part can be resumed from files alone. |
| Later providers (2) | OpenAI-compatible model APIs (LiteLLM, vLLM, Ollama, Azure OpenAI). Workflow builders and vendor agent services are out of view. |
| Names (3, 4) | Everything is renamed: the product is "AI App Hub" (`ai-app-hub` for the repo, package, Docker images, compose projects and local folders), and neutral code drops "dify". Dify-only code keeps the Dify name. |
| App metadata (5) | Name, description, tags and icon are admin-owned for every provider. The Dify sync is removed. |
| Spike (6) | The AG-UI spike opens Part 2 and answers the chat-UI questions before Part 2's spec. |
| AG-UI (7) | The provider follows the AG-UI 1.0 spec and the official `@ag-ui/client`/`@ag-ui/core`, and is universal: nothing specific to Pydantic AI or CopilotKit. Pydantic AI is only the first agent tested. The spike and the e2e stub cover at least one more framework or a spec-level stub. |
| Secrets (8) | Secrets are stored in plain text in Parts 0 to 3, kept apart from the other settings. Encryption comes later, together with SMTP and LDAP. |
| Shape (9) | A shared chat API and shared components for what providers have in common (most of it), plus per-provider extras. |
| History (10) | The hub stores the message history of every provider, Dify included. Whether a provider is sent that history is decided per provider. |
| Wire format (11) | AG-UI is the hub's chat protocol for every provider. Server adapters turn each provider's own API into AG-UI events, and the hub stores AG-UI-shaped messages. Provider extras travel as namespaced `CUSTOM` events and extra routes. The browser has one chat data layer on Ant Design X: a custom `AbstractChatProvider`. Rejected: the hub's own event format; native streams with a shared API only for the rest. |
| Database (13–16) | MySQL → PostgreSQL 18 first (Part 0), with a fresh start (no data kept), in the hub's own container, using `pg` through `drizzle-orm/node-postgres`. Parts 1 to 3 are written for PostgreSQL. |
| Settings storage (17) | A `provider` column plus `settings jsonb` and `secrets jsonb`, validated by the provider's zod schemas on every write and read. Rejected: a typed table per provider; a wide table. |
| Dify app type (18) | The Dify app type is an admin field, with a "Test connection" button that copies nothing. Saving never calls Dify. |
| Icons (19) | Image-only uploads through ADR-0030's pipeline, with a fallback icon per provider. Emoji icons go. |
| Annotations (21) | Dify annotations are removed entirely. Every provider has the same row actions. |
| UI components | The owner picks every new component and variant from a complete candidate list (memory `owner-picks-ui-components`). Part 1's list is `docs/superpowers/research/2026-10-11-provider-hub/ui-picks-part1.md`. |

## 3. Sources

All in `docs/superpowers/research/2026-10-11-provider-hub/`:

- `dify-coupling-map.md`: every place the code assumes Dify, classed as neutral core, Dify-only, or name only.
- `agui-and-reference-hubs.md` covers:
  - the AG-UI 1.0 protocol and `@ag-ui/client` 1.0.2;
  - Pydantic AI 2.55.0's adapter and its 0.x pin;
  - Ant Design X (no AG-UI support released);
  - other AG-UI clients;
  - how LibreChat, Open WebUI, LobeHub and Dify model their providers.
- `agui-reference-projects.md` covers:
  - `vstorm-co/full-stack-ai-agent-template` (UX reference);
  - `vstorm-co/agenticos` (a competing hub; a reference, not adopted);
  - the AG-UI Dojo's 26 features (the acceptance list for Part 2);
  - Pydantic AI's AG-UI examples (the spike's agent list).
- `doc-verification.md`: each Part 0 and Part 1 building block checked against its docs.

## 4. Architecture

### 4.1 Target shape

```
browser ── AG-UI over SSE ──▶ shared chat API (/api/apps/[appId]/…)        [Parts 2–3]
                                 │  guard: session → app → enabled → visible → provider
                                 │  hub store: conversations, AG-UI messages, state, interrupts
                                 ▼
                             provider adapter (registry)
                       ┌─────────┼──────────────┐
                    Dify      AG-UI agent    OpenAI-compatible (later)
              (Service API)  (HTTP + SSE)    (chat completions)
```

**The core** (provider-neutral):

- the `apps` record;
- access and grants (ADR-0027);
- the route guard;
- the error envelope (`lib/http`);
- the provider registry (server and client);
- the admin "add app" flow;
- the gallery and the chat page dispatch;
- the shared chat API and store (Parts 2–3);
- the shared chat components.

**A provider module** owns:

- its settings and secrets schemas, its defaults and its `testConnection()`;
- its server adapter, with the history policy (send the hub's history, or rely on the provider's own conversation);
- its custom events and their renderers;
- its extra routes (Dify: audio, files, the workflow view; whatever Part 3 keeps).

### 4.2 Data

- **`apps`** (Part 1):
  - neutral columns: name, description, tags, enabled, access mode, the icon as `bytea` plus its MIME type;
  - `provider` (a PostgreSQL enum);
  - `settings jsonb` and `secrets jsonb`, both NOT NULL;
  - the provider cannot change after creation.
- **The conversation and message store** (designed in Part 2, used by Dify in Part 3):
  - keyed by app and account;
  - messages in AG-UI's message shape, with explicit order;
  - the thread's state and its open interrupts or pending tool calls;
  - written as a run streams, so a stopped run keeps what arrived. The template's save-at-the-end is the pattern to avoid.

  Retention, deletion and who may read conversations are Part 2 questions.

- **The end user** is the account's permanent id for every provider (ADR-0026). How it reaches an AG-UI agent (a server-set header) is fixed in Part 2. AG-UI defines no convention for it, and `forwardedProps` is not an auth channel.

### 4.3 Security

The hub is the trusted server in front of every provider. This follows Microsoft's AG-UI security guidance and Pydantic AI's warning that its endpoint "is not an authentication boundary":

- Provider hosts and secrets never reach the browser.
- The hub builds each run's input on the server: the user's messages only, the hub-chosen tools, state and context.
- A client-supplied thread id is a continuation id, not a credential: the store is scoped to the account.
- Resume answers must cover every open interrupt, and the hub checks this as the AG-UI consumer.

### 4.4 Frontend

Ant Design X stays (ADR-0008, ADR-0017):

- The shared chat runs on `useXChat` with one custom `AbstractChatProvider` over AG-UI. Whether `useXChat`'s one-request-one-message model fits AG-UI runs is the spike's first question.
- X's experimental `AgentProvider` (unreleased `feature` branch) and issue #1722 ("planned" AG-UI support) are watched. If X ships documented AG-UI support, Part 2's spec weighs it over the custom provider (ADR-0002).
- Every new UI element is the owner's pick from a complete candidate list.

## 5. Delivery plan

| Part | Branch | Contents | Spec |
| --- | --- | --- | --- |
| 0 | `feat/postgres-and-rename` | PostgreSQL 18 with a fresh baseline; `pg`; the schema port and its re-derivations; compose services; the product rename (built-in brand, package, Docker names). The GitHub repo can be renamed from the web any time. The local folders, and Claude Code's memory directory with them, are renamed at the end of the programme, following the written steps in Part 0's §8 (owner, 2026-10-12). | `2026-10-11-part-0-postgres-and-rename-design.md` |
| 1 | `feat/provider-core` | The `apps` reshape; the registry; the "add app" flow with the provider picker; admin-owned metadata and the image icon; Test connection; the removal of the sync and annotations; the code renames; the gallery and the chat page dispatch. The Dify chat is unchanged. | `2026-10-11-part-1-provider-core-design.md` |
| 2 | `feat/agui-shared-chat` | It opens with the spike. Then the store, the shared chat API on AG-UI, the browser's AG-UI chat provider and shared components, and the AG-UI provider: settings, adapter, Test connection, renderers for the Dojo's features in scope. | after the spike |
| 3 | `feat/dify-on-shared-chat` | The Dify-to-AG-UI adapter: text, reasoning, agent thoughts as tool calls, workflow nodes as steps or activity, human input as interrupts, extras as `dify:*` custom events. Dify history in the hub store, and the old Dify chat removed. | after Part 2 |

Each part ends with the gates in `CLAUDE.md`:

- typegen and `tsc`, oxlint and oxfmt;
- `pnpm test`;
- the e2e suite on three projects;
- `pnpm test:ldap` where touched;
- the Docker gate.

## 6. Records

- **Part 0:** an ADR superseding ADR-0004 (PostgreSQL), and a dated note for the rename.
- **Part 1:** "Organise apps by provider: a shared core with provider modules", with notes on ADR-0023 (the record and the guard) and ADR-0026 (every provider's end user).
- **Part 2:**
  - AG-UI as the hub's chat protocol and the hub-side store. It supersedes ADR-0017's "one `DifyChatProvider`" once Part 3 lands, and gets a note in Part 2.
  - The AG-UI provider.
- **Part 3:** the Dify adapter, and the retirement of the Dify chat routes that the shared API replaces (a note on ADR-0023).
- **Every part:** `CLAUDE.md` and the running record are updated.

## 7. Risks and how they are handled

| Risk | Handling |
| --- | --- |
| Pydantic AI still speaks AG-UI 0.x (PR #8627 open); the 1.0 client translates 0.x with warnings. | The spike runs both against `@ag-ui/client` 1.0.x. The hub builds on 1.0 and records each gap; the server-side parser accepts both shapes if it has to (`agui-and-reference-hubs.md`, implication 6). |
| `useXChat` assumes one request produces one message, while an AG-UI run can produce several messages and interrupts. | This is the spike's first question, answered before Part 2's spec. |
| Part 3 rebuilds a working chat. | Dify parity is measured against today's e2e specs (27 Dify specs), which stay green through the switch. |
| The rename touches both worktrees, the shared GitHub repo and the memory path. | The GitHub repo is renamed whenever the owner likes. The folders are renamed at the end of the programme, between sessions, from written steps. `fork/main`'s content is untouched (ADR-0019). |
| The schema port's MySQL-specific spots (gap lock, errno, `affectedRows`, the slot claim). | They are listed and re-derived in Part 0's spec, each with a test. |
| Scope creep from the reference projects (agenticos's governance, the template's panels). | Part 2's scope is the Dojo features the owner picks. The rest stays in the record as ideas. |

## 8. Open questions for later parts

- **Part 2:**
  - the shape of the shared chat API (operations, stop, feedback, files) and of the store;
  - what "stop" does to an agent (the protocol has no stop request);
  - the header that carries the user's identity;
  - which Dojo features are in scope;
  - retention and privacy of stored conversations, and whether admins can read them (the "Logs" tab idea);
  - every new UI element, picked by the owner.
- **Part 3:**
  - what happens to conversations that exist only in Dify today: import them, read them through, or start fresh;
  - whether the workflow and completion views go onto AG-UI runs or stay Dify extras;
  - audio, file previews and suggestions as shared capabilities or Dify extras.

## 9. Definition of done for the programme

- An admin can add a Dify app and an AG-UI app through the same flow.
- Users chat with both through the shared chat on AG-UI, and the hub keeps every conversation.
- No neutral code carries Dify's name, and the product is "AI App Hub".
- The database is PostgreSQL.
- Every part has its ADRs, its passing gates and its entry in `CLAUDE.md`.
