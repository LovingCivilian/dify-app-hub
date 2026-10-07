# Backend rework research and B1 execution records

Committed on the owner's instruction of 2026-10-07 ("commit everything"). These files were local research under `.superpowers/sdd/` (git-ignored); the charter (§6) and the B1 plan cite them by that path. This folder is the committed copy.

Brainstorm research (2026-10-07, input to the charter `docs/superpowers/specs/2026-10-07-backend-rework-charter.md`):

- `design-notes.md` — the approved brainstorm record.
- `dify-endpoint-map.md` — the research behind the committed endpoint map `docs/dify-service-api-1.17.1.md`.
- `frontend-consumer-map.md` — every frontend call into the backend, the shape each caller expects, the e2e specs per route.
- `reference-projects.md` — the survey of reference projects and library docs.

B1 execution (subagent-driven run of `docs/superpowers/plans/2026-10-07-backend-b1-dify-layer.md`):

- `b1-execution/ledger.md` — the run's ledger: every task's dispatches, reviews, fix rounds, the controller's rulings (each with its reason and what it costs if wrong), deferred minor findings and carries to later tasks. A snapshot; Task 18 refreshes it.
- `b1-execution/preflight-scan.md` — the pre-flight conflict scan of the plan and its findings.
- `b1-execution/doc-verification.md` — the controller's rulings checked against official docs and standards.
- `b1-execution/reference-check.md` — the architectural rulings compared with well-known projects on the same stack.
- `b1-execution/follow-ups.md` — what B1 leaves open after the final review and its fix wave, by area, one line each.
- `b1-execution/final-review-report.md` — the whole-branch review (most capable model): findings, the triage of every deferred item, the verdict.
- `b1-execution/rulings.md` — every ruling the controller made during the run, in order, each with its reason and its cost if wrong.
