# Remove the legacy styling stack — implementation plan (frontend overhaul, sub-project 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the overhaul on pure antd: Tailwind, its PostCSS config, the shadcn/Radix leftovers, Lucide, the legacy aliases and global rules, and `lib/helpers/responsive.ts` are gone; antd's `reset.css` is the browser reset; `color-scheme` on `<html>` is the scheme marker.

**Architecture:** The order is chosen so the tree builds after every task: first the CSS swap (Task 1, while the Tailwind packages are still installed and unused), then the package and file removals (Task 2), then the marker (Task 3), then the whole-tree verification (Task 4) and the records (Task 5). No new dependency, no new mechanism: a Next global CSS import of `antd/dist/reset.css` in the root layout, one antd prop (`bordered={false}`), one inline style on `<html>` rendered from the existing theme cookies and toggled by the existing theme context.

**Tech Stack:** Next 16.3.4 (App Router, Turbopack), React 19, antd 6.6.5, Ant Design X 2.9, Playwright 1.63 (`pnpm test:e2e`, three projects), vitest 4, pnpm 11.5, oxlint/oxfmt.

**Spec:** `docs/superpowers/specs/2026-10-07-remove-legacy-styling-stack-design.md` (the authority; §2 owner decisions, §3 inventory, §4 design, §5 verification, §6 docs). Charter: `docs/superpowers/specs/2026-10-04-frontend-overhaul-charter.md` §5 row 4, §7.

## Global Constraints

- No visual redesign and no new hand styling (spec §1, §4.5). A visible difference is handled by the §4.5 policy only: a documented antd prop, or a token-free layout property in the component's own CSS Module, or accepted as the antd/X default. Anything else goes on the follow-up list, not into the code.
- Documented approaches only (ADR-0002): every API used here is named with its source in the spec §9; nothing is invented. No new packages.
- Frontend rules stay binding (`docs/frontend-conventions.md`, `.claude/rules/frontend.md`): CSS Modules with `var(--ant-*)` only, no hex/rgb literals, no magic pixel numbers, no `!important`, no Tailwind classes, no `.dark` selectors, no `--theme-*` or shadcn variable names anywhere in product code.
- `AGENTS.md` is not edited (it stays byte-identical to upstream). The charter is not edited. `.env` and `.env*.local` are never read or printed.
- Before each commit: `pnpm exec tsc --noEmit`, `pnpm exec oxlint <files>`, `pnpm exec oxfmt --check <files>`, `pnpm test`. lint-staged runs oxfmt/oxlint on commit; if it reformats, the reformatted file is what gets committed.
- Commits are conventional (`feat|fix|docs|chore(scope): …`), in English, and end with exactly these two trailer lines, verbatim (both lines, in this order, nothing else after them):

  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn
  ```

- e2e: `pnpm exec playwright test <spec> --project <name>` runs a subset (projects `desktop-light`, `desktop-dark`, `mobile-light`; the `setup` project runs first automatically). The suite boots its own `next dev` on 127.0.0.1:5301 and a throwaway MySQL on 3307; Next 16 allows one `next dev` per checkout, so no `pnpm dev` may be running. Never run the Docker image build and the e2e suite at the same time (this machine has ~5 GB RAM). `pnpm build` runs alone too.
- Browser evidence comes only from the Playwright suite and its screenshots (`e2e/screenshots/<name>-<project>.png`, git-ignored), never from the user's instance or a real Dify server.
- Never push, never open a PR, never merge: the controller handles the branch's end with the finishing skill.

## Review Focus

Inputs the spec implies but no existing test exercises; each line's test is pinned to the task that owns the code.

1. **A plain `<img>` inside our own CSS Module after the reset swap** (antd's reset renders images inline, Tailwind's rendered them block): the app card's icon must not gain a descender gap or shift the card's rows. Pinned by the before/after screenshot comparison in Task 1 step 7, and fixed there with `display: block` in the module if it shows.
2. **A visitor with the dark cookies gets the dark scheme in the first HTML**, not after hydration: no white canvas flash. Pinned in Task 3 by `e2e/ssr-first-paint.spec.ts` asserting `style="color-scheme:dark"` on `<html>` in the served HTML.
3. **An explicit light theme under an OS dark preference stays light** (Chrome's forced auto-darkening leaves a page alone only when it declares a scheme): the html style must say `light`, never be absent. Pinned in Task 3 by the new test "an explicit light theme keeps the light scheme under an OS dark preference" run in the `desktop-dark` project.
4. **Switching the theme from the header updates the browser scheme at runtime** (the toggle path through `applyScheme`): the html style flips with the antd algorithm. Pinned in Task 3 by one assertion added to the existing toggle test in `e2e/shell.spec.ts`.
5. **The production build without a PostCSS config still inlines antd's styles and compiles the CSS Modules**: the first HTML carries one `antd-cssinjs` style tag and the emitted CSS has no Tailwind marker. Pinned in Task 4 (`pnpm build` and the CSS grep) and by the Docker gate's curl at the end of the branch.

## File map

| Task | Creates | Modifies | Deletes |
| --- | --- | --- | --- |
| 1 | — | `app/layout.tsx` (import), `components/chat/chat-view/inputs-collapse.tsx` (one prop); possibly one CSS Module per §4.5 | `app/globals.css`, `e2e/theme-aliases.spec.ts` |
| 2 | — | `lib/helpers/index.ts`, `components/providers/app-providers.tsx`, `.oxfmtrc.json`, `.github/dependabot.yml`, `README.md`, `package.json` + `pnpm-lock.yaml` (via `pnpm remove`) | `components/ui/accordion.tsx`, `components/ui/button.tsx`, `components/ui/drawer.tsx`, `lib/utils.ts`, `components.json`, `postcss.config.mjs`, `lib/helpers/responsive.ts`, `types/emoji.d.ts` |
| 3 | — | `app/layout.tsx`, `lib/theme/theme-context.tsx`, `e2e/ssr-first-paint.spec.ts`, `e2e/chat-markdown.spec.ts`, `e2e/shell.spec.ts` | — |
| 4 | report only | only if a finding needs a fix | — |
| 5 | `docs/decisions/0021-finish-on-pure-antd-after-the-tailwind-removal.md` | `docs/decisions/0012-alias-legacy-theme-variables-to-antd-tokens.md` (status), `docs/decisions/README.md`, `CLAUDE.md`, `.claude/rules/frontend.md`, `docs/frontend-conventions.md`, `.cii-assessment.md` | — |

---

### Task 1: antd's reset replaces Tailwind; `globals.css` goes

**Files:**

- Modify: `app/layout.tsx:11` (the CSS import)
- Modify: `components/chat/chat-view/inputs-collapse.tsx:49-51` (the Collapse)
- Delete: `app/globals.css`, `e2e/theme-aliases.spec.ts`
- Possibly modify, only if step 7 shows the §4.5 image case: `components/apps/app-gallery.module.css` or the module the affected component uses

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: a tree with no `globals.css`; Task 2 may then remove the Tailwind packages without breaking the build. `app/layout.tsx` line 11 reads `import 'antd/dist/reset.css'` and Task 3 edits the same file below it.

- [ ] **Step 1: Take the "before" screenshots on the unchanged tree**

The screenshot spec writes `e2e/screenshots/<name>-<project>.png`. Run it on all three projects before touching anything, then move the set aside, outside the repository tree so nothing can commit it:

```bash
pnpm exec playwright test e2e/screenshots.spec.ts
mkdir -p /tmp/sdd-sub-project-4/screenshots-before
cp e2e/screenshots/*.png /tmp/sdd-sub-project-4/screenshots-before/
ls /tmp/sdd-sub-project-4/screenshots-before | wc -l
```

Expected: the run passes on `desktop-light`, `desktop-dark` and `mobile-light`; the copy holds every PNG the run produced (record the count in the report).

- [ ] **Step 2: Delete the spec that pins the alias block**

```bash
git rm e2e/theme-aliases.spec.ts
```

It exists to assert that `.text-theme-desc` resolves through the alias block (ADR-0012 verification). With the block gone it has nothing to test.

- [ ] **Step 3: Swap the global CSS import**

In `app/layout.tsx`, replace line 11:

```ts
import './globals.css'
```

with:

```ts
// antd's browser reset (box-sizing, body margin, heading, paragraph and list margins, form-control font inheritance)
// in place of Tailwind's Preflight (ADR-0021). No @layer wrapper: that is only needed with `StyleProvider layer`,
// which this app does not enable. Text colour, font and line height come from antd's <App> root (`.ant-app`).
import 'antd/dist/reset.css'
```

Then delete the file:

```bash
git rm app/globals.css
```

- [ ] **Step 4: Keep the chat's input-parameters panel borderless**

The deleted `.ant-collapse` override removed the panel's borders. In `components/chat/chat-view/inputs-collapse.tsx`, the Collapse at line 49 becomes:

```tsx
			<Collapse
				size="small"
				// The global `.ant-collapse` override that removed these borders is gone (sub-project 4); the documented
				// prop keeps the panel borderless.
				bordered={false}
				activeKey={panel.active}
				onChange={keys => setPanel({ key: conversationKey, active: keys })}
```

(`antd doc Collapse`: `bordered` "Toggles rendering of the border around the collapse block", default `true`.)

- [ ] **Step 5: Static checks**

```bash
pnpm exec tsc --noEmit
pnpm exec oxlint app/layout.tsx components/chat/chat-view/inputs-collapse.tsx
pnpm exec oxfmt --check app/layout.tsx components/chat/chat-view/inputs-collapse.tsx
pnpm test
```

Expected: all pass (vitest: 61 files, 589 tests; nothing in this task touches a unit-tested module).

- [ ] **Step 6: The e2e subset most exposed to the reset swap**

```bash
pnpm exec playwright test e2e/providers.spec.ts e2e/ssr-first-paint.spec.ts e2e/apps.spec.ts e2e/chat-markdown.spec.ts --project desktop-light --project desktop-dark
```

Expected: PASS. `providers.spec.ts` proves the `--ant-*` tokens still resolve; `ssr-first-paint.spec.ts` still asserts the body class (Task 3 changes that); `chat-markdown.spec.ts` renders the markdown fixtures that the reset's margins affect most.

- [ ] **Step 7: The "after" screenshots and the comparison**

```bash
pnpm exec playwright test e2e/screenshots.spec.ts
ls e2e/screenshots/*.png | wc -l
```

Expected: PASS, the same count as step 1. In the report, list every pair `/tmp/sdd-sub-project-4/screenshots-before/<file>` and `e2e/screenshots/<file>` and, for each page, state in one line what differs (expected per spec §4.5: markdown paragraph and list spacing in the chat screenshots; the chat input-parameters panel unchanged; native scrollbars where a region scrolls; nothing else). Look at the `apps-*.png` pair closely for the icon row of the cards (Review Focus 1). If the icon shows a gap or the card rows shifted, add to the icon's CSS Module class (the one applied to the `<img>`/`next/image` element in `components/apps/app-icon.tsx`; follow the module the file already imports):

```css
display: block;
```

and rerun this step. Any other difference is reported, not fixed: the controller decides against §4.5.

- [ ] **Step 8: Commit**

```bash
git add app/layout.tsx components/chat/chat-view/inputs-collapse.tsx
git status --short   # the two `git rm` deletions are already staged
git commit -m "feat(styles): antd's reset.css replaces Tailwind's Preflight; the legacy global CSS is deleted

app/globals.css (Tailwind imports, the ADR-0012 alias block and the legacy rules) is gone; app/layout.tsx imports
antd/dist/reset.css instead. The chat's input-parameters Collapse keeps its borderless look with bordered={false}
now that the global .ant-collapse override is gone. e2e/theme-aliases.spec.ts pinned the block and goes with it."
```

(plus the two trailer lines from Global Constraints; if step 7 changed a CSS Module, add it to the first `git add`).

---

### Task 2: Remove the packages, the dead files and the config

**Files:**

- Delete: `components/ui/accordion.tsx`, `components/ui/button.tsx`, `components/ui/drawer.tsx`, `lib/utils.ts`, `components.json`, `postcss.config.mjs`, `lib/helpers/responsive.ts`, `types/emoji.d.ts`
- Modify: `lib/helpers/index.ts:5`, `components/providers/app-providers.tsx:10,18`, `.oxfmtrc.json:3`, `.github/dependabot.yml:19-20`, `README.md:106`, `package.json` and `pnpm-lock.yaml` through `pnpm remove`

**Interfaces:**

- Consumes: Task 1's tree (no `globals.css`, so nothing imports Tailwind any more).
- Produces: `package.json` without the twelve packages; `lib/helpers` without `responsive`; no PostCSS config. Task 4 greps this tree.

- [ ] **Step 1: Delete the dead files**

```bash
git rm components/ui/accordion.tsx components/ui/button.tsx components/ui/drawer.tsx lib/utils.ts components.json postcss.config.mjs lib/helpers/responsive.ts types/emoji.d.ts
```

- [ ] **Step 2: Drop the `responsive` re-export and the provider's call**

`lib/helpers/index.ts`: remove the line `export * from './responsive'` (the file keeps its other five lines).

`components/providers/app-providers.tsx`: remove line 10 (`import { initResponsiveConfig } from '@/lib/helpers'`) and line 18 (`initResponsiveConfig()`), leaving the blank line structure tidy (one blank line between the import block and the `ServerSession` comment).

- [ ] **Step 3: Remove the packages**

```bash
pnpm remove @radix-ui/react-accordion @radix-ui/react-dialog @radix-ui/react-slot @toolkit-fe/where-am-i class-variance-authority clsx lucide-react tailwind-merge vaul tailwindcss @tailwindcss/postcss tw-animate-css
pnpm install --frozen-lockfile
```

Expected: `pnpm remove` edits `package.json` and `pnpm-lock.yaml` and prunes `node_modules`; the second command succeeds (lockfile and manifest agree). `ahooks` stays (the chat's `useLocalStorageState`). If `clsx` still appears in `pnpm-lock.yaml` as a transitive dependency, that is expected (spec §4.1).

- [ ] **Step 4: Config and README**

`.oxfmtrc.json`: delete line 3, `"experimentalTailwindcss": {},`.

`.github/dependabot.yml`: delete the two lines

```yaml
- dependency-name: 'tailwindcss'
  update-types: ['version-update:semver-major']
```

`README.md`: delete line 106, `- Tailwind CSS v4`.

- [ ] **Step 5: Static checks on the whole tree**

```bash
pnpm exec tsc --noEmit
pnpm exec oxlint lib/helpers/index.ts components/providers/app-providers.tsx
pnpm exec oxfmt --check .
pnpm test
```

Expected: all pass. `oxfmt --check .` runs on the whole tree because the removed `experimentalTailwindcss` option sorted class strings; with no Tailwind classes left it must report no file to format. `tsc` over the whole project also proves nothing imported the deleted files.

- [ ] **Step 6: The dev server and the CSS Modules without a PostCSS config**

```bash
pnpm exec playwright test e2e/providers.spec.ts e2e/apps.spec.ts e2e/shell.spec.ts --project desktop-light
```

Expected: PASS. `next dev` boots without `postcss.config.mjs`, the CSS Modules compile, the tokens resolve, the shell renders.

- [ ] **Step 7: The code-scoped grep (spec §5.4)**

```bash
git grep -I -n -i -e '--theme-' -e tailwind -e lucide -e radix -e clsx -e class-variance -e tw-animate -e vaul -e 'components/ui' -e 'lib/utils' -e 'helpers/responsive' -e where-am-i -- . ':!*.md' ':!pnpm-lock.yaml'
```

Expected: no output. If a line shows up, it is a consumer the inventory missed: report it (file and line) and, if it is one of the known kinds (a dead import, a config key), remove it in this task; otherwise leave it for the controller's ruling.

- [ ] **Step 8: Commit**

```bash
git add lib/helpers/index.ts components/providers/app-providers.tsx .oxfmtrc.json .github/dependabot.yml README.md package.json pnpm-lock.yaml
git status --short   # the eight `git rm` deletions are already staged; nothing else may be listed
git commit -m "chore(deps): remove Tailwind, the shadcn/Radix leftovers, Lucide and responsive.ts

Twelve packages leave package.json; components/ui, lib/utils.ts, components.json, postcss.config.mjs,
lib/helpers/responsive.ts (one module-level call in the provider stack, no other importer) and the orphan
types/emoji.d.ts are deleted; the oxfmt Tailwind option, the Dependabot ignore rule and the README line go with them.
AGENTS.md stays identical to upstream; CLAUDE.md records the override."
```

(plus the two trailer lines.)

---

### Task 3: `color-scheme` on `<html>` replaces the dark body class

**Files:**

- Modify: `app/layout.tsx:23-29`, `lib/theme/theme-context.tsx:28-29,66-70`
- Test: `e2e/ssr-first-paint.spec.ts:17,36-37,57` and a new test; `e2e/chat-markdown.spec.ts:55-56`; `e2e/shell.spec.ts:42-44`

**Interfaces:**

- Consumes: `readThemeCookies` and `ThemeEnum` as `app/layout.tsx` already imports them; `applyScheme` in the theme context.
- Produces: the DOM contract the e2e suite asserts from now on: `<html style="color-scheme:dark">` or `…:light` in the served HTML; the computed `color-scheme` of `html` after hydration and after a toggle.

- [ ] **Step 1: Write the failing assertions**

`e2e/ssr-first-paint.spec.ts`:

Line 17, `expect(html).toContain('class="antialiased dark"')`, becomes:

```ts
// The scheme marker is the browser's own color-scheme on <html> (ADR-0021), rendered from the cookies, so the canvas
// behind the shell, native controls and scrollbars are dark before hydration. React serialises the style object as
// `color-scheme:dark`.
expect(html).toMatch(/<html[^>]*\bstyle="color-scheme:dark"/)
```

Lines 36–37 become:

```ts
expect(html).toMatch(/<html[^>]*\bstyle="color-scheme:light"/)
expect(html).not.toMatch(/<html[^>]*color-scheme:dark/)
```

Line 57, `await expect(page.locator('body')).toHaveClass(/\bdark\b/)`, becomes:

```ts
await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
```

Add this test after the `junk theme cookies` test (before the `legacy localStorage theme entries` describe):

```ts
// The light value is written out, not left implicit: a browser that auto-darkens pages (Chrome's forced dark mode)
// leaves a page alone only when the page declares its scheme. Meaningful in the desktop-dark project, whose
// colorScheme emulation says the OS prefers dark.
test('an explicit light theme keeps the light scheme under an OS dark preference', async ({
	page,
}) => {
	await page.context().addCookies([
		{ name: 'theme-mode', value: 'light', url: baseURL },
		{ name: 'theme', value: 'light', url: baseURL },
	])
	await page.goto('/apps')
	await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
	await expect(page.locator('.ant-app').first()).toHaveCSS('--ant-color-bg-layout', '#f5f5f5')
})
```

`e2e/chat-markdown.spec.ts` lines 55–56 become:

```ts
if (testInfo.project.use.colorScheme === 'dark')
	await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
```

`e2e/shell.spec.ts`: after line 44 (`await expect.poll(shellBackground).toBe('rgb(0, 0, 0)')`) add:

```ts
// The browser's scheme follows the antd algorithm (ADR-0021): the html style flips with the toggle.
await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
```

- [ ] **Step 2: Run them to see them fail**

```bash
pnpm exec playwright test e2e/ssr-first-paint.spec.ts --project desktop-light
```

Expected: FAIL on "the first HTML carries the dark scheme…" (no `style="color-scheme:dark"`), "junk theme cookies…" (no `color-scheme:light`), "an explicit light theme…" (computed `color-scheme` is `normal`), and the legacy-localStorage case (timeout waiting for `dark`). The other tests in the file pass.

- [ ] **Step 3: Render the marker on the server**

In `app/layout.tsx`, replace line 23 and the `<html>`/`<body>` opening (lines 23–29):

```tsx
	// The browser's scheme for the canvas behind the shell, native controls and scrollbars (CSS color-scheme, ADR-0021);
	// antd's dark algorithm is applied by ThemeContextProvider. Rendered from the cookie so the first paint matches,
	// toggled in lib/theme/theme-context.tsx. `light` is explicit so browsers that auto-darken pages leave it alone.
	const colorScheme = initialTheme.resolved === ThemeEnum.DARK ? 'dark' : 'light'
	return (
		<html
			lang={initialLanguage}
			suppressHydrationWarning
			style={{ colorScheme }}
		>
			<body>
```

(`bodyClass` is gone; the body has no `className`.)

- [ ] **Step 4: Toggle it on the client**

In `lib/theme/theme-context.tsx`, delete lines 28–29:

```ts
/** Class the dark scheme puts on <body>; app/layout.tsx renders it on the server from the cookie. */
export const DARK_CLASS_NAME = 'dark'
```

and change `applyScheme` (lines 66–70) to:

```ts
const applyScheme = useCallback((dark: boolean) => {
	setThemeState(dark ? ThemeEnum.DARK : ThemeEnum.LIGHT)
	// The browser's scheme (canvas, native controls, scrollbars); app/layout.tsx renders it on the server from the cookie.
	document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}, [])
```

- [ ] **Step 5: Run the specs to see them pass**

```bash
pnpm exec playwright test e2e/ssr-first-paint.spec.ts e2e/shell.spec.ts --project desktop-light --project desktop-dark --project mobile-light
pnpm exec playwright test e2e/chat-markdown.spec.ts --project desktop-dark
```

Expected: PASS everywhere. The hydration test in `ssr-first-paint.spec.ts` ("a hard load with the cookie hydrates without a mismatch") must still report no hydration error: the server and the client compute the same value from the same cookie.

- [ ] **Step 6: Static checks**

```bash
pnpm exec tsc --noEmit
pnpm exec oxlint app/layout.tsx lib/theme/theme-context.tsx e2e/ssr-first-paint.spec.ts e2e/chat-markdown.spec.ts e2e/shell.spec.ts
pnpm exec oxfmt --check app/layout.tsx lib/theme/theme-context.tsx e2e/ssr-first-paint.spec.ts e2e/chat-markdown.spec.ts e2e/shell.spec.ts
pnpm test
git grep -n "DARK_CLASS_NAME\|antialiased" -- . ':!*.md'
```

Expected: checks pass; the grep prints nothing.

- [ ] **Step 7: Commit**

```bash
git add app/layout.tsx lib/theme/theme-context.tsx e2e/ssr-first-paint.spec.ts e2e/chat-markdown.spec.ts e2e/shell.spec.ts
git commit -m "feat(theme): color-scheme on <html> replaces the Tailwind dark body class

The root layout renders style=\"color-scheme: dark|light\" from the theme cookies and the theme context sets
document.documentElement.style.colorScheme where it toggled body.dark; the body has no class any more
(antialiased was a Tailwind utility). The canvas, native controls and scrollbars now follow the scheme,
which closes the ADR-0012 white-canvas limit. The e2e probes assert the html style; a new case checks that
an explicit light theme stays light under an OS dark preference."
```

(plus the two trailer lines.)

---

### Task 4: Build, grep, lint and the full suite

**Files:**

- Report only. A fix for a finding is committed in this task with its own message; otherwise nothing is committed.

**Interfaces:**

- Consumes: the tree after Task 3.
- Produces: the numbers Task 5 writes into the conventions doc and the assessment (lint findings, test counts) and the proof the ADR's confirmation section cites.

- [ ] **Step 1: Production build without a PostCSS config**

Nothing else may be running (no `pnpm dev`, no e2e, no Docker build).

```bash
pnpm build 2>&1 | tail -40
```

Expected: the build succeeds; the route table prints; no warning mentions PostCSS or Tailwind. `/init` still shows as dynamic (its `force-dynamic` export is untouched).

- [ ] **Step 2: No Tailwind, no legacy variables in the emitted CSS**

```bash
grep -rl -e 'tailwindcss' -e '--tw-' -e '--theme-' .next/static/ | wc -l
ls .next/static/css/*.css 2>/dev/null | head; find .next/static -name '*.css' | head
```

Expected: `0`. The second line is for the report (which CSS files exist); if the first command prints a file, open it and name the first matching line in the report.

- [ ] **Step 3: The code-scoped grep, repeated on the final tree**

```bash
git grep -I -n -i -e '--theme-' -e tailwind -e lucide -e radix -e clsx -e class-variance -e tw-animate -e vaul -e 'components/ui' -e 'lib/utils' -e 'helpers/responsive' -e where-am-i -e 'DARK_CLASS_NAME' -e antialiased -- . ':!*.md' ':!pnpm-lock.yaml'
```

Expected: no output.

- [ ] **Step 4: antd lint stays at zero**

```bash
npx -y @ant-design/cli lint ./ 2>&1 | tail -15
```

Expected: `0` findings. Record the "files scanned" figure for Task 5.

- [ ] **Step 5: The full e2e suite**

```bash
pnpm test:e2e 2>&1 | tail -30
```

Expected: PASS on `desktop-light`, `desktop-dark` and `mobile-light` (record the totals per project). A failure is a finding: name the spec and the assertion in the report; if the cause is a leftover from Tasks 1–3 that the §4.5 policy or the spec already decides (a module class, a probe), fix it here, commit as `fix(…)`, and rerun the affected spec on all three projects; otherwise stop and report.

- [ ] **Step 6: Test counts for the records**

```bash
pnpm test 2>&1 | grep -E "Test Files|Tests"
ls e2e/*.spec.ts | wc -l
```

Expected: vitest unchanged (61 files, 589 tests); 23 e2e spec files (24 minus `theme-aliases`).

- [ ] **Step 7: Report**

Write the figures from steps 1–6 into the task report (build time, CSS files, lint scan size, per-project e2e totals, unit counts) and whether anything was committed. No commit when nothing changed.

---

### Task 5: ADR-0021, ADR-0012 superseded, CLAUDE.md, rules, conventions, assessment

**Files:**

- Create: `docs/decisions/0021-finish-on-pure-antd-after-the-tailwind-removal.md` (through the ADR script)
- Modify: `docs/decisions/0012-alias-legacy-theme-variables-to-antd-tokens.md` (status line), `docs/decisions/README.md` (rows 0012 and 0021), `CLAUDE.md`, `.claude/rules/frontend.md`, `docs/frontend-conventions.md`, `.cii-assessment.md`

**Interfaces:**

- Consumes: Task 4's figures (lint scan size, e2e totals, unit counts).
- Produces: the records the next session reads first.

- [ ] **Step 1: Create the ADR with the script and fill it**

```bash
node .claude/skills/adr-skill/scripts/new_adr.js --title "Finish on pure antd after the Tailwind removal" --dir docs/decisions --template madr --status accepted
```

Expected: it prints the created path, `docs/decisions/0021-finish-on-pure-antd-after-the-tailwind-removal.md` (the script slugs the title; if the path differs, use the printed one everywhere below). Replace the generated body with this content (keep the front matter the script wrote, with `status: accepted`, `date: 2026-10-07`, `decision-makers: LovingCivilian (fork owner)`, `consulted: Claude Code session (sub-project 4)`). In its Confirmation list, tick only what Task 4's report confirms; the Docker line stays unticked (the controller runs it at the end of the branch):

```markdown
# Finish on pure antd after the Tailwind removal

## Context and Problem Statement

Sub-projects 0–3 rebuilt every page on antd 6 and Ant Design X 2 (ADR-0008). What remained of the original stack was unused: three shadcn primitives in `components/ui/` with no importer, `lib/utils.ts`, the Tailwind and `tw-animate-css` imports with their PostCSS config, the ADR-0012 alias block and the legacy global rules in `app/globals.css`, `lib/helpers/responsive.ts` with one module-level call, and twelve packages. Two things were not dead, though: `@import 'tailwindcss'` also supplied the browser reset (Preflight), and the `dark` class on `<body>`, rendered from the theme cookies, was the probe two e2e specs used for "the dark scheme is applied". How should the stack be removed so the pages keep a sane baseline and the browser knows the scheme?

## Decision Drivers

- One styling system, nothing hand-styled per mode (charter §4.3 rules 7–8); no literals, no `!important`.
- Documented approaches only (ADR-0002), no new dependency.
- No intended visual change; the sub-project is a cleanup.
- A dark-mode visitor should not see a white canvas or light native controls (ADR-0012's recorded limit).

## Considered Options

- Browser reset: antd's `antd/dist/reset.css`; no reset at all (antd's `App` root styles plus each component's own reset); a third-party reset such as modern-normalize.
- Scheme marker: `color-scheme` on `<html>` rendered from the cookies and toggled by the theme context; no marker (probes read a token); keep `dark` on the body as an inert marker.
- Fallout: pure cleanup (native scrollbars, one documented prop where a deleted rule shaped a component, antd/X defaults elsewhere); thin token-coloured scrollbars now; antd's bordered Collapse in the chat.

## Decision Outcome

Chosen: antd's `reset.css`, `color-scheme` on `<html>`, pure cleanup (owner decisions in brainstorming, 2026-10-07).

1. `app/layout.tsx` imports `antd/dist/reset.css` (Next: global CSS in the root layout; CSS from `node_modules` may be imported anywhere). No `@layer` wrapper, because the app does not enable `StyleProvider layer`, the only case antd's docs attach the layer advice to. `app/globals.css` is deleted; nothing remained in it. Text colour, font family, font size and line height keep coming from antd's `App` root style (`.ant-app`).
2. The root layout renders `<html style={{ colorScheme }}>` with `dark` or `light` from `readThemeCookies` (ADR-0016); `lib/theme/theme-context.tsx` sets `document.documentElement.style.colorScheme` where it toggled the body class. Both values are explicit so browsers that auto-darken pages leave the light theme alone. antd's dark algorithm is applied as before; the marker only tells the browser which scheme to use for the canvas, native form controls and scrollbars. This is the DOM state next-themes produces (`style="color-scheme: dark"` on `documentElement`); its `data-theme` attribute is not copied because no CSS keys on the theme by hand.
3. Fallout policy: the deleted `.ant-collapse` override is replaced by `bordered={false}` on the chat's input-parameters Collapse; the scrollbar rules are gone (native scrollbars, dark under `color-scheme: dark`); markdown output follows the X markdown theme and the reset; a plain element inside a CSS Module that the reset changed gets a token-free layout property in that module.
4. Removed: `components/ui/`, `lib/utils.ts`, `components.json`, `postcss.config.mjs`, `lib/helpers/responsive.ts`, `types/emoji.d.ts`, `e2e/theme-aliases.spec.ts`; packages `@radix-ui/react-accordion`, `@radix-ui/react-dialog`, `@radix-ui/react-slot`, `@toolkit-fe/where-am-i`, `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`, `vaul`, `tailwindcss`, `@tailwindcss/postcss`, `tw-animate-css`; the oxfmt Tailwind option and the Dependabot ignore rule. `ahooks` stays (the chat uses it). `AGENTS.md` keeps upstream's Tailwind paragraph; `CLAUDE.md` says it does not apply on this line.

### Consequences

- Good, because the charter's §7 end state holds: no Tailwind, Lucide, Radix, hand-written theme variables or hex colours remain; the code-scoped grep is empty and the built CSS carries no Tailwind marker.
- Good, because the browser now knows the scheme: the canvas behind the shell, native controls and scrollbars are dark in dark mode (ADR-0012's "white canvas" limit is closed), and the first HTML carries it.
- Good, because the reset is antd's own, so plain elements in markdown output get the margins antd's components assume.
- Bad, because scrollbars are native now; token-coloured thin scrollbars (`scrollbar-width`, `scrollbar-color` on `.ant-app`) are a cosmetic-sweep candidate.
- Bad, because `AGENTS.md` still names Tailwind; the override lives in `CLAUDE.md` so upstream's file stays identical.
- Neutral, because without a PostCSS config Turbopack compiles CSS natively; prefixing follows the browserslist defaults (verified by `pnpm build` and the suite, not assumed).

## Implementation Plan

- **Affected paths**: `app/layout.tsx`, `lib/theme/theme-context.tsx`, `components/chat/chat-view/inputs-collapse.tsx`, `components/providers/app-providers.tsx`, `lib/helpers/index.ts`, `package.json`, `.oxfmtrc.json`, `.github/dependabot.yml`, `README.md`; deletions as listed above; e2e probes in `e2e/ssr-first-paint.spec.ts`, `e2e/chat-markdown.spec.ts`, `e2e/shell.spec.ts`.
- **Dependencies**: twelve removed, none added.
- **Patterns to follow**: global CSS is the one antd reset import in the root layout; a global rule needs a new file and a reason; the scheme is `color-scheme` on `<html>` (server from the cookie, client in `applyScheme`); component looks come from antd props and token-only CSS Modules.
- **Patterns to avoid**: a `globals.css` that accumulates rules; `.dark` selectors or a body class for the theme; `--theme-*`/shadcn names; utility-class frameworks; a second reset.
- **Configuration**: no PostCSS config; `.oxfmtrc.json` without `experimentalTailwindcss`.

### Confirmation

- [x] `e2e/ssr-first-paint.spec.ts`: the served HTML carries `style="color-scheme:dark"` under the dark cookies and `style="color-scheme:light"` without; an explicit light theme stays light in the `desktop-dark` project; the legacy-localStorage migration ends with a dark html style. `e2e/shell.spec.ts`: the header toggle flips the html style. `e2e/chat-markdown.spec.ts` waits for it in the dark project.
- [x] `pnpm build` succeeds without a PostCSS config; no `tailwindcss`, `--tw-` or `--theme-` in `.next/static`.
- [x] `git grep -I -n -i -e '--theme-' -e tailwind -e lucide -e radix -e clsx -e class-variance -e tw-animate -e vaul -e 'components/ui' -e 'lib/utils' -e 'helpers/responsive' -e where-am-i -- . ':!*.md' ':!pnpm-lock.yaml'` prints nothing.
- [x] Full e2e suite green on the three projects; `npx -y @ant-design/cli lint ./` at zero findings; screenshots of every page in both schemes reviewed against the pre-change set.
- [ ] Docker image rebuilt from the branch; `/api/health` 200, `/apps` signed out 307 → `/login?callbackUrl=%2Fapps`, `/api/client/apps` 401, `antd-cssinjs` style count 1 on `/login`.

## Pros and Cons of the Options

### antd's `reset.css`

- Good, because antd provides it for this purpose and documents its relation to the component styles.
- Bad, because it is opinionated (heading, paragraph and list margins); those are the margins antd's own components assume, so the trade is right.

### No reset

- Good, because less CSS.
- Bad, because plain elements in markdown output fall back to raw browser defaults.

### `color-scheme` on `<html>`

- Good, because standard CSS, one mechanism for server and client, and the reference project's own end state.
- Bad, because native controls and scrollbars change look between schemes, which is the point.

### No marker

- Good, because nothing to maintain.
- Bad, because the dark shell sits on a white canvas with light scrollbars.

## More Information

Sources: antd 6.6.5 docs `docs/react/compatible-style.en-US.md` (`reset.css`; `@layer` only with `StyleProvider layer`), the `App` component page ("provide reset styles based on `.ant-app`"), `node_modules/antd/dist/reset.css`, `node_modules/antd/es/app/style/index.js`, `antd doc Collapse` (`bordered`). Next 16.3.4 bundled docs: `01-app/01-getting-started/11-css.md` (global CSS in the root layout; importing CSS from `node_modules`), `01-app/03-api-reference/08-turbopack.md` (PostCSS processed when a config exists), `01-app/03-api-reference/04-functions/generate-viewport.md` (`colorScheme` meta, considered: it would still need the client-side style for toggling). MDN `color-scheme`. Reference project (ADR-0002 note): next-themes, README and `_autodocs/api-reference/script.md` (`data-theme` plus `style="color-scheme: dark"` on `documentElement`). Playwright `toHaveCSS`.

Related: spec `docs/superpowers/specs/2026-10-07-remove-legacy-styling-stack-design.md`, plan `docs/superpowers/plans/2026-10-07-remove-legacy-styling-stack.md`, charter §5 row 4 and §7, [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md), [ADR-0012](0012-alias-legacy-theme-variables-to-antd-tokens.md) (superseded by this record), [ADR-0016](0016-store-the-theme-preference-in-cookies.md).
```

- [ ] **Step 2: Supersede ADR-0012 and update the index**

```bash
node .claude/skills/adr-skill/scripts/set_adr_status.js docs/decisions/0012-alias-legacy-theme-variables-to-antd-tokens.md --status "superseded by [ADR-0021](0021-finish-on-pure-antd-after-the-tailwind-removal.md)"
```

Expected: the front matter's `status:` line now reads `superseded by [ADR-0021](0021-finish-on-pure-antd-after-the-tailwind-removal.md)` (the format ADR-0003 and ADR-0007 use). Then in ADR-0012's Confirmation list, tick the last item and point at the successor:

```markdown
- [x] Sub-project 4 removed the block and its consumers (2026-10-07, [ADR-0021](0021-finish-on-pure-antd-after-the-tailwind-removal.md)); `git grep -- "--theme-"` over the code is empty.
```

`docs/decisions/README.md`: change row 0012's status cell to `superseded by [ADR-0021](0021-finish-on-pure-antd-after-the-tailwind-removal.md)` and append after row 0020:

```markdown
| [0021](0021-finish-on-pure-antd-after-the-tailwind-removal.md) | Finish on pure antd after the Tailwind removal: antd's reset, `color-scheme` on `<html>`, pure cleanup | accepted | 2026-10-07 |
```

- [ ] **Step 3: CLAUDE.md**

Edit these lines (find each by its leading text; keep the file under 200 lines):

The ADR-0008 line: replace `sub-projects 0–4 (0 to 3 done)` with `sub-projects 0–4 (all done 2026-10-07)`.

The ADR-0012 line becomes:

```markdown
- ADR-0012 (superseded by ADR-0021) Legacy `--theme-*`/shadcn variables were aliased to `--ant-*` tokens on `.ant-app` until sub-project 4 removed the block.
```

After the ADR-0020 line add:

```markdown
- ADR-0021 Pure antd after sub-project 4: `antd/dist/reset.css` is the only global CSS (imported in `app/layout.tsx`, no `globals.css`); the scheme marker is `color-scheme` on `<html>` (server from the theme cookies, client in `lib/theme/theme-context.tsx`); Tailwind, PostCSS, Radix/shadcn, Lucide and `responsive.ts` are gone, and `AGENTS.md`'s "Tailwind CSS v4" paragraph does not apply on this line.
```

In the "Structure after sub-project 2" bullet under "Where things are", the bullet ends with the sentence

```markdown
`app/globals.css` holds the alias block.
```

Replace that sentence with:

```markdown
the only global CSS is antd's reset, imported in `app/layout.tsx` (ADR-0021).
```

Replace the whole "Next frontend step:" bullet with:

```markdown
- Next frontend step: the owner's cosmetic sweep (candidates collected in the sub-project 4 handoff: token-coloured scrollbars, the chat Collapse look, markdown spacing), then the backend rework (see "Open follow-ups"). Sub-project 4 (removal of the legacy styling stack): spec `docs/superpowers/specs/2026-10-07-remove-legacy-styling-stack-design.md`, plan `docs/superpowers/plans/2026-10-07-remove-legacy-styling-stack.md`. Sub-project 3 (app list, admin, auth): spec `docs/superpowers/specs/2026-10-06-admin-apps-auth-on-antd-design.md`, plan `docs/superpowers/plans/2026-10-06-admin-apps-auth-on-antd.md`. Sub-project 2 (chat): spec `docs/superpowers/specs/2026-10-04-chat-on-ant-design-x-design.md` (its deviations paragraph at the end), plan `docs/superpowers/plans/2026-10-04-chat-on-ant-design-x.md`. Research already recorded in the charter (do not redo): antd 6 exposes tokens as `--ant-*` CSS variables on `<App>`'s root; the X site ships `@ant-design/x-skill`; antd serves every docs page as Markdown (`https://ant.design/components/<name>.md`); ProComponents does not support antd 6; `antd-style` is not used.
```

In "Open follow-ups", the "Frontend:" bullet starts with

```markdown
- Frontend: two `@ant-design/icons` majors in the tree; chat:
```

Change that start to

```markdown
- Frontend: two `@ant-design/icons` majors in the tree; `components/chat/**` was not audited for the Flex-spacing trap (ADR-0020); chat:
```

and keep the rest of the bullet.

Then check:

```bash
wc -l CLAUDE.md
grep -n "globals.css\|alias block" CLAUDE.md
```

Expected: under 200 lines; the grep shows only the ADR-0012 and ADR-0021 lines and the sub-project 4 spec pointer.

- [ ] **Step 4: `.claude/rules/frontend.md`**

In the "Governing ADRs" bullet, replace `0012 legacy variable aliases on `.ant-app`(never use`--theme-\*`/shadcn classes in new code or inside overlays);` with:

```markdown
0021 the only global CSS is `antd/dist/reset.css` imported in `app/layout.tsx` (no `globals.css`; a new global rule needs a file and a reason), the scheme marker is `color-scheme` on `<html>` (never a `.dark` selector, a body class, `--theme-*` or shadcn variable names);
```

- [ ] **Step 5: `docs/frontend-conventions.md`**

Under "## Status", replace the final "Next:" bullet with these two bullets (fill the figures from Task 4's report):

```markdown
- Sub-project 4 (removal of the legacy styling stack): done (spec `docs/superpowers/specs/2026-10-07-remove-legacy-styling-stack-design.md`, plan `docs/superpowers/plans/2026-10-07-remove-legacy-styling-stack.md`; ADR-0021, ADR-0012 superseded). Tailwind, its PostCSS config and `tw-animate-css`, `components.json`, `components/ui/`, `lib/utils.ts`, Radix, `class-variance-authority`, `clsx`, `tailwind-merge`, `vaul`, Lucide, `lib/helpers/responsive.ts`, the orphan `types/emoji.d.ts` and `@toolkit-fe/where-am-i`, and `app/globals.css` with the ADR-0012 alias block are gone. `app/layout.tsx` imports `antd/dist/reset.css` as the only global CSS; `<html>` carries `color-scheme` from the theme cookies and the theme context toggles it; the chat's input-parameters Collapse keeps its borderless look with `bordered={false}`; scrollbars are native. e2e: `theme-aliases.spec.ts` deleted, the scheme probes moved to the html style, one new case for an explicit light theme under an OS dark preference. Lint re-check (2026-10-07, `npx -y @ant-design/cli lint ./`): <files> files scanned, 0 findings.
- Next: the owner's cosmetic sweep (candidates: token-coloured thin scrollbars on `.ant-app`, the chat Collapse look, markdown spacing), then the backend rework (`docs/superpowers/specs/2026-10-05-backend-rework-brief.md`).
```

The earlier Status bullets stay as they are: they are the history, and the sub-project 1 sentence about the aliases is dated by the bullet it sits in.

- [ ] **Step 6: `.cii-assessment.md`**

Row 19 stays unchanged. In row 20, replace `另有 24 个 Playwright 端到端测试文件` with `另有 23 个 Playwright 端到端测试文件`. Add a history row above the `2026-10-06` row, same columns:

```markdown
| 2026-10-07 | v0.8.1 | 28/35 | #20 证据更新：端到端测试文件 24 → 23（`theme-aliases.spec.ts` 随别名块一起删除，新增显式浅色主题用例并入 `ssr-first-paint.spec.ts`）；仍为 ❌ |
```

- [ ] **Step 7: Checks and commit**

```bash
pnpm exec oxfmt --check docs/decisions/0021-finish-on-pure-antd-after-the-tailwind-removal.md docs/decisions/0012-alias-legacy-theme-variables-to-antd-tokens.md docs/decisions/README.md CLAUDE.md .claude/rules/frontend.md docs/frontend-conventions.md .cii-assessment.md
wc -l CLAUDE.md
git grep -n "ADR-0021" -- CLAUDE.md docs/decisions/README.md .claude/rules/frontend.md docs/frontend-conventions.md | wc -l
```

Expected: oxfmt clean (run `pnpm exec oxfmt <files>` first if it wants to reformat the tables); under 200 lines; the grep count is at least 5.

```bash
git add docs/decisions/0021-finish-on-pure-antd-after-the-tailwind-removal.md docs/decisions/0012-alias-legacy-theme-variables-to-antd-tokens.md docs/decisions/README.md CLAUDE.md .claude/rules/frontend.md docs/frontend-conventions.md .cii-assessment.md
git commit -m "docs(sub-project 4): ADR-0021 (pure antd after the Tailwind removal), ADR-0012 superseded, pointers and status

ADR-0021 records the reset, the color-scheme marker and the cleanup policy with their sources; ADR-0012 is
superseded; CLAUDE.md, the frontend rules, the conventions status and the assessment describe the final state."
```

(plus the two trailer lines.)

---

## After the last task (controller, not a task)

Final whole-branch review on the most capable model, one fix wave if needed, then `superpowers:finishing-a-development-branch`: Docker rebuild from HEAD with the e2e MySQL stopped first (`docker compose -f docker-compose.e2e.yml down`), the curl checks (ADR-0021's last confirmation box), the PR to `fork/overhaul` naming ADR-0021 and the spec and plan, and the handoff under `docs/superpowers/handoffs/`.
