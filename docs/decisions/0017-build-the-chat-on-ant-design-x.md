---
status: proposed
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (chat sub-project, Task 4)
---

# Build the chat on Ant Design X with a provider-centred data layer

## Context and Problem Statement

The `/chat/[appId]` page was upstream's: a zustand store, a hand-written provider adapter, custom sidebar, welcome, bubble footer, thought chain and sender wrappers, and a react-markdown pipeline (remark/rehype plugins, react-syntax-highlighter, a regex that turned Markdown images into `<img>` tags, a `<think>` → `<details>` rewrite). [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md) rebuilds the frontend on antd 6 and Ant Design X 2 the way their documentation prescribes; the charter maps the chat onto X's full-page pattern (§4.4: `Conversations`, `Welcome` + `Prompts`, `Bubble.List`, `Actions`, `Think`/`ThoughtChain`, `Sources`, `Sender` + `Attachments`, `XMarkdown` "subject to the spike"). The chat spec (§2) resolves the open questions: the late-history race, the stub's streams, the X locale, the gate, dark first paint, the viewport unit, PRs #7 and #8, every app mode, and the approach.

Two things need a recorded decision: the shape of the data layer every later chat task builds on, and whether `@ant-design/x-markdown` can replace the react-markdown pipeline for real Dify content (spec §6: nine criteria, all must pass, a fix that needs a private API or a patched package counts as a failure).

## Decision Drivers

- Documented X and x-sdk approaches only ([ADR-0002](0002-use-documented-library-approaches-only.md)); custom code only where X has no component.
- One message store per conversation, shared by live replies and history, so one can no longer wipe the other (the late-history race).
- Every app mode and every feature kept (spec §1).
- One Markdown entry point for bubbles, the welcome panel and workflow results.
- No new dependency; package removals happen in Task 19.

## Considered Options

- Provider-centred rebuild: one `AbstractChatProvider` for Dify, `useXChat` and `useXConversations` for state, X components through `contentRender`, custom pieces from antd primitives (spec §2, owner's choice 2026-10-04).
- Keep upstream's store and adapter and restyle the components.
- Markdown: `XMarkdown` with a `components` map and the Latex plugin, against keeping react-markdown restyled with tokens (decided by the spike below).

## Decision Outcome

Chosen option: the provider-centred rebuild, with `XMarkdown` behind `MessageMarkdown`.

- **One provider.** `DifyChatProvider` extends `AbstractChatProvider` and implements only the three transforms (`transformParams`, `transformLocalMessage`, `transformMessage`); requests go through `XRequest(…, { manual: true, fetch })`, the documented `fetch` option routing a HITL resume to the workflow events stream. One provider instance per conversation key, from a cache.
- **Keys.** `conversationKey` is `<appId>:<difyId>` for server conversations and `<appId>:temp:<uuid>` for a new chat; it never changes during the page session. The Dify conversation id lives in a field of the conversation item (`difyId`), set when the first event of a new chat brings it.
- **History.** `defaultMessages` (async, per key) loads `/messages`; a message sent while `isDefaultMessagesRequesting` goes through `queueRequest`, which the SDK flushes when the defaults land.
- **HITL continuation.** After a form is submitted, `onReload(assistantId, { resume })` continues the paused message from the resumed stream; the SDK adds no local bubble.
- **Regenerate** is a new turn (`onRequest` with the preceding user message), not `onReload`, so the live view matches what history will show.
- **Markdown.** `components/chat/message/message-markdown.tsx` is the single renderer: `XMarkdown` with the Latex plugin, a module-constant `components` map (`code` → `CodeHighlighter`/`Mermaid`/ECharts/SVG blocks, `think` → `Think`, `form`/`button` → post-back blocks through `MarkdownSendContext`, `img` → antd `Image`, `video`), an explicit `dompurifyConfig`, `paragraphTag="div"`, `openLinksInNewTab`, and the `x-markdown-light`/`x-markdown-dark` theme class from the theme context. The spike's verdict follows.

The data-layer items are implemented by Tasks 6–17 of the chat plan; this record is completed (status, verification) when they land.

## Markdown verdict (spike, 2026-10-04)

Run on 2026-10-04 with `@ant-design/x-markdown` 2.9.0 and `@ant-design/x` 2.9.0: a temporary signed-in page rendered every sample of `e2e/fixtures/markdown-samples.ts` through `MessageMarkdown` (client only, see the SSR consequence below) and replayed each sample as a stream (20 characters every 30 ms, `hasNextChunk` true until the last chunk). A temporary Playwright spec encoded the criteria and ran on `desktop-light`, `desktop-dark` and `mobile-light`: 27 of 27 passed, with no console error or warning, page error or failed request in any test. Page and spec were deleted after recording; the chat specs from Task 9 on re-verify the criteria in place.

| # | Criterion | Sample | Result | Note |
| --- | --- | --- | --- | --- |
| 1 | Streaming | `streaming` | pass | A DOM observer recorded the text after every mutation: no `](`, `**` or table separator ever reached the screen mid-stream (XMarkdown holds incomplete links, emphasis and tables back); the final render has the table (6 cells), the link with its `href`, the bold text and both list items. |
| 2 | Fenced code | `code` | pass, with a caveat | `CodeHighlighter` highlights `ts` with a language header and a copy button; `mermaid` draws through X `Mermaid`, `echarts` through echarts-for-react, `svg` through the SVG block; inline code stays a plain `<code>`. Diagram fences render as code until the fence closes (`streamStatus`, x-markdown STREAMING.md). `prismLightMode={false}` (documented prop) so Prism resolves aliases such as `ts`; the default light mode loads one file per exact Prism name and warned "Failed to load language: ts". Caveat: under React Strict Mode (development only) X's `Mermaid` draws the first diagram on a page blank: its render effect runs twice and both calls share one element id while mermaid is still loading. With `reactStrictMode: false` (a probe, not committed) the same diagram drew; a diagram mounted later always draws. |
| 3 | Math | `math` | pass | `Latex()` renders `$$…$$` inline and as a block and `\[…\]` inside list items: 4 formulas, 2 of them in list items, no `.katex-error`, no raw delimiters left. |
| 4 | Reasoning | `think` | pass | `<think>` → X `Think`: open with "Thinking... (n.ns)" while the tag is unclosed, collapsed with "Finished thinking (0.1s)" when it closes, expandable on click; a block that was never seen streaming shows the time the think-time store remembers, or "Finished thinking". |
| 5 | Raw HTML | `html` | pass, with a documented fix | `<img>`, `<video controls>`, `<details>`, `<button data-message>` (posts "Tell me more") and `<form data-format="json">` (posts `{"name":"Jane","isFormSubmit":true}`) survive. Fix: DOMPurify's default clobbering protection removed `name="name"` (a form property), so the field lost its name; `SANITIZE_NAMED_PROPS: true` (DOMPurify README) keeps every `id`/`name` with a `user-content-` prefix, and the form block strips the prefix. |
| 6 | Images | `imageFirst`, `html` | pass, with a documented fix | Markdown and HTML images render through antd `Image` with preview (the preview opens on click); content that starts with an image works without the old regex. Fix: antd `Image`'s wrapper is a `<div>`, which React reports inside a `<p>`; `paragraphTag="div"` (x-markdown API, the pattern of X's own chat demos) renders paragraphs as `<div>`s, and `markdown.module.css` gives them back the 16 px gap (`--ant-margin`). |
| 7 | Links | `links`, `streaming` | pass | `openLinksInNewTab` sets `target="_blank"` and `rel="noopener noreferrer"` on Markdown links and autolinks. |
| 8 | Theme | `theme`, `code` | pass, with documented fixes | Both theme stylesheets load; the root carries `x-markdown-dark` or `x-markdown-light` from the theme context. Table cells and the code block follow the scheme with text contrast ≥ 4.5 (dark: td 18.4, th 16.9, code 6.6; light: 21, 20.1, 20.1). Fixes: `CodeHighlighter` always highlights with Prism one-light (in dark the block stayed light, background rgb(250,250,250)), so dark passes `highlightProps={{ style: oneDark, customStyle: { margin: 0 } }}` (documented `highlightProps` → react-syntax-highlighter `style`/`customStyle`); `Mermaid` gets `config={{ theme: 'dark' }}` (labels were unreadable) and ECharts `theme="dark"`. |
| 9 | Performance | `long` | pass | 300 paragraphs (15.8 k characters) streamed in 790 updates in 24.7–24.9 s (the 30 ms timer alone takes 23.7 s), with no "Maximum update depth" error and no console output; `components`, the marked config and `dompurifyConfig` are module constants and the `streaming` option is memoised (XMarkdown rebuilds its parser or renderer when they change). |

Conclusion: **XMarkdown adopted; the react-markdown pipeline and its packages are removed in Task 19.** Every fix above is a documented option of x-markdown, X, DOMPurify, react-syntax-highlighter, mermaid or ECharts; none uses a private API or a patched package.

### Consequences

- Good, because one renderer covers bubbles, the welcome panel and workflow results, with streaming recovery, `<think>`, Dify's post-back forms and buttons, math and diagrams, and no regex preprocessing.
- Good, because history and live replies share one store per conversation, which removes the late-history race at its cause.
- Bad, because `XMarkdown` renders nothing on the server (its renderer skips without a DOM for DOMPurify), so server-rendered content would mismatch on hydration. The chat only feeds it client-fetched data; any server-rendered use must load `MessageMarkdown` with `next/dynamic` and `{ ssr: false }` (Next bundled docs, lazy loading, "Skipping SSR"), as the spike page did.
- Bad, because paragraphs are `<div>`s (`paragraphTag`), so the themes' `p` rules do not apply and the paragraph gap is our one CSS rule.
- Bad, because `id`/`name` attributes in answers carry the `user-content-` prefix: an in-page anchor to a raw-HTML `id` does not resolve.
- Bad, because in development the first Mermaid diagram on a page can draw blank (Strict Mode, X issue above); e2e specs must not assert on the first diagram's drawing.
- Neutral, because `react-syntax-highlighter` stays a direct dependency (the dark Prism style), reversing the spec's plan to remove it.

## Implementation Plan

- **Affected paths**: `components/chat/message/message-markdown.tsx`; `components/chat/message/markdown/` (`components.tsx`, `code-block.tsx`, `echarts-block.tsx`, `echarts-option.ts`, `svg-block.tsx`, `think-block.tsx`, `answer-form.tsx`, `answer-button.tsx`, `markdown-image.tsx`, `video-block.tsx`, `dompurify-config.ts`, `send-context.tsx`, `message-context.tsx`, `dom-node.ts`, `markdown.module.css`); `components/chat/persistence/think-time-storage.ts` (moved from `hooks/useX/`); `e2e/fixtures/markdown-samples.ts` (shared with the stub's `markdown` scenario); the provider, hooks and views of spec §13 in Tasks 6–17.
- **Dependencies**: none added. Removable once the old renderer is deleted (Task 19, each confirmed with `pnpm why`): `react-markdown`, `remark-gfm`, `remark-math`, `remark-breaks`, `rehype-katex`, `rehype-raw`, `katex` (x-markdown brings its own), `hast` and `@types/hast`, `mermaid` (X depends on it). Kept: `react-syntax-highlighter` and `@types/react-syntax-highlighter` (dark Prism style; the direct dependency is 15.x while X uses 16.x), `dompurify` (SVG block, `Config` type), `@svgdotjs/svg.js`, `echarts-for-react`, `zustand`, `idb-keyval`.
- **Patterns to follow**: every Markdown string goes through `MessageMarkdown` (`content`, `streaming` while the reply is updating, `messageId`, `onSend`); new tag handlers go into the module-constant map and read `domNode`/`streamStatus`; anything that needs a complete block waits for `streamStatus === 'done'`. ECharts options from a fence pass through `hardenEChartsOption` (`markdown/echarts-option.ts`), which applies the ECharts Security Guidelines checklist to every option unit the option manager merges (the root, `baseOption`, each timeline `options[i]` and each `media[i].option`): `tooltip.renderMode: 'richText'`, no `title.link`/`sublink`, no series node links (treemap/sunburst `data.link`), no `toolbox.feature.dataView`/`saveAsImage`, no dataset filter `reg`.
- **Patterns to avoid**: inline `components`, `config` or `dompurifyConfig` objects; `ALLOWED_TAGS`/`ALLOWED_ATTR` (they replace DOMPurify's defaults); `SANITIZE_DOM: false`; preprocessing the Markdown string with regexes; a second Markdown renderer.

### Verification

- [x] Markdown spike: nine criteria on three projects, 27/27 passed, no console output (table above).
- [x] `__tests__/markdown-dompurify.test.ts`, `__tests__/markdown-samples.test.ts` and `__tests__/echarts-option.test.ts` pass.
- [ ] A production build draws the first Mermaid diagram on a page (X Mermaid's render effect blanks it under development Strict Mode); Task 20's Docker check ticks this.
- [ ] Tasks 6–17: provider, keys, `defaultMessages` + `queueRequest`, `onReload` resume and regenerate land with their unit and e2e tests; the chat specs re-verify the Markdown criteria in place.
- [ ] Task 19: the old renderer and the removable packages are gone (`git grep` and `pnpm why` empty).

## More Information

Sources: x-markdown skill (`SKILL.md`, `reference/CORE.md`, `STREAMING.md`, `EXTENSIONS.md`, `API.md`) and the installed `XMarkdown/interface.d.ts`; X docs at tag 2.9.0 (`docs/x-markdown/components`, `themes`, `streaming`, demos `components/codeHighlighter.tsx`, `components/think.tsx`, `components/mermaid.tsx`, `codeDemo/supersets.tsx`; `components/code-highlighter/index.en-US.md`); x-components skill `reference/API.md` (CodeHighlighter, Mermaid, Think); DOMPurify README (SANITIZE_NAMED_PROPS); antd 6.6.5 `Image` and `Form` docs (`getValueProps` + `normalize` demo); Next bundled docs `02-guides/lazy-loading.md` and `05-config/01-next-config-js/reactStrictMode.md`. Spec §2, §4–§6, §11; charter §2 and §4.4. Related: [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md), [ADR-0010](0010-verify-the-frontend-with-playwright-and-a-stub-dify-api.md). Retest the Mermaid caveat at the next `@ant-design/x` release.
