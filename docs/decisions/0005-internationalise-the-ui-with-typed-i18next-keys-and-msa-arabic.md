---
status: accepted
date: 2026-10-03
decision-makers: LovingCivilian (fork owner)
---

# Internationalise the UI with typed i18next keys, with Modern Standard Arabic and Arabic-Indic digits

## Context and Problem Statement

Upstream's UI was Chinese-only with hard-coded strings. The fork needs English and Arabic for its users, and must stay mergeable with upstream, whose files keep their paths. Arabic raises two sub-decisions: which Arabic (dialect, digits) and which Ant Design locale pack (antd ships a single Arabic pack, `ar_EG`).

## Decision

- All UI text goes through i18next keys in `locales/{en,zh,ar}/translation.json`; keys are typed from the English file (`types/i18next.d.ts`), so a missing key fails `tsc`; a unit test checks that every language has the same keys and placeholders. Languages are listed in `i18next.config.ts` and `libs/i18n.ts`. The checklist for a new language is `docs/i18n-maintenance.md`.
- Arabic is Modern Standard Arabic with Arabic-Indic digits: antd locale `ar_EG`, Day.js locale `ar` plus the official `preParsePostFormat` plugin, dates through `Intl` with `ar-SA-u-ca-gregory-nu-arab` (`libs/format-date.ts`). Locale wiring lives in `libs/antd-locale.ts` and `hooks/use-html-lang.ts` (`<html lang>` follows the active language).
- "Text first, RTL later": right-to-left layout is a separate follow-up; `direction` on `XProvider` stays at antd's default until then.
- The language switcher sits in the header's right icon group in the order language · theme · GitHub · account (since the overhaul: `components/shell/language-dropdown.tsx`).
- Still open: server-side messages and e-mails, docs/README translation; translating code comments was dropped.

## Consequences

- Good, because adding a string is one key in three files and the type system plus a test enforce completeness.
- Good, because Arabic dates and numerals render natively without custom formatting code.
- Bad, because every new UI element costs three translations, and Ant Design X ships no Arabic component strings (en_US/zh_CN only) — X components stay in their default language until the X locale question is settled in the chat sub-project.
- Bad, because the app-level Arabic wording (plurals, terminology) still needs a native review.

## Implementation Plan

- **Affected paths**: `locales/**`, `types/i18next.d.ts`, `i18next.config.ts`, `libs/i18n.ts`, `libs/antd-locale.ts`, `libs/format-date.ts`, `hooks/use-html-lang.ts`, `components/shell/language-dropdown.tsx`, `docs/i18n-maintenance.md`.
- **Dependencies**: `i18next`, `react-i18next`, `i18next-browser-languagedetector`, `dayjs` (+ `preParsePostFormat`), antd locale packs.
- **Patterns to follow**: `t('area.key')` in components, `i18next.t()` outside React; add keys under the matching area in all three files; never name an interpolation variable `count`; `pnpm i18n:lint` finds hard-coded JSX text (product names are fine).
- **Patterns to avoid**: `i18next-cli extract`/`sync` (they rewrite the JSON and miss keys held in constants); hard-coded English in `aria-label`s (use a key, e.g. `system.menu`).

### Verification

- [x] `pnpm test` includes the locale-consistency tests (`__tests__/i18n-locales.test.ts`, `i18n-init.test.ts`).
- [x] e2e `shell.spec.ts`: switching to Arabic sets `<html lang="ar">` and the page stays usable.
- [ ] Native review of the Arabic wording (open follow-up in `CLAUDE.md`).

## Alternatives Considered

- Egyptian or Gulf Arabic: rejected; MSA is the written standard across the target audience.
- Western digits in Arabic: rejected; Arabic-Indic digits are the expected form for the audience and `Intl` supports them natively.
- Keep upstream's hard-coded Chinese and overlay English: rejected; not maintainable against upstream changes.

## More Information

Sources: spec `docs/superpowers/specs/2026-10-01-app-ui-i18n-design.md`, plan `docs/superpowers/plans/2026-10-01-app-ui-i18n.md`, merges of `i18n/app-ui` and `i18n/arabic` into `fork/main` (2026-10-03), PR #4 (switcher placement), `CLAUDE.md` "Internationalisation".

Note, 2026-10-05 (chat sub-project Task 18b, language cookie): the UI language is a cookie the server renders, following the theme cookie pattern of [ADR-0016](0016-store-the-theme-preference-in-cookies.md). Once the shells were server-rendered, the browser-only detection gave every Arabic or Chinese visitor an English first HTML and a React hydration mismatch. The language detector now reads the `i18next` cookie first (`detection.order`: cookie → localStorage → navigator; `querystring` is gone, because the root layout cannot see `?lng=`) and caches the language in the cookie (one year, `Path=/`, `SameSite=Lax`) and in localStorage. `app/layout.tsx` reads the cookie with `cookies()` through `lib/i18n/language-cookie.ts` (supported languages, regional tags reduced the way i18next resolves them, English fallback), renders `<html lang>` and passes `initialLanguage` to `AppProviders`. There each server render gets its own `i18n.cloneInstance({ lng })` through `I18nextProvider`, so concurrent requests never change the shared instance, and the browser's first render takes the same language through react-i18next's `useSSR`. A language the detector found without a cookie (an older localStorage value, the browser language) is applied once after hydration and written to the cookie. `hooks/use-html-lang.ts` stays: it keeps `<html lang>` and the Day.js locale in step after a change in the page. Sources: `i18next-browser-languagedetector` 8.2.1 README ("Detector Options"; `cacheUserLanguage` "will be called after init and on changeLanguage"), react-i18next docs "SSR (additional components)" and "I18nextProvider", react-i18next changelog ("only apply initial values in useSSR, withSSR on i18next instances not being a clone … don't apply on serverside"), i18next API docs (`cloneInstance`: "independent on set language"), Next 16.3.4 bundled docs (`cookies`, and the TanStack Query guide's per-server-render instance with one browser instance).
