# i18n maintenance

All UI text lives in `locales/<language>/translation.json` (English, Chinese and Arabic). Components read it with `t('area.key')` from `react-i18next`. Keys are type-checked: a key that is missing from the English file fails `tsc`.

## How the language is chosen

The UI language is a cookie the server reads, so the first HTML is already in the visitor's language (ADR-0005 note of 2026-10-05; the theme uses the same pattern, ADR-0016).

- The language detector (`i18next-browser-languagedetector`, options in `libs/i18n.ts`) looks in the `i18next` cookie, then localStorage (`i18nextLng`), then the browser language. There is no `?lng=` query: the server cannot read it in the root layout, so it would render one language and hydrate another.
- Every language change (the header dropdown calls `i18n.changeLanguage`) is cached by the detector in the cookie (one year, `Path=/`, `SameSite=Lax`) and in localStorage.
- `app/layout.tsx` reads the cookie with `cookies()` through `readLanguageCookie` (`lib/i18n/language-cookie.ts`: supported languages, `ar-SA` → `ar`, English for junk or no cookie), renders `<html lang>` with it and passes it to `AppProviders` as `initialLanguage`.
- `components/providers/app-providers.tsx`: each server render translates with its own `i18n.cloneInstance({ lng })` through `I18nextProvider` (the shared instance is never switched per request); in the browser the module instance is used and react-i18next's `useSSR` sets the server's language for the first render. A language the detector found without a cookie (an older localStorage value, the browser language) is applied once after hydration, which writes the cookie.
- `hooks/use-html-lang.ts` keeps `<html lang>` and the Day.js locale in step after a change in the page.
- In e2e specs, start in a language with the cookie (`page.context().addCookies([{ name: 'i18next', value: 'ar', url: baseURL }])`) or switch through the dropdown.

## Adding or changing text

1. Add the key to every locale file, under the matching area.
2. Use it with `t('area.key')`. Outside React components, use `i18next.t('area.key')`.
3. Run `pnpm test` (checks that every language has the same keys and placeholders) and `pnpm exec tsc --noEmit`.

Do not name an interpolation variable `count`, and do not run `i18next-cli extract` or `i18next-cli sync`: they rewrite the JSON files and cannot see keys held in constants.

## Adding a language

1. Create `locales/<code>/translation.json` with every key from the English file. Use the plain language code (`ar`, not `ar-SA`): i18next resolves regional browser languages to it.
2. Register it in `libs/i18n.ts` (`resources`), `lib/i18n/language-cookie.ts` (`SUPPORTED_LANGUAGES`, which the server accepts from the cookie) and `i18next.config.ts` (`locales`).
3. Add it to `translations` in `__tests__/i18n-locales.test.ts` and to the resolution cases in `__tests__/i18n-init.test.ts`.
4. Add the Ant Design pack and the Day.js locale to `libs/antd-locale.ts`, and a case to `__tests__/antd-locale.test.ts`.
5. Add the language's own name to the picker: the `languages` map in `components/shell/language-dropdown.tsx`.
6. Add the language's Ant Design X strings to `libs/x-locale.ts` (a pack like `libs/x-locale-ar.ts`; X ships only English and Chinese) and a case to `__tests__/x-locale.test.ts`.

Right-to-left languages also need `dir` set on `<html>` (on the server in `app/layout.tsx` from the cookie's language, and in `hooks/use-html-lang.ts` from `i18n.dir()` after a change) and `direction="rtl"` on the single `XProvider` in `components/providers/app-providers.tsx`; this is not done yet for Arabic.

## After merging upstream

```bash
git fetch upstream
git merge upstream/main
pnpm install
```

Then look for Chinese text upstream added:

```bash
git grep -nP '[\x{4e00}-\x{9fff}]' -- 'app/**/*.tsx' 'app/**/*.ts' 'components' 'hooks' 'lib' ':!app/api' | grep -vP '^[^:]+:\d+:\s*(//|\*|/\*|\{/\*)'
pnpm i18n:lint
```

The `git grep` lists every non-comment line containing Chinese. `pnpm i18n:lint` lists hardcoded text between JSX tags (it also reports product names such as "Dify App Hub Platform", which are fine). For each new string, add a key to every locale file and replace the literal with `t()`.

Lines the `git grep` is expected to print:

- `components/shell/language-dropdown.tsx`: `中文`, the language's own name.
- `locales/zh/translation.json` is excluded by the path list; `locales/ar/translation.json` contains no Chinese.
- `components/chat/markdown-renderer/blocks/think-block.tsx`: `text.includes('思考')`, matching model output.
- `components/chat/chatbox/message/referrence.tsx`: text inside a commented-out block.
- Trailing code comments (for example in `components/chat/chatbox-wrapper.tsx`).
- Server-side files not yet translated: `app/(admin)/app-management/actions.ts`, `lib/mail.ts`, `lib/auth.ts`.

## Typical merge conflicts

- `libs/i18n.ts`: upstream added or changed inline strings. Keep this fork's version of the file (including its `detection` options, which the server's cookie read depends on) and move upstream's new strings into the locale files.
- `components/providers/app-providers.tsx`: upstream changed the Ant Design locale line (upstream had it in `components/layout/page-layout-wrapper.tsx`, which no longer exists here, and in `app/(user)/layout.tsx`, which no longer has it). Keep the merged `locale={{ ...getAntdLocale(i18n.resolvedLanguage), ...getXLocale(i18n.resolvedLanguage) }}` and add any new locale to `libs/antd-locale.ts` and `libs/x-locale.ts`.
- A line where upstream edited a string this fork replaced with `t()`: keep the `t()` call and update the JSON value.
- `package.json` / `pnpm-lock.yaml`: keep both sides in `package.json`, then run `pnpm install`.
