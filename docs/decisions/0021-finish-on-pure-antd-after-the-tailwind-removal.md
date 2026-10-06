---
status: accepted
date: 2026-10-07
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (sub-project 4)
---

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
2. The root layout renders `<html style={{ colorScheme }}>` with `dark` or `only light` from `readThemeCookies` (ADR-0016); `lib/theme/theme-context.tsx` sets `document.documentElement.style.colorScheme` where it toggled the body class. The light value is `only light`: the `only` keyword forbids the user agent's own override and is the documented opt-out from Chrome's Auto Dark Theme (MDN `color-scheme`), so auto-darkening browsers leave the light theme alone; a bare `light` would not do that. antd's dark algorithm is applied as before; the marker only tells the browser which scheme to use for the canvas, native form controls and scrollbars. This is the DOM state next-themes produces (`style="color-scheme: dark"` on `documentElement`); its `data-theme` attribute is not copied because no CSS keys on the theme by hand.
3. Fallout policy: the deleted `.ant-collapse` override had removed only the header/content divider of a bordered Collapse, which no documented prop reproduces (`bordered={false}` is the filled borderless variant), so the chat's Collapses take antd's default look; the legacy `h3 { font-size: 18px !important }` rule had also been shrinking every `Typography.Title level={3}`, so the auth card's title regains antd's 24 px; the scrollbar rules are gone (native scrollbars, dark under `color-scheme: dark`); markdown output follows the X markdown theme and the reset; a plain element inside a CSS Module that the reset changed gets a token-free layout property in that module.
4. Removed: `components/ui/`, `lib/utils.ts`, `components.json`, `postcss.config.mjs`, `lib/helpers/responsive.ts`, `types/emoji.d.ts`, `e2e/theme-aliases.spec.ts`; packages `@radix-ui/react-accordion`, `@radix-ui/react-dialog`, `@radix-ui/react-slot`, `@toolkit-fe/where-am-i`, `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`, `vaul`, `tailwindcss`, `@tailwindcss/postcss`, `tw-animate-css`; the oxfmt Tailwind option and the Dependabot ignore rule. `ahooks` stays (the chat uses it). `AGENTS.md` keeps upstream's Tailwind paragraph; `CLAUDE.md` says it does not apply on this line.

### Consequences

- Good, because the charter's §7 end state holds: no Tailwind, Lucide, Radix, hand-written theme variables or hex colours remain; the code-scoped grep is empty and the built CSS carries no Tailwind marker.
- Good, because the browser now knows the scheme: the canvas behind the shell, native controls and scrollbars are dark in dark mode (ADR-0012's "white canvas" limit is closed), and the first HTML carries it.
- Good, because the reset is antd's own, so plain elements in markdown output get the margins antd's components assume.
- Bad, because scrollbars are native now; token-coloured thin scrollbars (`scrollbar-width`, `scrollbar-color` on `.ant-app`) are a cosmetic-sweep candidate.
- Bad, because `AGENTS.md` still names Tailwind; the override lives in `CLAUDE.md` so upstream's file stays identical.
- Neutral, because without a PostCSS config Turbopack compiles CSS natively; prefixing follows the browserslist defaults (verified by `pnpm build` and the suite, not assumed).

## Implementation Plan

- **Affected paths**: `app/layout.tsx`, `lib/theme/theme-context.tsx`, `components/providers/app-providers.tsx`, `lib/helpers/index.ts`, `package.json`, `.oxfmtrc.json`, `.github/dependabot.yml`, `README.md`; deletions as listed above; e2e probes in `e2e/ssr-first-paint.spec.ts`, `e2e/chat-markdown.spec.ts`, `e2e/shell.spec.ts`.
- **Dependencies**: twelve removed, none added.
- **Patterns to follow**: global CSS is the one antd reset import in the root layout; a global rule needs a new file and a reason; the scheme is `color-scheme` on `<html>` (server from the cookie, client in `applyScheme`); component looks come from antd props and token-only CSS Modules.
- **Patterns to avoid**: a `globals.css` that accumulates rules; `.dark` selectors or a body class for the theme; `--theme-*`/shadcn names; utility-class frameworks; a second reset.
- **Configuration**: no PostCSS config; `.oxfmtrc.json` without `experimentalTailwindcss`.

### Confirmation

- [x] `e2e/ssr-first-paint.spec.ts`: the served HTML carries `style="color-scheme:dark"` under the dark cookies and `style="color-scheme:only light"` without; a light theme stays `only light` in the `desktop-dark` project; the legacy-localStorage migration ends with a dark html style. `e2e/shell.spec.ts`: the header toggle flips the html style. `e2e/chat-markdown.spec.ts` waits for it in the dark project.
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
