# Architecture Decision Records (ADR)

An Architecture Decision Record (ADR) captures an important architecture decision along with its context and consequences. Format: MADR 4.0 (YAML front matter, Context, Decision, Consequences, Implementation Plan with verification). Tooling: `.claude/skills/adr-skill` (`scripts/new_adr.js --update-index`, `scripts/set_adr_status.js`).

## Conventions

- Directory: `docs/decisions`
- Naming: numbered files, `NNNN-verb-phrase.md` (e.g. `0004-keep-mysql-through-drizzle.md`)
- Status values: `proposed`, `accepted`, `rejected`, `deprecated`, `superseded by [ADR-NNNN](…)`
- An accepted ADR is not edited except for a status change or a dated note under "More Information"; a changed decision gets a new ADR that supersedes the old one, linked both ways.
- Code implementing a decision references it at its entry point (`// ADR-NNNN`); PR descriptions name the ADRs they implement.

## Workflow

- Create a new ADR as `proposed` (`node .claude/skills/adr-skill/scripts/new_adr.js --title "…" --status proposed --update-index`).
- The skill's scripts are CommonJS and crash under this repo's `"type": "module"`: run them from a temporary copy of `.claude/skills/adr-skill` with `scripts/*.js` renamed to `.cjs`, then check the index row here by hand (`--update-index` appends it below the table).
- **ADR numbers are per line.** The two lines never merge (ADR-0019), so each line numbers its own records from its own highest number (what `new_adr.js` does). Records 0001–0019 match the overhaul's numbers; from 0020 the same number may mean different decisions on the two lines, so a document that refers to the other line's ADR names the line ("ADR-0018 on `fork/overhaul`"), and an ADR file brought over by cherry-pick is renumbered to this line's next free number.
- Discuss and iterate; the owner accepts (`scripts/set_adr_status.js`).
- Read `accepted` ADRs before architecture work in their area.

## ADRs

This is the `fork/main` line (the line-level product, [ADR-0019](0019-keep-two-product-lines.md)). Numbers 0001–0019 match `fork/overhaul`'s (later numbers are per line); the records that concern only the frontend overhaul (ADR-0008–ADR-0012, ADR-0014, ADR-0016–ADR-0018) live on that branch (ADR-0016–ADR-0018 on PR #15's branch until it merges) and are missing here on purpose; the body text of some copied records links to them. ADR-0007 is superseded on `fork/overhaul` but in force on this line.

| # | Title | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-adopt-architecture-decision-records.md) | Adopt architecture decision records | accepted | 2026-10-04 |
| [0002](0002-use-documented-library-approaches-only.md) | Use documented library approaches only, verified against current docs | accepted | 2026-10-04 |
| [0003](0003-run-the-fork-on-a-two-branch-model.md) | Run the fork on a two-branch model: `main` mirrors upstream, `fork/main` integrates | superseded by [ADR-0019](0019-keep-two-product-lines.md) | 2026-10-04 |
| [0004](0004-keep-mysql-through-drizzle.md) | Keep MySQL (through Drizzle) instead of moving to PostgreSQL | accepted | 2026-10-04 |
| [0005](0005-internationalise-the-ui-with-typed-i18next-keys-and-msa-arabic.md) | Internationalise the UI with typed i18next keys, with Modern Standard Arabic and Arabic-Indic digits | accepted | 2026-10-03 |
| [0006](0006-require-login-everywhere-and-use-the-email-as-dify-end-user-id.md) | Require the app's own login for every page and API, and use the signed-in email as the Dify end-user id | accepted | 2026-10-04 |
| [0007](0007-leave-the-ant-design-look-as-upstream-has-it.md) | Leave the Ant Design / Ant Design X look as upstream has it | accepted | 2026-10-04 |
| [0013](0013-pin-ant-design-cssinjs-to-antd-version.md) | Pin `@ant-design/cssinjs` to the version Ant Design depends on | accepted | 2026-10-04 |
| [0015](0015-record-decisions-as-adrs-and-session-handoffs.md) | Record decisions as MADR ADRs and session state as handoff documents; keep CLAUDE.md to rules and pointers | accepted | 2026-10-04 |
| [0019](0019-keep-two-product-lines.md) | Keep two product lines: `fork/main` for the line-level fork, `fork/overhaul` for the frontend overhaul | accepted | 2026-10-06 |

## Inherited from upstream (not fork decisions)

Upstream's own design records live under `docs/superpowers/specs/2026-05-*` and `docs/superpowers/plans/2026-05-*`: web dual auth (not adopted by the fork, see ADR-0006), web lib cleanup, Prisma → Drizzle ORM migration (see ADR-0004), HITL human intervention. Treat them as upstream history.
