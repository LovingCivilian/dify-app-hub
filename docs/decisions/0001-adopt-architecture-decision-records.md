---
status: accepted
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
---

# Adopt architecture decision records

## Context and Problem Statement

Architecture decisions in this project are made implicitly — through code, conversations, and tribal knowledge. When a new contributor (human or AI agent) joins the codebase, there is no record of _why_ things are built the way they are. This makes it hard to:

- Understand whether a pattern is intentional or accidental
- Know if a past decision still applies or has been superseded
- Avoid relitigating decisions that were already carefully considered

We need a lightweight, version-controlled way to capture decisions where the code lives.

## Decision

Adopt Architecture Decision Records (ADRs) using the MADR 4.0 format, stored in `docs/decisions/`.

Conventions:

- One ADR per file, named `NNNN-title-with-dashes.md`
- New ADRs start as `proposed`, move to `accepted` or `rejected`
- Superseded ADRs link to their replacement
- ADRs are written to be self-contained — a coding agent should be able to read one and implement the decision without further context

## Consequences

- Good, because decisions are discoverable and version-controlled alongside the code
- Good, because new contributors (human or agent) can understand the "why" behind architecture choices
- Good, because the team builds a shared decision log that prevents relitigating settled questions
- Bad, because writing ADRs takes time — though a good ADR saves more time than it costs
- Neutral, because ADRs require periodic review to mark outdated decisions as deprecated or superseded

## Alternatives Considered

- No formal records: Continue making decisions in conversations and code comments. Rejected because context is lost and decisions get relitigated.
- Wiki or Notion pages: Capture decisions outside the repo. Rejected because they drift out of sync with the code and are not version-controlled.
- Lightweight RFCs: More heavyweight process with formal review cycles. Rejected as overkill for most decisions — ADRs can scale up to RFC-level detail when needed.

## More Information

- MADR: <https://adr.github.io/madr/>
- Michael Nygard, "Documenting Architecture Decisions": <https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions>

## Implementation Plan

- **Affected paths**: `docs/decisions/` (records and `README.md` index), `.claude/skills/adr-skill/` (vendored skill: `scripts/new_adr.js`, `scripts/set_adr_status.js`, templates, review checklist), `CLAUDE.md` (one pointer line per decision).
- **Dependencies**: none at runtime; the skill's scripts run on Node with no packages.
- **Patterns to follow**: `node .claude/skills/adr-skill/scripts/new_adr.js --title "<verb phrase>" --status proposed --update-index`; MADR template for decisions with several options, the simple template otherwise; one decision per record; status changes through `set_adr_status.js`; supersede instead of rewriting; `// ADR-NNNN` at the code entry point.
- **Patterns to avoid**: decision prose in `CLAUDE.md`; ADRs for routine implementation choices or bug fixes; editing an accepted record's decision text.

### Verification

- [x] `docs/decisions/README.md` lists every record with status and date.
- [x] Each record has Context, Decision, Consequences, an Implementation Plan and Verification checkboxes.
- [ ] New PRs that change a pattern or dependency add or update a record (reviewers check).

## More Information (project specifics, 2026-10-04)

Written with `skillrecordings/adr-skill` (project copy in `.claude/skills/adr-skill`). Records 0002–0014 were reconstructed from `CLAUDE.md` "Decisions taken", the fork's merged PRs (#3–#11), the specs under `docs/superpowers/` and the 2026-10-04 foundation session; 0015 records this tooling choice. Upstream's own design records (May 2026, `docs/superpowers/specs/2026-05-*`) are inherited, not fork decisions, and are listed in the index for orientation only.

Note, 2026-10-06 (copy on `fork/main`): this record was copied to the line-level product when the fork split into two lines ([ADR-0019](0019-keep-two-product-lines.md)). Its text is kept as written on `fork/overhaul`; references to ADR-0008–ADR-0014, ADR-0016–ADR-0018, the frontend overhaul, its shells and its Playwright e2e harness concern `fork/overhaul` only and have no file on this line (ADR-0016–ADR-0018 are on PR #15's branch until it merges into `fork/overhaul`).
