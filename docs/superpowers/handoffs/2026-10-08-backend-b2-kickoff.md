# Handoff 2026-10-08: start backend rework B2 (accounts and admin)

The next session plans and then runs B2 on `fork/overhaul`. This file holds only what the records below don't already say. Read those records rather than copying them.

## Where things stand

- **`fork/overhaul`** is at `5f88775e`. Locally it is clean, and the only untracked file is this handoff.
- **B1 is merged** as PR #26, merge commit `0c6a75b7`. Its branch is deleted under the new branch policy.
- **The policy itself** is PR #27: Conventional Branch names, and merged branches deleted. It is recorded in the ADR-0019 note of 2026-10-08 and in the branch-model section of `CLAUDE.md`.
- **B1's records:**
  - `docs/superpowers/research/2026-10-07-backend-rework/b1-execution/`: `rulings.md` holds every controller ruling, plus `ledger.md`, `follow-ups.md` and `final-review-report.md`;
  - ADR-0022, ADR-0023 and ADR-0025;
  - the dated notes on ADR-0006, ADR-0017, ADR-0018 and ADR-0020.
- **The owner's browser check of B1 passed,** except speech-to-text. That waits until the owner has a speech-to-text provider; Dify 1.17.1's source refuses WebM, according to the ADR-0017 note of 2026-10-07 and its 2026-10-08 outcome.
- **The check found two chat bugs from before B1, both fixed in PR #26.** The fixes and their limits are in the two ADR-0017 notes of 2026-10-08: the order of a human-input answer, and the reasoning block.
- **The Docker stack** (`localhost:5300`) runs an image built from `bf980052`. Only documentation has landed since then.

## What B2 is

The charter is B2's spec, and its decisions are not re-opened: `docs/superpowers/specs/2026-10-07-backend-rework-charter.md`.

- §2 lists the decisions.
- §4.2 covers data, sessions, roles, actions, first run and the proxy.
- §4.4 covers the `users.role` migration and its backfill.
- §5 has the B2 row, including the "done when" column.
- §6 lists the records: ADR-0024 and the rewritten `docs/auth-gate.md`.

The branch is `feat/backend-b2-accounts`, created from `fork/overhaul`. The charter names it, and it fits the new naming policy.

The B2 plan goes under `docs/superpowers/plans/`, in the same format as `docs/superpowers/plans/2026-10-07-backend-b1-dify-layer.md`: header, global constraints, tasks, and the review focus.

### Things the plan must settle or carry, which the charter does not say

1. **Forms.**
   - The charter says `useActionState`. B1 ruled that admin forms call their Server Action through `startTransition` from antd Form's `onFinish`, because the Form owns validation (`.claude/rules/frontend.md`). See ADR-0023, "Admin actions", and `rulings.md`.
   - Apply the same ruling to the users drawer, `/init`, forgot and reset password, and the new change-password form.
   - Say so in the plan header, as B1's plan did for its own deviations.
2. **B1 follow-ups tagged "(B2)"** in `b1-execution/follow-ups.md`:
   - `failureText` gains `forbidden` and `icon_not_found`;
   - creating an annotation gets the role gate, and the app's `enableAnnotation` setting;
   - `authorize` gets its tests.
3. **One wording fix in `CLAUDE.md`'s branch model.**
   - `gh pr merge <n> -R LovingCivilian/dify-app-hub --merge --delete-branch` deleted only the GitHub branch on 2026-10-08. With `-R`, `gh` doesn't touch the local checkout.
   - Reword the line so the local `git branch -d <name>` is always part of the cleanup.
4. **`CLAUDE.md` "Where things are":** the "Latest handoff" pointer becomes this file.

## How the owner wants it run

These come from the B1 kick-off and later sessions. `CLAUDE.md` and memory already cover the rest.

- **Approval first.** Write the plan with superpowers:writing-plans, run a pre-flight review of it, and stop for the owner's approval before any code.
- **Subagent-driven execution:**
  - a fresh implementer per task, given only its task text;
  - a fresh reviewer per task, with the gates the plan states;
  - one fix wave after the whole-branch review, then a scoped re-review.
- **Model use:**
  - The owner has no Fable usage left as of 2026-10-08. Run the pre-flight review, the whole-branch review and the reviews of the riskiest tasks on Opus, and use Fable again only if the owner says it is back.
  - Opus and Sonnet have headroom.
  - Name every subagent's model explicitly.
- **Commits:** one per task, with both trailer lines in one `-m`. `.cii-assessment.md` goes in its own `docs: update CII assessment` commit (`AGENTS.md`).
- **Pushing:** never push or open a PR without the owner's word. Stop after the Docker gate and the PR text, and ask.
- **e2e runs:**
  - Run the affected specs while iterating, and the full suite once at the end. The owner asked why it ran in full twice; it takes about 19 minutes.
  - Stop `pnpm dev` before `pnpm test:e2e`.
- **Docker:**
  - Take the old app container down first, and build in the foreground (`docker compose -f docker-compose.local.yml build app`, then `up -d app`).
  - Never restart a build that was killed for memory.
  - The WSL machine has about 5 GB of memory.
- **The migration:** check the role backfill on a copy of the local database before the Docker gate (charter §4.4). Keep any dump in `tmp/` and delete it afterwards, because it holds password hashes and keys.
- **Files:**
  - `AGENTS.md` stays byte-identical. Never read or print `.env` or `.env*.local`.
  - Write no handoff document unless the owner asks.

## Environment facts learned this session

- **Scratch files go in `tmp/`** at the repo root. It ignores itself (`tmp/.gitignore` holds `*`), and `.dockerignore` already excludes it. Never use `/tmp`: `wsl --shutdown` wiped it on 2026-10-08, and with it a PR text and the review reports.
- **The pre-commit hook is now on.**
  - `pnpm exec husky` was run on 2026-10-08, so `core.hooksPath` is `.husky/_` and `lint-staged` runs on every commit.
  - It runs `oxfmt` on staged Markdown too. Staging one of the docs that were never formatted, such as `docs/dify-service-api-1.17.1.md` or the B1 charter, plan and research files, reformats the whole file. That is the recorded docs-formatting follow-up, so keep those files out of B2 commits unless the reformat is intended.
- **No CI runs for PRs into `fork/overhaul`.** Every workflow in `.github/workflows` triggers only on `main` or on `v*` tags, so the local gates are the only gates.
- **The B1 workspace** `.superpowers/sdd/2026-10-07-backend-b1-dify-layer/` is git-ignored and local. Its `implementer-contract.md`, `reviewer-contract.md` and `re-review-contract.md` can be templates for B2's contracts. Their key rule: official sources, plus comparison with reference projects.

## Open items outside B2

The owner hasn't asked for these yet, so leave them alone.

- The branch policy is not yet in `fork/main`'s own `CLAUDE.md`, in `~/repos/dify-app-hub-main`.
- The human-input limits that remain, and the per-browser reasoning and node data, are in `follow-ups.md` and the ADR-0017 notes of 2026-10-08. The message-metadata study comes after B1-B3 and frontend phase 2.

## Suggested skills

- `superpowers:writing-plans`: first, to write the B2 plan from the charter; its pre-flight review runs on Opus.
- `superpowers:subagent-driven-development`: to run the plan once the owner approves it.
- `superpowers:test-driven-development`: in every implementer brief.
- `superpowers:systematic-debugging`: for any failure during the run.
- `superpowers:requesting-code-review`: for the whole-branch review.
- `superpowers:verification-before-completion`: before claiming any gate passed.
- `superpowers:finishing-a-development-branch`: after the Docker gate, to present the merge options.
- `adr-skill`: for ADR-0024 (the Data Access Layer with Server Actions and roles).
- `antd`: for the users drawer's role field and the change-password form.
- `find-docs` (Context7): next-auth v4 for sign-out and the session callbacks, Drizzle `mysqlEnum` and `$onUpdate`, and Next's Server Actions and `refresh`.

## Suggested kick-off prompt

> Read docs/superpowers/handoffs/2026-10-08-backend-b2-kickoff.md, then CLAUDE.md, then the charter docs/superpowers/specs/2026-10-07-backend-rework-charter.md (§2, §4.2, §4.4, §5, §6). Create feat/backend-b2-accounts from fork/overhaul, commit this handoff as its first commit, then write the B2 plan with superpowers:writing-plans in B1's plan format, and run the pre-flight review on Opus. Stop for my approval before any code.
