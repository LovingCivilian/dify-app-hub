---
status: proposed
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (chat sub-project, Task 1)
---

# Store the theme preference in cookies so the server renders the right scheme

## Context and Problem Statement

The theme mode (system / light / dark) and the last resolved scheme were kept in `localStorage`, which the server cannot read. Every server render therefore started light, and a dark-mode user saw a light first paint that flipped to dark after hydration (antd's `darkAlgorithm` and the `dark` body class were applied on the client only). Sub-project 2 moves the user shells to server components (planned ADR-0018; chat sub-project spec `docs/superpowers/specs/2026-10-04-chat-on-ant-design-x-design.md`, §3.2 and §2 "Dark first paint"), which makes the mismatch visible on every hard load. How does the server learn the visitor's scheme without a custom mechanism?

## Decision Drivers

- The first HTML must already carry the right antd algorithm and body class (no light-to-dark flash on a hard load).
- Documented Next.js and browser APIs only ([ADR-0002](0002-use-documented-library-approaches-only.md)).
- The server cannot see `prefers-color-scheme`, so system mode needs the last scheme the client resolved.
- No new dependency; junk or missing values must never break a server render.

## Considered Options

- Two cookies, `theme-mode` and `theme`, read with `cookies()` in the root layout and written by the client on every change.
- Keep `localStorage` and accept the flash.
- An inline pre-hydration script that sets the body class before paint.

## Decision Outcome

Chosen option: the two cookies. `theme-mode` (`system` | `light` | `dark`) and `theme` (`light` | `dark`, the last resolved scheme) are one year, `Path=/`, `SameSite=Lax` (`Secure` on https) and are not `HttpOnly`, because the client writes them with `document.cookie` whenever the mode or the resolved scheme changes. `app/layout.tsx` (an async server component) reads them with `await cookies()` through `readThemeCookies`, renders `class="antialiased dark"` on `<body>` when the resolved scheme is dark and passes `initialTheme` to `AppProviders` → `ThemeContextProvider`, so the first client render equals the first HTML and `AntdRegistry` inlines the dark tokens. An explicit light or dark mode decides the scheme; system mode uses the stored resolved scheme and keeps following `prefers-color-scheme` live on the client. Junk values fall back per cookie to system mode and the light scheme. The old `localStorage` theme-mode value is migrated once, when no `theme-mode` cookie exists; the legacy entries are removed in the same step.

### Consequences

- Good, because a dark-mode user gets the dark body class and the dark antd tokens in the first HTML, measured in the server response under `next dev` as well (`--ant-color-bg-layout:#000000` with the cookies, `#f5f5f5` without).
- Good, because the shells can render on the server without a theme flash, and the code is plain Next.js `cookies()` plus `document.cookie`.
- Bad, because `cookies()` in the root layout opts every route into dynamic rendering (Next's `cookies` reference, "Good to know"). `/login` and `/chat/[appId]` were already `force-dynamic`, and `/forgot-password` is dynamic through its layout's session read; the routes with no request-time call of their own (`/`, `/init`, `/apps`, `/app-management`, `/user-management`, `/reset-password`) move from static prerender to per-request rendering. The proxy ([ADR-0006](0006-require-login-everywhere-and-use-the-email-as-dify-end-user-id.md)) does not make a route dynamic; the `next build` route table in Task 20 of the chat plan confirms the split.
- Bad, because one corrected paint remains when the OS scheme changed since the last visit under system mode (the server renders the stored scheme, the client then applies the live one).
- Neutral, because the cookies hold a display preference only, so they are not `HttpOnly`; they are sent with every request (two short values).
- Neutral, because the migration removes the legacy `__DC__THEME_MODE` / `__DC__THEME` `localStorage` entries after reading them, so it runs once and nothing reads them afterwards (an expired cookie cannot revive an old value).

## Implementation Plan

- **Affected paths**: `lib/theme/theme-cookie.ts` (names, `readThemeCookies`, `themeCookieStrings`, `DEFAULT_INITIAL_THEME`), `lib/theme/theme-context.tsx` (`initialTheme` prop, cookie writes, migration, `addEventListener('change')` only), `components/providers/app-providers.tsx` (`initialTheme` prop), `app/layout.tsx` (reads the cookies, body class), `__tests__/theme-cookie.test.ts`, `e2e/ssr-first-paint.spec.ts`.
- **Dependencies**: none.
- **Patterns to follow**: server components import `lib/theme/constants` and `lib/theme/theme-cookie` only (no React context code); the cookie names live in `theme-cookie.ts` and nowhere else; new theme consumers read `useThemeContext()`.
- **Patterns to avoid**: reading `localStorage` for the theme; styling the scheme by hand with `.dark` rules ([ADR-0012](0012-alias-legacy-theme-variables-to-antd-tokens.md)); a pre-hydration script.
- **Configuration**: none.

### Verification

- [x] `__tests__/theme-cookie.test.ts`: defaults, explicit modes, system mode keeps the stored scheme, junk values fall back per cookie, cookie attributes and `Secure`.
- [x] `e2e/ssr-first-paint.spec.ts`: with the dark cookies the server HTML (page request context) has `class="antialiased dark"` and antd's dark `--ant-color-bg-layout`; junk cookies render the light default; all three Playwright projects.
- [ ] Production build: `curl` with the dark cookies shows the dark body class and the inlined `antd-cssinjs` style (Task 20 of the plan, Docker stack).

## Pros and Cons of the Options

### Two cookies read in the root layout

- Good, because the server renders the right antd algorithm and body class; only documented APIs are used.
- Bad, because every route becomes dynamic (several were static before; see Consequences) and system mode can show one corrected paint.

### Keep `localStorage` and accept the flash

- Good, because nothing changes.
- Bad, because every hard load flashes light for dark-mode users once the shells are server-rendered.

### Inline pre-hydration script

- Good, because it can set the body class before first paint without reading cookies on the server.
- Bad, because it cannot switch antd's algorithm: the CSS-in-JS tokens are computed during render, so the server HTML and the first client render would still be light.

## More Information

Sources: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md` (Next 16.3.4 bundled docs: async, read in Server Components, dynamic rendering), MDN `document.cookie` and `MediaQueryList` `change` events, Playwright `page.request` (shares the context's cookies), chat sub-project spec §3.2 and §2 "Dark first paint". Related: [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md), [ADR-0012](0012-alias-legacy-theme-variables-to-antd-tokens.md).
