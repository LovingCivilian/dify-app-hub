# Handoff: Part 1 is merged; start Part 2 (2026-10-14)

The next session starts **Part 2 of the provider hub: the shared chat on AG-UI plus the AG-UI provider**. It begins with a design (brainstorming → the Part 2 spec), then the plan. Nothing of Part 2 is written yet.

## Where things stand

- `fork/overhaul` is at `6062ea64` with a clean tree. Part 0 (PR #39) and Part 1 (PR #60, merged as `8500cce3`) are in. The history to date is the running record, `docs/superpowers/research/2026-10-11-provider-hub/README.md`: decision 39 for Part 1, and decision 12 for the Parts 0–3 split.
- Part 1's design is **ADR-0032** (`docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md`, accepted). Its "The modules" table names every place a new provider plugs in: `PROVIDER_IDS`, the `apps_provider_check` CHECK (a migration), `PROVIDER_SCHEMAS`, the `PROVIDERS` registry, `PROVIDER_UI` and `ProviderChat`'s exhaustive switch. `__tests__/provider-boundary.test.ts` pins the import boundary.
- **Issue #62** ("Follow-ups: provider core") has a "For the second provider" section. Those items were left for Part 2 to decide, for example M5 (an invalid row's settings are lost in Edit) and the `object`-typed `chatFields`/`summaryFields`.
- Not for Part 2: the `fork/main` folder's docs still mention its removed `.venv`. The owner chose to leave them.

## Inputs for the Part 2 design

- **The charter:** `docs/superpowers/specs/2026-10-11-provider-hub-charter.md`, which covers Part 2's scope and Part 3, Dify moving onto the shared chat.
- **The running record's "Open questions":** conversation storage for providers that keep no history, and the AG-UI chat UI picks.
- **Research beside the record:**
  - `agui-and-reference-hubs.md`: the AG-UI protocol, `@ag-ui/client`, Pydantic AI's adapter, and how LibreChat, Open WebUI and LobeChat do providers;
  - `agui-reference-projects.md`: the vstorm templates and the AG-UI Dojo;
  - `ui-picks-part1.md`.
- **The owner's direction** (memory `agui-direction`): Ant Design X with `@ag-ui/client` rather than CopilotKit, and the vstorm template as the UX reference.
- **Decision 33:** each part's plan is written against the code as it stands after the previous part merged.

## How to work (owner's standing rules, all in AGENTS.md or memory)

- **Workflow:** the superpowers-extended-cc skills run it. Branch in place in `~/repos/dify-app-hub` (no worktree), with `docs/…` for the spec and `feat/…` for the build. PRs target `fork/overhaul`.
- **Node:** run `nvm use` first (Node 22); the shell starts on 24.
- **Docs:** documented approaches only, with a source for each piece (ADR-0002). Check docs from every source: the repo's docs, Next's bundled docs, the antd CLI or MCP and the Ant Design X skills, Context7, and `crwl`. crawl4ai is now a pipx install on `PATH`, not `.venv`.
- **A new pattern or dependency** (AG-UI, `@ag-ui/client`) gets an ADR in the same PR (ADR-0015).

## Lessons from Part 1's run

- **Locale strings:** when one changes, grep `e2e/` for the old text. Task 5's rewording broke specs that nobody re-ran until the final gate.
- **Full e2e run:** about 30 minutes, with swap reaching about 4 GB on this 4.9 GB machine.
  - When a run fails, read `test-results/` and `.next/dev/trace` before rerunning. Reruns overwrite the traces, and the "flake" had a real cause (ADR-0010 note of 2026-10-14).
  - Strict-mode races appear when the machine is slow: prefer exact or scoped locators.
- **Docker Desktop off:** if `docker` is missing in WSL, run `"/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe" desktop start`. The app container may then restart once, because it starts before PostgreSQL is ready; that's harmless.

## Suggested skills

- `superpowers-extended-cc:brainstorming`: first, for Part 2's design and spec.
- `superpowers-extended-cc:writing-plans`: once the owner approves the spec.
- The Ant Design X skills, for the shared chat: `x-components`, `use-x-chat`, `x-chat-provider`, `x-request`, `x-markdown`, and `x-card` (A2UI / generative UI).
- `antd`, `context7-mcp` and `crawl4ai`, for docs checks: AG-UI's and Pydantic AI's documentation and the reference projects.
- `adr-skill`: the AG-UI provider decision.
