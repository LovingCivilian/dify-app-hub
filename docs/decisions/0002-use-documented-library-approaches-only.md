---
status: accepted
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
---

# Use documented library approaches only, verified against current docs

## Context and Problem Statement

The fork is maintained by one person with coding agents doing most of the implementation. Agents reproduce whatever pattern they last saw, and training data lags behind library releases (Next 16, antd 6, Ant Design X 2, Playwright 1.6x all changed APIs recently). Custom mechanisms and workarounds were the main source of merge pain and rework in earlier sessions. The owner's standing instruction is: "documented, standard approaches only; check the library's current docs before using an API, even a familiar one; when a wanted behaviour has no documented way, say so instead of hacking around it."

## Decision

Every API use in fork-owned code follows the library's current documentation:

- Look up the API before writing it: Context7 (`npx ctx7@latest library …` then `docs …`, at most three commands per question), Next's bundled docs under `node_modules/next/dist/docs/`, the repo's vendored skills (`.claude/skills/antd`, `x-components`, …), crawl4ai (`.venv/bin/crwl <url> -o markdown`) for pages that need a browser.
- Prefer the documented default or recommendation (e.g. Playwright's `reuseExistingServer: !process.env.CI`, Next's `loading="eager"` over the deprecated `priority`).
- When a requirement has no documented path, record the gap and choose the smallest standard workaround, never a private API or a hack; implementers name the doc source for each non-trivial API decision in their reports, and reviewers check it.
- Deviations from a plan or spec are allowed when the docs contradict them; the doc wins and the deviation is recorded (commit body, ledger, or ADR).

Non-goals: this does not forbid custom code where no library covers the need (e.g. the e2e stub Dify API, layout CSS Modules built from antd tokens); it forbids custom mechanisms where a documented one exists.

## Consequences

- Good, because the code stays upgradeable and reviewable against a public reference, and reviewers can verify claims instead of trusting them.
- Good, because it caught real defects: the deprecated `priority` prop, `networkidle` waits, a Playwright server-ordering assumption, the `@ant-design/cssinjs` version mismatch ([ADR-0013](0013-pin-ant-design-cssinjs-to-antd-version.md)).
- Bad, because lookups cost time on every task (minutes per API) and occasionally the documented way is slower to implement than a shortcut.
- Follow-up: keep the vendored skills current when antd/X release (`npx -y @ant-design/cli setup --client claude --mode skill`, `npm pack @ant-design/x-skill@<version>`).

## Implementation Plan

- **Affected paths**: all fork-owned code; the rule is stated in `CLAUDE.md` ("How to work here") and `docs/frontend-conventions.md`.
- **Dependencies**: Context7 CLI (`npx ctx7@latest`), crawl4ai in `.venv` (per machine), the skills under `.claude/skills/`.
- **Patterns to follow**: cite the doc page in the commit body or report when an API choice is not obvious; when a reviewer finds an undocumented pattern, treat it as a finding.
- **Patterns to avoid**: private imports (`antd/es/...` internals), `!important`, timing sleeps in tests, "it worked in the old version" assumptions.

### Verification

- [x] `CLAUDE.md` and `docs/frontend-conventions.md` state the rule.
- [x] Task reports in the foundation PR cite doc sources per API decision (PR #12).
- [ ] Future PRs: reviewers list any undocumented mechanism as a finding.

## Alternatives Considered

- Trust training knowledge and fix on review: rejected; reviews found wrong-version APIs every time this was tried.
- Pin libraries and stop upgrading: rejected; the point of the overhaul is to track antd/X releases.

## More Information

Source: `CLAUDE.md` "How to work here" (PR #6, 2026-10-04); the owner's instruction repeated at the start of the 2026-10-04 execution session. Related: [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md), [ADR-0015](0015-record-decisions-as-adrs-and-session-handoffs.md).

2026-10-06 (sub-project 3): when the documentation covers only the basics, the architectural decision is also checked against two or three well-known, well-architected open-source projects on the same stack (Context7 indexes repositories; crawl4ai reads a page when the snippets are shallow), and the spec or ADR cites them beside the doc sources. Documented library behaviour still outranks a reference project's choice. First applied in [ADR-0020](0020-load-page-data-on-the-server.md).
