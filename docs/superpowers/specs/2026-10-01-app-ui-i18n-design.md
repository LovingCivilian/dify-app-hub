# App UI Internationalization (English + Chinese) — Design

Date: 2026-10-01
Status: Awaiting review
Branch: `i18n/app-ui`

## Context

This repository is a personal fork of `lexmin0412/dify-app-hub`. The app is mostly Chinese:
only the chat UI is wired to i18next, through about 50 keys defined inline in `libs/i18n.ts`,
and the English for those keys has errors. Admin, login, init and password-reset pages have no
i18n at all.

The full translation effort is split into four sub-projects. This spec covers the first.

| #   | Sub-project                                   | Status           |
| --- | --------------------------------------------- | ---------------- |
| 1   | App UI text (browser-rendered)                | **This spec**    |
| 2   | Server messages and emails                    | Later, own spec  |
| 3   | Docs site and README                          | Later, own spec  |
| 4   | Code comments                                 | Later, undecided |

## Goals

1. Every string a user or admin sees in the browser comes from i18next, in correct English and
   the original Chinese, and follows the language switch.
2. Follow the documented i18next / react-i18next conventions and official tooling. No custom
   mechanisms.
3. Keep future `git merge upstream/main` easy: translations live in new files, and edits to
   upstream files are line-level.

## Non-goals

- API route responses, server actions, the password-reset email, seed data, server logs
  (sub-project 2).
- Docs site, README and other Markdown (sub-project 3).
- Code comments (sub-project 4).
- Adding languages other than English and Chinese.
- URL-based locale routing (`/en/...`, `/zh/...`). Language stays a client-side preference, as
  upstream has it.
- Refactoring, reformatting or renaming anything in upstream files beyond what a string
  replacement needs.

## Design

### 1. Translation files

Standard i18next layout, one JSON file per language, using i18next's default namespace
`translation`:

```
locales/
  en/translation.json
  zh/translation.json
```

- Keys are nested by area and use upstream's existing style (`area.snake_case`), for example
  `chat.new_chat`. Upstream's existing keys keep their names, so the existing `t('...')`
  calls (38 lines across the chat UI) need no changes.
- New top-level areas are added for what is not covered today: `auth` (login, forgot/reset
  password), `init`, `admin_apps`, `admin_users`, `workflow`, plus additions to the existing
  `common`, `form`, `app`, `chat`, `message` and `system`.
- Variables use i18next interpolation (`{{name}}`). English copy is phrased so that no plural
  forms are needed ("Total: {{total}}"), which keeps both files on identical key sets.
- **Chinese values are copied verbatim** from the current source literals, so Chinese users see
  no change in wording.
- **English values are written fresh**, including corrections to upstream's existing English
  (for example `Params will be reaonly if the conversation starts`).
- Upstream's `en` resources contain a stray second copy of the `debug` block outside the
  `translation` namespace, and `zh` has no `debug` keys. The move fixes both: one `debug` block
  per language, with Chinese supplied.

This is a deviation from the design discussed in chat, which said "one file per area". A single
`translation.json` per language is what lets upstream's existing key names stay unchanged; the
areas become top-level sections inside the file.

### 2. `libs/i18n.ts`

Edited directly. The inline `resources` object is removed and replaced with imports of the two
JSON files:

```ts
import en from '@/locales/en/translation.json'
import zh from '@/locales/zh/translation.json'

// .init({
//   ...existing options unchanged (debug, fallbackLng: 'en', interpolation)...
//   resources: { en: { translation: en }, zh: { translation: zh } },
// })
```

Language detection (`i18next-browser-languagedetector`), the `en` fallback and the top-level
`await` stay as they are.

### 3. Type-safe keys

A declaration file, following the i18next TypeScript guide, makes a mistyped or missing key a
compile error:

```ts
// types/i18next.d.ts
import 'i18next'
import type translation from '@/locales/en/translation.json'

declare module 'i18next' {
	interface CustomTypeOptions {
		defaultNS: 'translation'
		resources: { translation: typeof translation }
	}
}
```

All existing `t()` calls pass plain string literals, so enabling this should not force changes
to upstream call sites. The plan verifies that with a typecheck right after this step.

### 4. Loading i18n on every page

Today `libs/i18n` is imported only by `app/(user)/layout.tsx`, so admin and auth pages have no
translations. Edits to upstream files:

| File                                        | Edit                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `components/layout/page-layout-wrapper.tsx` | Import `@/libs/i18n`; pass Ant Design's `locale` (`enUS` / `zhCN`) to the existing `ConfigProvider`.           |
| `components/layout/admin-header-title.tsx`  | Render the existing `I18nSwitcher` component (currently unused) next to the user menu.                         |
| `app/(user)/layout.tsx`                     | Compare `i18n.resolvedLanguage` instead of `i18n.language` when choosing the Ant Design locale.                |
| `components/chat/i18n-switcher/index.tsx`   | Highlight the active language using `i18n.resolvedLanguage`.                                                   |
| `components/chat/chat-layout.tsx`           | Language radio: bind to `i18n.resolvedLanguage`; show each language in its own name (`English`, `中文`).       |

Why `resolvedLanguage`: the detector returns the browser's full tag (for example `en-US`), and
upstream compares `i18n.language === 'en'`. From reading the code, an `en-US` browser therefore
gets Chinese Ant Design built-ins and an unselected language radio. The i18next docs name
`resolvedLanguage` as the property to use for UI decisions. This is to be confirmed in the
browser during verification.

Language behaviour is otherwise unchanged: follow the browser, remember the user's choice
(localStorage, the detector's default), fall back to English.

### 5. Replacing hardcoded strings

An inventory pass comes first: the plan lists every user-visible Chinese literal per file,
because a grep for "non-comment lines containing Chinese" (457 lines in 67 files) also matches
trailing comments and server-only files.

Files in scope (browser-rendered):

- `app/login`, `app/init`, `app/forgot-password`, `app/reset-password`
- `app/app-management/**` (pages and components; `actions.ts` is server-side and out of scope)
- `app/user-management/**`
- `app/(user)/**`
- `components/**`
- `hooks/useX/**`
- `lib/core/constants.ts`, `lib/theme/constants.ts`, and client-side helpers under `lib/`
  that produce user-visible text
- `app/layout.tsx` (page metadata description)

Rules:

1. **Components:** add `const { t } = useTranslation()` where missing; replace the literal with
   `t('key')`. Only the string changes on the line.
2. **Module-level constants** (`TopMenuOptions`, `AppModeNames`,
   `OpeningStatementDisplayModeOptions`, `ThemeModeLabelEnum`, and similar): the constant holds
   the translation key; the text is produced with `t()` at the point of display. Constants are
   evaluated once at import, before the language is known and before it can change.
3. **Non-React code** that must produce user-visible text uses the i18next instance directly
   (`i18n.t('key')`), the documented way to translate outside components.
4. **Browser console messages** (`console.error('…')`): plain English in place, no i18n key.
   Only developers read them.
5. **Page metadata** in `app/layout.tsx`: English in place. It is static server-rendered
   metadata, not switchable UI.
6. No other change to a touched line or its neighbours.

### 6. English terminology

English copy uses Dify's own product terms where a Dify concept is involved, and stays
consistent across pages.

| Chinese          | English             |
| ---------------- | ------------------- |
| 应用             | App                 |
| 应用管理         | App management      |
| 用户管理         | User management     |
| 对话             | Conversation        |
| 标注             | Annotation          |
| 开场白           | Conversation opener |
| 聊天助手         | Chatbot             |
| 工作流           | Workflow            |
| 文本生成         | Text Generator      |
| 退出登录         | Log out             |

Buttons and labels use sentence case ("New conversation"), except proper product terms.
Upstream's existing English keys that say "Chat" where the Chinese says 对话 are changed to
"Conversation" for consistency.

### 7. Tooling

`i18next-cli` (the official i18next toolchain) is added as a dev dependency, with a standard
`i18next.config.ts`:

```ts
import { defineConfig } from 'i18next-cli'

export default defineConfig({
	locales: ['en', 'zh'],
	extract: {
		input: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
		output: 'locales/{{language}}/{{namespace}}.json',
		defaultNS: 'translation',
		primaryLanguage: 'en',
	},
})
```

Two `package.json` scripts:

- `i18n:lint` → `i18next-cli lint` (reports hardcoded strings)
- `i18n:status` → `i18next-cli status` (reports keys missing in a language)

Verified against this codebase: `lint` reports only text between JSX tags. It does not report
JSX attributes (`placeholder="…"`), call arguments (`message.error('…')`) or object values
(`label: '…'`). Those are checked with a plain `git grep` for Chinese characters in `*.ts` /
`*.tsx`, documented as a command, not a script. The config also sets `removeUnusedKeys: false`,
because the extractor cannot see keys that are held in constants.

One unit test is added with the existing Vitest setup: `__tests__/i18n-locales.test.ts` asserts
that `en` and `zh` have identical key sets and no empty values.

### 8. Merge workflow

- Work happens on `i18n/app-ui`, in commits grouped by area (setup, auth pages, admin apps,
  admin users, chat, shared constants) so each can be reviewed and reverted on its own.
- Pull upstream with `git fetch upstream && git merge upstream/main` (merge, not rebase).
- After a merge: run `pnpm i18n:lint`, `pnpm i18n:status` and the `git grep` check to find text
  upstream added, then add keys for it.
- Expected conflict points, all with a mechanical resolution:
  - `libs/i18n.ts`, if upstream adds or edits inline strings: move their strings into the two
    JSON files and keep the fork's version of the file. Upstream last edited its strings in
    January 2026.
  - Any line where upstream edits a string the fork replaced with `t()`: keep the `t()` call and
    update the JSON value.
  - `package.json` / `pnpm-lock.yaml`, from the added dev dependency and scripts: keep both
    sides in `package.json`, then run `pnpm install` to regenerate the lockfile.

## Known limitation

Pages are client components but are still pre-rendered on the server, where no browser language
is available, so the server renders English. A browser set to Chinese then switches to Chinese
on load, which can show a brief flash of English and a React hydration warning on pages that
render text before login (`/login`, `/init`, `/forgot-password`, `/reset-password`). Browsers set
to English are unaffected. This comes from upstream's client-side detection and already applies
to the chat UI. The documented fix is server-side language detection (a language cookie read
during rendering), which is a larger change and is left out of this sub-project.

## Verification

Automated, run by the implementer:

1. `pnpm install`
2. `pnpm exec tsc --noEmit` (includes key type-checking)
3. `pnpm exec oxlint`
4. `pnpm test`
5. `pnpm i18n:status` reports no missing keys
6. `pnpm build`

Manual, run by the fork owner (the repository's `AGENTS.md` reserves browser checks for the
owner, because every page sits behind login). For each page, in English and then Chinese:
`/init`, `/login`, `/forgot-password`, `/reset-password`, `/app-management` (list, create/edit
drawer, settings form, annotation drawer), `/user-management` (list, edit drawer), `/apps`,
`/chat` (conversation list, message actions, settings menu, workflow view).

Check on each: no Chinese remains in English mode, no English remains in Chinese mode except
product names, Ant Design built-ins (pagination, confirm buttons, empty states) follow the
language, and the choice survives a reload.

## Risks

| Risk                                                                                   | Handling                                                                                                    |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `i18next-cli lint` does not catch Chinese literals outside JSX text (confirmed)        | `git grep` covers the gap; both commands are documented in `docs/i18n-maintenance.md`.                      |
| Type-safe keys reject a call site that builds its key dynamically                      | None exist today. New code stores literal keys typed as translation keys.                                   |
| `pnpm build` needs environment variables (for example `DATABASE_URL`) not present here | Found out in the plan's first step; if so, build with placeholder values and say so in the results.         |
| A constant converted to hold a key is also used somewhere that expects display text    | The inventory pass lists every use of each converted constant before it is changed.                         |
