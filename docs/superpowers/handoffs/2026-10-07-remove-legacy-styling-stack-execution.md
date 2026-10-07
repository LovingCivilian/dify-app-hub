# Handoff — sub-project 4 (removal of the legacy styling stack): executed, reviewed, merged as PR #24

Date: 2026-10-07 · Branch: `feat/remove-legacy-styling-stack` (from `fork/overhaul` @ 039c2356, the merge of PR #23; HEAD 2243a533; merged into `fork/overhaul` as PR #24, merge commit 392fc37c, on 2026-10-07; branch deleted locally and on origin) · Spec: `docs/superpowers/specs/2026-10-07-remove-legacy-styling-stack-design.md` (§10 = deviations during execution) · Plan: `docs/superpowers/plans/2026-10-07-remove-legacy-styling-stack.md` · Decision: ADR-0021 (`docs/decisions/0021-finish-on-pure-antd-after-the-tailwind-removal.md`), ADR-0012 superseded.

The user-level `handoff` skill is user-invocable only, so this document follows its instructions by hand: a compact summary, references instead of duplicated content, suggested skills, no secrets.

## What the next session is for

1. **Done on 2026-10-07 (owner's word "merge it"):** the branch was pushed, PR #24 opened against `fork/overhaul` with the template sections and merged with a merge commit (392fc37c), the branch deleted locally and on origin, the SDD workspace deleted; CLAUDE.md's latest-handoff line records the PR number. Nothing of the merge remains to do.
2. **The Docker gate** (CLAUDE.md "Docker stack") passed on 2026-10-07 from the merged head 392fc37c; the checks are in "State of the work" below, and `localhost:5300` serves the merged code for the owner's browser check. If it has to be rerun, stop the e2e MySQL first (`docker compose -f docker-compose.e2e.yml down`) and never run it beside `pnpm test:e2e` or `pnpm build`; a foreground build (not a background one) survived the memory reaper this time.
3. **Next stage: the owner's cosmetic sweep**, planned since sub-project 2, now with sub-project 4's candidates (below), then the backend rework (`docs/superpowers/specs/2026-10-05-backend-rework-brief.md`), last. Both start with brainstorming.

## State of the work

- The frontend overhaul (ADR-0008) is complete: sub-projects 0–4 done. The charter's §7 end state holds: no Tailwind, Lucide, Radix, hand-written theme variables or hex colours remain; the code-scoped grep of spec §5.4 is empty; the built CSS carries no Tailwind marker; full e2e green on three projects; `npx -y @ant-design/cli lint ./` at 0 findings (337 files).
- Commits on the branch (8 before this handoff): spec, plan, Task 1 (reset swap, `globals.css` and `theme-aliases.spec.ts` deleted), a docs amendment (Collapse ruling), Task 2 (twelve packages, eight files, config), Task 3 (`color-scheme` on `<html>`, probes moved), a docs amendment (`only light`), Task 5 (ADR-0021 and the records). Task 4 was verification only.
- Reviews: every task reviewed (two fix rounds in total: Task 1's Collapse prop reverted; Task 3's light value corrected to `only light`), the final whole-branch review on the most capable model: "Ready to merge: Yes (after the Docker gate)", no Critical or Important findings; its five Minor doc lines are fixed in this handoff's commit.
- Verification figures (Task 4, HEAD 22757e16, code identical to 63eb7ddd): `pnpm build` 35 s without a PostCSS config, 6 CSS chunks, no `tailwindcss`/`--tw-`/`--theme-`; e2e 412 tests, 394 passed, 18 skipped, 0 failed (desktop-light 130 + 7 skipped, desktop-dark 129 + 8, mobile-light 134 + 3); vitest 61 files / 589 tests; 23 e2e spec files.
- Docker gate: **passed on 2026-10-07** from the merged head 392fc37c (the first attempt, from HEAD 63eb7ddd, had been killed by Claude Code's memory reaper while the session was idle and was not restarted; the second ran in the foreground after the merge, with the e2e MySQL down and the old app container removed, and took 5.5 min). Checks: `/api/health` 200; `/apps` signed out 307 → `/login?callbackUrl=%2Fapps`; `/` 307 → `/login?callbackUrl=%2F`; `/init` 307 → `/login`; `/api/client/apps` 401; `antd-cssinjs` style count 1 on `/login`; the served `<html>` is `<html lang="en" style="color-scheme:only light">` without cookies and with junk cookies, `style="color-scheme:dark"` with `theme-mode=dark` and with `theme-mode=system; theme=dark`; `<body>` carries no class; the three CSS chunks linked from `/login` contain no `tailwind`, `--tw-` or `--theme-`, and the largest carries the reset. The app container on `localhost:5300` now runs the merged code.
- The SDD workspace `.superpowers/sdd/2026-10-07-remove-legacy-styling-stack/` (git-ignored; the ledger with every ruling, the five briefs and reports, the review packages) was deleted after the merge; the rulings survive in spec §10 and in "Rulings made by the controller" below. The "before" screenshots live in `/tmp/sdd-sub-project-4/screenshots-before/` on this machine only.

## Read first, in this order

1. `CLAUDE.md` (rules and pointers; the ADR-0021 line, the `AGENTS.md` override, "Next frontend step").
2. Spec §2 (owner decisions), §4.5 (fallout policy) and §10 (deviations: the Collapse premise, the `h3 !important` effect on Typography titles, `only light`, Chrome's `light only` serialisation).
3. ADR-0021 (the three choices with sources; Confirmation list) and `.claude/rules/frontend.md` (the 0021 clause).
4. For the cosmetic sweep: the candidates below and `docs/frontend-conventions.md` "Status" (sub-project 4 bullet) and "Next".

## Owner verification list (browser, real Dify server)

The suite covers these against the stub; a real server is still worth one pass:

- Light and dark theme on every page: the canvas behind the shell, native scrollbars and native form controls follow the scheme (dark scrollbars in dark mode; no white band when a page scrolls).
- On a phone with Chrome's Auto Dark Theme on: the light theme stays light (`only light`).
- Theme toggle in the header: scrollbars and controls flip with the antd colours; reload keeps the scheme from the first paint (no flash).
- Chat markdown answers: paragraph spacing, list indentation and headings now follow the X markdown theme plus antd's reset (Preflight is gone); check a long answer with lists, a table and code.
- The chat's "Conversation parameters" panel and the workflow logs: antd's default Collapse look, a 1 px divider under the header (was removed by a legacy override).
- Auth pages: the "Dify App Hub" title at antd's level-3 size (24 px, was 18 px under a legacy `!important` rule); the card scrolls on short viewports.

## Rulings made by the controller during execution (owner can undo any; each is in the ledger and spec §10)

1. T3's line references were pre-T1 — located by content. Costs nothing.
2. The chat's "Conversation parameters" Collapse takes antd's default look; `bordered={false}` reverted — the deleted override removed only the header/content divider of a bordered Collapse, which no documented prop reproduces; `bordered={false}` is antd's filled borderless variant. Costs a 1 px divider if the owner wanted it gone (cosmetic sweep).
3. The auth card's title grows from 18 px to antd's Title level 3 (24 px), no change — the deleted `h3 { font-size: 18px !important }` rule had been distorting every level-3 Typography title. Costs a cosmetic-sweep item if the owner prefers level 4 (20 px).
4. The workflow-log Collapse's header divider and the 1–3 px drawer row shifts are accepted as antd/reset defaults (§4.5). Costs nothing functional.
5. The `pnpm-workspace.yaml` build-approval key for `@tailwindcss/oxide` is a config key of the removed stack; its removal stands. Costs nothing.
6. Task 1's comment naming "Tailwind's Preflight" was reworded in Task 3 so the grep gate stays mechanical. Costs nothing.
7. `oxfmt --check .` reporting 46 pre-existing unformatted files (docs, `.claude/skills`, `packages/docs`; same count before and after) is out of scope — lint-staged formats staged files only. Costs nothing; the owner may want a repository-wide format some day.
8. `e2e/screenshots.spec.ts`'s capture helper also waited for the `dark` body class (missed by the inventory); moved to the html style in Task 3. Costs nothing.
9. The light theme renders `color-scheme: only light`, the dark theme `dark` — the spec's intent (auto-darkening browsers leave the light theme alone) is binding and MDN documents `only light` as the opt-out from Chrome's Auto Dark Theme; a bare `light` does not do that (my brainstorming text was wrong; the Task 3 review caught it). Costs a DOM-contract change recorded in spec §4.4/§10 and ADR-0021; nothing functional if wrong.
10. The computed-value assertions expect Chrome's serialisation `light only` while the source keeps MDN's `only light` (the grammar's `&&` allows either order). Costs nothing.
11. The five final-review doc lines were folded into this handoff's commit (docs only, no code). Costs nothing.

## Known limits and follow-ups (triaged by the final review; none blocks the merge)

- **Cosmetic-sweep candidates** (owner's list, after this sub-project): token-coloured thin scrollbars (`scrollbar-width`, `scrollbar-color` with `--ant-*` tokens on `.ant-app`; the document scrollbar on the auth surface stays native); the chat Collapses' look (default vs `ghost`); the auth title size (level 3 vs 4); markdown spacing preferences now that Preflight is gone.
- **Dev-log hydration message on the auth pages' `Input.Password`**: React reports `style="caret-color: transparent"` present on the client DOM only. Not caused by this branch (antd sets `caret-color` only in class rules; no auth file or antd version changed; no test fails). Baseline it on `fork/overhaul` with a console capture in `e2e/auth.spec.ts` like `ssr-first-paint.spec.ts`'s hydration test; if it reproduces there, record it under "Open follow-ups" rather than chasing it here. Also one Next dev `performance.measure` "negative time stamp" TypeError in the dev log (Next internal).
- **No e2e covers the chat's input-parameters panel**; its look is covered by the screenshot review only (spec §10).
- **`AGENTS.md`** still names Tailwind v4 (byte-identical to upstream by rule); CLAUDE.md's ADR-0021 line is the override.
- A second antd entry (6.4.3) sits in `node_modules/.pnpm` beside 6.6.5; `pnpm why antd` resolves one version (store leftover, not touched).
- From sub-project 3, still open: `components/chat/**` not audited for the Flex-spacing trap (ADR-0020); two `@ant-design/icons` majors; the Dify icon per card; the chat's app lookup on its server page; Arabic wording review.

## Facts verified this session (do not re-derive)

- antd 6.6.5 ships `antd/dist/reset.css` (246 lines; `html, body { height: 100% }`, `body { margin: 0 }`, heading/paragraph/list margins, `img { vertical-align: middle }`, one transparent tap-highlight literal); the `@layer` advice in `docs/react/compatible-style` applies only with `StyleProvider layer`, which this app does not enable (the first HTML contains no `@layer`). antd's `App` root style sets colour, font size, line height and font family on `.ant-app`. antd sets no `color-scheme` anywhere in `es/`.
- Turbopack processes PostCSS only when a config file exists (Next bundled docs, `08-turbopack.md`); without one the build compiles CSS natively and succeeded in 35 s. Next 16 dev output lives in `.next/dev`, so a production build and the e2e `next dev` do not collide.
- MDN `color-scheme`: `only` "forbids the user agent from overriding the color scheme"; `color-scheme: only light` turns off Chrome's Auto Dark Theme; grammar `normal | [ light | dark | <custom-ident> ]+ && only?`. Chrome serialises the computed value as `light only`. React serialises `style={{ colorScheme: 'only light' }}` as `style="color-scheme:only light"` and renders `lang` before `style` on `<html>`.
- next-themes ends in `document.documentElement.style = 'color-scheme: dark'` plus a `data-theme` attribute (its own tests); we took the style half only.
- The Task 1 before/after screenshots: `apps-*` byte-identical (no icon gap, no CSS Module change needed); the only differences are the ones in rulings 2–4.
- The `.ant-collapse` override and the `h3 !important` rule shaped antd components, not only legacy markup: a global rule's reach must be grepped against antd class names before a cleanup spec promises "no visual change".
- The ADR script's `new_adr.js` wrote `date: 2026-10-06` on 2026-10-07 (local clock vs. session date); check the date after creating an ADR.

## Suggested skills for the next session

- `superpowers:brainstorming` for the cosmetic sweep (bounded or architectural depends on its size; the scrollbar and Collapse items are bounded).
- `superpowers:finishing-a-development-branch` if the PR is still open.
- `/adr-skill` for the cosmetic sweep only if it changes a pattern (token scrollbars would be a conventions note, not an ADR).

## Lessons for the next plan

- A cleanup spec that promises "no visual change" must grep every deleted global rule against antd class names and plain elements first; the `.ant-collapse` and `h3` rules reached antd components, and the "one documented prop keeps the look" premise was wrong in detail.
- Verify every mechanism claim against the docs before writing it into a plan comment: the "explicit `light` opts out of auto-darkening" line was mine and wrong; the reviewer's MDN check caught it. The rule applies to the controller's prose as much as to the code.
- Take "before" screenshots on the unchanged tree before a styling task and compare file hashes first; it made the Task 1 review fast and exact.
- `review-package` refuses an amended commit range ("HEAD is not a descendant of BASE"); write the fix-round diff file by hand (`git diff -U10 OLD..NEW`) in that case.
- A verification-only task still gets a reviewer: decoding Playwright's HTML report (base64 zip, `report.json`) confirms per-project totals without re-running the suite.
