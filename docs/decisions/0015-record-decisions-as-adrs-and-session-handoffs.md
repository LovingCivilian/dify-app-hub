---
status: accepted
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
---

# Record decisions as MADR ADRs and session state as handoff documents; keep CLAUDE.md to rules and pointers

## Context and Problem Statement

Until this session, the fork's decisions, status and the handoff for the next session all lived in `CLAUDE.md`. The owner called that "inefficient and following no standard". Anthropic's Claude Code docs keep `CLAUDE.md` under about 200 lines for standards, commands and pointers, with multi-step procedures in skills and part-specific rules in `.claude/rules/*.md`; there is no built-in handoff feature. The skills registry offers handoff and ADR skills; the owner rejected collection-hosted skills whose popularity comes from their parent repositories and chose on content.

## Decision

- Architecture decisions are MADR 4.0 records in `docs/decisions/` (numbered `NNNN-verb-phrase.md`, YAML front matter with status/date/decision-makers, index in `docs/decisions/README.md`), written with `skillrecordings/adr-skill` (vendored as a real copy in `.claude/skills/adr-skill`; also installed at user level). Lifecycle `proposed → accepted → deprecated / superseded by ADR-NNNN`; an accepted ADR is not edited except to add a status change or a dated "More Information" note. Code that implements a decision references it (`// ADR-NNNN`) at its entry point, and PR descriptions name the ADRs they implement.
- Session handoffs are documents under `docs/superpowers/handoffs/<date>-<topic>.md`, produced with the user-level `handoff` skill (`/handoff "<purpose>"`; it defaults to the OS temp dir, so the path is given explicitly). They reference specs, plans, ADRs and commits by path instead of duplicating them, and name the skills the next session should load.
- `CLAUDE.md` keeps the working rules, commands, structure pointers and open follow-ups; each decision gets one line pointing at its ADR. Frontend-specific rules move to `.claude/rules/frontend.md` scoped to `app/**` and `components/**`. Target: under 200 lines.
- Specs and plans stay under `docs/superpowers/` (superpowers workflow); ADRs record the decision and point at the spec or plan for the detail.

Non-goals: a memory server or database; migrating upstream's own May 2026 specs into ADRs (they are upstream's records and are listed as inherited in the index).

## Consequences

- Good, because a fresh session reads one handoff and a short `CLAUDE.md`, and the "why" of each decision has a standard, versioned home.
- Good, because the ADR skill's scripts (`new_adr.js`, `set_adr_status.js`) keep numbering and the index consistent.
- Bad, because every significant decision now costs an ADR, and retroactive records (0002–0014) were written from history rather than through the skill's interview; their "Verification" sections double as the audit of what still holds.
- Bad, because two skill copies exist (project `.claude/skills/adr-skill`, user `~/.agents/skills/adr-skill`); the project copy wins inside the repo and must be refreshed when the upstream skill changes.

## Implementation Plan

- **Affected paths**: `docs/decisions/**`, `.claude/skills/adr-skill/**`, `docs/superpowers/handoffs/**`, `CLAUDE.md` (pointers), `.claude/rules/frontend.md`.
- **Dependencies**: none at runtime; `npx skills add skillrecordings/adr-skill --copy -a claude-code` for the project copy, `npx skills add mattpocock/skills@handoff -g` for the user-level handoff skill.
- **Patterns to follow**: before architecture work, read `docs/decisions/README.md`; when a decision is made during execution (a ruling that changes a pattern, a new dependency, a reversed plan), write or update an ADR in the same PR; at session end, write the handoff.
- **Patterns to avoid**: decision prose in `CLAUDE.md`; status boards in `CLAUDE.md`; editing accepted ADRs' decision text (supersede instead).

### Verification

- [x] `docs/decisions/` bootstrapped with the index and ADR-0001 (this PR).
- [x] ADRs 0002–0015 cover `CLAUDE.md` "Decisions taken", the fork PR history and the foundation session's rulings.
- [ ] `CLAUDE.md` decisions replaced by pointers; `.claude/rules/frontend.md` added; `wc -l CLAUDE.md` < 200.
- [ ] Next session ends with a handoff under `docs/superpowers/handoffs/`.

## Alternatives Considered

- `addyosmani/agent-skills@documentation-and-adrs`, `wshobson/agents@architecture-decision-records`, `affaan-m/ecc@architecture-decision-records`: rejected on content (template-only or one-off writers; popularity from parent collections). `othmanadi/planning-with-files`: rejected (overlaps superpowers plans and the SDD ledger; hooks on every turn). `rohitg00/agentmemory`: rejected (needs a memory server).
- Keep everything in `CLAUDE.md`: rejected by the owner.

## More Information

Sources: Claude Code docs (`code.claude.com/docs/en/memory`, `sessions`), the skill comparison in the 2026-10-04 session, `docs/superpowers/handoffs/2026-10-04-frontend-foundation.md`. Related: [ADR-0002](0002-use-documented-library-approaches-only.md).
