# i18n maintenance

All UI text lives in `locales/en/translation.json` and `locales/zh/translation.json`. Components read it with `t('area.key')` from `react-i18next`. Keys are type-checked: a key that is missing from the English file fails `tsc`.

## Adding or changing text

1. Add the key to both JSON files, under the matching area.
2. Use it with `t('area.key')`. Outside React components, use `i18next.t('area.key')`.
3. Run `pnpm test` (checks that both languages have the same keys and placeholders) and `pnpm exec tsc --noEmit`.

Do not name an interpolation variable `count`, and do not run `i18next-cli extract` or `i18next-cli sync`: they rewrite the JSON files and cannot see keys held in constants.

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

The `git grep` lists every non-comment line containing Chinese. `pnpm i18n:lint` lists hardcoded text between JSX tags (it also reports product names such as "Dify App Hub Platform", which are fine). For each new string, add a key to both JSON files and replace the literal with `t()`.

Lines the `git grep` is expected to print:

- `components/chat/i18n-switcher/index.tsx` and `components/chat/chat-layout.tsx`: `中文`, the language's own name.
- `components/chat/markdown-renderer/blocks/think-block.tsx`: `text.includes('思考')`, matching model output.
- `components/chat/chatbox/message/referrence.tsx`: text inside a commented-out block.
- Trailing code comments (for example in `components/chat/theme-config.ts`).
- Server-side files not yet translated: `app/app-management/actions.ts`, `lib/mail.ts`, `lib/auth.ts`.

## Typical merge conflicts

- `libs/i18n.ts`: upstream added or changed inline strings. Keep this fork's version of the file and move upstream's new strings into the two JSON files.
- A line where upstream edited a string this fork replaced with `t()`: keep the `t()` call and update the JSON value.
- `package.json` / `pnpm-lock.yaml`: keep both sides in `package.json`, then run `pnpm install`.
