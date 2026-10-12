# Handoff, 2026-10-12: Part 0 executed and merged, Part 1 planned

> **Superseded in part (owner, 2026-10-12):** the run brief ("How the owner wants Part 1 run"), "What worked in Part 0's run" and the `superpowers:` skill names below no longer apply. The superpowers-extended-cc plugin's skills run Part 1 with their defaults, after the plan is converted to that plugin's plan format (running record, decision 38). The status sections still hold.

The next session executes **Part 1 of the provider-hub programme** (the provider-neutral core), subagent-driven. Everything it needs is in the repository; this file says where things stand and where to look.

## Where things stand

- **Part 0** (PostgreSQL 18 and the rename to "AI App Hub") is **merged**: PR #39, merge commit `fd05be49`. ADR-0031 was accepted after the owner tested the pushed branch ("ive tested it and it looks like its working").
  - Its run records were merged as PR #40 (`dfeff12e`): `docs/superpowers/research/2026-10-11-provider-hub/part0-execution/`. That folder holds the ledger, every ruling with its cost (`rulings.md`), the pre-flight scan, the ADR-0002 docs check of execution-time choices, the three-seat final review and the fix wave.
  - Decision 36 in the running record (`docs/superpowers/research/2026-10-11-provider-hub/README.md`) summarises the run and the owner's answers.
- **Part 1's plan is approved** (owner, 2026-10-12): `docs/superpowers/plans/2026-10-12-part-1-provider-core.md`, 15 tasks, decisions a–ag, no open questions.
  - An Opus subagent wrote it; two Opus reviewers checked it; it got one fix round, an Opus re-review and a last round of small fixes. "Review findings not taken" sits at the plan's end.
  - The owner's two answers ("Cap at 512 KB" for the icon; "Default, like branding" for the icon's Remove button) are decision 37. They are also written into the spec (§4.1, §4.4) and `ui-picks-part1.md` (E4).
  - Committed as `fe98954f` on the local branch **`docs/part-1-plan`**, together with the spec, running-record and UI-picks corrections and CLAUDE.md's pointer. **Not pushed, no PR yet.** The owner was offered "say merge it" to push, open the docs PR and merge it before Part 1 starts. If the plan is not on `fork/overhaul` when the next session starts, ask the owner.
  - The plan's own review records (review-A/B, re-review, the pre-fix plan and the fix diff) are scratch in the git-ignored `tmp/part1-plan-review/`. Archive them with Part 1's run records if the owner wants them kept.

## The machine (WSL, ~5 GB RAM)

- Running: the new local stack `ai-app-hub-local` (`ai-app-hub-local-app` on :5300, `ai-app-hub-local-postgres` on 127.0.0.1:5432), built from Part 0.
  - On this machine nobody has created the owner at `/init` yet. The owner tested Part 0 on a clone of the pushed branch and created an owner there.
  - Part 1's Docker gate migrates whatever data this stack holds.
- `.env` and `.env.development.local` were switched to PostgreSQL by Claude with the owner's permission (a new random password; no value was printed). The MySQL-era backups were deleted on the owner's word. The old MySQL volume `dify-app-hub-local_mysql-data` is removed.
- The e2e containers are down. The git-ignored `tmp/refs/` holds the owner's research clones; `tsconfig.json` excludes `tmp/`.
- The untracked `docs/superpowers/handoffs/2026-10-10-repo-housekeeping-kickoff.md` belongs to the postponed housekeeping work. Leave it alone.

## How the owner wants Part 1 run

The owner received this prompt for the new session; use it as the brief:

> Execute Part 1 of the provider-hub programme (the provider-neutral core), subagent-driven. Start with CLAUDE.md, the running record (decisions 36–37), the plan, the spec (binding authority), `ui-picks-part1.md`, and Part 0's run records (`rulings.md` first). First check the plan is on `fork/overhaul`; if not, stop and ask. Branch `feat/provider-core` from `fork/overhaul` in this folder. Run an Opus pre-flight scan split in two before Task 1, a review for every task, a three-seat Opus final review plus one fix wave and a scoped re-review before the last task's full gates. Each commit carries its own model's Co-Authored-By plus this session's Claude-Session line (the plan's commands show the previous session's link). ADR-0002 strict: every implementer checks APIs against current docs and reports "Docs checked"; documented commands only (pnpm add/remove), never `--no-verify`. Any UI outside the picks is a question for the owner with the full candidate list. Never read or print `.env`. The Docker gate stops for the owner's word and takes the mandatory backup image and dump first; nothing is replaced until the dump has been restored into a copy and the migrations rehearsed. Push, PR and merge only on the owner's word. At the end, list every ruling with its cost, and archive the run records in `…/part1-execution/` in a small docs PR.

## What worked in Part 0's run (repeat it)

These are the controller's own practices; the skill does not require them.

- **One shared rules file for implementers.** It held the trailers, the gates, what never to touch and the "Docs checked" section. Every dispatch pointed to it instead of repeating it.
- **The plan split per task.** The skill's `task-brief` script makes one brief per task, plus a `plan-header.md` and an `interfaces.md` for the scanners and reviewers.
- **Focused review packages for big diffs.** They leave out deleted files, generated snapshots, the lockfile and the test CA.
- **Every decision as a ruling in the ledger**, with "if wrong: …".
- **Subagents' commits** sometimes carried the wrong trailer. A Haiku implementer copied "Opus"; Sonnet ones wrote their own model's name. The owner chose to keep per-model trailers.
- **A commit of only the lockfile** used to fail the lint-staged hook. `.lintstagedrc.mjs` now passes `--no-error-on-unmatched-pattern` to oxfmt.

## Owner preferences seen this session

- The owner asks "did you follow adr 02?" and wants a per-piece answer with sources. A gap gets fixed the documented way: tsconfig `exclude` rather than filtering tsc's output; `pnpm remove` rather than a hand-edited lockfile.
- One question at a time, with a recommendation.
- The owner is making frontend mockups in Vercel v0 on antd 6 and Ant Design X 2, for later frontend work. They will still pick each component from the full candidate list.

## Suggested skills

- `superpowers:subagent-driven-development`: run Part 1's plan (its `scripts/task-brief`, `review-package` and `sdd-workspace`).
- `superpowers:requesting-code-review`: the final whole-branch review template.
- `superpowers:receiving-code-review`: judging review findings before fixing them.
- `superpowers:verification-before-completion`: before claiming a gate passed.
- `superpowers:finishing-a-development-branch`: at the end (PR and merge only on the owner's word).
- `find-docs`: the ADR-0002 docs checks (Context7).
- `antd` and `x-components`: before judging or changing any antd 6 / Ant Design X code (the drawer, the table, the icon field).
- `adr-skill`: ADR-0032 and the dated notes in Task 14.
- `handoff`: at the end of that session, if the owner asks for one.
