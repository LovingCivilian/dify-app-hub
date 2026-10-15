# Build or adopt: the hub against a template or an existing product (2026-10-15)

While Part 2c's plan was written, the owner asked: "so far we've been building everything from scratch which is a huge undertaking and we're bound to create errors. and in the end we will have w worse product that whats already available. why don't we just take an existing template. like full stack ai template. and just do the simple modification thats important to us. like ldap login and having different apps. can you explore that for me?" Then: "dify is not a hard requirement for me. its was the initial idea but I've grown past it. im more interested in having agents code like pydantic ai and the others", and "keep the current 2c about dify. just the exploration shouldn't be limited by dify". Three research passes compared four candidates with the hub's requirements, Dify left out: several code-defined agents (Pydantic AI first, other frameworks too) served as separate apps with their own access, human in the loop, LDAP and directory groups, per-app grants, admin, branding, the Logs with an audit, en/zh/ar with right-to-left, Docker. Facts come first, each with its source; **(opinion)** marks the researchers' readings and the summary.

## Summary (opinion)

|  | Full-stack AI agent template 0.2.21 | AgenticOS | Open WebUI | LibreChat |
| --- | --- | --- | --- | --- |
| Code agents as separate services | No: one framework in its own backend per deployment | No: agents are configured in its builder ("an agent is data, not code") | Through a Python Pipe per agent | Only as an OpenAI-compatible model, the user's identity in unsigned headers |
| Approvals and the agent asking the user | Per framework (approvals with DeepAgents only, `ask_user` with Pydantic AI only) | Yes, for its own agents | Dialogs lost on reload; no plan or state | None for outside agents |
| LDAP and directory groups | Missing | LDAP, Kerberos, OIDC; no scheduled sync | Groups only from `memberOf`, at login, replacing other groups | No group sync |
| Arabic, right to left | Missing (en, pl) | Missing (en, pl, de) | Translated, layout not mirrored | Mirrored, 20 % translated |
| Branding | Yes | Yes | Licence forbids it above 50 users without an enterprise licence | Yes (MIT) |
| Admin reads conversations, audited | No | Activity, reads not audited | No audit | No |
| Estimate to the hub's features | 2.5–4 months | 2–4 months plus carrying a fork | 6–10 weeks plus a fork | 5–8 weeks, weakest on human in the loop |

None speaks AG-UI, the protocol the hub uses toward agents and that LangGraph, CrewAI, Pydantic AI, Agno, Google ADK, Mastra and LlamaIndex ship adapters for; each would need a bridge per agent that loses the interrupts, the questions and the state. The hub's remaining work toward the owner's aim was 2c (weeks), with Part 3 optional now that Dify is. What the products do far better (document search, MCP, code tools, voice, model catalogues, community scrutiny) suggests keeping the hub a narrow agent portal, putting such capabilities inside the agents (Pydantic AI and its harness, or the template's Pydantic AI pieces behind AG-UI), and running a general assistant such as LibreChat beside the hub on the same LDAP if users need one.

## The full-stack AI agent template — vstorm-co/full-stack-ai-agent-template as the hub's base

Read: the local clone `~/repos/dify-app-hub/tmp/refs/fsat` at `475f799` = release 0.2.21 (2026-10-06), plus `gh api` metadata on 2026-10-15. Below, `fsat/` is that clone and `T/` is `fsat/template/{{cookiecutter.project_slug}}/`. Nothing was generated or run. Statements marked **(opinion)** are mine. The weighting follows the owner's update of 2026-10-15: Dify is no longer a hard requirement. The heavy questions are code-defined agents from several frameworks served as separate apps, where those agents run, human in the loop, and how easily a new agent is added. The hub's earlier review of this template is `docs/superpowers/research/2026-10-11-provider-hub/agui-reference-projects.md` §1. It agrees with everything below.

### 1. What it is (facts)

- **A project generator, not a running product.** It is a cookiecutter template behind a Click CLI (`fastapi-fullstack create …`, PyPI package `fastapi-fullstack`). `fsat/AGENTS.md` ("CLI tool that generates…") and `fsat/template/cookiecutter.json` (~220 keys) back this up. Most files are Jinja (`{%- if cookiecutter.… %}`). You answer a wizard, get a repository, and own it from then on.
- **What it generates:**
  - Backend: FastAPI (`fastapi>=0.135.3,<0.137`, `T/backend/pyproject.toml`), SQLAlchemy 2 async or SQLModel, Alembic, and PostgreSQL (`postgres:16-alpine` in `T/docker-compose.prod.yml`).
  - Optional pieces: Valkey/Redis; Celery, Taskiq, ARQ or Prefect; Logfire, Sentry and Prometheus; RAG over Milvus, Qdrant, Chroma or pgvector; Stripe billing, teams and orgs; Slack and Telegram bots; a marketing site; an SQLAdmin `/admin`; Kubernetes; nginx or Traefik.
  - Frontend (optional): Next.js `^15.1.0` with `middleware.ts`, Tailwind 4, Radix primitives, Zustand, TanStack Query and next-intl `^3.25` (`T/frontend/package.json`).
  - Auth: JWT plus API key, optional Google OAuth, magic links, password reset by email (Resend or SMTP), or a "delegated" mode that trusts an external IdP's JWT (`fsat/template/VARIABLES.md` l.95–100).
- **Agent frameworks: one per generated project, run inside the backend.** The `AIFrameworkType` values are `pydantic_ai | langchain | langgraph | deepagents | pydantic_deep | none` (`fsat/fastapi_gen/config.py` l.76–84). There is no CrewAI, Agno, OpenAI Agents SDK, Google ADK or Mastra (no source match).
  - The agent is built in-process by one `get_agent()` (`T/backend/app/agents/assistant.py` l.551).
  - A per-framework `AgentSession` class drives it: five near-copies of 480–630 lines each in `T/backend/app/services/agent_session.py`, 2,951 lines, branched by Jinja at l.1/857/1346/1829/2456.
- **Streaming transport:** the template's own WebSocket at `/api/v1/ws/agent` (`T/backend/app/api/routes/v1/agent.py` l.64), with its own event names (`T/frontend/src/hooks/use-chat.ts` l.111–345).
  - The browser connects straight to FastAPI through `NEXT_PUBLIC_WS_URL` (`T/frontend/src/lib/constants.ts` l.71). REST calls go through Next route handlers that proxy to the backend (`T/frontend/src/lib/server-api.ts`).
  - **No AG-UI anywhere:** searches for `ag-ui|ag_ui|agui` in the clone find nothing. Issue #14 "AG-UI + Pydantic-AI" was closed as "completed" on 2025-12-27 with no body and no AG-UI code since.
- **Tests that ship in a generated project:**
  - Backend: 40 `test_*.py` files with 515 `def test_` across all options.
  - Frontend: 5 Vitest files and 3 Playwright specs, about 30 tests (`T/frontend/e2e/`).
- **Docker:** compose files for dev and prod with memory limits (app 512M, `docker-compose.prod.yml` l.216).
- **Taking upstream changes:** `fastapi-fullstack upgrade`, added in 0.2.17 (2026-07-25; `fsat/CHANGELOG.md` l.228).
  - It renders the template at the old and new versions from the answers saved in `.fastapi-fullstack.json`, then 3-way merges onto a `template-upgrade/v<ver>` branch and leaves conflict markers (`fsat/docs/guides/version-upgrade.md`).
  - `fsat/UPGRADES.yaml` lists the renames, breaking changes and manual steps of each release. Recent ones break things: in 0.2.19 the auth token helpers changed signature and three files were removed; in 0.2.20 Redis became Valkey, the floors moved to Pydantic AI 2.x and mcp 2.0, and a Redis RDB has to be moved by hand.
  - **(opinion)** The tool works when your edits are local. The hub would rewrite `agent_session.py`, `use-chat.ts`, auth, the user model, i18n and the layouts, and those are the files the template changes most. Every upgrade would be mostly conflicts, so in practice you own a fork.

### 2. The hub's requirements, one by one

Effort figures are **(opinion)**, at the agent-assisted pace the hub has had.

#### Weighted heavily: code-defined agents as apps

| Requirement | fsat | Effort and what changes |
| --- | --- | --- |
| **Several code-defined agents served as separate "apps", each with its own access, plus a gallery** | **Missing.** One agent per deployment, from one framework chosen at generation time. There is no app or agent model and no gallery. "Projects" are pydantic-deep sandbox workspaces (`T/backend/app/db/models/project.py`). "Deep research" is a per-message flag on the same agent (`agent_session.py` l.233). Sub-agents are delegations inside one agent. | **Weeks.** Needs an app/agent table, admin CRUD, a gallery, an agent id on the WebSocket route and on every REST route, and per-app checks on all of them. |
| **Agents from several frameworks (Pydantic AI first, then LangGraph, CrewAI, Agno, OpenAI Agents SDK…)** | **Missing.** The five `AgentSession` variants are mutually exclusive renders (same class name, Jinja `elif`). Mixing Pydantic AI and LangGraph means hand-merging two generated projects. CrewAI, Agno and the OpenAI Agents SDK have no session class. | **About 1 week per extra framework in-process.** Each needs a new session class (~500–600 lines) that maps the framework's stream onto the template's own event names, plus dependency-pin conflicts in one Python environment **(opinion: a real risk with langchain, crewai and agno in one lock)**. |
| **Where the agents live** | **In the template's backend.** The FastAPI process imports and runs the agent (`get_agent()`). Agents cannot be separate services: no proxy, no remote-agent client, no service-to-service JWT outward. Delegated auth is the _inbound_ direction: it trusts an HS256 or JWKS token from an IdP (`T/backend/app/core/config.py` ~l.155–180, `T/backend/app/api/deps.py` ~l.270–300). | **Separate services: 2–4 weeks.** Write an AG-UI (SSE) consumer and per-request JWT minting in FastAPI, then either translate AG-UI into the template's WebSocket events or replace `use-chat.ts` with `@ag-ui/client`. That is the hub's slice 2a again, on another stack. |
| **Human in the loop** | **UI yes, producers partial and tied to one framework each.** See the per-feature table below. | Over separate AG-UI agents none of the backend producers apply. You keep the cards and rewire them to AG-UI's interrupt outcome, frontend tools and `STATE_*` events: **2–3 weeks**. |
| **How easily a new agent is added** | Writing a new agent is a code change in the backend and a redeploy of the whole app. A new framework is a new session class (above). Every agent in the deployment shares one Python environment and one process. | Not configurable from an admin page. |

**Human in the loop, feature by feature** (all paths in `agent_session.py` unless named):

- **`ask_user`:** Pydantic AI only. It blocks an `asyncio.Future` on the open socket (l.419–433), so a reload loses the run.
- **Tool approvals:** DeepAgents (LangChain) only, through LangGraph `interrupt_on` (l.2283–2292).
  - There is no `requires_approval`, `DeferredToolRequests` or `ApprovalRequired` anywhere in the backend (0 matches), so Pydantic AI has no approvals.
  - The frames each variant handles (`_HANDLED_FRAME_TYPES`, l.75/902/1390/1883/2520) are `message` everywhere, plus `ask_user_response` (Pydantic AI) or `resume` (DeepAgents).
- **Plan checklist:** `pydantic-ai-todo`, Pydantic AI only (`fsat/template/VARIABLES.md` l.292).

**The same question for the hub (facts from its spec, `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` §2.1–2.3):**

- Agents are separate services. An admin adds an "AG-UI agent" app with `agentUrl`, `audience` and a write-only `jwtSecret`, then grants it.
- The hub signs a fresh HS256 JWT per request (`sub`, `iss`, `aud`, `auth_source`, `roles`, 60 s).
- Any framework with an AG-UI adapter fits without hub code. Per docs.ag-ui.com/integrations (fetched 2026-10-15), that list includes Pydantic AI, LangGraph, CrewAI, Agno, Google ADK, Mastra, LlamaIndex, AG2, AWS Strands, Microsoft Agent Framework and the Claude Agent SDK. The OpenAI Agents SDK is not on that list today; the hub's earlier research found it "in progress" (`agui-and-reference-hubs.md` l.126–145).
- **(opinion) Caveat:** only Pydantic AI has been exercised so far. Interrupt shapes differ per adapter (LangGraph also has a legacy `CUSTOM on_interrupt`, `agui-reference-projects.md` l.142), so each new framework likely needs a spike, an e2e scenario and maybe a small hub-side mapping: days each.

#### The other requirements (unchanged)

| Requirement | fsat | Effort and what changes |
| --- | --- | --- |
| Local accounts; roles owner/admin/user; deactivation; password reset by email | **Partly.** Roles are `admin`/`user` plus an `is_app_admin` flag (`T/backend/app/db/models/user.py`). Admins can suspend (`is_active` toggle, `T/frontend/src/components/admin/user-detail-drawer.tsx` l.186), delete and impersonate (`admin_users.py`). Reset by email exists with `--email` (`auth.py` l.208–243). Self-registration is on. There is no owner tier. | Hours to 1 day. |
| **LDAP sign-in (AD and OpenLDAP) and scheduled directory sync** | **Missing.** `T/SECURITY.md` l.89: "No SAML / OIDC beyond Google OAuth". There is no LDAP anywhere. | **1–2 weeks in Python** (for example `ldap3`): sign-in, account linking, a sync job on Celery beat or Taskiq, and a groups model. The hub's TypeScript `ldapts` code does not carry over. Its test directories and CA (`docker-compose.e2e.yml` profile `ldap`, `e2e/fixtures/ldap/tls/`) would. |
| Groups; per-app grants to groups and people | **Missing.** "Teams" are tenancy: organizations with OWNER/ADMIN/MEMBER/VIEWER and invitations (`VARIABLES.md` l.389). They are not access groups, and there are no apps to grant. | 3–5 days, after the app model exists. |
| Admin pages: apps, users, groups; branding; settings | **Partly.** Users, all conversations, ratings, system health and Stripe events (`T/frontend/src/app/[locale]/(dashboard)/admin/`). Branding is build-time env (`NEXT_PUBLIC_BRAND_COLOR`, `NEXT_PUBLIC_BRAND_LOGO_URL`, `T/frontend/src/components/brand-override.tsx`), and the favicon is code (`app/icon.tsx`). Settings come from env only (pydantic-settings). | About 1 week: apps, groups, runtime logo/favicon upload, a settings page. |
| Logs of every conversation per app, plus an access audit | **Partly.** The admin conversations list spans all users; there are no apps to scope it. `AppAdminAuditLog` records admin user update, delete and impersonate (`T/backend/app/core/audit.py`, `admin_users.py` l.60–124), but no page shows it. The documented `/admin/audit-log` page does not exist: `enable_admin_features_audit_log` only gates a paragraph of `T/SECURITY.md`. Who-read-which-conversation is not logged. | About 1 week. |
| i18n en/zh/ar with RTL | **Mostly missing.** Locales are `en` and `pl` (`T/frontend/src/i18n.ts`). Only 75 of 257 `.tsx` files use translations, and the chat hard-codes English (`chat-input.tsx` l.331 "Type a message...", `tool-approval-dialog.tsx` l.74). There is no RTL: 256 physical-direction Tailwind classes (`ml-`, `pr-`, `left-`, `text-right`…) against 0 logical ones. | 1–2 weeks: extract the strings, translate to zh and ar, convert to logical classes, add `dir` and Radix `DirectionProvider`. |
| Attachments (images, PDFs, text) | **Has.** Upload up to 10 MB: images, text, PDF, DOCX (`T/backend/app/services/file_storage.py` l.17–28). Images go to the model as `BinaryContent`; documents are parsed to text and pasted into the prompt (`agent_session.py` l.634–660). This is in-process only. | Rewire for remote agents. |
| Chat history: rename, delete | **Has** rename, archive and delete (`conversation-sidebar.tsx`), plus share links and ratings. The turn is persisted after the run ends; ordering on reload is reconstructed (hub research §1, `conversation-to-chat.ts`). | n/a |
| Docker, PostgreSQL, a 16 GB server beside Dify | **Has.** Compose, Postgres 16, memory limits, nginx or Traefik. | Hours: join Dify's network if Dify stays. |
| Dify apps (in passing) | Absent (the only grep hits for "dify" are "modify"). | Not a hard requirement any more. |

### 3. Quality and risk (facts)

- **Project metadata:**
  - MIT license; 1,951 stars, 390 forks; created 2025-12-19; vendor Vstorm (Poland).
  - Governance: "Benevolent Dictator" with a "bus factor of 2" (`fsat/GOVERNANCE.md`).
  - Contributors: DEENUU1 338 commits, pawelkiszczak 41, OchnikBartek 12, then bots and one-offs. Of the last 100 commits, 55 are DEENUU1's and 32 are bots'.
- **Cadence:** 40 releases in about 10 months (0.1.3 2025-12-21 → 0.2.21 2026-10-06). 30 commits since 2026-09-15 and 50 since 2026-07-15. Open items: 4 (3 PRs and the Renovate dashboard); 43 issues all-time.
- **Self-reported audit in 0.2.19** (`fsat/CHANGELOG.md` l.167–205): "53 of 88 CLI flags were never generated" by CI. Found and fixed there:
  - delegated auth left `/auth/register` open, so the first stranger became app-admin with SQLAdmin access;
  - the WebSocket checked tokens against the wrong authority;
  - rate limiting was "enforced on nothing";
  - password-reset and magic-link tokens were replayable for their whole TTL.
- **More defects:** 0.2.20 fixed a shared-conversation edit hole reported externally (#143). 0.2.21 fixed a migration chain that blocked `alembic upgrade` past 0025 for projects without MCP.
- **Credit where due:** the changelog is candid, the bugs were fixed fast, and CI now renders about 25 option combinations (`fsat/.github/workflows/ci.yml`). Only 6 of them build the frontend (lint, type-check, Vitest), and none runs Playwright.
- **The coverage badge:** the README shows a static `coverage-100%` image. Measured coverage is of the generator (`--cov=fastapi_gen`, ci.yml l.89; 628 generator tests), not of the generated app.
- **Scaffolding vs product:**
  - Generated code is up to about 43k lines of Python in `backend/app` and about 48k lines of TS/TSX in `frontend/src` (all options, Jinja included). The hub is about 32.7k product lines plus about 43k test lines.
  - Much of the template is SaaS scaffolding the hub would delete: billing, credits, marketing, blog, onboarding, Stripe events, orgs, Slack and Telegram.
  - The agent core is five copies kept in step by hand. The 0.2.19 changelog itself notes the copies were "happening to agree".
- **Stack distance from the hub:** Python/FastAPI with a separate Next 15 app, Tailwind and Radix, next-intl, SQLAlchemy and Alembic, Postgres 16. The hub is Next 16 only, with antd 6, Ant Design X 2.9, `@ag-ui/client` 1.0.2, Drizzle, Postgres 18 and ldapts. Adopting fsat reverses ADR-0008/0017/0021 (UI) and 0023/0024/0025/0031 (backend, data).

### 4. Estimate and recommendation (opinion)

**The template as the base.** You keep its auth, admin shell, Docker and chat UI (Tailwind). Then you add:

| Work | Effort |
| --- | --- |
| The app model, gallery and grants | ~2 weeks |
| LDAP and sync | 1–2 weeks |
| Remote agents over AG-UI with JWT, and rewiring the chat and its HITL cards to AG-UI | 3–5 weeks |
| Per-framework checks | days each |
| i18n zh/ar with RTL | 1–2 weeks |
| Branding, settings, Logs and the access log | ~2 weeks |
| Tests back up toward the hub's level | ongoing |
| **Total** | **roughly 2.5–4 months** |

The result would be a fork that can no longer take upgrades cleanly. Most of the template's distinctive value would be deleted or unused: in-process agents, RAG, billing and channels.

The alternative that keeps agents in-process (extend the template's own backend with a registry) is cheaper at first, about 1–1.5 months. It leaves every agent in one process and one dependency set, needs a hand-written bridge for each new framework, and runs against the owner's own contract of a separate agent service.

**Finishing the hub:**

- 2c (attachments and Logs) is one slice. 2a and 2b each went from plan to merge in about a day (spec §0 table).
- Part 3 (Dify onto the shared chat) can now be deferred or dropped, since Dify is optional.
- The new work the owner's update adds is per-framework validation: a spike and e2e scenario for LangGraph, CrewAI and Agno against the hub's AG-UI chat, days each.
- The honest gaps: the hub has exercised only Pydantic AI, and it lacks some of the template's polish (sub-agent feed and panel, sources and citations panel, chart cards, share links, ratings). Those are UI pieces the hub can keep borrowing as a UX reference, as it already does.
- **Overall:** weeks, not months.

**Recommendation:** do not rebase the hub on fsat. Its architecture runs one framework in-process per deployment. That is the opposite of "many code-defined agents from many frameworks, each its own app", which the hub's AG-UI boundary already gives by protocol.

The template is more useful on the _agent-service_ side. Its Pydantic AI pieces can be lifted into the owner's separate agent service and exposed through Pydantic AI's `AGUIAdapter`: tools, RAG, MCP client, memory via `pydantic-ai-harness`, and vstorm's `subagents_pydantic_ai` and `pydantic_ai_todo`.

If the owner wants an off-the-shelf hub rather than a generator, the like-for-like candidate is the same vendor's AgenticOS (Apache-2.0; OIDC/LDAP/Kerberos and directory mappings). Its agents also run in-process on Pydantic AI over its own WebSocket. The hub's earlier review (`agui-reference-projects.md` §2) judged it a reference, not a base; it is worth a fresh look only as a separate evaluation.

## AgenticOS — vstorm-co/agenticos as the hub's base

Read at clone commit `6f8d24c1` (2026-10-09, "cut 0.0.535") in `~/repos/dify-app-hub/tmp/refs/agenticos`; GitHub figures from `gh api repos/vstorm-co/agenticos` on 2026-10-15 (latest release v0.0.539). The paths below are relative to the clone. The requirements follow the owner's update: code-defined agents come first, and Dify is mentioned only in passing. Opinions are marked **(opinion)**; everything else is a fact with its source.

### 1. What it is

- **A running product, not a template.** It is "a sovereign, self-hosted layer for your company's AI agents" (README.md:42). `CLAUDE.md` says it "originated from the Full-Stack AI Agent Template", and the template-inherited parts have a separate coverage gate.
- **Its core idea runs against the owner's.** In `backend/app/agents/spec.py:3`, "An agent is data, not code." In README.md:85, "Code defines, configuration composes": engineers register _capabilities_ (Python tool packages), and business users put agents together in a browser Builder (instructions, model profile, capabilities, knowledge, budget), publish versions and export them as YAML.
- **Stack** (CLAUDE.md, README "For developers"):

| Layer | What it uses |
| --- | --- |
| Backend | Python 3.12, FastAPI, SQLAlchemy async, Alembic (105 migrations), Prefect 3 workers |
| Data | PostgreSQL 16 with pgvector, Valkey (Redis) |
| Agents | Pydantic AI and pydantic-ai-harness, in-process |
| Frontend | Next.js 16, React 19, Tailwind 4, Radix/shadcn, TanStack Query, zustand, next-intl, bun |
| Other | `sandboxd` code sandboxes; MkDocs documentation in 4 languages |

- **How agents run.** All agents run in-process. `backend/app/agents/factory.py` builds a `pydantic_ai.Agent` from the stored spec ("the single place where configuration becomes an executable agent"). `backend/app/services/agent_runner.py` (4,749 lines) runs it, and `backend/app/services/run_stream.py` iterates Pydantic AI's graph events into the project's own WebSocket frames.
  - It does **not** use AG-UI. The `pydantic-ai-slim` extras in `backend/pyproject.toml:59` include no `ag-ui`, and the code has no AG-UI client or server.
  - It has **no external-agent runtime**. The only plan is open issue #2092 (milestone "W12 · Oct 19–23", label effort:xl): Claude Code and Codex over ACP as a "coding agent" runtime, and A2A agents as **delegation targets**, which a local LLM agent hands work to. It does not plan a chat that goes straight to an external agent.
- **Surfaces:** web chat, website widget, hosted page, HTTP API (`POST /api/v1/agents/{id}/run`), WebSocket, Slack, Mattermost and Telegram (README).
- **RBAC** (`docs/permissions.md`), in three layers:
  - `users.is_app_admin` is the deployment's superadmin.
  - Each organization membership carries one of six roles (owner, admin, builder, operator, member, viewer) that resolve to 27 permissions in code.
  - Per-resource visibility plus grants to people and groups.
  - It is **multi-tenant**: every resource belongs to an organization, and "Every account is given a personal organization at sign-up" (docs/deployment.md:280).
- **Deployment:** Docker Compose on one host (README.md:312 says there are no Kubernetes manifests). The services are `migrate`, `app`, `db` (pgvector pg16), `redis` (Valkey), `prefect-server`, `prefect-runner` and `sandboxd`, plus the `frontend` compose file. Images come from `ghcr.io/vstorm-co/agenticos-*`.
- **Taking upstream updates:**
  - An unmodified install pulls images by `AGENTICOS_VERSION`, and `scripts/deploy.sh <sha>` deploys one commit (docs/deploy.md:338ff).
  - Customizing means changing the source tree: capabilities go under `backend/app/agents/capabilities/<name>/`, a layout enforced by `tests/test_capability_layout.py` (docs/howto/add-capability.md). There is no out-of-tree plugin mechanism.
  - Versions are `0.0.x` and promise no stability.

### 2. The hub's requirements, one by one

| Requirement | agenticos | Effort to close (opinion) |
| --- | --- | --- |
| Local accounts, roles owner/admin/user | **Has.** owner/admin/member map onto the hub's roles; builder, operator and viewer are extra. | Hours, to hide the extra roles |
| Account deactivation | **Has.** `users.is_active` (`backend/app/db/models/user.py:55`); "deactivate the account under Admin → Users" (docs/directory.md:306ff) | – |
| Password reset by email | **Has.** `POST /auth/password-reset/request` and `/confirm` (`backend/app/api/routes/v1/auth.py:249-287`), SMTP | – |
| Admin creates an account | **Missing by design.** "there is no administrator-creates-an-account path" (docs/deployment.md:152); only invitations | Days |
| Personal organizations | Every user gets one, and can build agents there | Days, to turn off and hide |
| LDAP sign-in (AD and OpenLDAP) | **Has.** ldap3 two-step bind, LDAPS/StartTLS, the `objectGUID`/`entryUUID` id, nested AD groups, plus Kerberos (SPNEGO) and OIDC with a groups claim (docs/directory.md). Configured by env, as in the hub. | – |
| Scheduled directory sync | **Missing.** Mappings apply only at each sign-in: "There is no SCIM and no scheduled directory sync" (docs/directory.md:309). No SAML (:314). Directory groups map onto local groups and roles, typed in by DN. | 3–5 days: a Prefect flow that lists group members, reconciles and deactivates, under the 100% coverage gate |
| Groups; per-app grants to groups and people | **Has.** Groups, `resource_grants` with levels, visibility private/shared/org, and a Sharing panel (docs/directory.md "Groups", docs/permissions.md layer 3) | – |
| An app catalog (name, icon, description, tags, enabled) | **Has.** The `agents` table has name, description, `avatar_url`/`avatar_color`, `categories`, `tags` and `status` draft/published/archived (`backend/app/db/models/agent.py:78-110`) | – |
| **Code-defined Pydantic AI agents as apps** | **Partly, and only in its own mould.** You don't bring your own `Agent`. Custom code becomes a capability package in their backend, and the agent is then put together as a spec in the UI. No custom output types, deps or graph of your own; the platform's runner, budget and approval layer wrap everything. | Hours to days per agent _if_ it fits capability + instructions; a rewrite otherwise |
| **Agents in other frameworks** (LangGraph, CrewAI, Agno, OpenAI Agents SDK, …) | **Missing.** Only Pydantic AI, in-process. #2092 would add A2A _delegation_ (a local LLM agent in front, which costs a second model call and adds no tool-call or HITL streaming of the remote agent). | An AG-UI runtime kind: **4–8 weeks**. It touches the spec and publish validation, `agent_runner.py`, `run_stream.py`, message persistence, approvals and `ask_user` (both built on Pydantic AI deferred tools, `backend/app/agents/approval.py` and `ask_user.py`) and budget metering. After that, the per-request HS256 JWT is hours. |
| Agents as separate services | **Missing** (see above) | As above |
| Human in the loop | **Has, for its own agents.** Approval per capability and per tool, which parks the run (`tool-approval-dialog.tsx`, docs/governance.md "Approvals"), plus `ask_user`, stop, and alerts by email and in the app. MCP tools are not gated per tool (docs/about/dify.md). | HITL from an external agent needs mapping into these. It is part of the 4–8 weeks above. |
| Adding a new agent | **No code** if existing capabilities or MCP servers suffice: a few minutes in the Builder. **With code:** a 4-file capability package, registration, a README and tests at 100% coverage, then an image rebuild. | – |
| Chat: streaming, reasoning, tool cards, plan | **Has.** `thinking` capability, `tool-call-card.tsx`, `plan-strip.tsx` / `plan-checklist.tsx` (`frontend/src/components/chat/`) | – |
| Chat: history | **Has.** Rename (`PATCH`) and delete (`conversations.py:156,173`), plus favourites, search and sharing | – |
| Chat: attachments | **Has.** Images, PDF, DOCX, text and ODF (docs/architecture.md:788-830) | – |
| Admin: users, groups, settings | **Has.** Admin users, members, groups, directory mappings, deployment settings, announcements, ratings and stats, with far more besides (vault, budgets, models, MCP, RAG, triggers) | Days, to _hide_ what the hub doesn't want |
| Admin: branding | **Has.** Name, tagline, wordmark and favicon, unauthenticated (`backend/app/api/routes/v1/branding.py`; docs/deployment.md "Identity") | – |
| Logs per app | **Partly.** Activity lists runs per agent (`GET /runs?agent_id=`) with each run's transcript to holders of `runs:view` (docs/governance.md:436-480), and CSV exports are audited. | – |
| Access audit | **Partly.** A hash-chained audit log of access and admin changes, verified by `agenticos cmd audit-verify` (docs/governance.md:1343ff). Opening one transcript is **not** audited, and sign-ins aren't either: the recorded actions are listed by `grep 'action="'` in `backend/app`. | 2–4 days |
| i18n: en, zh, ar | **Partly.** Locales `["en","pl","de"]` (`frontend/src/lib/locales.ts:9`); no zh or ar. The catalog has 4,867 keys (`frontend/messages/en.json`). Emails and backend sentences are English only. | Machine translation plus review of about 9,700 strings: about 1 week |
| RTL layout | **Missing.** No `dir` handling; about 360 physical Tailwind direction classes against 4 logical ones in `frontend/src` | 1–2 weeks: Radix `DirectionProvider`, logical classes, charts, e2e |
| Dify apps (in passing) | **None.** It positions itself as an alternative to Dify (docs/about/dify.md) | A second external runtime: weeks |
| Docker, PostgreSQL, a 16 GB server beside Dify | **Partly.** Docker Compose on one host, but **PostgreSQL 16** (the hub uses 18) plus Valkey, Prefect, sandboxd and a separate frontend. Measured: about 3.1 GB at rest and about 8.3 GB in container limits (docs/deploy.md:42-60), plus 2 GB for each running sandbox. The hub today is one container plus PostgreSQL. | Fits beside Dify on 16 GB, but tight **(opinion)** |

### 3. Quality and risk

- **Size** (counted with `find`/`wc` at the clone commit):
  - Backend: 600 Python files with 151k lines, and tests of 526 files with 203k lines and about 9,950 test functions.
  - Frontend: 865 source files with 118k lines, about 104k lines of tests with about 6,400 Vitest cases, and 22 Playwright specs with about 96 tests.
  - The hub, for comparison: about 33k lines of source and 43k lines of tests. agenticos is about **8x** bigger.
- **Testing discipline is high.**
  - A 100% coverage gate on the platform layer (`backend/pyproject.toml`, `tests/test_coverage_gate.py`).
  - CI (`.github/workflows/ci.yml`), CodeQL and an AI review workflow.
  - `make check` runs ruff, ty, vulture, deptry, eslint, tsc, codespell and an i18n guard.
  - The documentation is thorough and lists the product's own limits (README.md:306-314).
- **Maintainers:**
  - 10 contributors. One person has 950 of the 1,185 commits on `main` (about 80%), the next has 177, and the rest have 15 or fewer (`gh api .../contributors`).
  - Company-backed by Vstorm, a consultancy: "Maintenance and support are agreed per engagement" (README.md:400).
  - 104 stars and 19 forks.
- **Pace:**
  - The repository was created on 2026-07-31, about 11 weeks ago.
  - **539 releases** so far, often several a day (four on 2026-10-15). 213 commits since 2026-09-15.
  - 876 issues, 153 of them open; 1,147 merged PRs.
  - The `CHANGELOG.md` is 787 KB.
  - The spec is at `SPEC_VERSION = 12`, and migrations were squashed once (CLAUDE.md).
  - It is very much in motion; versions are `0.0.x`.
- **License: Apache-2.0, with one catch.**
  - `LICENSE` is Apache 2.0 and `NOTICE` says "Copyright 2026 Vstorm". The name and logo are not covered (README.md:348).
  - **The backend image ships PyMuPDF under AGPL-3.0-only.** The project's own `docs/licenses.md:138-162` and `licenses/policy.toml` `[review.python."pymupdf"]` say "the backend image as a whole is conveyed under AGPL-3.0 terms". A deployment that _modifies the platform and serves it over a network_ must offer its users the modified source.
  - The documented exits are: buy Artifex's commercial licence, remove PyMuPDF in a private build (it is imported in about 10 backend files, and LiteParse is the Apache alternative), or offer the source to your own users.
  - The other copyleft dependencies are weak and accepted: ldap3 (LGPL-3.0), psycopg2-binary (LGPL), odfpy (LGPL), and the optional MinIO profile (AGPL, a separate service).
  - So it is open source, not source-available, and has no commercial terms. **For a modified internal deployment, the AGPL obligation is real, but small if PyMuPDF is dropped.**
- **What would be ours to maintain (opinion):**
  - The changes the owner needs (an external-agent runtime, RTL and Arabic, a scheduled sync, hiding tenancy and the Builder) go through the most load-bearing files (`spec.py`, `agent_runner.py`, `run_stream.py`). Upstream rewrites those files weekly.
  - Merging upstream would conflict constantly, so in practice we would freeze a version and own about 270k lines of source in a stack different from the hub's: Python/FastAPI/SQLAlchemy/Prefect plus Tailwind/Radix, against Next.js full-stack, Drizzle and antd 6 / Ant Design X.
  - All the hub's ADRs and conventions would be dropped, and we would adopt theirs (100% coverage gate, documentation in 4 languages).

### 4. Estimate (opinion)

**From agenticos to the hub's current feature set** (one developer with Claude, new to the codebase):

| Work | Estimate |
| --- | --- |
| External AG-UI runtime with the JWT and HITL mapping (the core requirement) | 4–8 weeks |
| Scheduled directory sync | about 1 week |
| Turning off personal organizations, the Builder, budgets and the extra roles for users | 1–2 weeks |
| zh and ar with RTL | 2–3 weeks |
| Per-transcript access audit, and admin-created accounts | about 1 week |
| **Total** | **about 2–4 months** |

The fork tax comes on top and never ends. The core runtime would also be one that #2092 may later reshape in a different direction (A2A delegation, ACP).

**Finishing the hub:**

- The hub already has the exact shape the owner now asks for: code-defined agents as separate services, each an admin-managed app with LDAP-group grants, reached over AG-UI with a per-request JWT, with the shared HITL chat on top.
- AG-UI's own README (ag-ui-protocol/ag-ui, read on 2026-10-15) lists LangGraph, CrewAI, Pydantic AI, Agno, Google ADK, Mastra, LlamaIndex, AG2, AWS Strands, Microsoft Agent Framework and the Claude Agent SDK as supported. It lists the OpenAI Agents SDK as "In Progress".
- Adding an agent means deploying its service and adding an app row. No hub code changes.
- What remains is 2c (attachments and Logs), which is weeks, not months. Part 3 (moving the Dify chat onto the shared chat) is now optional, because Dify is no longer a requirement.

**Honest both ways:**

- agenticos is more mature and far broader than anything the hub will become: RAG with sync connectors, about 99 curated MCP servers, sandboxes, budgets, approval policies, triggers, artifacts, Slack, Mattermost and Telegram, OIDC and Kerberos, a hash-chained audit log, and about 16k tests.
- If the owner wanted a no-code agent _builder_ for business users, adopting it would beat building one.
- The owner's need is the opposite: "my agents in code, many frameworks, served as apps". agenticos's founding rule ("an agent is data, not code") is the mismatch, and the bridge exists only as an open proposal.
- The cheap wins are to borrow its ideas, not its code:
  - its directory-sync rules (`backend/app/services/directory/sync.py`, docs/directory.md)
  - the hash-chained audit with a checkpoint
  - a run's transcript in Activity
  - its licence inventory
- If it ever gains an AG-UI endpoint, the hub could also front agenticos agents as another app kind. Today only its HTTP API (`/api/v1/agents/{id}/run`) and WebSocket would serve that.

## Open WebUI and LibreChat — Open WebUI or LibreChat as the hub's base instead of finishing the hub (2026-10-15)

The question: would it be better to take an off-the-shelf chat hub and add LDAP and "apps" to it? This file covers that question for **Open WebUI** and **LibreChat**. A separate file covers templates. **Requirements, revised by the owner mid-task:** Dify is no longer required and is mentioned only in passing. What counts most now is several code-defined agents: Pydantic AI first, then LangGraph, CrewAI, Agno, the OpenAI Agents SDK and others. Each runs as its own service, is served to users as its own "app" with its own access rules, and has human in the loop. How easily a new agent can be added also counts. These requirements still stand: LDAP and directory groups, per-app grants, admins reading conversations with an audit, branding, en/zh/ar with RTL, and Docker.

**Pinned sources:** `open-webui/open-webui` main @`6a18585ff4c2` (2026-10-14), docs `open-webui/docs` @`03d9698064`. `LibreChat-AI/LibreChat` main @`e1dfc10449ff` (2026-10-06), docs `LibreChat-AI/docs` @`d825c67897`. `pydantic/pydantic-ai` @`3685d7e344`. I read them with `gh api`, raw files and crawl4ai, and cloned nothing. Context7's monthly quota ran out after four queries, so the rest came from the docs repos themselves. **Already researched, not repeated here:** admin chat reading, audit and retention (`docs/superpowers/research/2026-10-11-provider-hub/part2-store-and-logs.md` §4–5); paging and audit internals (`scratchpad/research/refs-dify-owui-librechat.md`); attachments (`scratchpad/research/r1-attachments.md`); provider modelling (`agui-and-reference-hubs.md` §5).

### 0. Bottom line

**Facts:**

- Neither product speaks AG-UI or A2A. I found no AG-UI or A2A code in either tree (path search, plus code search for `ag-ui` and `a2a`). LibreChat's A2A client PR #9859 was closed without being merged.
- Both reach an external agent only as an **OpenAI-compatible model**. Open WebUI can also reach one through a **Python Pipe function** that it runs in its own process.
- Both have human in the loop (tool approvals, the agent asking the user) only for **tool loops they run themselves**, not inside an external agent.
- Open WebUI's licence forbids changing its branding above 50 users unless you buy an enterprise licence.
- LibreChat is MIT, but its Arabic UI is 20 % translated and it does not sync LDAP groups.
- Open WebUI's Arabic is 97 % translated, but RTL there is a per-message text direction; the layout does not mirror.

**Opinion:** Neither product removes the hard part of this hub: serving many AG-UI agents with durable approvals, the agent asking the user, and a signed per-user identity. Open WebUI comes closest, through a Pipe you would write and maintain yourself. Its licence (above 50 users) and its LTR-only layout are dealbreakers if branding and Arabic RTL are firm requirements. Details in §9.

### 1. Snapshot

|  | Open WebUI | LibreChat |
| --- | --- | --- |
| Repo (2026-10-15) | 155.8k★, 22.7k forks; owner Open WebUI Inc. | 45.7k★, 9.4k forks; `danny-avila/LibreChat` redirects here. "LibreChat is joining ClickHouse" (librechat.ai banner); ClickHouse's post says it "remains 100% open-source under its existing MIT license" (clickhouse.com/blog/librechat-open-source-agentic-data-stack) |
| Licence | "Open WebUI License": BSD-3 plus a branding clause 4 since v0.6.6 (2025-04-19); not OSI-approved; contributors sign a CLA (§4) | MIT. The separate admin panel `LibreChat-AI/admin-panel` is **AGPL-3.0** (repo metadata) |
| Stack | Python (FastAPI, async SQLAlchemy) + Svelte. About 288 .py and 711 .svelte source files, ≈4.9 MB + 4.5 MB (≈270k lines, my estimate from blob sizes, tests and locales excluded) | Node/TypeScript + React. About 1,954 .ts, 1,021 .tsx and 432 .js files, ≈27 MB (≈760k lines, same method) |
| Cadence | 18 releases since 2026-04-15 (v0.11.2–v0.12.2 between Aug and Oct); 2,136 commits and 1,005 merged PRs since 2026-07-15 | 11 releases since 2026-04-15 (v0.8.7 on 06-24, v0.8.8 on 10-01 after rc1–rc4); 1,403 commits and 1,539 merged PRs since 2026-07-15 |
| Data stores | SQLite (default) or PostgreSQL, embedded Chroma (or pgvector and others), optional Redis; one container (docs `getting-started/advanced-topics/scaling.md` L20–23, L35–61) | MongoDB 8, Meilisearch, plus pgvector and `rag_api` for file search, plus the admin-panel container (`docker-compose.yml`: `api, admin-panel, mongodb, meilisearch, vectordb, rag_api`) |
| For comparison: the hub | — | ≈32.7k lines of TS in `app/ components/ lib/ db/schema`, ≈43k lines of tests, 37 ADRs |

### 2. Requirements, one by one

Effort grades: **config** = settings only; **plugin** = a Pipe, Function or sidecar with no fork; **fork** = change upstream code. Hours, days and weeks are my estimates.

| Requirement | Open WebUI | LibreChat |
| --- | --- | --- |
| Local accounts, roles | **Has.** Roles `admin`, `user` and `pending`, with granular permissions and groups (docs `rbac/roles.md`) | **Has.** Roles plus capability grants (`features/access_control.mdx`) |
| Deactivation | **Has.** Setting a user to `pending` is "the default state for … deactivated users" (roles.md L37–38). SCIM `active` maps to it | **Partly.** The admin API lists and searches users; its delete route is commented out (`api/server/routes/admin/users.js` L47–49). CLI `config/ban-user.js` and `delete-user.js`; bans are time-limited (`BAN_DURATION`). A real "disabled" flag means a **fork, 2–4 days** |
| Password reset by email | **Missing.** There is no SMTP setting anywhere in `env.py`/`config.py`; the docs only describe an admin resetting a hash in SQL (`troubleshooting/password-reset.mdx`). Adding it is a **fork, 3–5 days** | **Has**, with SMTP (`features/password_reset.mdx`, `authentication/email.mdx`) |
| LDAP sign-in, AD and OpenLDAP | **Has (config).** `ENABLE_LDAP`, TLS, CA file, bind DN, search filter; AD and OpenLDAP guides (`auth/ldap.mdx`, `tutorials/auth-sso/azure-ad-ds-ldap.mdx`) | **Has (config).** `LDAP_URL`, StartTLS, CA, `LDAP_SEARCH_FILTER`, attribute mapping (`authentication/ldap.mdx`; `api/strategies/ldapStrategy.js`) |
| Directory group sync | **Partly (config).** See the details below this table. Making it robust is a **fork, 3–5 days** | **Missing for LDAP.** Groups have `source: ['local','entra']` only (`packages/data-schemas/src/schema/group.ts` L30–41). Entra ID groups sync through OIDC token reuse. The LDAP strategy reads no groups. Options: a sidecar that syncs through `/api/admin/groups` (**plugin, 3–5 days**), or a **fork** adding an `ldap` source (1 week) |
| Groups and per-app access | **Has (config).** A Workspace Model (name, icon, description, base model, prompt) is Private with Read/Write grants to groups or users; nested groups; `BYPASS_MODEL_ACCESS_CONTROL=false` by default (`rbac/groups.md`; `hardening.md`) | **Has (config).** LibreChat Agents carry an ACL (Viewer/Editor/Owner) shared to users, groups or roles (`features/agents.mdx` "Access Roles"). Endpoints and model specs can be scoped per group or role through the admin panel's per-principal config overrides (`features/admin_panel.mdx` L23–27, L210–227) |
| Several admin-managed "apps" | **Has (config).** Workspace Models, or one Pipe "manifold" that publishes many models (`functions/pipe.mdx` L95–97) | **Has (config).** `modelSpecs` (label, `iconURL`, description, `group`) or Agents with categories and a marketplace (`model_specs.mdx` L300–433) |
| Code-defined agents as apps | **Plugin.** See §3. Of the two, it comes closest | **Partly.** See §3. External agents lose all HITL |
| HITL for external agents | **Partly, through a plugin.** Pipe `__event_call__` `confirmation`/`input` modals; not durable (§3.2) | **Missing.** Native Ask User and tool approval cover LibreChat's own Agent runs only (`features/agents.mdx` L288–302; `agents.mdx` yaml §toolApproval L821–884) |
| Attachments to an external agent | **Has.** Images go as base64 to OpenAI connections; documents go through RAG by default; a Pipe gets `__files__` with a storage path and can send bytes (reserved-args L348–362; r1 §4.3) | **Partly.** Images go to vision models. Documents go through `rag_api` or "upload as text" (`features/upload_as_text.mdx`); r1 §4.3 |
| Admin reads chats, with an audit | **Partly.** Reading is on by default, read-only in the UI. Audit goes only to a loguru JSON **file**, and GETs only with `ENABLE_AUDIT_GET_REQUESTS`; there is no UI (prior research §4.1). An audited access log with a UI is a **fork, 1–2 weeks** | **Missing.** No admin conversation reader. Insights (opt-in) shows only the first message. The audit covers grants only (prior §4.2). Adding both is a **fork, 2–3 weeks** |
| Branding (own logo and name) | **Blocked above 50 users** without an enterprise licence (§4). `WEBUI_NAME` always gets " (Open WebUI)" appended (`env.py` L953–959) | **Has.** `APP_TITLE`, `customFooter`, theme; the logo is a static file, `client/public/assets/logo.svg`, replaced through a volume. MIT |
| en, zh, ar with RTL | **Partly.** Strings: ar 96.8 %, zh-CN 92.4 % filled. RTL is per message only (§5) | **Partly.** RTL layout comes from `document.documentElement.dir = i18n.dir(locale)` (`client/src/locales/i18n.ts` L284–285). But ar is only 20.2 % translated and zh-Hans 41.4 %, with English fallback; the RTL layout issue #7829 has been open since 2025-06, and the fix PR #16171 is open |
| Docker beside other services on 16 GB | **Easy.** One container plus the PostgreSQL you already run. The memory spike is local embedding models, which can be swapped for an external one | **Heavier.** Five or six containers, including MongoDB and Meilisearch, which are new datastores to operate and back up |
| Dify (no longer required) | Community Dify Pipes exist on openwebui.com (not vetted, per the plugin warning in `plugin/index.mdx` L20–34) | Only through an OpenAI-compatible shim. Nothing native |

**Open WebUI's LDAP group sync, in detail:**

- Groups come only from an attribute on the user entry (`LDAP_ATTRIBUTE_FOR_GROUPS`, default `memberOf`). The code turns each DN into its CN (`routers/auths.py` L521–561). That means:
  - OpenLDAP needs the memberof overlay;
  - there is no group search and no nested-group resolution;
  - groups with the same CN in different OUs collide.
- Sync runs **only at login** (L627–631). A user removed from a directory group keeps access until they next sign in. Nothing deactivates a user who was disabled in the directory; SCIM would.
- Each sync **replaces all** of the user's memberships: `previous - target` is deleted (`models/groups.py` L658–679). So hand-made local groups cannot be mixed with LDAP for LDAP users.

### 3. Code-defined agents as apps (weighted heaviest)

#### 3.1 What the agent frameworks speak

- **AG-UI is the common output.** AG-UI's integrations list has LangGraph, CrewAI, Microsoft Agent Framework, Google ADK, AWS Strands, Mastra, Agno, LlamaIndex and Pydantic AI as supported; the OpenAI Agents SDK is "in progress" (`agui-and-reference-hubs.md` L124–146).
- **No OpenAI-compatible server in Pydantic AI.** Its UI layer has two adapters, AG-UI and Vercel AI (`docs/ui/overview.md`: "natively supports two UI event stream protocols"), plus a web UI. It has no `/v1/chat/completions` server.
- **So each product needs a bridge (opinion, from the two facts above).** To put a code agent into either product you write an OpenAI-compatible façade, or one generic AG-UI→OpenAI bridge service, because the products only speak OpenAI and the agents only speak AG-UI. The bridge is lossy: OpenAI chat-completions streaming has no interrupts, state, plan or ask-user events.

#### 3.2 Open WebUI: three ways in

**(a) OpenAI connection plus a forwarded identity (config).**

- `ENABLE_FORWARD_USER_INFO_HEADERS` together with `FORWARD_USER_INFO_HEADER_JWT_SECRET` sends **one HS256 JWT per request**. Its claims are `sub` (user id), `email`, `name`, `role`, `iss` "open-webui", `iat` and `exp`; "A fresh token is minted on every request" (docs `reference/env-configuration.mdx` L2227–2320).
- Per-connection headers can also carry placeholders such as `{{USER_ID}}`, `{{CHAT_ID}}` and `{{MODEL_ID}}`.
- **What this loses against the owner's agent contract:**
  - no `aud` per app (the secret is global, so one token is valid for every agent);
  - no `auth_source`;
  - `roles` is only `admin`/`user`, with no groups;
  - no HITL;
  - no agent state;
  - the agent sees only text history (`body.messages`), not its earlier tool calls.

**(b) An AG-UI bridge Pipe (plugin).** This is the strongest route. A Pipe is admin-installed Python run inside Open WebUI, with `requirements:` frontmatter pip-installed (`functions/index.mdx` L105–131). A single "manifold" Pipe can publish one model per agent from a valve list (`pipe.mdx` L95–97), so a new agent is one valve entry plus a Workspace Model with its grants. The Pipe receives:

- `__user__`: the full user record (reserved-args L73–75). It can query groups (the docs' own Pipe examples import `open_webui.models.*`, `pipe.mdx` L320) and mint **exactly the owner's JWT** (`aud`, `roles`, `auth_source`; my reading);
- `__files__`;
- `__chat_id__`;
- `__event_emitter__`, for status, citations and message deltas;
- `__event_call__`, whose `confirmation` and `input` dialogs "pause execution until the user responds" (`plugin/development/events.mdx` L73–100, L145–147).

So an AG-UI interrupt can become a confirmation dialog, and the Pipe then starts the resume run itself. **What it lacks:**

- The dialog is a modal held open over the websocket. If the browser reloads, it returns `{"error": "Client session disconnected."}`, and it waits forever unless `WEBSOCKET_EVENT_CALLER_TIMEOUT` is set (events.mdx L88–99). The hub's approvals and questions survive a reload; these would not.
- `input` is a single text box. Richer cards need Rich UI iframes, whose "prompt submission" sends a new user turn (`rich-ui.mdx` L111–165, L358–390).
- There is no plan or state panel.
- The Pipe must keep each chat's AG-UI messages and state in a store of its own, because Open WebUI stores only what the Pipe yields.

**Opinion:** 1–2 weeks to a solid Pipe, then you maintain it against Open WebUI's plugin API, which has had breaking migrations (`plugin/migration/to-0.5.0`, `to-0.9.0`).

**(c) MCP (config).** Open WebUI has native MCP over Streamable HTTP with OAuth 2.1 (`extensibility/mcp.mdx`), an elicitation dialog (`src/lib/components/chat/ElicitationDialog.svelte`), and an experimental per-chat **"Ask for approval"** before each tool call (`ENABLE_TOOL_PERMISSIONS`, env reference L1409–1414). These work only when **Open WebUI's own model runs the loop**. Your Pydantic AI agent would then be reduced to a tool server: its own reasoning loop, prompts and structured flow are no longer the "app".

#### 3.3 LibreChat

- **Custom endpoint (config).** In `librechat.yaml`, `endpoints.custom` takes `baseURL`, `apiKey`, `models`, `iconURL` and `headers` with `{{LIBRECHAT_USER_ID}}`, `{{LIBRECHAT_USER_ROLE}}`, `{{LIBRECHAT_USER_LDAPID}}` and `{{LIBRECHAT_BODY_*}}` (`custom_endpoint.mdx` L797–842). These are **plain, unsigned headers**. That is exactly the "static bearer plus plain user-id header" design the owner's contract rejects; a bridge would have to mint the JWT and trust LibreChat's network hop. `{{LIBRECHAT_OPENID_*}}` token reuse needs an OIDC login, which LDAP users do not have.
- **Wrapping it as an app (config).** A LibreChat Agent can use the endpoint as its provider and be shared by ACL, or a `modelSpec` can name it, give it an icon and scope it per group through config overrides.
- **No HITL path for external agents.** Ask User and `toolApproval` (with `allow`/`deny`/`ask` globs, checkpointed resume across replicas) are excellent, but they exist only inside LibreChat's own agent runtime.
- **The "Agents API" (`remoteAgents`) points the other way.** It exposes LibreChat agents to outside callers (`features/agents_api.mdx`).
- **Agent Plugins** bundle Skills, MCP servers and hooks, and are "Experimental" (`features/agent_plugins.mdx`).
- **To get HITL for an external agent you would fork** the agent runtime (`@librechat/agents` with LangGraph checkpointing): weeks, my estimate.

#### 3.4 Adding agent number N (opinion)

- **Hub today:** an admin form (URL, audience, secret, `askUser`) plus grants. It works for every AG-UI framework with full HITL. Approvals already work (2b), and attachments are next (2c).
- **Open WebUI:**
  - with a Pipe: a valve entry plus a Workspace Model and its grants, in minutes;
  - with OpenAI connections: a façade per framework or per agent, then a connection and a Workspace Model.
- **LibreChat:** a façade or bridge, then a YAML `custom` entry (a restart; or a DB override through the admin panel), then an Agent or modelSpec plus ACL. No HITL.

### 4. Licences

**Open WebUI, LICENSE clause 4, verbatim in substance.** Licensees are "strictly prohibited from altering, removing, obscuring, or replacing any 'Open WebUI' branding, including … the name, logo …". There are three exceptions:

- (i) the total number of end users (natural persons with direct access) "does not exceed fifty (50) within any rolling thirty (30) day period";
- (ii) prior written permission;
- (iii) an executed enterprise licence.

Removal otherwise is a "material breach". The clause was added in commit `60d84a3aae` on 2025-04-18 and took effect with v0.6.6.

What the docs add (`docs.openwebui.com/license`):

- "Co-branding is not permitted": you may not put your logo "next to, … the same size as, or in comparable proximity or prominence to" theirs.
- "Removing **ANY** Open WebUI logo/name" is not allowed, even "with Powered by…".
- A subordinate "Managed by YourOrg" banner and a footer or About link are allowed.
- Code up to and including v0.6.5 remains BSD-3, so forking from there is allowed.
- Permission as a "substantive contributor" applies "only in exceptional cases".
- Research exemptions exclude "ongoing departmental use".
- Enterprise licences go through sales only (`openwebui.com/contact/sales`). The form asks for "Expected users" in bands (1–50 up to 5,000+) and "White-label / OEM". **No price is published.** Licences are "available exclusively to registered entities", and personal-domain emails "will not receive a response" (`docs.openwebui.com/enterprise`).
- The enterprise tier also gates "enterprise-exclusive offerings like Terminals".

**Opinion:** an organisation behind AD probably has more than 50 users. Then the product must say "Open WebUI" everywhere and cannot carry your logo beside it, unless you pay a price you only learn by asking. Forking v0.6.5 gives up 18 months of releases (native MCP, tool permissions, JWT forwarding), so it is not a real option.

**LibreChat:** MIT, so rebrand freely. The optional admin panel is AGPL-3.0. Running it unmodified is fine; changing it and serving it to users obliges you to offer its source (my reading of AGPL §13).

### 5. Arabic, Chinese, RTL

**Open WebUI:**

- Locales `ar`, `ar-BH`, `zh-CN` and `zh-TW` are well filled (4,076 keys, 130 empty for `ar`).
- Direction is a user setting, `chatDirection` (`auto | LTR | RTL`), applied as `dir=` on messages and inputs (`src/lib/components/common/InterfaceSettings.svelte` L68, L223–231; `ResponseMessage.svelte` L683, L714).
- Nothing sets the document's `dir`: code search for `documentElement.dir`, `i18n.dir` and `isRTL` returned 0 hits. So the sidebar, menus and admin pages stay LTR in Arabic.
- PR #28387, "Complete Arabic support – RTL layout …", was closed unmerged on 2026-08-10. Issue #31827 (mixed Arabic+English cursor and direction bugs), opened on 2026-10-01, is closed.
- **Opinion:** a mirrored layout means a fork touching many of the 711 Svelte files, with daily upstream churn: weeks, plus a permanent rebase cost.

**LibreChat:** the document direction follows the locale, so the layout mirrors. But only 688 of 3,407 keys are in Arabic (20.2 %) and 1,409 in Chinese (41.4 %). Translation happens in Locize (`translation.mdx`; the Locize badge API reported ar 17.6 %). Issue #7829, "RTL … UI elements and interface layout", is open, and so is PR #16171 (RTL shaping).

**Opinion:** about 2,700 Arabic strings and 2,000 Chinese strings to supply, at 2–4 days with review, plus RTL fixes. Contributing them upstream avoids carrying a fork.

### 6. Identity, groups and admin reading, in short

- **Both:** LDAP login.
- **Open WebUI also has:** OIDC, SCIM 2.0 (which, unlike LDAP sync, deactivates removed users; `auth/scim.mdx`), trusted-header groups, MFA.
- **LibreChat also has:** OIDC, SAML, passkeys, 2FA, Entra group sync, and a hash-chained audit of grants.
- **Neither has** an audited "who read which conversation" log with a UI; the hub's 2c plans one. Open WebUI's privacy page tells operators to switch admin chat access off where privacy matters (prior §4.1).

### 7. Deployment on the 16 GB server

- **Open WebUI:** one image and `DATABASE_URL` pointing at a PostgreSQL. SQLite is fine for a single replica on local disk. Redis is needed only for several replicas (scaling.md L20–23, L35–61, L96–102). Set `RAG_EMBEDDING_ENGINE` (env reference L4191) to an external engine, or accept the RAM taken by local sentence-transformers.
- **LibreChat:** `api` and `admin-panel`, plus `mongo:8.0.20`, `getmeili/meilisearch:v1.35.1`, `pgvector/pgvector:0.8.0-pg15` and `rag_api` (`docker-compose.yml`). That is two new datastores to back up and upgrade. Search and file RAG can be dropped to slim it down.

### 8. Customising without a fork, and the cost of a fork

- **Open WebUI without a fork:** most behaviour is in admin settings, persisted in the DB (`ENABLE_PERSISTENT_CONFIG`), plus Pipes, Filters (inlet/outlet), Actions, Tools, banners and webhooks. The docs say most "need a core change" requests can be plugins (`plugin/index.mdx` L52). Plugins run arbitrary Python as admin.
- **Open WebUI with a fork:** Python and Svelte, ≈270k lines, ~23 commits a day. Any fork of v0.6.6 or later keeps the branding clause.
- **LibreChat without a fork:** `librechat.yaml` plus DB-backed per-principal overrides, MCP, Agents, Skills and Agent Plugins.
- **LibreChat with a fork:** TypeScript and React, ≈760k lines, ~15 commits a day, Mongo schemas spread across `packages/data-schemas`.
- **Opinion:** a long-lived fork of either costs 1–3 days a month just to rebase, given this churn.

### 9. Estimates (opinion)

**Open WebUI to the hub's needs:**

- deploy, LDAP and groups: 2–3 days;
- the AG-UI Pipe with owner-JWT, files and modal HITL: 1–2 weeks;
- Workspace Models and grants: hours.

Still missing after that:

- branding above 50 users (licence; price unknown);
- RTL layout (a fork, weeks);
- durable approvals and ask-user, and the plan/state panel (cannot be done well in a Pipe);
- email reset (fork, days);
- an audited reader UI (fork, 1–2 weeks).

**Roughly 2–3 weeks to "good minus RTL layout and branding"; 6–10 weeks and a permanent fork to match the hub.**

**LibreChat:**

- deploy: 2 days;
- an LDAP group sync sidecar: 3–5 days;
- an AG-UI→OpenAI bridge that also mints the JWT: 1 week;
- Arabic and Chinese strings: 3–5 days;
- admin reader plus audit: a fork, 2–3 weeks;
- HITL for external agents: a deep fork of the agent runtime, weeks, or giving up Pydantic AI's loop.

**Roughly 5–8 weeks, and agent HITL is the item it does worst.**

**The hub:**

- **Already merged, and matching the revised requirements closely:**
  - Parts 0, 1, 2a and 2b;
  - local and LDAP accounts with sync;
  - groups and grants;
  - AG-UI apps behind a signed per-app JWT;
  - durable approvals, `ask_user`, interrupts and plan;
  - branding, settings, and en/zh/ar with RTL layout;
  - about 2,545 unit and 725 e2e tests at the last gate.
- **Remaining:** 2c (attachments, Logs and the access log). With Dify dropped, **Part 3 (moving the Dify chat onto the shared chat) can be cut or shrunk to removing the Dify provider**. Opinion: 1–3 weeks.

**Honest both ways:**

- The hub's real risk is **breadth and upkeep, not the agent chat**. It will never have the products' RAG, MCP, model catalogue, mobile polish or security scrutiny, and one owner carries the maintenance.
- On the revised requirements, both products are **weaker exactly where the owner is strongest and most specific**: many AG-UI agents with durable HITL and signed identity, Arabic RTL, and its own brand.
- Building that into a product means a fork, which brings back the "building from scratch" cost on someone else's codebase.

**Also possible (opinion):** keep the hub narrow as the agent portal and stop adding generic chat features. Where users want a general ChatGPT-style assistant, run LibreChat (MIT, brandable) or Open WebUI (if 50 users or fewer, or with the branding kept) beside it on the same LDAP.

### 10. What these products do far better than the hub will

- **Both:**
  - **knowledge and RAG** over uploaded documents, with vector DBs, OCR, citations and web search;
  - **model management** across dozens of providers, with presets and parameters;
  - **native MCP**, including OAuth and per-user connections;
  - a code interpreter and artifacts;
  - image generation, speech-to-text and text-to-speech;
  - memory;
  - prompt libraries;
  - conversation search, sharing and forking;
  - SSO breadth (OIDC, SAML, SCIM or Entra);
  - horizontal scaling guides;
  - huge user bases that find bugs and security holes quickly.
- **Open WebUI also has:** a community site of shared Functions and Tools, channels, notes, an arena/evaluation mode, analytics, and Python-native plugins, which suit a Pydantic AI owner.
- **LibreChat also has:**
  - first-class agents with ACL sharing, a marketplace, subagents, skills, scheduled chats, resumable streams;
  - the best native tool-approval and Ask-User UX of the two, but for its own agents only;
  - multi-tenancy and a delegated-admin grant model with a hash-chained audit.

### Sources (beyond the inline ones)

- Open WebUI: `LICENSE` (raw, main); `docs.openwebui.com/license`; `/enterprise`; `openwebui.com/contact/sales`; docs files `features/authentication-access/{auth/ldap.mdx,auth/scim.mdx,rbac/*.md}`, `features/extensibility/{mcp.mdx,plugin/index.mdx,plugin/functions/{index,pipe}.mdx,plugin/development/{events,reserved-args,rich-ui}.mdx}`, `reference/env-configuration.mdx`, `troubleshooting/password-reset.mdx`, `getting-started/advanced-topics/{scaling,hardening}.md`; code `backend/open_webui/{env.py,config.py,routers/auths.py,models/groups.py}`, `src/lib/i18n/locales/*/translation.json`, `src/lib/components/common/InterfaceSettings.svelte`; issues and PRs #28387, #31827, #14470.
- LibreChat: docs `content/docs/{configuration/librechat_yaml/object_structure/{custom_endpoint,model_specs,agents,interface}.mdx, configuration/authentication/{ldap,email}.mdx, features/{access_control,admin_panel,agents,agents_api,agent_plugins,password_reset,upload_as_text}.mdx, translation.mdx}`; code `api/strategies/ldapStrategy.js`, `packages/api/src/auth/ldap.ts`, `packages/data-schemas/src/schema/group.ts`, `api/server/routes/admin/users.js`, `client/src/locales/{i18n.ts,*/translation.json}`, `client/src/components/Nav/SettingsTabs/Chat/ChatDirection.tsx`, `docker-compose.yml`, `config/*.js`; issues and PRs #7829, #16171, #9859; Locize badge API; ClickHouse blog post.
- Pydantic AI: `docs/ui/overview.md`, tree `pydantic_ai_slim/pydantic_ai/ui/{ag_ui,vercel_ai,_web}`.
