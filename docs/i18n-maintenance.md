# i18n maintenance

All UI text lives in `locales/<language>/translation.json` (English, Chinese and Arabic). Components read it with `t('area.key')` from `react-i18next`. Keys are type-checked: a key that is missing from the English file fails `tsc`.

## Adding or changing text

1. Add the key to every locale file, under the matching area.
2. Use it with `t('area.key')`. Outside React components, use `i18next.t('area.key')`.
3. Run `pnpm test` (checks that every language has the same keys and placeholders) and `pnpm exec tsc --noEmit`.

Do not name an interpolation variable `count`, and do not run `i18next-cli extract` or `i18next-cli sync`: they rewrite the JSON files and cannot see keys held in constants.

## Adding a language

1. Create `locales/<code>/translation.json` with every key from the English file. Use the plain language code (`ar`, not `ar-SA`): i18next resolves regional browser languages to it.
2. Register it in `libs/i18n.ts` (`resources`) and `i18next.config.ts` (`locales`).
3. Add it to `translations` in `__tests__/i18n-locales.test.ts` and to the resolution cases in `__tests__/i18n-init.test.ts`.
4. Add the Ant Design pack and the Day.js locale to `libs/antd-locale.ts`, and a case to `__tests__/antd-locale.test.ts`.
5. Add the language's own name to the two pickers: the `languages` map in `components/shell/language-dropdown.tsx` and the language radio in `components/chat/chat-layout.tsx`.

Right-to-left languages also need `dir` set on `<html>` (`hooks/use-html-lang.ts`, from `i18n.dir()`) and `direction="rtl"` on the single `XProvider` in `components/providers/app-providers.tsx`; this is not done yet for Arabic.

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

- `components/shell/language-dropdown.tsx` and `components/chat/chat-layout.tsx`: `中文`, the language's own name.
- `locales/zh/translation.json` is excluded by the path list; `locales/ar/translation.json` contains no Chinese.
- `components/chat/markdown-renderer/blocks/think-block.tsx`: `text.includes('思考')`, matching model output.
- `components/chat/chatbox/message/referrence.tsx`: text inside a commented-out block.
- Trailing code comments (for example in `components/chat/chatbox-wrapper.tsx`).
- Server-side files not yet translated: `app/(admin)/app-management/actions.ts`, `lib/mail.ts`, `lib/auth.ts`.

## Typical merge conflicts

- `libs/i18n.ts`: upstream added or changed inline strings. Keep this fork's version of the file and move upstream's new strings into the locale files.
- `components/providers/app-providers.tsx`: upstream changed the Ant Design locale line (upstream had it in `components/layout/page-layout-wrapper.tsx`, which no longer exists here, and in `app/(user)/layout.tsx`, which no longer has it). Keep `getAntdLocale(i18n.resolvedLanguage)` and add any new locale to `libs/antd-locale.ts`.
- A line where upstream edited a string this fork replaced with `t()`: keep the `t()` call and update the JSON value.
- `package.json` / `pnpm-lock.yaml`: keep both sides in `package.json`, then run `pnpm install`.
