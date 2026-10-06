# Remove the legacy styling stack — design (frontend overhaul, sub-project 4)

Date: 2026-10-07. Branch `feat/remove-legacy-styling-stack` from `fork/overhaul` (039c2356, after PR #23). Charter: `docs/superpowers/specs/2026-10-04-frontend-overhaul-charter.md` (§5 row 4, §7). Governing decisions: ADR-0002 (documented approaches, reference projects), ADR-0008 (rebuild on antd), ADR-0011 (viewport-bound shells), ADR-0012 (the alias bridge this sub-project removes), ADR-0016 (theme cookies). This spec is the authority for the plan; the plan argues from it.

## 1. Goal and non-goals

**Goal.** Finish the overhaul on pure antd: delete Tailwind and its PostCSS config, the shadcn/Radix leftovers, Lucide, the legacy variable aliases and global rules in `app/globals.css`, and `lib/helpers/responsive.ts`; replace Tailwind's browser reset with antd's; replace Tailwind's dark-mode marker with the browser's `color-scheme`. Done means: the code-scoped `git grep` of §5.4 is empty, the built CSS carries no Tailwind, the full e2e suite is green, `antd lint` stays at zero, and `CLAUDE.md` and `docs/frontend-conventions.md` describe the final state.

**Non-goals.** No visual redesign and no new hand styling: where a deleted rule shaped a component, the look is kept with one documented prop or the antd/X default is accepted (§4.5); wishes that surface in the screenshots go to the cosmetic sweep the owner has planned after this sub-project. No chat logic, no backend, no `AGENTS.md` edit (it stays byte-identical to upstream), no charter edit (historical plan of record).

## 2. Owner decisions (brainstorming, 2026-10-07)

1. **Browser reset: antd's `antd/dist/reset.css`** rather than no reset. antd provides it for this purpose; the `@layer` advice in its docs applies only when `StyleProvider layer` is on, which this app does not use (the first HTML contains no `@layer`).
2. **Dark marker: `color-scheme` on `<html>`** rather than dropping the marker or keeping an inert `dark` class. Rendered on the server from the theme cookies, toggled on the client by the theme context; the e2e probes move to it.
3. **Pure cleanup.** Native scrollbars; the chat's "input parameters" Collapse gets `bordered={false}` to keep its borderless look; everything else takes the antd and Ant Design X defaults; screenshots of every page in both schemes are reviewed before the final review.
4. **Execution shape: one branch, one task per concern** (removals; reset and `globals.css`; marker and probes; Collapse; build and grep verification; ADR and docs), subagent-driven with a review per task.

Judgment calls recorded here so the plan does not re-open them: no lint guard against the removed packages (an import fails at install and type-check once they are gone; the grep is the charter's verification; a CSS variable name cannot be lint-guarded); `README.md`'s tech-stack list drops Tailwind; `app/globals.css` is deleted rather than kept empty; the orphans found by the inventory ride along (§3).

## 3. Inventory (verified on `fork/overhaul` 039c2356)

Product code is already clean: nothing under `app/`, `components/`, `hooks/`, `lib/` or `libs/` uses a Tailwind utility class, `lucide-react`, Radix, `cn()`, a `--theme-*` or shadcn variable, or `next-themes` (not installed). The remaining consumers of the legacy stack are:

| Consumer | What it holds | Importers |
| --- | --- | --- |
| `components/ui/accordion.tsx`, `button.tsx`, `drawer.tsx` | shadcn primitives on `@radix-ui/react-accordion`, `@radix-ui/react-slot`, `vaul`, `class-variance-authority`, `lucide-react` (`ChevronDownIcon`), Tailwind classes | none |
| `lib/utils.ts` | `cn()` = `twMerge(clsx(...))` | the three files above |
| `app/globals.css` (308 lines) | `@import 'tailwindcss'` and `'tw-animate-css'`, the `dark` custom variant, `@theme inline`, a universal border/outline rule, the ADR-0012 alias block on `.ant-app` (14 `--theme-*`, 19 shadcn names) and its `.bg-theme-*`/`.text-theme-*`/`.border-theme*` classes, an `.ant-collapse` override with `!important`, `hr`/`h3`/`body`/`a` rules, `.content`, scrollbar rules, `.dc-answer-form-button`, `.dc-react-markdown-container`, a stray `declare namespace JSX` block, `html.wide-screen` | `app/layout.tsx` |
| `postcss.config.mjs`, `components.json` | the Tailwind PostCSS plugin; the shadcn CLI config | build; nobody |
| `lib/helpers/responsive.ts` | `initResponsiveConfig` (ahooks `configResponsive`), `useIsMobile` (no importer), a Tailwind-shaped breakpoint type | `components/providers/app-providers.tsx` (one module-level call); `lib/helpers/index.ts` re-export |
| `app/layout.tsx`, `lib/theme/theme-context.tsx` | `<body class="antialiased dark">` from the cookies; `document.body.classList.toggle('dark')` | Tailwind's `dark:` variant (dead); the e2e probes below |
| `e2e/theme-aliases.spec.ts` | pins `.text-theme-desc` → antd `colorTextSecondary` through the alias block | — |
| `e2e/ssr-first-paint.spec.ts`, `e2e/chat-markdown.spec.ts` | assert the body `dark` class as the "dark scheme applied" probe | — |
| `.oxfmtrc.json`, `.github/dependabot.yml`, `README.md` | `experimentalTailwindcss`; a `tailwindcss` major-update ignore; "Tailwind CSS v4" in the tech-stack list | — |
| `package.json` | dependencies `@radix-ui/react-accordion`, `@radix-ui/react-dialog` (no importer), `@radix-ui/react-slot`, `@toolkit-fe/where-am-i` (no importer), `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`, `vaul`; devDependencies `tailwindcss`, `@tailwindcss/postcss`, `tw-animate-css` | — |
| `types/emoji.d.ts` | an `em-emoji` JSX declaration with no consumer | — |

Kept on purpose: `ahooks` (the chat's wide-screen preference uses `useLocalStorageState`); `components/chat/theme-config.ts` named by the charter row is already gone; `packages/docs` (upstream's rspress site) has its own empty PostCSS config and is out of scope.

## 4. Design

### 4.1 Removals

- Delete `components/ui/` (three files), `lib/utils.ts`, `components.json`, `postcss.config.mjs`, `lib/helpers/responsive.ts` and its line in `lib/helpers/index.ts`, `types/emoji.d.ts`, `e2e/theme-aliases.spec.ts`, `app/globals.css` (§4.3).
- `components/providers/app-providers.tsx`: drop the `initResponsiveConfig` import and the module-level call; nothing else changes in the provider stack.
- `pnpm remove` the twelve packages of §3 so `pnpm-lock.yaml` follows. `clsx` may survive in the lockfile as a transitive dependency of antd or X; that is not a finding.
- `.oxfmtrc.json`: remove `experimentalTailwindcss`. `.github/dependabot.yml`: remove the `tailwindcss` ignore entry. `README.md`: remove the "Tailwind CSS v4" line.
- `AGENTS.md` keeps upstream's "Tailwind CSS v4" paragraph; `CLAUDE.md` states that the paragraph does not apply on this line (the same way it already carries the Next docs block so `AGENTS.md` stays identical to upstream).

### 4.2 The browser reset

`app/layout.tsx` imports `antd/dist/reset.css` where it imports `./globals.css` today. Next documents both halves: global CSS is imported in the root layout, and CSS from `node_modules` may be imported anywhere. The reset gives box-sizing, body margin, heading, paragraph and list margins, and form-control font inheritance; its only colour literal is a transparent tap-highlight, inside `node_modules`, not product CSS. No `@layer` wrapper (§2.1). Text colour, font family, font size and line height keep coming from antd's `App` root style on `.ant-app`, which every page renders inside.

### 4.3 `app/globals.css`: disposition, line by line

| Lines | Content | Disposition |
| --- | --- | --- |
| 1–4 | Tailwind and `tw-animate-css` imports, `dark` custom variant | Tailwind, gone |
| 6–45 | `@theme inline` (shadcn colour and radius mapping, `--min-width-chat-card` with no consumer) | Tailwind, gone |
| 47–50 | `* { border-color; outline-color }` | Tailwind's border reset companion, gone |
| 52–91 | ADR-0012 alias block on `.ant-app` | no consumers left, gone (closes ADR-0012's open verification item) |
| 93–125 | `.bg-theme-*`, `.text-theme-*`, `.border-theme*` | no consumers left, gone |
| 127–142 | `.ant-collapse` override (no item borders, `!important` text colour) | gone; the chat's `InputsCollapse` gets `bordered={false}` (§4.5) |
| 144–166 | `hr`, `h3` with `!important`, `body` (margin, unresolvable legacy colours, a misspelt font), `a` | gone; the reset, `.ant-app` and the X markdown theme cover them |
| 168–185 | `.content` | dead (the shell's `.content` is module-scoped), gone |
| 187–207 | `::-webkit-scrollbar*` | gone, native scrollbars (ADR-0012 already schedules this) |
| 208–298 | `.dc-answer-form-button`, `.dc-react-markdown-container` | dead since sub-project 2, gone |
| 299–303 | `declare namespace JSX { 'em-emoji' }` | TypeScript in a CSS file, gone with `types/emoji.d.ts` |
| 305–308 | `html.wide-screen .md\:max-w-\[720px\]` | targets a class nothing emits; the chat's wide mode is `style={{ maxWidth }}` from the token already, gone |

Nothing remains, so the file is deleted and its import goes. A future global rule gets a new file with a reason; an empty file invites leftovers.

### 4.4 The theme marker: `color-scheme`

- `app/layout.tsx` renders `<html lang={…} suppressHydrationWarning style={{ colorScheme }}>` with `colorScheme` = `'dark'` when the resolved theme from `readThemeCookies` is dark, else `'light'`. The `<body>` renders without `className`: `antialiased` was a Tailwind utility and `dark` fed Tailwind's `dark:` variant only.
- `lib/theme/theme-context.tsx`: `applyScheme` sets `document.documentElement.style.colorScheme = dark ? 'dark' : 'light'` where it toggles the body class today; `DARK_CLASS_NAME` is removed (no other importer).
- Both values are explicit so that browsers with forced auto-darkening leave the light theme alone.
- The antd dark algorithm keeps being applied by `ThemeContextProvider` as before; the marker only tells the browser which scheme to use for the canvas behind the shell, native form controls and scrollbars. This closes the ADR-0012 limit "the body has no background, so a dark-mode user sees a white canvas until the shell paints".
- Sources: `color-scheme` is standard CSS (MDN); antd sets nothing of the kind (no `color-scheme` or `colorScheme` in `node_modules/antd/es`); next-themes, the reference project for theme switching in Next apps, ends in exactly this DOM state (`document.documentElement.style = 'color-scheme: dark'`, asserted by its own tests) and also sets a `data-theme` attribute, which we skip because no CSS keys on the theme by hand (charter §4.3 rule 8) and the server already reads the cookies. Next's `generateViewport({ colorScheme })` renders a `<meta name="color-scheme">` for the first paint and was considered; it would still need the client-side style for toggling, so one mechanism is better than two.

### 4.5 Fallout policy

The sub-project intends no visual change. Where the screenshots show one:

- A deleted rule shaped an antd component and one documented prop restores the look → use the prop. Known case: `components/chat/chat-view/inputs-collapse.tsx` gets `bordered={false}` (antd Collapse API), which keeps the panel borderless as the override made it.
- The reset changed a plain element inside our own CSS Module (expected: `img` renders inline instead of block, so an icon may show a descender gap) → fix in that module with token-free layout properties (`display: block`), which the conventions allow.
- Markdown output (paragraph margins, list indentation, `h3` size, link colour) now follows the X markdown theme and the reset → accepted as the defaults sub-project 2 designed against; preferences go on the cosmetic-sweep list.
- Scrollbars become native; dark under `color-scheme: dark`. Token-coloured thin scrollbars (`scrollbar-width`, `scrollbar-color` on `.ant-app`) are a cosmetic-sweep candidate, not part of this sub-project.

## 5. Verification

### 5.1 e2e (ADR-0010; projects `desktop-light`, `desktop-dark`, `mobile-light`)

- `e2e/theme-aliases.spec.ts` is deleted with the block it pinned.
- `e2e/ssr-first-paint.spec.ts`: the first HTML contains `style="color-scheme:dark"` on `<html>` under the dark cookies and `style="color-scheme:light"` without them (string assertions on the served HTML, as the spec does today for the body class); the legacy-localStorage migration case waits for `html` to have `color-scheme: dark` (Playwright `toHaveCSS('color-scheme', 'dark')` on the `html` locator).
- `e2e/chat-markdown.spec.ts`: the dark-project `beforeEach` waits for the same `toHaveCSS` instead of the body class.
- The whole suite green on all three projects.

### 5.2 Screenshots

`e2e/screenshots.spec.ts` runs after the CSS task; every page in both schemes is looked at before the final review (sub-project 3's lesson), checking for the §4.5 differences only. Findings are fixed in the same task.

### 5.3 Build

`pnpm build` succeeds without a PostCSS config (Turbopack processes PostCSS only when a config file exists, per its docs). The CSS files under `.next/static` contain no `tailwindcss`, `--tw-` or `--theme-`.

### 5.4 Repository grep (the charter's acceptance line, scoped to code)

```bash
git grep -I -n -i -e '--theme-' -e tailwind -e lucide -e radix -e clsx -e class-variance -e tw-animate -e vaul -e 'components/ui' -e 'lib/utils' -e 'helpers/responsive' -e where-am-i -- . ':!*.md' ':!pnpm-lock.yaml'
```

returns nothing. Markdown is excluded because ADR-0012, the specs, the handoffs and CLAUDE.md's "no Tailwind classes" rule name these on purpose; the lockfile because of transitive dependencies.

### 5.5 Static checks

Before each commit: `pnpm exec tsc --noEmit`, `pnpm exec oxlint <files>`, `pnpm exec oxfmt --check <files>`, `pnpm test`. `npx -y @ant-design/cli lint ./` stays at zero findings. No new unit tests: the sub-project adds no logic; the one new branch (cookie to `colorScheme`) is covered by §5.1.

### 5.6 Docker gate

Before the merge: stop the e2e MySQL, rebuild the image from HEAD, then `/api/health` 200, `/apps` signed out → 307 `/login?callbackUrl=%2Fapps`, `/api/client/apps` → 401, `antd-cssinjs` count 1 on `/login`.

### 5.7 Gaps stated

The visual effect of `color-scheme` on native controls and scrollbars is not asserted beyond the computed style; the screenshots show it. Chrome's forced auto-dark on Android is not testable here.

## 6. Documentation and decisions

- **ADR-0021** "Finish on pure antd: the browser reset and the colour scheme after the Tailwind removal", accepted in the same PR: the three choices of §2, the §4.5 policy, the §5 verification, and the sources of §9. **ADR-0012** becomes "superseded by ADR-0021" through `.claude/skills/adr-skill/scripts/set_adr_status.js`. ADR-0008's `CLAUDE.md` line reads "sub-projects 0 to 4 done". `docs/decisions/README.md` gets the row.
- **`CLAUDE.md`**: ADR lines 0008, 0012, 0021; "Where things are" drops the alias-block sentence and states "global CSS is antd's `reset.css` imported in `app/layout.tsx`; no `globals.css`; the scheme marker is `color-scheme` on `<html>`"; the `AGENTS.md` override line (§4.1); "Next frontend step" becomes the cosmetic sweep, then the backend rework; the latest-handoff pointer. Under 200 lines.
- **`.claude/rules/frontend.md`**: the ADR-0012 clause is replaced by the reset and `color-scheme` facts (no global CSS file without a reason, no `.dark` selectors, no legacy variables).
- **`docs/frontend-conventions.md`**: rule 7 stays the standing rule; Status gets the sub-project 4 line with the lint figure; "Next" points at the cosmetic sweep and the backend rework.
- **`.cii-assessment.md`** evidence lines; a handoff under `docs/superpowers/handoffs/` at session end.

## 7. Follow-ups (not in this sub-project)

- Cosmetic sweep candidates collected during the screenshot review: token-coloured scrollbars, the chat Collapse look, markdown spacing preferences.
- From the sub-project 3 handoff: `components/chat/**` was not audited for the Flex-spacing trap; two `@ant-design/icons` majors in the tree.
- Then the backend rework (`docs/superpowers/specs/2026-10-05-backend-rework-brief.md`), last.

## 8. Risks

- **Layout shifts from the reset swap** (inline images, margins on plain elements). Caught by §5.2; fixed per §4.5.
- **`html, body { height: 100% }` from the reset** meets the viewport-bound shells (ADR-0011) and the document-scrolling auth pages. Overflow stays visible, so the document still scrolls; the e2e suite and screenshots confirm.
- **CSS pipeline without PostCSS**: prefixing now comes from Turbopack's CSS compiler and the browserslist defaults. §5.3 builds and inspects; if an unprefixed property shows up in the screenshots, it is a finding for the CSS task.
- **Hydration**: the server and the client compute the same `colorScheme` from the same cookie, so the inline style matches; `suppressHydrationWarning` on `<html>` already exists for `lang`.
- **A `.dark` selector or legacy variable re-introduced later**: the rules file and the conventions forbid it; the grep of §5.4 is repeatable.

## 9. Sources

- Charter §5 row 4 and §7; ADR-0012 (consequences and the sub-project 4 removal note); handoff `2026-10-06-admin-apps-auth-execution.md` point 3.
- antd: `docs/react/compatible-style.en-US.md` (`reset.css`, `@layer` only with `StyleProvider layer`), the `App` component page ("provide reset styles based on `.ant-app`", via `antd doc App`), `node_modules/antd/dist/reset.css` (antd 6.6.5), `node_modules/antd/es/app/style/index.js` (colour, font, line height on `.ant-app`), Collapse `bordered` (`antd doc Collapse`).
- Next (bundled docs under `node_modules/next/dist/docs/01-app/`): `01-getting-started/11-css.md` (Global CSS in the root layout; importing CSS from `node_modules`), `03-api-reference/08-turbopack.md` (PostCSS processed when a config exists), `03-api-reference/04-functions/generate-viewport.md` (`colorScheme`, considered and not used).
- MDN `color-scheme`; next-themes README and `_autodocs/api-reference/script.md` (`data-theme` attribute plus `style="color-scheme: dark"` on `documentElement`).
- Playwright `toHaveCSS` (web-first assertion on a computed style).
- Inventory of §3: `git grep` on `fork/overhaul` 039c2356, 2026-10-07.
