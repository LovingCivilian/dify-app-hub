# Part 2c: Attachments and Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can attach images, PDFs and text files to a message in an AG-UI app's chat, and they reach the agent inline as the app allows; an admin reads every conversation of an AG-UI app on its Logs page, read-only, and every transcript opened and every attachment fetched there is in the access log, which the owner can read.

**Architecture:** Files are uploaded when picked (`POST /api/apps/[appId]/attachments`), proven by their bytes, processed (images re-encoded by sharp in their own format; PDFs read to text by pdf.js in a worker thread with a memory and a time limit; text files decoded as UTF-8 or UTF-16; long text cut at 100,000 characters) and stored in a new `conversation_attachments` table as `bytea`, unsent; removing a card deletes its file, and the daily purge removes what was never sent. A run's body names the message's files, and the run's transaction links them to the user message it stores. Every run's input then carries every attachment of the conversation inline: the stored user message keeps its text, and the server expands it into AG-UI content parts (images, PDF `document` parts in native mode, `[file name]` text parts otherwise) by the app's current settings. History and the browser show a user turn's files; `GET …/attachments/[attachmentId]` serves them back to their uploader, or to an admin with a `download` row in the new `conversation_access_log`. The admin Logs page is a server page with numbered pages over the app's conversations (offset paging, the owner's choice) and a drawer that reads one transcript through a Route Handler that writes a `view` row; the owner also sees the app's access log.

**Tech Stack:** Next.js 16.3 (Route Handlers with `request.formData()`, server pages with `searchParams`, `serverExternalPackages`, `outputFileTracingIncludes`), Node 22 `worker_threads`, React 19.2, antd 6.6.5 (`Table` with server-side `pagination`, `Drawer`, `Tabs`, `Timeline`, `Descriptions`, `DatePicker.RangePicker`, `Select`, `Switch`, `Radio`, `InputNumber`, `Image.PreviewGroup`, `Upload`) and Ant Design X 2.9 (`Sender` and its `SendButton`, `Sender.Header`, `Attachments`, `FileCard`, `Bubble.List`, `CodeHighlighter`), sharp 0.35.4 (already installed), `pdfjs-dist` 6.4.299 (new, server-only), `@ag-ui/core` 1.0.2 content parts, zod 4.6.5, Drizzle ORM on PostgreSQL 18 (`bytea`, one migration), Vitest 4 (projects `unit`, `db`; node environment), Playwright 1.63 (three projects; the stub on 5399 gains the `files` scenario).

**Spec:** `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` (owner-approved 2026-10-14, decision 56), slice 2c: §7, with 2c's rows in §1, §2.2 (`attachments.*`), §3.4 (the purge of unsent attachments), §8 (the upload codes), §9 (`pdfjs-dist`), §10, §11 and §12. Read its §0 first. Running record: `docs/superpowers/research/2026-10-11-provider-hub/README.md`, decisions 40–71 (69 and 70 hold the owner's answers for this plan; three of them change the spec, see "User decisions"). Research: `…/part2c-files-logs.md` (this plan's research: R1 attachments, R2 documents and images, R3 the Logs, each with the docs, best practice and reference projects behind decisions 69 and 70), `…/part2-hitl-state-files.md` §4 and Implications D (AG-UI content parts, what Pydantic AI accepts, how reference hubs store uploads, PostgreSQL `bytea`, OWASP upload rules), `…/part2-store-and-logs.md` §4, §5.6 and §7.7 (admin access, retention, the access log), `…/agui-spike.md` (only inline base64 attachments reach the model). The 2b plan, `docs/superpowers/plans/2026-10-14-part-2b-agui-hitl.md`, describes the code 2c extends (its Shared contracts); ADR-0035 (one `ChatCard`, the box rule, `lib/chat/sent-answers.ts`) and ADR-0036 (`ChatScroll`) govern the UI 2c adds to.

## Global Constraints

- **Branches.** This plan merges on its own `docs/part-2c-plan` PR first (spec §0, decision 33). The build then runs on `feat/agui-files-logs`, branched from `fork/overhaul` after that merge, in `~/repos/dify-app-hub` itself (no worktree; owner, 2026-10-12). `nvm use` first (Node 22). Nothing is pushed until a task or the owner says so; the PR targets `fork/overhaul` (`gh pr create -R LovingCivilian/dify-app-hub --base fork/overhaul …`). A problem the owner's browser check of 2a finds is fixed on its own `fix/` branch (decision 61), never on `feat/agui-files-logs`; if such a fix, or #73's or #74's, merges while 2c is built, `feat/agui-files-logs` merges `fork/overhaul` in before its gates.
- **Commits.** Conventional (`feat|fix|refactor|test|docs|chore(scope): …`), English, `git add <paths>`, never `-A`. Each message ends, after a blank line inside the same `-m`, with `Co-Authored-By: <the implementer's model> <noreply@anthropic.com>` (the plan's commands show `Claude Opus 5.5`; an implementer on another model writes its own name: the owner keeps the mixed per-model trailers, 2026-10-12), then the `Claude-Session:` line the build session supplies (CLAUDE.md).
- **ADR-0002.** Documented approaches only, a source per non-obvious choice in a comment, as the surrounding code does. Before using an API, check it against every source AGENTS.md names: the repo's docs, Next's bundled docs (`node_modules/next/dist/docs/`), the library's own skill or CLI (`npx -y @ant-design/cli info|doc|demo <Component> --version 6.6.5`, the X skills and `node_modules/@ant-design/x/es/**/*.d.ts`), Context7, crawl4ai. The facts this plan relies on are cited where they are used. The one pattern of the hub's own, the PDF worker thread, and the one undocumented placement, its path's `turbopackIgnore` comment (P5, the owner's accepted exception), are recorded in ADR-0037.
- **Gates before each commit (AGENTS.md):** `pnpm exec next typegen && pnpm exec tsc --noEmit` (tsc checks `__tests__/` and `e2e/` too), `pnpm exec oxlint <changed files>`, `pnpm exec oxfmt --check <changed files>`, `pnpm test`. A task that touches `db/` or `lib/data/` also runs `pnpm test:db`. A task that names e2e specs runs them. UI tasks keep `npx -y @ant-design/cli lint ./ --format json` at `"total": 0` (the ratchet in `docs/frontend-conventions.md`).
- **One heavy process at a time** (~5 GB RAM): one `next dev` per checkout (stop `pnpm dev` before `pnpm test:e2e`); `pnpm test:db` and `pnpm test:e2e` share the e2e PostgreSQL on 127.0.0.1:5433 and never run together; a full e2e run takes about 35 minutes, so it runs in the background. After an e2e run, a stale `.next/dev/types` breaks tsc: `rm -rf .next/dev/types && pnpm exec next typegen`. The owner's local stack (`ai-app-hub-local`, port 5300) is touched only by Task 21's Docker gate.
- **One migration and one dependency.** The migration is Task 3's, generated by `pnpm db:generate --name chat_attachments` and read before it is committed (ADR-0031; never `drizzle-kit push`); its two tables are spec §7's. The dependency is `pdfjs-dist@6.4.299`, pinned exactly (`pnpm add -E`, spec §9; decision 69 (1)), with its optional native `@napi-rs/canvas` skipped (`ignoredOptionalDependencies`, P5), server-only, in `next.config.ts`'s `serverExternalPackages`, and its files and the PDF worker traced into the standalone build by `outputFileTracingIncludes` (Task 5). A task that finds it needs another migration or dependency stops and asks.
- **Server-only stays server-only** (spec §9; the 2a and 2b boundary): `pdfjs-dist`, `sharp`, `@ag-ui/client` and `@ag-ui/encoder` are imported only by modules that start with `import 'server-only'` (`lib/chat/documents.ts`, `lib/chat/uploads.ts`, `lib/chat/attachment-parts.ts`, `lib/settings/images.ts`, `lib/data/**`) or by the PDF worker `lib/chat/pdf-text.worker.mjs`, which only `lib/chat/documents.ts` starts; the client-safe rules (`lib/chat/attachment-rules.ts`, `lib/chat/log-view.ts`, `lib/chat/turn.ts`, `components/**`) import `@ag-ui/core` with `import type` only. Task 21's boundary checks: no `pdfjs`, `pdf.worker`, `@ag-ui/client` or `[ag-ui]` in `.next/static`.
- **The agent contract (spec §2.3) is unchanged except a user message's `content`** (spec §7.1): a string when the message has no attachment, as in 2a; with attachments an array: the text part when the text is not blank, then one part per attachment in the order the user attached them (P11). Data sources only (`{ type: 'data', value: <base64>, mimeType }`), never a URL (decision 48). Every run re-sends every attachment of the conversation (decision 54).
- **Limits** (spec §7.1; decisions 53, 54, 69, 70): a file at most 5 MB; at most 5 files a message; at most 6 MB of stored, sent attachments a conversation; at most 25 unsent files a user; images decoded within 50,000,000 pixels; a PDF read within 256 MB of JS heap and 10 seconds; a file's text at most 100,000 characters (code points) before the truncation note. All of them live in `lib/chat/attachment-rules.ts` (Task 1) and nowhere else.
- **Decision 69 (the owner's first answers, 2026-10-15):** (1) PDFs are read with `pdfjs-dist` 6.4.299; (2) a message may hold files and no text; (3) in `text` mode a file's text is cut at 100,000 characters with a note to the agent and a note on the file's card, and a PDF with no text is refused at upload; (4) every fetch of an attachment by anyone but its uploader writes a `download` row, thumbnails included; (5) the Logs list has numbered pages, a page-size changer, a quick jumper and the total, like the other admin tables (offset paging, replacing the spec's keyset); (6) the extension claims the kind and the bytes must prove it, any of PNG, JPEG or WebP passing for an image; (7) an unsent file stays for the daily purge (reversed by decision 70 (4)); (8) no notice in the chat (the spec's notice line is dropped).
- **Decision 70 (the owner's answers after the research, 2026-10-15):** (1) PDFs are read in a worker thread with a memory and a time limit; (2) chat images may have 50,000,000 pixels (logos and icons keep ADR-0030's 4096 × 4096); (3) text files may be UTF-8 or UTF-16 with a byte-order mark, and other encodings are refused with a "save as UTF-8" message; (4) removing a card deletes its unsent file at once (a delete route), and a user may have at most 25 unsent files; (5) a `download` row names the attachment (`attachment_id`); (6) a text file holding a NUL byte is refused as binary; (7) an animated WebP is refused; (8) JPEG and WebP are re-encoded at quality 90; (9) the PDF worker's path carries `/* turbopackIgnore: true */` (P5), the one accepted exception to ADR-0002.
- **Admins** (ADR-0024): the Logs page is gated by the `(admin)` layout and its page (`requireAdminUser`), the logs Route Handler by its own role check, and every Logs DAL function by `assertAdmin`; the access log tab and its DAL read are the owner role's only. An admin never writes anything in a user's conversation.
- **Every text renders as text** (spec §6.4): file names, conversation titles, extracted text, the access log's names and the state JSON go into React text nodes or antd props that render text, never HTML.
- **Browser (spec §5):** the user side changes only in `components/shared-chat/` and one backwards-compatible prop of the shared `components/chat/chat-view/chat-sender.tsx` (P12); the rest of `components/chat/**` is the Dify chat and behaves exactly as before (its specs, `chat-files.spec.ts` among them, stay green). The admin side adds `components/admin/logs/` and one row action in `components/admin/apps/app-actions.tsx`. X status (transport) and the turn's run outcome stay separate layers.
- **i18n (ADR-0005):** every new text is a key in `locales/{en,zh,ar}/translation.json` (Arabic in Modern Standard Arabic), the full texts are in each task; no plural keys (Arabic has six forms; counts go through `{{count}}` in a neutral sentence); icon-only buttons are named by keys, which the e2e locators use; when a string changes, `e2e/` is searched for the old text; `i18next-cli extract`/`sync` are never run.
- **Tests:** unit tests run in Vitest's node environment (no DOM), so components keep their logic in pure `.ts` modules that the unit suite covers; browser behaviour is proven by the e2e suite on `desktop-light`, `desktop-dark` and `mobile-light`; every Dify spec and every 2a and 2b AG-UI spec stays green. Spec prompts avoid the stub's scenario keywords (Task 18's list).
- **Never** read or print `.env` or `.env*.local`; never send an email address to any service other than this app.
- Line numbers are those of `fork/overhaul` at `09000df4` unless a step says "as of Task N"; the quoted text decides. A step that says "replace the whole of" a file gives its complete new content. The plan file is formatted by oxfmt (lint-staged), which formats its code blocks too and can strip the leading tabs of a fragment quoted from inside a function: find each "replace" fragment by its text and keep the indentation of the lines it replaces.

**User decisions (already made):**

- The plans are written one slice at a time, each against the code as it stands then (record decision 33; decision 51: "One spec, three PRs"); this plan is written against `09000df4`, 2b's merge (decision 68).
- Attachments are stored in PostgreSQL `bytea` and sent inline, never as hub URLs; allowed kinds are per app, images off by default, PDFs and text extracted to text by default (owner, 2026-10-14; decision 48).
- Images keep their size unless the app sets a maximum edge (owner, 2026-10-14: "Per-app max size"; decision 53).
- A per-conversation cap of 6 MB, every attachment re-sent on every run (owner, 2026-10-14: "Per-conversation cap"; decision 54).
- Admins can read every conversation, read-only; each admin view writes an access-log row; a deleted conversation stays visible to admins for 30 days, then the purge (owner, 2026-10-14: "Admins can read", "Audited, notice, soft delete"; decisions 42, 49). The notice part of decision 49 is reversed by decision 69 (below).
- PDFs are read with `pdfjs-dist` 6.4.299 (owner, 2026-10-15: "pdfjs-dist 6.4.299 (Recommended)"; decision 69). Option not taken: `unpdf` 1.9.0.
- A message may carry files and no text (owner, 2026-10-15: "Allow file-only (Recommended)"; decision 69). Option not taken: text required.
- In `text` mode, a file's text is cut at 100,000 characters with a note, and a PDF without text is refused at upload (owner, 2026-10-15: "Cut long, refuse empty (Recommended)"; decision 69). Options not taken: refuse both; cut long and send empty.
- Every fetch of an attachment by someone other than its uploader is a `download` row, thumbnails in the Logs included (owner, 2026-10-15: "Every fetch is a download (Recommended)"; decision 69). Option not taken: file cards that open on click.
- The Logs list has numbered pages like the other admin tables (owner, 2026-10-15: "Numbered pages"; decision 69). Options not taken: "Load more" and Newer/Older pages, both keyset as spec §7.2 had it.
- The extension claims the kind and the bytes must prove it (owner, 2026-10-15: "Bytes prove the kind (Recommended)"; decision 69). Options not taken: exact match; bytes decide everything.
- No notice in the chat (owner, 2026-10-15: "don't show it", typed in place of the two placements offered; decision 69). Spec §7.2's notice bullet and §12's "users see the notice" are struck (Task 20 records it in the spec and ADR-0037).
- PDFs are read in a worker thread with a 256 MB heap limit and a 10-second limit (owner, 2026-10-15: "Worker thread (Recommended)", after the research measured a crafted PDF freezing or crashing the process; decision 70). Options not taken: a child process; the calling thread, as LibreChat and LobeHub do.
- Chat images may have up to 50 MP (owner, 2026-10-15: "Raise to 50 MP (Recommended)"; decision 70). Options not taken: 25 MP; ADR-0030's 16.7 MP.
- Text files may be UTF-8 or UTF-16 (owner, 2026-10-15: "UTF-8 or UTF-16 (Recommended)"; decision 70). Options not taken: UTF-8 only; guessing legacy encodings.
- Removing a card deletes its unsent file, and a user may have at most 25 files waiting to be sent (owner, 2026-10-15: "Add a delete route too", which reverses their earlier "Leave it for the purge" after the research found the gap; decision 70). Options not taken: the limit alone; no limit.
- The plan takes four small additions (owner, 2026-10-15, all four ticked; decision 70): a download row names its attachment; a text file holding NUL is refused; an animated WebP is refused; JPEG and WebP are re-encoded at quality 90.
- The PDF worker's path is marked for the bundler with `/* turbopackIgnore: true */`, the placement Next's own code uses but its docs do not describe (owner, 2026-10-15: "Magic comment (Recommended)", after the drafts found Turbopack bundling the worker; decision 70). Options not taken: a workspace package in `serverExternalPackages` (bundled anyway under this repo's pnpm linking); no worker.
- Every choice is backed by docs, best practice and reference projects (owner, 2026-10-14: "follow docs, best oractiers, and refrense other projetcs"; decision 43; and for this plan, 2026-10-15: "after you finish all of your questions, I want you to look online for documentation, best practices, and relevant projects and how they deal with those": `part2c-files-logs.md`).
- Feature branches run in `~/repos/dify-app-hub` itself, no worktree (owner, 2026-10-12); commits keep the mixed per-model `Co-Authored-By` trailers (owner, 2026-10-12).

## Plan calls (where the spec is silent; for the owner's review of this plan)

Decisions 69 and 70 settle what the owner was asked; these calls settle the rest, each from the docs, best practice and the reference projects in `part2c-files-logs.md` (R1 attachments, R2 documents and images, R3 the Logs).

- **P1. The attachment policy comes from the chat adapter.** `ChatAdapter` gains `attachments(settings): AttachmentPolicy` beside 2b's `hubTools` (spec §4.1: the adapter is given what the provider decides); AG-UI answers its settings' `attachments`. The upload route and the run read it as it is now, so a change in the admin form applies to the next upload and the next run (decision 62's rule for `ask_user`).
- **P2. The settings and the form** (spec §2.2): `attachments: { images: boolean = false, documents: 'off' | 'text' | 'native' = 'text', maxImageEdge: integer 256–8192 | null = null }`, the object itself defaulted, so a document 2a or 2b wrote still parses. The chat DTO carries `attachments: { images, documents: documents !== 'off' }` and never `maxImageEdge`. AG-UI's form gains an "Attachments" section after "Conversation settings": an "Images" switch (tooltip: only for agents whose model reads images), a "Documents" radio group (Off, As text, As PDF; tooltip: most models refuse PDF parts, so "As text" is the safe choice) and a "Largest image edge" number in pixels (empty keeps the size; decision 53).
- **P3. Kinds, extensions and proof** (decision 69 (6), decision 70 (3, 6); OWASP File Upload Cheat Sheet: allow-list the extensions, then validate the content, R1 §2). The extension (the name's last dot segment, lower-cased) claims the kind: image `png jpg jpeg webp`, document `pdf`, text `txt md csv`. The bytes must prove it:
  - an image is what sharp decodes as PNG, JPEG or WebP, any of the three for any image extension; the stored MIME is the decoded format's (LobeHub relabels the same way, R1 §2);
  - a document has `%PDF-` within its first 1,024 bytes, pdf.js's own rule for finding the header (R1 §2), and pdf.js opens it (P5);
  - a text file decodes as UTF-8 (`TextDecoder('utf-8', { fatal: true })`, a leading BOM dropped), or, when it starts with a UTF-16 byte-order mark (`FF FE` or `FE FF`), as UTF-16LE or UTF-16BE with `fatal: true` (WHATWG Encoding; decision 70 (3)); a decoded text that holds U+0000 is refused as binary (decision 70 (6); Open WebUI's rule, R1 §2). Its MIME is `text/plain`, `text/markdown` or `text/csv` by its extension, with the charset it was read in (`; charset=utf-8`, `utf-16le` or `utf-16be`), so the bytes are served back as they were uploaded.
  - **The refusals:** an extension of no kind, or of a kind the app does not allow now, is 415 `attachment_type_not_allowed`; bytes that do not prove the kind are 400 `attachment_invalid`; a text file in another encoding (GBK, Windows-1256, …) is 400 `attachment_encoding`. The browser's `Content-Type` is never read. A name is at most 255 characters (else 400 `attachment_invalid`) and is kept for display only.
- **P4. The codes.** Spec §8's four (413 `attachment_too_large`, also answered from `Content-Length` before the body is read when it exceeds 5 MB plus 64 KB of multipart framing, since a body past Next's 10 MB proxy limit arrives cut and would read as invalid, R1 §4; 413 `conversation_attachments_full`; 415 `attachment_type_not_allowed`; 400 `attachment_invalid`) and four of this plan's, each with its own text in the composer: 400 `attachment_no_text` ("This PDF has no text the agent can read", decision 69 (3)), 400 `attachment_encoding` ("Save the file as UTF-8 text, in Excel: CSV UTF-8", decision 70 (3)), 413 `unsent_attachments_full` ("Too many files are waiting to be sent", decision 70 (4)) and 404 `attachment_not_found` (the serve and delete routes). Spec §8's table gains the four in Task 20.
- **P5. PDFs are read in a worker thread** (decision 70 (1); R2 "Security and limits"). pdf.js in Node runs on the calling thread and no timer can interrupt it (R2 measured a 92 KB PDF stalling the event loop 3.9 s and a 916 KB one crashing the process), so `extractPdfText` runs `lib/chat/pdf-text.worker.mjs` in a Node `worker_threads` `Worker` (Node docs, "Worker threads": `new Worker(filename, { workerData, resourceLimits })`, `worker.terminate()`) with `resourceLimits.maxOldGenerationSizeMb: 256` and a 10-second limit after which the hub terminates it; a timeout, a worker out of memory, a password (`PasswordException`) or a broken file (`InvalidPDFException`) is 400 `attachment_invalid`, in both document modes (Claude refuses encrypted PDFs too, R2). It is the hub's own pattern, not pdf.js's (a maintainer: "we only support standard Web Workers", #21934), recorded in ADR-0037 with its known gap: memory outside the JS heap (the inflated streams) is not bounded by `resourceLimits` (Node docs; R2 measured 985 MB from a crafted 916 KB file). The worker is a plain ES module started by path, `path.join(/* turbopackIgnore: true */ process.cwd(), 'lib/chat/pdf-text.worker.mjs')`, and shipped by `outputFileTracingIncludes` with the pdf.js files it loads (Next's `output.md`: "files to include in the trace", route globs as keys). Without the comment, Turbopack 16.3.4 bundles a `worker_threads` worker into a chunk that breaks at run time; Next's docs describe `turbopackIgnore` on `import()`, `require()` and `new Worker()` expressions, where Turbopack ignores it for `worker_threads`, and this placement on the path is the one Next's own server code uses (`next-server.js`, `image-optimizer.js`). The owner accepted it as the one exception to ADR-0002 (decision 70 (9)); a workspace package listed in `serverExternalPackages` was tried and is bundled too under this repo's pnpm linking. Task 7's build check fails if a Next upgrade changes this. Inside, the R2 call: `getDocument({ data: <a copy>, cMapUrl: <absolute path>/cmaps/, cMapPacked: true, standardFontDataUrl: <absolute path>/standard_fonts/, enableXfa: false, stopAtErrors: false, useSystemFonts: false, disableFontFace: true, verbosity: VerbosityLevel.ERRORS })` from `pdfjs-dist/legacy/build/pdf.mjs` (pdf.js's Node examples; CMaps as filesystem paths ending in `/`, without which CJK text vanishes silently, R2), then `page.streamTextContent()` page by page, items joined as pdf.js's own test helper joins them (`str`, plus `\n` where `hasEOL`), stopping as soon as 100,001 code points are read (R2: cutting after collecting everything protects nothing), and `loadingTask.destroy()`. No `isEvalSupported` (removed by pdf.js #21005). The text is extracted at upload in both document modes, so a later change to `text` mode has it. `@napi-rs/canvas`, `pdfjs-dist`'s optional native dependency (31 MB), is not needed for text in 6.4.299 (R2 measured) and is skipped with pnpm's `ignoredOptionalDependencies`; Task 5's test that imports pdf.js and reads a fixture fails if a later release needs it again.
- **P6. The text cap and its note** (decision 69 (3)). A PDF's text and a text file's decoded text lose any U+0000 (PostgreSQL text cannot hold it; for a text file it was refused already, P3), are cut at 100,000 code points (never inside a surrogate pair), and a cut text ends with `\n\n[truncated: only the first 100,000 characters of this file are included]`, stored with it in `extracted_text`, so the agent always reads the same thing. The upload answers `truncated: true`, and the file's card in the composer reads "Only the first 100,000 characters are sent" (its description, the slot the Dify chat uses for "Uploading…"). Text files are capped in both document modes (they always go as text, spec §7.1). A PDF whose text is blank after trimming is 400 `attachment_no_text` in `text` mode only; in `native` mode the model reads its pages, scans included (R2), and its empty text is stored.
- **P7. Chat images** (spec §7.1, decision 53, decision 70 (2, 7, 8); R2 "Images"). `processChatImage(bytes, { maxEdge })` in `lib/settings/images.ts` decodes with `limitInputPixels: 50_000_000` (`CHAT_IMAGE_MAX_PIXELS`, decision 70: default 24 MP and 48 MP phone photos pass; ADR-0030's 4096 × 4096 stays for logos and icons), sharp's default `failOn`, `autoOrient`, and a `timeout({ seconds: 10 })`; refuses anything but PNG, JPEG and WebP, and an animated WebP (`metadata().pages > 1`, decision 70); keeps the decoded format; resizes `inside` `maxEdge × maxEdge` `withoutEnlargement` only when the app sets `maxEdge`; and re-encodes PNG with sharp's defaults (lossless) and JPEG and WebP at `quality: 90` (decision 70), metadata removed by default. `ImageKind` gains `'chatImage'`, whose byte cap is `ATTACHMENT_MAX_BYTES`.
- **P8. The caps count stored bytes and sent files** (R1 §3). A file's `size` is what is stored (an image after re-encoding, a document or text file as uploaded). The upload checks the file (5 MB), the actor's waiting files (at most 25 unsent across apps, else 413 `unsent_attachments_full`, decision 70 (4)) and, when the form names a `conversationId` (the actor's conversation of this app, else 404 `conversation_not_found`), the conversation's sent total plus this file (else 413 `conversation_attachments_full`); unsent files never count against a conversation, so removing and re-adding a file never locks a user out. The run checks the message's files: 1–5 distinct ids (the body schema), each the actor's unsent attachment of this app (P9), and the conversation's sent total plus the message's files (413 `conversation_attachments_full`), before anything is stored, since a new chat's files have no conversation while they are uploaded.
- **P9. Sending links the files.** Before `startRun`, the run reads the message's files (`unsentAttachments`): fewer than the ids is 400 `attachment_invalid`; a kind the app does not allow now is 415 `attachment_type_not_allowed`; the cap is P8's. Inside `startRun`'s transaction, after the user message is inserted: `UPDATE conversation_attachments SET conversation_id, message_id, position WHERE id = … AND user_id = actor AND app_id = app AND conversation_id IS NULL` for each id, `position` being its index in `attachmentIds` (nothing else keeps the order the user attached them in: uploads finish in any order); fewer rows than ids (a race with a delete, the purge or another send) rolls the transaction back and the route answers 400 `attachment_invalid`.
- **P10. The stored user message keeps its text.** Its `content` stays a string (`''` for a file-only message), and the attachments are joined by `message_id`: when a run's input is built (`withAttachmentParts`, server-only, with the bytes) and when history is read (`files`, metadata only). The run session never writes a `user` message: `startRun` stored it, and the agent's copy carries the inlined bytes, which must never reach `conversation_messages` (a `save()` rule with its own test).
- **P11. The parts** (spec §7.1, decision 54). A user message with attachments goes as `[the text part when the text is not blank, …one part per attachment in the order of its attachmentIds]`, the order kept as `position` (P9), so every run and the history show it the same; a blank text part is left out (Anthropic refuses empty text blocks; CopilotKit's shape, R1 §1): an image as `{ type: 'image', source: { type: 'data', value, mimeType } }`; a PDF in `native` mode as `{ type: 'document', source: { type: 'data', value, mimeType: 'application/pdf' } }`; a PDF in `text` mode and every text file as one text part, `[file <name>]` on its own line followed by the stored text. The app's settings at run time decide: a PDF stored under `native` whose text is empty, read in `text` mode, goes as `[file <name>]\n(no text could be read from this file)`; an attachment whose kind the app no longer allows goes as `[file <name> was not sent: this app no longer accepts this kind of file]`, so the history stays readable and the run is not refused for an old file.
- **P12. File-only messages** (decision 69 (2); X's own Sender demo "Disable Ctrl" does it, R1 §1). The run body's `message.text` may be blank when `attachmentIds` holds at least one id, and a message without files still needs a non-blank text (2a's rule). `ChatSender` gains `canSendEmpty?: boolean`: while it is true and no reply runs, its suffix renders X's `SendButton` with `disabled={false}` (X 2.9 `ActionButton`: the button's own `disabled` wins over the context's `onSendDisabled`, and reports it through `setSubmitDisabled`, so Enter sends too), and `onSubmit` takes a blank text; Send stays disabled for whitespace alone when there is no file (the box's text is trimmed first, R1 §1). A file-only conversation's title is `''`, which the list shows as "New conversation" (spec §3.1).
- **P13. The composer's files.** The shared chat gets its own `useSharedAttachments` (`components/shared-chat/hooks/`), built on the Dify chat's pattern (X `Attachments` in a `Sender.Header` with `forceRender`, the prefix button with its `Badge`, pasted files through `AttachmentsRef.upload`, dropped files on the Sender, a fresh list after a send), not on its Dify upload: the Dify chat is left untouched because Part 3 replaces it (spec §5.1), and its helpers that are not Dify's (`withinLimit`, `formatCount`) are imported, not copied. A file is uploaded when it is picked (`customRequest` → `POST …/attachments`, with the conversation's id when it has one; antd's default, and what every reference hub that stores files does, R1 §4); a refused one keeps its card with its code's text (X's own rendering of a failed item; LobeHub and assistant-ui do the same), and Send waits with "Remove the files that could not be attached" until it is removed (the Dify chat's rule). Removing an uploaded card calls the delete route (P22) and forgets the card whatever it answers; the purge catches a file whose delete failed. The picker's `accept` lists the extensions of the kinds the app allows. The header renders only after hydration (React's two-pass pattern, as `ClientDateTime` does): X's `Sender.Header` with `forceRender` renders the closed panel on the server and nothing on the browser's first render, which the pre-flight saw as hydration errors on every AG-UI chat load.
- **P14. Serving and the download audit** (decision 69 (4), decision 70 (5); R3 §1). `GET /api/apps/[appId]/attachments/[attachmentId]`: the uploader gets it while the app is visible to them and enabled and the conversation is not deleted (no row); an owner or admin otherwise gets a sent attachment of a conversation of this app, deleted or not until the purge, and a `download` row naming the attachment is written before the body is sent; anyone else, an unsent file of someone else, and a malformed id answer 404 `attachment_not_found`. Headers: `Content-Type` as stored, `X-Content-Type-Options: nosniff`, the icon route's sandbox CSP, `Cache-Control: private, no-store` (ASVS 5.0 14.3.2 for sensitive data; with nothing cached, every view of an admin is a fetch and a row, and the 304 question disappears, R3 §1), `Content-Disposition: inline` for an image and `attachment; filename*=UTF-8''<RFC 8187 encoded name>` otherwise.
- **P15. A user turn's files.** `Turn` gains `files?: TurnFile[]` (`id`, `name`, `kind`, `mime`, `size`), set on user turns only: live from the composer's uploaded items, in history from `readThreadPage`'s `files` (the attachments whose `message_id` is among the page's user messages) through `turnsFromMessages`' third argument. The bubble shows images as thumbnails in an antd `Image.PreviewGroup` and the others as X `FileCard`s that download, as `message-files.tsx` does, through the route of P14; the text, when there is any, follows them.
- **P16. The Logs list** (decision 69 (5); antd Table's server-side `pagination`; R3 §2: Dify, Langfuse, agenticos, Open WebUI and LibreChat all page their admin lists with offset and an exact count, Langfuse's pager the closest). The page reads its query from the URL: `page` (≥ 1), `pageSize` (10, 20, 50 or 100; 10 by default, antd's default as the other admin tables), `from` and `to` (ISO 8601 instants, the start and the end of the days picked in the browser's zone), `user` (an account id), `status` (`failed`, `stopped` or `waiting`) and `deleted=1`. It asks the DAL for one page in `updated_at DESC, id DESC` order (`LIMIT`/`OFFSET` on `(app_id, updated_at)`) and the total with the same filters; a conversation that moves while an admin pages may repeat or be skipped once, as in Dify (R3 §2), and the id breaks ties. A filter change goes back to page 1; the pager keeps the filters. A query value that does not parse is dropped (the page shows the unfiltered first page), never a 400 on a page. The open conversation is not in the URL, so a reload writes no second `view` row (R3 §4).
- **P17. A row's figures.** Messages: the conversation's `user` and `assistant` rows. Tokens: over its runs, each `usage` entry's `totalTokens`, else its `inputTokens + outputTokens` (AG-UI 1.0 `TokenUsage`: "totalTokens is the two totals summed"); `null` when no run reported usage. Tags, any of: failed (its newest run failed), stopped (its newest run was cancelled or truncated), waiting for an answer (the run it continues, 2b's `continuedRun` rule, ended `interrupted`, or left a call to `ask_user` without a result), and "Deleted by the user, purged on <date>" (`deleted_at` + 30 days). The status filter matches a tag.
- **P18. The transcript drawer.** "View" on a row opens an antd `Drawer` (`size="large"`, `destroyOnHidden`, keyed by the conversation) that fetches `GET /api/apps/[appId]/logs/[conversationId]`: the user's history page shape (20 turns, "load earlier"), the page's runs as timeline entries, the state and the conversation's facts. Tabs: "Transcript" (2a's `TurnList` with `AssistantTurn` and the user turns, no `TurnAnswersContext`, so every card is read-only and ADR-0035's receipts show the answers; no footer, no composer), "Runs" (antd `Timeline`: status, start, duration, tokens, the error, the interrupts and the answers sent) and "State" (indented JSON in X `CodeHighlighter`). Above the tabs, antd `Descriptions`: the user, created, last activity, deleted and purged on. The route writes the `view` row for the first page only (no `before`), so "load earlier" in the same drawer is one view.
- **P19. The access log tab** (spec §7.2: owner only). `?tab=access` on the same page, with its own numbered pages (the same `page` and `pageSize`); the tab is not rendered for an admin and the DAL refuses anyone but the owner. Columns: when, who (name and email, or "Deleted account" when the actor is gone, since the log has no foreign keys), the action (View, Download), the conversation (its title and its user, or "Purged conversation") and, for a download, the file (its name, or "Removed file" once it is gone). Newest first on a new `(app_id, at)` index (spec §7.2 lists `(conversation_id, at)` and `(actor_id, at)`; the tab reads by app).
- **P20. The "Logs" row action** (spec §7.2). `AdminAppDto` gains `hubHistory`, read from the registry on the server (the client registry `PROVIDER_UI` holds no behaviour); the apps table's "more" menu gets "Logs" after "User view" on those rows only, a link to `/app-management/<id>/logs` in the same tab. The page answers Next's `notFound()` for a missing app or one whose provider keeps no history.
- **P21. The purge** (spec §3.4). The 03:00 job also deletes attachments with no conversation created more than 24 hours earlier (`UNSENT_ATTACHMENT_HOURS`), on a partial index `(created_at) WHERE conversation_id IS NULL`, and logs both counts. A conversation's attachments go with it (cascade).
- **P22. The delete route** (decision 70 (4); LibreChat and LobeHub delete a removed file, and assistant-ui's documented attachment adapter calls a DELETE route, R1 §3). `DELETE /api/apps/[appId]/attachments/[attachmentId]` deletes the actor's own unsent attachment of this app and answers 204; a sent one, another's, an unknown or a malformed id answer 404 `attachment_not_found`. Guarded by `resolveChatRoute`, as the upload.
- **P23. The stub and the seed.** The e2e stub's `files` scenario (`e2e/fixtures/stub/agui.ts`, a keyword no earlier prompt uses) answers one line per content part of the last user message: its type, MIME, decoded byte count, and for a text part its first line, so a spec can read what reached the agent. The seed turns on images and `text` documents for `AGUI_APP` and adds `AGUI_NATIVE_APP` (images off, `native` documents) for the native part and an image refusal.
- **P24. No notice** (decision 69 (8)): nothing is added under or above the composer; spec §7.2's notice bullet and §12's "users see the notice" are struck in Task 20, and ADR-0037 records that the ICO-based line is not shown (R3 §3: the ICO's own example of informing workers is the intranet or signage; GDPR Art. 13 exempts information the person already has; no reference product shows a built-in notice).

## File map

Each task's **Files** section is authoritative; this is the overview.

| Task | Creates | Changes most |
| --- | --- | --- |
| 1 The rules | `lib/chat/attachment-rules.ts`, `__tests__/chat-attachment-rules.test.ts` | — |
| 2 The settings and the adapter | `components/provider-ui/agui/form-section.module.css` | `lib/providers/agui/{schema,provider,chat}.ts`, `lib/chat/adapter.ts`, `components/provider-ui/agui/form-section.tsx`, locales, `__tests__/agui-schema.test.ts` and the typed fixtures |
| 3 The tables | `db/schema/attachments.ts`, `db/migrations/<stamp>_chat_attachments/`, `__tests__/db/attachments-schema.db.test.ts` | `db/schema/{index,columns,conversations}.ts`, `lib/chat/statuses.ts`, `__tests__/db/database.ts`, `__tests__/db/schema.db.test.ts`, `__tests__/db-apps-migrations.test.ts` |
| 4 Chat images | `__tests__/settings-chat-image.test.ts` | `lib/settings/images.ts` |
| 5 PDF and text reading | `lib/chat/documents.ts`, `lib/chat/pdf-text.worker.mjs`, `__tests__/chat-documents.test.ts`, `__tests__/fixtures/pdf/` (with its `generate.mjs`) | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` (`ignoredOptionalDependencies`), `next.config.ts` (`serverExternalPackages`, `outputFileTracingIncludes`) |
| 6 The attachments' data layer and the purge | `lib/data/attachments.ts`, `lib/data/access-log.ts`, `__tests__/db/attachments.db.test.ts` | `lib/chat/purge.ts`, `__tests__/chat-purge.test.ts` |
| 7 The upload route | `lib/chat/uploads.ts`, `app/api/apps/[appId]/attachments/route.ts`, `__tests__/chat-uploads.test.ts` | `lib/http/parse.ts` (`parseFileForm`), `components/shared-chat/run-error.ts`, locales, `__tests__/{api-routes,http-parse,shared-chat-view}.test.ts` |
| 8 The serve and delete routes | `lib/chat/attachment-response.ts`, `app/api/apps/[appId]/attachments/[attachmentId]/route.ts` (GET, DELETE), `__tests__/chat-attachment-response.test.ts` | `__tests__/api-routes.test.ts` |
| 9 Runs carry attachments | `lib/chat/attachment-parts.ts`, `__tests__/chat-attachment-parts.test.ts` | `lib/chat/{schemas,run,session}.ts`, `lib/data/conversations.ts`, `__tests__/chat-{schemas,run,session}.test.ts`, `__tests__/db/conversations-run.db.test.ts` |
| 10 Files in history | — | `lib/chat/turn.ts`, `lib/data/conversations.ts`, `app/api/apps/[appId]/conversations/[conversationId]/route.ts`, `__tests__/chat-{turn,routes}.test.ts`, `__tests__/db/conversations-read.db.test.ts` |
| 11 The composer | `components/shared-chat/hooks/use-shared-attachments.tsx`, `components/shared-chat/attachment-items.ts`, `__tests__/shared-chat-attachment-items.test.ts`, `__tests__/shared-chat-api.test.ts` | `components/shared-chat/{api.ts,shared-chat.tsx,provider/ag-ui-chat-provider.ts,hooks/use-shared-chat.ts}`, `components/chat/chat-view/chat-sender.tsx`, locales, `__tests__/shared-chat-provider.test.ts` |
| 12 Files in the bubble | `components/shared-chat/turn-files.tsx`, `components/shared-chat/turn-files.module.css` | `components/shared-chat/user-turn.tsx` |
| 13 The Logs' data layer | `lib/data/logs.ts`, `lib/chat/log-view.ts`, `__tests__/chat-log-view.test.ts`, `__tests__/db/logs.db.test.ts` | `lib/data/conversations.ts` |
| 14 The Logs route and the row action | `app/api/apps/[appId]/logs/[conversationId]/route.ts`, `components/admin/logs/logs-api.ts`, `__tests__/admin-logs-route.test.ts` | `.gitignore` (`logs/` → `/logs/`), `lib/data/apps.ts`, `components/admin/apps/app-actions.tsx`, `__tests__/api-routes.test.ts`, `__tests__/data-apps.test.ts`, locales |
| 15 The Logs page | `app/(admin)/app-management/[appId]/logs/{page,schemas}.ts(x)`, `components/admin/logs/{app-logs.tsx,logs-filters.tsx,log-columns.ts,use-logs-navigation.ts,logs.module.css}`, `__tests__/admin-logs-{query,page}.test.ts`, `__tests__/admin-log-columns.test.ts` | locales |
| 16 The transcript drawer | `components/admin/logs/{log-drawer.tsx,log-runs.tsx,log-run-items.ts}`, `__tests__/admin-log-runs.test.ts` | `components/admin/logs/app-logs.tsx` (the View column), locales |
| 17 The access log tab | `components/admin/logs/access-log-table.tsx` | `components/admin/logs/app-logs.tsx`, `app/(admin)/app-management/[appId]/logs/page.tsx`, `__tests__/admin-logs-page.test.ts`, locales |
| 18 The e2e stub and seed | `e2e/fixtures/files.ts` | `e2e/fixtures/stub/{agui,agui-apps}.ts`, `e2e/auth.setup.ts`, `__tests__/stub-agui.test.ts` |
| 19 The e2e specs | `e2e/agui-files.spec.ts`, `e2e/agui-logs.spec.ts` | `e2e/agui-admin.spec.ts`, `e2e/screenshots.spec.ts` |
| 20 Records | `docs/decisions/0037-keep-chat-attachments-and-admin-logs-on-the-hub.md` | `docs/decisions/{0030,README}.md`, `docs/agui-agents.md`, `AGENTS.md`, spec §0/§7/§8/§12, running record |
| 21 Gates | — | — (the Docker gate on the owner's local stack) |

## Cross-task ordering

The tasks run in order, 1 to 21. These dependencies are why, and each timing rule has its own test (the 2a and 2b reviews' main catches were orderings).

| Rule | Where | Test |
| --- | --- | --- |
| Task 1's names exist before every later task imports them; Task 3's `ACCESS_ACTIONS` and `LOG_STATUSES` before Tasks 6 and 13 | the modules' imports | tsc |
| Task 2 adds `ChatAdapter.attachments`, so every hand-made adapter in a test gains it in the same commit | `__tests__/` | tsc |
| The migration is generated after the schema compiles and is read before the commit; nothing else in 2c changes `db/schema/` | Task 3 | `pnpm test:db` (the global setup migrates a fresh database) |
| `pdfjs-dist` is in `serverExternalPackages`, and the worker and pdf.js's files in `outputFileTracingIncludes`, in the commit that adds it, so no route bundles it and the standalone build ships them | Task 5 | Task 5's `next build` check of `.next/standalone`; Task 21's `.next/static` grep and the Docker gate's PDF upload |
| The worker is terminated on its time limit and its error becomes `DocumentError`; the hub's thread never runs pdf.js | Task 5, `extractPdfText` | `chat-documents.test.ts`: a fixture that inflates past the time limit answers `DocumentError` and the test's own event loop keeps running |
| A refused upload stores nothing: every check runs before `storeAttachment` | Task 7, `acceptUpload` | `chat-uploads.test.ts`: the store spy is not called on each refusal |
| A `download` row naming the attachment is written before the body leaves, and never for the uploader | Task 6, `readAttachment` | `attachments.db.test.ts` |
| A delete removes only the actor's own unsent file; a sent one stays | Task 6, `deleteUnsentAttachment` | `attachments.db.test.ts` |
| The files are linked in the transaction that stores the user message, after it; a short count rolls everything back (no run, no message, no conversation) | Task 9, `startRun` | `conversations-run.db.test.ts` |
| The run's checks (kinds now, the cap) answer before `startRun`; a refusal stores nothing | Task 9, `runTurn` | `chat-run.test.ts`: `startRun` not called |
| The expanded thread is what the session is seeded with, and the session never writes a `user` row | Task 9, `streamRun` and `RunSession.save` | `chat-session.test.ts`: a user message whose agent copy differs is not saved |
| `readThreadPage` answers `files` (Task 10) before `readThreadPageOf` is split out of it (Task 13) | `lib/data/conversations.ts` | tsc; `conversations-read.db.test.ts` |
| Task 11's `send` resets the composer only when the send was taken | `shared-chat.tsx` | Task 19's e2e (a refused send keeps the files) |
| The `view` row is written by the route's first page only, after the conversation is found | Task 13, `readLogThread` | `logs.db.test.ts` |
| Task 14 narrows `.gitignore`'s `logs/` to `/logs/` before any task adds a file under a `logs` folder (git would refuse it) | `.gitignore` | Tasks 14–17's `git add` |
| Tasks 15 → 16 → 17 each change `app-logs.tsx`; 16 and 17 quote it as of the task before | `components/admin/logs/app-logs.tsx` | — |
| Task 18's stub before Task 19's specs; Task 19 before Task 20's records; Task 21 last | — | — |

## Shared contracts

These names, types and signatures are binding across tasks: a task that defines one writes it exactly as here; a task that uses one imports it from here. Comments in the real files follow the surrounding code's style; the comments below say what each piece is for.

### The rules (Task 1) — `lib/chat/attachment-rules.ts`, client-safe, no imports

```ts
export const ATTACHMENT_KINDS = ['image', 'document', 'text'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]
export const DOCUMENTS_MODES = ['off', 'text', 'native'] as const
export type DocumentsMode = (typeof DOCUMENTS_MODES)[number]

/** Spec §7.1: per file (under Next's 10 MB proxyClientMaxBodySize), per message, per conversation; P6: text per file. */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
export const ATTACHMENTS_PER_MESSAGE = 5
export const CONVERSATION_ATTACHMENTS_MAX_BYTES = 6 * 1024 * 1024
export const ATTACHMENT_TEXT_MAX = 100_000
/** P4: the multipart framing allowed above ATTACHMENT_MAX_BYTES before Content-Length alone refuses a body. */
export const UPLOAD_BODY_SLACK_BYTES = 64 * 1024
/** P3: a name longer than this is refused. */
export const ATTACHMENT_NAME_MAX = 255
/** P21: an attachment never sent is purged this many hours after its upload. */
export const UNSENT_ATTACHMENT_HOURS = 24
/** P8, decision 70 (4): the unsent files a user may have at once, across apps. */
export const UNSENT_ATTACHMENTS_MAX = 25
/** P7, decision 70 (2): a chat image's decoded pixels (ADR-0030's 4096 × 4096 stays for logos and icons). */
export const CHAT_IMAGE_MAX_PIXELS = 50_000_000
/** P7, decision 70 (8): JPEG and WebP re-encoding quality (sharp's default is 80). */
export const CHAT_IMAGE_QUALITY = 90
/** P5, decision 70 (1): the PDF worker's JS heap and wall-clock limits. */
export const PDF_WORKER_HEAP_MB = 256
export const PDF_WORKER_TIME_LIMIT_MS = 10_000
/** P3: pdf.js looks for `%PDF-` within this many leading bytes. */
export const PDF_HEADER_SEARCH_BYTES = 1024

/** P3: the extensions each kind claims, lower case, without the dot. */
export const KIND_EXTENSIONS: Readonly<Record<AttachmentKind, readonly string[]>> = {
	image: ['png', 'jpg', 'jpeg', 'webp'],
	document: ['pdf'],
	text: ['txt', 'md', 'csv'],
}
/** P3: the media type stored for a text file, by its extension; the charset it was read in is added (`; charset=utf-8`). */
export const TEXT_MIME: Readonly<Record<string, string>> = {
	txt: 'text/plain',
	md: 'text/markdown',
	csv: 'text/csv',
}
/** P3, decision 70 (3): the encodings a text file may be in. */
export type TextCharset = 'utf-8' | 'utf-16le' | 'utf-16be'
/** The name's last dot segment, lower-cased; '' when the name has none (".env" has none; "a." has none). */
export const extensionOf: (name: string) => string
/** P3: the kind the name claims, or null. */
export const claimedKind: (name: string) => AttachmentKind | null

/** What the server decides by (P1). */
export interface AttachmentPolicy {
	images: boolean
	documents: DocumentsMode
	maxImageEdge: number | null
}
/** What the chat DTO carries (spec §2.2): `documents` is `documents !== 'off'`. */
export interface AttachmentKindsAllowed {
	images: boolean
	documents: boolean
}
export const kindsAllowedBy: (policy: AttachmentPolicy) => AttachmentKindsAllowed
/** The kinds a DTO allows: image when images, document and text when documents. */
export const allowedKinds: (allowed: AttachmentKindsAllowed) => AttachmentKind[]
/** The picker's `accept` string for the allowed kinds, e.g. ".png,.jpg,.jpeg,.webp"; '' when none. */
export const acceptOf: (allowed: AttachmentKindsAllowed) => string

/** Spec §8 and P4: the upload's and the run's refusal codes. */
export const ATTACHMENT_ERROR_CODES = [
	'attachment_too_large',
	'conversation_attachments_full',
	'unsent_attachments_full',
	'attachment_type_not_allowed',
	'attachment_invalid',
	'attachment_encoding',
	'attachment_no_text',
	'attachment_not_found',
] as const
export type AttachmentErrorCode = (typeof ATTACHMENT_ERROR_CODES)[number]
/** A refusal's code: an attachment's, or the conversation an upload names. */
export type UploadRefusalCode = AttachmentErrorCode | 'conversation_not_found'
/** P4: each refusal's HTTP status and the envelope's English message, shared by the upload, serve and run routes (pure data). */
export const UPLOAD_REFUSALS: Readonly<
	Record<UploadRefusalCode, { status: number; message: string }>
>

/** P6: the note a cut text ends with. */
export const TRUNCATED_NOTE =
	'[truncated: only the first 100,000 characters of this file are included]'
/** P6: the text without U+0000, cut at ATTACHMENT_TEXT_MAX code points, the note appended when cut. */
export const capText: (text: string) => { text: string; truncated: boolean }
/** P11: the line a text part starts with. */
export const fileMarker: (name: string) => string // `[file ${name}]`
/** P11: what stands in for a PDF without text, and for a file of a kind the app no longer takes. */
export const NO_TEXT_LINE = '(no text could be read from this file)'
export const notAcceptedLine: (name: string) => string // `[file ${name} was not sent: this app no longer accepts this kind of file]`

/** P15: a file as a user turn shows it, and as the upload answers it (plus `truncated`). */
export interface TurnFile {
	id: string
	name: string
	kind: AttachmentKind
	mime: string
	size: number
}
export interface UploadedAttachment extends TurnFile {
	/** P6: its text was cut at ATTACHMENT_TEXT_MAX. */
	truncated: boolean
}
```

### Settings and the adapter (Task 2)

```ts
// lib/providers/agui/schema.ts — client-safe; zod defaults, so a document 2a or 2b wrote still parses (P2)
export const attachmentsSettingsSchema = z.object({
	images: z.boolean().default(false),
	documents: z.enum(DOCUMENTS_MODES).default('text'),
	maxImageEdge: z.int().min(256).max(8192).nullable().default(null),
})
// aguiSettingsSchema gains:
attachments: attachmentsSettingsSchema.default({ images: false, documents: 'text', maxImageEdge: null })
// AGUI_DEFAULT_SETTINGS gains:
attachments: { images: false, documents: 'text', maxImageEdge: null }

// lib/providers/agui/provider.ts
export type AguiChatFields = { askUser: boolean; attachments: AttachmentKindsAllowed }
chatFields: (settings: AguiSettings): AguiChatFields => ({
	askUser: settings.askUser,
	attachments: kindsAllowedBy(settings.attachments),
})

// lib/chat/adapter.ts — ChatAdapter gains (P1)
attachments(settings: ProviderSettings<P>): AttachmentPolicy
// lib/providers/agui/chat.ts
attachments: settings => settings.attachments
```

### The tables (Task 3) — `db/schema/attachments.ts`, exported from `db/schema/index.ts`

```ts
/** Spec §7.1. `id` is minted by the DAL (crypto.randomUUID). A sent row has both conversation_id and message_id. */
export const conversationAttachments = pgTable(
	'conversation_attachments',
	{
		id: uuid().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		appId: uuid('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		conversationId: uuid('conversation_id').references(() => conversations.id, {
			onDelete: 'cascade',
		}),
		messageId: text('message_id'),
		/** P11: the file's 0-based index in its message's attachmentIds, set when it is sent. */
		position: integer('position'),
		kind: text({ enum: ATTACHMENT_KINDS }).notNull(),
		mime: text().notNull(),
		name: text().notNull(),
		size: integer().notNull(),
		sha256: text().notNull(),
		data: bytea().notNull(),
		extractedText: text('extracted_text'),
		createdAt: timestamptz('created_at').defaultNow().notNull(),
	},
	table => [
		index('conversation_attachments_conversation_id_message_id_idx').on(
			table.conversationId,
			table.messageId,
		),
		index('conversation_attachments_user_id_idx').on(table.userId),
		index('conversation_attachments_app_id_idx').on(table.appId),
		index('conversation_attachments_unsent_created_at_idx')
			.on(table.createdAt)
			.where(sql`${table.conversationId} IS NULL`),
		check(
			'conversation_attachments_kind_check',
			sql`${table.kind} IN (${listed(ATTACHMENT_KINDS)})`,
		),
		check(
			'conversation_attachments_sent_check',
			sql`(${table.conversationId} IS NULL) = (${table.messageId} IS NULL) AND (${table.conversationId} IS NULL) = (${table.position} IS NULL)`,
		),
	],
)

/** Spec §7.2: no foreign keys, so a row outlives the conversation, the app and the actor; never purged in Part 2. */
export const conversationAccessLog = pgTable(
	'conversation_access_log',
	{
		id: uuid().primaryKey(),
		actorId: uuid('actor_id').notNull(),
		conversationId: uuid('conversation_id').notNull(),
		appId: uuid('app_id').notNull(),
		action: text({ enum: ACCESS_ACTIONS }).notNull(),
		/** Decision 70 (5): the attachment a `download` fetched; null for a `view`. No foreign key either. */
		attachmentId: uuid('attachment_id'),
		at: timestamptz('at').defaultNow().notNull(),
	},
	table => [
		index('conversation_access_log_conversation_id_at_idx').on(table.conversationId, table.at),
		index('conversation_access_log_actor_id_at_idx').on(table.actorId, table.at),
		index('conversation_access_log_app_id_at_idx').on(table.appId, table.at), // P19
		check(
			'conversation_access_log_action_check',
			sql`${table.action} IN (${listed(ACCESS_ACTIONS)})`,
		),
		check(
			'conversation_access_log_attachment_check',
			sql`(${table.action} = 'download') = (${table.attachmentId} IS NOT NULL)`,
		),
	],
)

// lib/chat/statuses.ts (Task 3) — client-safe, beside RUN_STATUSES
export const ACCESS_ACTIONS = ['view', 'download'] as const
export type AccessAction = (typeof ACCESS_ACTIONS)[number]
/** P17: a Logs row's tags (and the status filter's values) besides "deleted". */
export const LOG_STATUSES = ['failed', 'stopped', 'waiting'] as const
export type LogStatus = (typeof LOG_STATUSES)[number]
```

`listed` is the same helper as `db/schema/conversations.ts`'s; Task 3 exports it from `db/schema/columns.ts` and both files import it.

### Images and documents (Tasks 4, 5) — server-only

```ts
// lib/settings/images.ts (Task 4)
export type ImageKind = BrandImageKind | 'appIcon' | 'chatImage'
export type ChatImageMime = 'image/png' | 'image/jpeg' | 'image/webp'
export interface ProcessedChatImage {
	bytes: Buffer
	sha256: string
	width: number
	height: number
	mime: ChatImageMime
}
/** P7: throws ImageError('too_large') over ATTACHMENT_MAX_BYTES, ImageError('not_allowed') for anything not a decodable PNG, JPEG or WebP. */
export function processChatImage(
	input: Buffer,
	options: { maxEdge: number | null },
): Promise<ProcessedChatImage>

// lib/chat/documents.ts (Task 5)
/** P3: `%PDF-` within the first PDF_HEADER_SEARCH_BYTES bytes. */
export const isPdf: (bytes: Uint8Array) => boolean
export class DocumentError extends Error {
	readonly code: 'invalid' // broken, encrypted, too slow or too large for the worker, or not a PDF pdf.js can open
}
/**
 * P5: the PDF's text, read in the worker (`lib/chat/pdf-text.worker.mjs`) under PDF_WORKER_HEAP_MB and
 * PDF_WORKER_TIME_LIMIT_MS, pages joined, no further than ATTACHMENT_TEXT_MAX + 1 code points; DocumentError for a
 * password, a broken file, the time limit or the heap limit.
 */
export function extractPdfText(
	bytes: Uint8Array,
	/** Tests pass smaller limits; the hub uses the defaults. */
	limits?: { heapMb?: number; timeLimitMs?: number },
): Promise<string>
/**
 * P3: the bytes as text: UTF-16LE or UTF-16BE when they start with that byte-order mark, else UTF-8 (a leading BOM
 * dropped), each with `fatal: true`; 'encoding' when they do not decode, 'binary' when the text holds U+0000.
 */
export const decodeText: (
	bytes: Uint8Array,
) => { ok: true; text: string; charset: TextCharset } | { ok: false; reason: 'encoding' | 'binary' }
```

### The attachments' data layer (Task 6) — `lib/data/attachments.ts`, server-only

```ts
export interface NewAttachment {
	appId: string
	kind: AttachmentKind
	mime: string
	name: string
	data: Buffer
	/** P6: the text the agent reads (capped, the note included); null for an image. */
	extractedText: string | null
}
/** Stores an unsent attachment of the actor; computes size and sha256 from `data`. */
export async function storeAttachment(actor: SessionUser, input: NewAttachment): Promise<TurnFile>
/** P8: the actor's unsent attachments, across apps. */
export async function countUnsentAttachments(actor: SessionUser): Promise<number>
/** P22: deletes the actor's own unsent attachment of this app; false when there is none. */
export async function deleteUnsentAttachment(
	actor: SessionUser,
	appId: string,
	attachmentId: string,
): Promise<boolean>
/** P8: the stored bytes of the conversation's sent attachments. */
export async function conversationAttachmentBytes(conversationId: string): Promise<number>
/** P9: the actor's unsent attachments of this app among `ids`, in the order of `ids`; missing ones are left out. */
export async function unsentAttachments(
	actor: SessionUser,
	appId: string,
	ids: readonly string[],
): Promise<TurnFile[]>
export interface AttachmentForAgent extends TurnFile {
	messageId: string
	data: Buffer
	extractedText: string | null
}
/** P10, P11: every sent attachment of the conversation with its bytes, by its message's `seq`, then `position`. */
export async function attachmentsForAgent(conversationId: string): Promise<AttachmentForAgent[]>
/** P15: the metadata of the attachments of these user messages, by `position` within each message. */
export async function attachmentFilesOf(
	conversationId: string,
	messageIds: readonly string[],
): Promise<(TurnFile & { messageId: string })[]>
export interface ServedAttachment extends TurnFile {
	data: Buffer
}
/**
 * P14: the uploader's own (while `appUsable` and its conversation is not deleted), or, for an owner or admin, a sent one
 * of a conversation of this app with a `download` row written first; null otherwise.
 */
export async function readAttachment(
	actor: SessionUser,
	appId: string,
	attachmentId: string,
	options: { appUsable: boolean },
): Promise<ServedAttachment | null>
/** P21: unsent attachments older than UNSENT_ATTACHMENT_HOURS; answers the count. */
export async function purgeUnsentAttachments(now?: Date): Promise<number>

// lib/data/conversations.ts (Task 9): startRun links the message's files (P9)
export interface StartRunInput {
	// …2a's fields…
	/** The message's attachments, linked to `messageId` in the same transaction, each with its index in `ids` as `position`. */
	attachments?: { ids: string[]; messageId: string }
}
export type StartRunResult =
	| { ok: true; key: RunKey }
	| { ok: false; code: 'run_in_progress' | 'conversation_not_found' | 'attachment_invalid' }

// lib/data/conversations.ts (Task 10): a history page carries its user messages' files (P15)
export interface ThreadPage {
	// …2a's fields…
	files: (TurnFile & { messageId: string })[]
}
```

### The access log and the Logs' data layer (Tasks 6, 13)

```ts
// lib/data/access-log.ts (Task 6) — server-only
/** Spec §7.2: one row per transcript opened or attachment fetched by someone other than the conversation's user. */
export async function recordAccess(
	actor: SessionUser,
	entry:
		| { conversationId: string; appId: string; action: 'view' }
		| { conversationId: string; appId: string; action: 'download'; attachmentId: string },
): Promise<void>

// lib/chat/log-view.ts (Task 13) — client-safe, pure; the logs route's body (Task 14) and the drawer's input (Task 16)
export interface LogRunView {
	id: string
	status: RunStatus
	startedAt: string
	finishedAt: string | null
	tokens: number | null
	error: { code?: string; message: string } | null
	/** The interrupts its outcome named. */
	interrupts: number
	/** The answers it was started with (its `resume` entries). */
	answers: number
}
export interface LogConversationPage {
	conversation: {
		id: string
		title: string
		user: { id: string; name: string | null; email: string }
		createdAt: string
		updatedAt: string
		deletedAt: string | null
		state: unknown
	}
	turns: HistoryTurn[]
	runs: LogRunView[]
	cursor: string | null
}
/** P17: a run's tokens from its stored `usage` (AG-UI `TokenUsage[]`): totalTokens, else inputTokens + outputTokens; null when none. */
export const tokensOf: (usage: unknown) => number | null
/** P18: a stored run as the drawer's timeline shows it. */
export const logRunView: (run: ThreadRun) => LogRunView

// lib/data/conversations.ts (Task 13): a page's runs carry their usage too (the drawer's tokens)
export interface ThreadRun extends StoredRun {
	resume: unknown
	usage: unknown
}

// lib/data/logs.ts (Task 13) — server-only; every function assertAdmin(actor) first
export interface LogFilters {
	from?: Date
	to?: Date
	userId?: string
	status?: LogStatus
	includeDeleted: boolean
}
export interface LogPageQuery {
	page: number
	pageSize: number
}
export interface LogListRow {
	id: string
	title: string
	user: { id: string; name: string | null; email: string }
	messages: number
	/** P17: null when no run reported usage. */
	tokens: number | null
	/** ISO 8601. */
	updatedAt: string
	statuses: LogStatus[]
	/** ISO 8601, or null; the purge date is deletedAt + PURGE_AFTER_DAYS. */
	deletedAt: string | null
}
/** The app as the Logs page names it; null when missing or its provider keeps no history (P20). */
export async function findLogsApp(
	actor: SessionUser,
	appId: string,
): Promise<{ id: string; name: string; description: string; hasIcon: boolean } | null>
export async function listAppLogs(
	actor: SessionUser,
	appId: string,
	filters: LogFilters,
	page: LogPageQuery,
): Promise<{ rows: LogListRow[]; total: number }>
/** P16: the accounts with a conversation in this app, for the user filter. */
export async function listLogUsers(actor: SessionUser, appId: string): Promise<UserOption[]>
export interface LogThread extends ThreadPage {
	user: { id: string; name: string | null; email: string }
	createdAt: Date
	deletedAt: Date | null
}
/** P18: any conversation of the app, deleted ones included until the purge; writes the `view` row when `before` is undefined. */
export async function readLogThread(
	actor: SessionUser,
	appId: string,
	conversationId: string,
	page: { before?: number; turns: number },
): Promise<LogThread | null>
export interface AccessLogRow {
	id: string
	/** ISO 8601. */
	at: string
	action: AccessAction
	/** null when the account is gone (the log has no foreign keys). */
	actor: { id: string; name: string | null; email: string } | null
	/** null when the conversation was purged. */
	conversation: { id: string; title: string; userEmail: string } | null
	/** P19: a download's file; `name` null once the file is gone (the log has no foreign keys); null for a view. */
	attachment: { id: string; name: string | null } | null
}
/** P19: the owner only (AuthError('forbidden') for anyone else). */
export async function listAccessLog(
	actor: SessionUser,
	appId: string,
	page: LogPageQuery,
): Promise<{ rows: AccessLogRow[]; total: number }>

// Task 13 also exports two existing helpers: `interruptsOf` (lib/chat/turn.ts) and `hasIcon` (lib/data/apps.ts).
// lib/data/conversations.ts (Task 13): the page reader shared by the user's and the admin's reads
export async function readThreadPageOf(
	conversation: ConversationRecord,
	page: { before?: number; turns: number },
): Promise<ThreadPage>
```

### Uploads, serving and runs (Tasks 7–10) — server-only

```ts
// lib/chat/uploads.ts (Task 7)
export type UploadResult =
	| { ok: true; attachment: UploadedAttachment }
	| { ok: false; code: AttachmentErrorCode | 'conversation_not_found'; status: number }
/** P3–P8: claim, policy, proof, processing, cap, store. */
export async function acceptUpload(args: {
	actor: SessionUser
	appId: string
	policy: AttachmentPolicy
	file: File
	conversationId?: string
}): Promise<UploadResult>

// lib/chat/attachment-response.ts (Task 8)
/** P14: the response headers for a served attachment (unit-tested, spec §10). */
export const attachmentHeaders: (
	file: Pick<TurnFile, 'kind' | 'mime' | 'name' | 'size'>,
) => Record<string, string>

// lib/chat/attachment-parts.ts (Task 9)
import type { ContentPart, Message } from '@ag-ui/core'
/** P11: one attachment's part under the policy. */
export const attachmentPart: (
	attachment: AttachmentForAgent,
	policy: AttachmentPolicy,
) => ContentPart
/** P10, P11: the thread with each user message that has attachments expanded into its content parts. */
export const withAttachmentParts: (
	messages: Message[],
	attachments: readonly AttachmentForAgent[],
	policy: AttachmentPolicy,
) => Message[]

// lib/chat/schemas.ts (Task 9): the message gains its files (P12)
message: z.object({
	text: z.string().max(MESSAGE_TEXT_MAX),
	attachmentIds: z.array(idSchema).min(1).max(ATTACHMENTS_PER_MESSAGE).optional(),
}) // refined: text non-blank unless attachmentIds is present; the ids distinct

// lib/chat/turn.ts (Task 10)
export interface Turn {
	// …2b's fields…
	/** P15: a user turn's files. */
	files?: TurnFile[]
}
export const userTurn: (messageId: string, text: string, files?: TurnFile[]) => Turn
export const turnsFromMessages: (
	rows: readonly TurnMessageRow[],
	runs: readonly TurnRunRow[],
	files?: readonly (TurnFile & { messageId: string })[],
) => HistoryTurn[]
```

Routes (each pinned by `__tests__/api-routes.test.ts`):

| Route | Task | Answers |
| --- | --- | --- |
| `POST /api/apps/[appId]/attachments` | 7 | 201 `UploadedAttachment`; refusals P4, P8; guarded by `resolveChatRoute` |
| `GET /api/apps/[appId]/attachments/[attachmentId]` | 8 | 200 the bytes with `attachmentHeaders`; 401; 404 `attachment_not_found` |
| `DELETE /api/apps/[appId]/attachments/[attachmentId]` | 8 | 204; the `resolveChatRoute` refusals; 404 `attachment_not_found` (P22) |
| `GET /api/apps/[appId]/logs/[conversationId]` | 14 | 200 `LogConversationPage`; 401; 403 `forbidden` for a user; 404 `app_not_found` or `conversation_not_found` |

```ts
// components/admin/logs/logs-api.ts (Task 14) — client-safe; the route's body is lib/chat/log-view.ts's LogConversationPage
export const createLogsApi: (appId: string) => {
	getConversation: (conversationId: string, before?: string) => Promise<LogConversationPage>
}
```

### Browser (Tasks 11, 12, 15–17)

```ts
// components/shared-chat/api.ts (Task 11): three more methods
uploadAttachment: (file: File, conversationId?: string) => Promise<UploadedAttachment> // multipart `file`, `conversationId`
deleteAttachment: (attachmentId: string) => Promise<void> // P22; rejects with RequestError
attachmentUrl: (attachmentId: string) => string

// components/shared-chat/provider/ag-ui-chat-provider.ts (Task 11)
export interface SharedChatInput {
	conversationId?: string
	message?: {
		text: string
		attachmentIds?: string[]
		/** Client-only: the files the local bubble shows; transformParams never sends them. */
		files?: TurnFile[]
	}
	answers?: { resume?: ResumeAnswer[]; toolResults?: ToolAnswer[] }
	continues?: Turn
}

// components/shared-chat/hooks/use-shared-chat.ts (Task 11): send takes the uploaded files
send: (text: string, files?: readonly UploadedAttachment[]) => boolean

// components/shared-chat/hooks/use-shared-attachments.tsx (Task 11)
export const useSharedAttachments: (args: {
	allowed: AttachmentKindsAllowed
	senderRef: React.RefObject<SenderRef | null>
	upload: (file: File) => Promise<UploadedAttachment>
	/** P13: called when an uploaded card is removed; its failure is ignored (the purge catches the file). */
	remove: (attachmentId: string) => Promise<void>
}) => {
	header: SenderProps['header']
	prefix: SenderProps['prefix']
	onPasteFile: SenderProps['onPasteFile']
	/** The uploaded files, in the order attached. */
	files: UploadedAttachment[]
	/** No file uploads and none failed. */
	ready: boolean
	uploading: boolean
	reset: () => void
}
// components/shared-chat/attachment-items.ts (Task 11) — pure, unit-tested. A refused upload's text is
// requestFailureText(error, t, …) (run-error.ts maps every AttachmentErrorCode, Task 7); these word the browser's own checks.
export type PreCheck = 'ok' | 'type' | 'too_large' | 'too_many'
export const preCheck: (file: File, allowed: AttachmentKindsAllowed, count: number) => PreCheck
/** The i18n key of a browser-side refusal: common.unsupported_file_type, shared_chat.error.attachment_too_large, sender.too_many_files. */
export const refusalKey: (check: Exclude<PreCheck, 'ok'>) => string
// Also exported for the hook: preCheckAll, uploadedOf, itemDescriptionKey, toTurnFile (Task 11 defines them).

// components/chat/chat-view/chat-sender.tsx (Task 11): one prop (P12)
canSendEmpty?: boolean

// components/shared-chat/turn-files.tsx (Task 12)
export default function TurnFiles({ files }: { files: readonly TurnFile[] }) // reads useChatAppInfo().id for the URLs

// components/admin/logs/ (Tasks 15–17)
// app/(admin)/app-management/[appId]/logs/schemas.ts (Task 15) — client-safe
export const LOG_PAGE_SIZES = [10, 20, 50, 100] as const
export interface LogsQuery {
	tab: 'conversations' | 'access'
	page: number
	pageSize: (typeof LOG_PAGE_SIZES)[number]
	from?: Date
	to?: Date
	user?: string
	status?: LogStatus
	deleted: boolean
}
/** P16: Next's `searchParams`, each value read on its own; one that does not parse is dropped (its default stands). */
export const parseLogsQuery: (params: Record<string, string | string[] | undefined>) => LogsQuery
/** The URL's query for a LogsQuery, defaults left out (the pager and the filters build their links with it). */
export const logsSearch: (query: LogsQuery) => string
// components/admin/logs/app-logs.tsx (Task 15)
export interface AppLogsProps {
	app: { id: string; name: string; description: string; hasIcon: boolean }
	query: LogsQuery
	list: { rows: LogListRow[]; total: number }
	users: UserOption[]
	/** P19: present for the owner only. */
	access?: { rows: AccessLogRow[]; total: number }
}
export default function AppLogs(props: AppLogsProps)
// components/admin/logs/log-drawer.tsx (Task 16): provides ChatAppInfoContext (the app) around the transcript, so
// TurnFiles' links and the shared cards work as in the user's chat
export default function LogDrawer(props: { app: AppLogsProps['app']; conversationId: string | null; onClose: () => void })
// components/admin/logs/access-log-table.tsx (Task 17)
export default function AccessLogTable(props: { rows: AccessLogRow[]; total: number; query: LogsQuery })
```

## Tasks

### Task 1: The attachment rules

**Goal:** `lib/chat/attachment-rules.ts` (client-safe, no imports) holds every kind, mode, limit, refusal code (with its status and message) and text of 2c's attachments, with the functions that read a file's name as a kind, an app's policy as the chat DTO's allowed kinds and the picker's `accept`, and a file's text as what the agent reads (cut at 100,000 code points with the note).

Spec §7.1 (the kinds and caps: "at most 5 MB per file", "at most 6 MB of attachments per conversation", "at most 5 files per message"; "a text part `[file report.pdf]` followed by the extracted text"), §2.2 ("The chat DTO carries … the allowed attachment kinds (`images`, `documents !== 'off'`), never … `maxImageEdge`"), §8 (the codes), plan calls P3 (the extensions and the claim), P4 (the codes), P6 (the cap and its note), P8 (the caps), P11 (the text part's lines) and P21, decisions 69 (3, 6) and 70 (1–4, 8), and the Shared contracts' "The rules (Task 1)" block, which this task writes exactly. Sources: OWASP File Upload Cheat Sheet ("List allowed extensions", compare the extension case-insensitively and by the last one, limit the filename's length; research R1 §2); MDN `accept` (crawl4ai, `https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/accept`: "a comma-separated list" of unique file type specifiers, one being "a valid case-insensitive filename extension, starting with a period"), which antd Upload's `accept` passes to the native input (`npx -y @ant-design/cli doc Upload --version 6.6.5`); PostgreSQL 18 "Character Types" ("the character with code zero (sometimes called NUL) cannot be stored", research R2 "Long and empty documents" (e)); ECMAScript `String.prototype[Symbol.iterator]` (it yields code points), the cut 2b's `components/shared-chat/activity-view.ts` already makes, so a cut never splits a surrogate pair (R2 (f): `slice` alone "can split 𠮷 or an emoji"). `extensionOf` reads a name as the Dify chat's `extensionOf` does (`components/chat/chat-view/file-types.ts`: the last dot, none when it is the first character, as Node's `path.extname` treats a leading dot), written here again because this module imports nothing and the Dify chat is replaced in Part 3. No later task defines a limit of its own: Task 2 reads `DOCUMENTS_MODES`, `AttachmentPolicy`, `AttachmentKindsAllowed` and `kindsAllowedBy`; Tasks 4–9 the limits, `claimedKind`, `capText`, the codes and the lines; Tasks 7 and 9 `UploadRefusalCode` and `UPLOAD_REFUSALS` (each refusal's status and the API's English message: pure data, kept here rather than in the upload pipeline so the run route reads them without importing sharp or the PDF worker); Tasks 10–12 `TurnFile`, `UploadedAttachment` and `acceptOf`.

**Files:**

- Create: `lib/chat/attachment-rules.ts`
- Test: `__tests__/chat-attachment-rules.test.ts` (the whole file, below)

**Acceptance Criteria:**

- [ ] `extensionOf` answers `pdf` for "report.PDF", `png` for "A.PNG", `gz` for "x.tar.gz", and `''` for "noext", ".env", "a." and "".
- [ ] `claimedKind` answers `image` for png, jpg, jpeg and webp (any case), `document` for pdf, `text` for txt, md and csv, and null for svg, gif, docx, a name without an extension, ".env" and "a.".
- [ ] `kindsAllowedBy` answers `documents: false` for `off` and `true` for `text` and `native`, carries `images`, and never `maxImageEdge`; `allowedKinds` answers `['image', 'document', 'text']`, `['image']`, `['document', 'text']` and `[]` for the four DTOs; `acceptOf` answers `.png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv`, `.png,.jpg,.jpeg,.webp`, `.pdf,.txt,.md,.csv` and `''`.
- [ ] `capText` keeps a text of at most 100,000 code points unchanged (`truncated: false`), 100,000 emoji (200,000 UTF-16 units) included; cuts a text of 100,001 code points to its first 100,000 followed by `\n\n` and `TRUNCATED_NOTE` (`truncated: true`), never inside a surrogate pair; removes every U+0000 before it counts.
- [ ] `UPLOAD_REFUSALS` gives every `UploadRefusalCode` (the eight attachment codes and `conversation_not_found`) its status (413, 413, 413, 415, 400, 400, 400, 404, 404) and the API's English message, read by Task 7's upload route and Task 9's run.
- [ ] `fileMarker('report.pdf')` is `[file report.pdf]`; `notAcceptedLine('photo.png')` is `[file photo.png was not sent: this app no longer accepts this kind of file]`; `NO_TEXT_LINE` is `(no text could be read from this file)`.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the two files.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-attachment-rules.test.ts` → `Test Files  1 passed (1)`, `Tests  40 passed (40)`

**Steps:**

- [ ] **Step 1: Branch and Node**

The plan's own PR has merged (Global Constraints). Run:

```bash
cd ~/repos/dify-app-hub
git switch fork/overhaul && git pull --ff-only
git switch -c feat/agui-files-logs
nvm use
```

Expected: `Switched to a new branch 'feat/agui-files-logs'`; `nvm use` prints Node v22.

- [ ] **Step 2: Write the failing tests**

Create `__tests__/chat-attachment-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	acceptOf,
	allowedKinds,
	ATTACHMENT_TEXT_MAX,
	capText,
	claimedKind,
	extensionOf,
	fileMarker,
	kindsAllowedBy,
	NO_TEXT_LINE,
	notAcceptedLine,
	TRUNCATED_NOTE,
	type AttachmentPolicy,
} from '@/lib/chat/attachment-rules'

const policy = (over: Partial<AttachmentPolicy> = {}): AttachmentPolicy => ({
	images: false,
	documents: 'text',
	maxImageEdge: null,
	...over,
})

// 2c's plan call P3: the last dot segment, lower-cased; OWASP File Upload Cheat Sheet, the extension allow-list.
describe('extensionOf', () => {
	it.each([
		['report.PDF', 'pdf'],
		['A.PNG', 'png'],
		['x.tar.gz', 'gz'],
		['notes.md', 'md'],
	])('reads %s as %s', (name, extension) => {
		expect(extensionOf(name)).toBe(extension)
	})
	it.each([
		['a name with no dot', 'noext'],
		['a hidden file’s name', '.env'],
		['a trailing dot', 'a.'],
		['an empty name', ''],
	])('answers no extension for %s', (_label, name) => {
		expect(extensionOf(name)).toBe('')
	})
})

describe('claimedKind', () => {
	it.each([
		['photo.png', 'image'],
		['photo.JPG', 'image'],
		['photo.jpeg', 'image'],
		['photo.webp', 'image'],
		['report.pdf', 'document'],
		['notes.txt', 'text'],
		['notes.md', 'text'],
		['table.CSV', 'text'],
	])('claims %s as %s', (name, kind) => {
		expect(claimedKind(name)).toBe(kind)
	})
	it.each(['icon.svg', 'anim.gif', 'archive.tar.gz', 'report.docx', 'noext', '.env', 'a.'])(
		'claims no kind for %s',
		name => {
			expect(claimedKind(name)).toBeNull()
		},
	)
})

// Spec §2.2: the chat DTO carries `images` and `documents !== 'off'`, never `maxImageEdge`.
describe('kindsAllowedBy', () => {
	it.each([
		['off', false],
		['text', true],
		['native', true],
	] as const)('reads documents %s as %s', (documents, allowed) => {
		expect(kindsAllowedBy(policy({ documents }))).toEqual({ images: false, documents: allowed })
	})
	it('carries images and never the largest edge', () => {
		const allowed = kindsAllowedBy(policy({ images: true, maxImageEdge: 1024 }))
		expect(allowed).toEqual({ images: true, documents: true })
		expect(allowed).not.toHaveProperty('maxImageEdge')
	})
})

describe('allowedKinds', () => {
	it('allows images for images, and documents and text files for documents', () => {
		expect(allowedKinds({ images: true, documents: true })).toEqual(['image', 'document', 'text'])
		expect(allowedKinds({ images: true, documents: false })).toEqual(['image'])
		expect(allowedKinds({ images: false, documents: true })).toEqual(['document', 'text'])
		expect(allowedKinds({ images: false, documents: false })).toEqual([])
	})
})

// MDN `accept`: a comma-separated list of extensions starting with a period.
describe('acceptOf', () => {
	it('lists the allowed kinds’ extensions', () => {
		expect(acceptOf({ images: true, documents: true })).toBe(
			'.png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv',
		)
		expect(acceptOf({ images: true, documents: false })).toBe('.png,.jpg,.jpeg,.webp')
		expect(acceptOf({ images: false, documents: true })).toBe('.pdf,.txt,.md,.csv')
	})
	it('answers an empty string when nothing is allowed', () => {
		expect(acceptOf({ images: false, documents: false })).toBe('')
	})
})

// 2c's plan call P6 (decision 69 (3)): cut at 100,000 code points with the note; U+0000 removed first.
describe('capText', () => {
	const cut = (kept: string) => `${kept}\n\n${TRUNCATED_NOTE}`

	it('keeps a text under the limit as it is', () => {
		expect(capText('Quarterly report\nPage 1')).toEqual({
			text: 'Quarterly report\nPage 1',
			truncated: false,
		})
	})
	it('keeps a text of exactly the limit as it is', () => {
		const text = 'a'.repeat(ATTACHMENT_TEXT_MAX)
		expect(capText(text)).toEqual({ text, truncated: false })
	})
	it('cuts a text one character over the limit, and adds the note after a blank line', () => {
		const kept = 'a'.repeat(ATTACHMENT_TEXT_MAX)
		expect(capText(`${kept}b`)).toEqual({ text: cut(kept), truncated: true })
	})
	it('counts code points: a text of 100,000 emoji is not cut', () => {
		const text = '😀'.repeat(ATTACHMENT_TEXT_MAX)
		expect(text.length).toBe(2 * ATTACHMENT_TEXT_MAX)
		expect(capText(text)).toEqual({ text, truncated: false })
	})
	it('never splits a surrogate pair at the cut', () => {
		const kept = `${'a'.repeat(ATTACHMENT_TEXT_MAX - 1)}😀`
		expect(capText(`${kept}😀`)).toEqual({ text: cut(kept), truncated: true })
		expect(capText(`${kept}b`).text.slice(ATTACHMENT_TEXT_MAX - 1, ATTACHMENT_TEXT_MAX + 1)).toBe(
			'😀',
		)
	})
	it('removes U+0000 before it counts', () => {
		expect(capText('a\u0000b\u0000')).toEqual({ text: 'ab', truncated: false })
		const text = 'a'.repeat(ATTACHMENT_TEXT_MAX)
		expect(capText(`${text}\u0000`)).toEqual({ text, truncated: false })
		expect(capText(`\u0000${text}b`)).toEqual({ text: cut(text), truncated: true })
	})
	it('words the note for the agent', () => {
		expect(TRUNCATED_NOTE).toBe(
			'[truncated: only the first 100,000 characters of this file are included]',
		)
	})
})

// 2c's plan call P11: the lines a file's text part is built from.
describe('the text part’s lines', () => {
	it('mark a file by its name', () => {
		expect(fileMarker('report.pdf')).toBe('[file report.pdf]')
	})
	it('say a PDF had no text', () => {
		expect(NO_TEXT_LINE).toBe('(no text could be read from this file)')
	})
	it('say a file of a kind the app no longer takes was not sent', () => {
		expect(notAcceptedLine('photo.png')).toBe(
			'[file photo.png was not sent: this app no longer accepts this kind of file]',
		)
	})
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-attachment-rules.test.ts`

Expected: FAIL, `Test Files  1 failed (1)`, `Tests  no tests`, with `Error: Cannot find package '@/lib/chat/attachment-rules' imported from …/__tests__/chat-attachment-rules.test.ts`.

- [ ] **Step 4: Write the rules**

Create `lib/chat/attachment-rules.ts`:

```ts
/*
 * The chat attachments' rules (Part 2 spec §7.1; 2c's plan calls P3, P6, P8 and P11), client-safe and with no imports:
 * the server's upload, run and serving code (lib/chat/uploads.ts, lib/chat/attachment-parts.ts, lib/data/attachments.ts)
 * and the composer (components/shared-chat/) read the same kinds, limits, codes and texts from here, and every limit
 * of 2c lives here and nowhere else.
 */

/** Spec §7.1: what a file may be, each kind proven by its bytes (P3). */
export const ATTACHMENT_KINDS = ['image', 'document', 'text'] as const

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

/** Spec §2.2: `off`, `text` (the hub extracts the text) or `native` (a PDF goes as a `document` part). */
export const DOCUMENTS_MODES = ['off', 'text', 'native'] as const

export type DocumentsMode = (typeof DOCUMENTS_MODES)[number]

/**
 * Spec §7.1: a file at most 5 MB (under Next's 10 MB `proxyClientMaxBodySize`, past which a body arrives cut), at most
 * 5 files a message and 6 MB of sent files a conversation (decision 54: every run re-sends them all); P6: a file's text
 * at most 100,000 characters, counted as code points.
 */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
export const ATTACHMENTS_PER_MESSAGE = 5
export const CONVERSATION_ATTACHMENTS_MAX_BYTES = 6 * 1024 * 1024
export const ATTACHMENT_TEXT_MAX = 100_000
/** P4: the multipart framing allowed above ATTACHMENT_MAX_BYTES before Content-Length alone refuses a body. */
export const UPLOAD_BODY_SLACK_BYTES = 64 * 1024
/** P3: a name longer than this is refused (OWASP File Upload Cheat Sheet: limit the filename's length). */
export const ATTACHMENT_NAME_MAX = 255
/** P21: an attachment never sent is purged this many hours after its upload (spec §3.4). */
export const UNSENT_ATTACHMENT_HOURS = 24
/** P8, decision 70 (4): the unsent files a user may have at once, across apps. */
export const UNSENT_ATTACHMENTS_MAX = 25
/** P7, decision 70 (2): a chat image's decoded pixels (ADR-0030's 4096 × 4096 stays for logos and icons). */
export const CHAT_IMAGE_MAX_PIXELS = 50_000_000
/** P7, decision 70 (8): JPEG and WebP re-encoding quality (sharp's default is 80). */
export const CHAT_IMAGE_QUALITY = 90
/** P5, decision 70 (1): the PDF worker's JS heap and wall-clock limits. */
export const PDF_WORKER_HEAP_MB = 256
export const PDF_WORKER_TIME_LIMIT_MS = 10_000
/** P3: pdf.js looks for `%PDF-` within this many leading bytes (`src/core/document.js`, the header search). */
export const PDF_HEADER_SEARCH_BYTES = 1024

/**
 * P3: the extensions each kind claims, lower case, without the dot (OWASP File Upload Cheat Sheet: "List allowed
 * extensions"; the bytes must then prove the kind).
 */
export const KIND_EXTENSIONS: Readonly<Record<AttachmentKind, readonly string[]>> = {
	image: ['png', 'jpg', 'jpeg', 'webp'],
	document: ['pdf'],
	text: ['txt', 'md', 'csv'],
}

/** P3: the media type stored for a text file, by its extension; the charset it was read in is added (`; charset=utf-8`). */
export const TEXT_MIME: Readonly<Record<string, string>> = {
	txt: 'text/plain',
	md: 'text/markdown',
	csv: 'text/csv',
}

/** P3, decision 70 (3): the encodings a text file may be in. */
export type TextCharset = 'utf-8' | 'utf-16le' | 'utf-16be'

/**
 * The name's last dot segment, lower-cased (OWASP: compare extensions case-insensitively, by the last one); '' when the
 * name has none: no dot, a trailing dot ("a."), or only a leading one (".env", a hidden file's name, as Node's
 * `path.extname` reads it). The Dify chat reads names the same way (components/chat/chat-view/file-types.ts).
 */
export const extensionOf = (name: string): string => {
	const dot = name.lastIndexOf('.')
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** P3: the kind the name's extension claims, or null when no kind lists it. */
export const claimedKind = (name: string): AttachmentKind | null => {
	const extension = extensionOf(name)
	if (!extension) return null
	return ATTACHMENT_KINDS.find(kind => KIND_EXTENSIONS[kind].includes(extension)) ?? null
}

/** What the server decides by (P1): the app's `attachments` settings as they are now (spec §2.2). */
export interface AttachmentPolicy {
	images: boolean
	documents: DocumentsMode
	maxImageEdge: number | null
}

/** What the chat DTO carries (spec §2.2): `documents` is `documents !== 'off'`, and never `maxImageEdge`. */
export interface AttachmentKindsAllowed {
	images: boolean
	documents: boolean
}

/** Spec §2.2: the chat DTO's allowed kinds from the app's policy. */
export const kindsAllowedBy = (policy: AttachmentPolicy): AttachmentKindsAllowed => ({
	images: policy.images,
	documents: policy.documents !== 'off',
})

/** The kinds a DTO allows: image when images, document and text when documents (spec §7.1: text files go as text). */
export const allowedKinds = (allowed: AttachmentKindsAllowed): AttachmentKind[] => [
	...(allowed.images ? (['image'] as const) : []),
	...(allowed.documents ? (['document', 'text'] as const) : []),
]

/**
 * The picker's `accept` string for the allowed kinds, e.g. ".png,.jpg,.jpeg,.webp"; '' when none. MDN `accept`: "a
 * comma-separated list" of "unique file type specifiers", one of which is "a valid case-insensitive filename extension,
 * starting with a period"; antd Upload's `accept` is the native attribute. A hint for the picker only: the server proves
 * every file (P3).
 */
export const acceptOf = (allowed: AttachmentKindsAllowed): string =>
	allowedKinds(allowed)
		.flatMap(kind => KIND_EXTENSIONS[kind].map(extension => `.${extension}`))
		.join(',')

/** Spec §8 and P4: the upload's and the run's refusal codes. */
export const ATTACHMENT_ERROR_CODES = [
	'attachment_too_large',
	'conversation_attachments_full',
	'unsent_attachments_full',
	'attachment_type_not_allowed',
	'attachment_invalid',
	'attachment_encoding',
	'attachment_no_text',
	'attachment_not_found',
] as const

export type AttachmentErrorCode = (typeof ATTACHMENT_ERROR_CODES)[number]

export type UploadRefusalCode = AttachmentErrorCode | 'conversation_not_found'

/**
 * Each refusal's status (spec §8, P4) and the envelope's message. The message is the API's English; the composer words
 * the code by its key (components/shared-chat/run-error.ts; charter §4.5).
 */
export const UPLOAD_REFUSALS: Readonly<
	Record<UploadRefusalCode, { status: number; message: string }>
> = {
	attachment_too_large: { status: 413, message: 'The file is larger than 5 MB.' },
	conversation_attachments_full: {
		status: 413,
		message: 'The conversation already holds 6 MB of files.',
	},
	unsent_attachments_full: { status: 413, message: 'Too many files are waiting to be sent.' },
	attachment_type_not_allowed: {
		status: 415,
		message: 'This app does not accept this kind of file.',
	},
	attachment_invalid: { status: 400, message: 'The file could not be read as its kind.' },
	attachment_encoding: { status: 400, message: 'The text file is not UTF-8 or UTF-16.' },
	attachment_no_text: { status: 400, message: 'The PDF has no text the agent can read.' },
	attachment_not_found: { status: 404, message: 'No such attachment.' },
	conversation_not_found: { status: 404, message: 'No such conversation.' },
}

/** P6: the note a cut text ends with, after a blank line, so the agent knows it reads only the start of the file. */
export const TRUNCATED_NOTE =
	'[truncated: only the first 100,000 characters of this file are included]'

/**
 * P6: the text without U+0000 (PostgreSQL 18 "Character Types": "the character with code zero … cannot be stored"),
 * then, when it has more than ATTACHMENT_TEXT_MAX code points, its first ATTACHMENT_TEXT_MAX and the note. A code point
 * is one or two UTF-16 units, so a text of at most ATTACHMENT_TEXT_MAX units fits; otherwise the string iterator, which
 * yields code points (ECMAScript `String.prototype[Symbol.iterator]`), finds the cut, so no surrogate pair is split (the
 * cut of components/shared-chat/activity-view.ts).
 */
export const capText = (text: string): { text: string; truncated: boolean } => {
	const clean = text.replaceAll('\u0000', '')
	if (clean.length <= ATTACHMENT_TEXT_MAX) return { text: clean, truncated: false }
	let count = 0
	let end = 0
	for (const char of clean) {
		if (count === ATTACHMENT_TEXT_MAX) {
			return { text: `${clean.slice(0, end)}\n\n${TRUNCATED_NOTE}`, truncated: true }
		}
		count += 1
		end += char.length
	}
	return { text: clean, truncated: false }
}

/** P11: the line a file's text part starts with (spec §7.1: "a text part `[file report.pdf]` followed by the text"). */
export const fileMarker = (name: string): string => `[file ${name}]`

/** P11: what follows the marker for a PDF whose stored text is empty (stored under `native`), read in `text` mode. */
export const NO_TEXT_LINE = '(no text could be read from this file)'

/** P11: what stands in for a file of a kind the app no longer takes, so the history stays readable. */
export const notAcceptedLine = (name: string): string =>
	`[file ${name} was not sent: this app no longer accepts this kind of file]`

/** P15: a file as a user turn shows it, and as the upload answers it (plus `truncated`). */
export interface TurnFile {
	id: string
	name: string
	kind: AttachmentKind
	mime: string
	size: number
}

/** P6, P13: the upload's answer (201), which the composer's card keeps. */
export interface UploadedAttachment extends TurnFile {
	/** P6: its text was cut at ATTACHMENT_TEXT_MAX. */
	truncated: boolean
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-attachment-rules.test.ts`

Expected: PASS, `Test Files  1 passed (1)`, `Tests  40 passed (40)`.

- [ ] **Step 6: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/attachment-rules.ts __tests__/chat-attachment-rules.test.ts
pnpm exec oxfmt --check lib/chat/attachment-rules.ts __tests__/chat-attachment-rules.test.ts
pnpm test
```

Expected: tsc exits 0; oxlint prints no finding; oxfmt "All matched files use the correct format"; vitest 0 failed (the pre-flight saw `Test Files  193 passed (193)`, `Tests  2585 passed (2585)`). Nothing renders yet, so the antd lint is unchanged; no `db/` or `lib/data/` file changed, so `pnpm test:db` is not needed.

- [ ] **Step 7: Commit**

```bash
git add lib/chat/attachment-rules.ts __tests__/chat-attachment-rules.test.ts
git commit -m "feat(chat): the attachment rules, kinds, limits and texts

One client-safe module, with no imports, holds every kind, documents
mode, limit, refusal code (with its status and the API's message) and
text of 2c's attachments, so the upload, the run, the serving routes and
the composer read the same values (Part 2 spec §7.1, §8). It reads a name's extension as the kind it claims, an
app's policy as the chat DTO's allowed kinds and the picker's accept
string, and a file's text as the agent reads it: U+0000 removed, cut at
100,000 code points with a note, never inside a surrogate pair (plan
calls P3, P4, P6, P8, P11; decisions 69 and 70).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the two files; lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": ["lib/chat/attachment-rules.ts", "__tests__/chat-attachment-rules.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-attachment-rules.test.ts", "acceptanceCriteria": ["extensionOf answers pdf for report.PDF, png for A.PNG, gz for x.tar.gz, and '' for noext, .env, a. and the empty name", "claimedKind answers image for png/jpg/jpeg/webp in any case, document for pdf, text for txt/md/csv, null for svg, gif, docx and names without an extension", "kindsAllowedBy answers documents false only for off and never carries maxImageEdge; allowedKinds and acceptOf answer the kinds and the exact accept strings for the four DTOs, '' when nothing is allowed", "capText keeps at most 100,000 code points unchanged (100,000 emoji included), cuts 100,001 to 100,000 plus a blank line and TRUNCATED_NOTE with truncated true, never splits a surrogate pair, and removes U+0000 before counting", "UPLOAD_REFUSALS gives each UploadRefusalCode its status and the API's message", "fileMarker, notAcceptedLine and NO_TEXT_LINE answer the P11 texts", "tsc exits 0, pnpm test 0 failed, oxlint and oxfmt clean"], "modelTier": "mechanical"}
```

---

### Task 2: The attachments settings, the chat DTO and the adapter

**Goal:** An AG-UI app's settings carry `attachments` (`images` off, `documents` `'text'`, `maxImageEdge` null by default, so every document 2a and 2b wrote still reads), the admin form shows them in an "Attachments" section, the chat DTO carries the allowed kinds (`images`, `documents !== 'off'`) and never `maxImageEdge`, and `ChatAdapter` answers an app's `AttachmentPolicy`.

Spec §2.2 (the three `attachments.*` rows: `images` "boolean; images allowed (vision models only)", default `false`; `documents` "`'off'` | `'text'` (extract to text in the hub) | `'native'` (send PDF as a `document` part)", default `'text'`; `maxImageEdge` "null, or an integer 256–8192 (pixels on the long edge)", default `null`; "Fields added by 2b and 2c carry zod defaults, so a document written by 2a still parses (zod 4 `.default()`); no data migration"; "The chat DTO carries `askUser` and the allowed attachment kinds (`images`, `documents !== 'off'`), never … `maxImageEdge`"), spec §4.1 (the adapter "is given … the tools"; here also the files it takes), plan calls P1 (the policy comes from the chat adapter, as it is now, decision 62's rule) and P2 (the settings, the DTO and the form's section, its tooltips), decision 53, and the Shared contracts' "Settings and the adapter (Task 2)" block, written exactly. Docs checked: zod 4.6.5 through Context7 (`/colinhacks/zod/v4.6.5`, "schema.default": "Setting a default short-circuits parsing, eagerly returning the provided value", which "must be assignable to the output type", so the object's default names all three fields; "optionality": `z.object({ a: z.string().default("d") }).parse({})` gives `{ a: "d" }`, so a partial object fills its missing fields; `z.int()` is the "safeint" number format, so 1.5 is refused; `node_modules/zod/v4/classic/schemas.js` L1282–1287: the static default is `util.shallowClone`d on each use, so no two parses share it); antd 6.6.5 through `npx -y @ant-design/cli doc <Component> --version 6.6.5`: `Form` (`valuePropName`: "the prop of Switch or Checkbox is `checked`"), `Switch`, `Radio` (`Radio.Group` `options` and `optionType: 'button'`, the access mode's control in `components/admin/apps/app-common-fields.tsx`), `InputNumber` (`min`, `max`, `precision`, `placeholder`; `changeOnBlur`: "Trigger `onChange` when blur. e.g. reset value in range by blur"; `onChange: function(value: number | string | null)`, so a cleared field stores null; its default width is the `controlWidth` token, 90 px, `es/input-number/style/token.js` L8, too narrow for the placeholder, so it takes the row's width through a colocated module class, as `components/chat/chat-view/inputs-form.module.css`'s `.number` does, since InputNumber has no `block`). The admin actions need no change: `createAppFormSchema`, `updateAppFormSchema` and `connectionTestSchema` parse `settings` with `PROVIDER_SCHEMAS.agui.settingsSchema`, the drawer sends the whole store (`form.getFieldsValue(true)`, `app-form-drawer.tsx`), a new app starts from `AGUI_DEFAULT_SETTINGS` through `providerDefaults` (`structuredClone`, so the nested object is the form's own), an edit from the admin DTO's parsed settings (a 2b row reads the defaults), and a refused nested field comes back as `settings.attachments.maxImageEdge`, which the drawer splits on `.` to mark that field. `AguiSettings` (the schema's output) gains a required `attachments`, and `ChatAdapter` a required `attachments` method, so every test that builds typed AG-UI settings or an adapter by hand gains them here (tsc checks `__tests__/`; `grep -rn "askUser:\|hubTools:" __tests__` lists them): `chat-run.test.ts`'s `chat` gains a bare `attachments: vi.fn()`, which Task 9 gives its implementation. Later tasks read what this one adds: Task 7's upload and Task 9's run call `chat.attachments(settings)`; Task 11's composer reads the DTO's `attachments` (with Task 1's `acceptOf`); Task 18 seeds `attachments` for the e2e apps, whose seeded documents (written without `attachments`) read the defaults until then; Task 19 drives the section in the browser. No e2e text changes: `e2e/` has none of the new texts, and the AG-UI admin spec's locators (`getByLabel('Agent URL')`, `getByRole('switch', { name: 'Ask the user' })`) match none of the new labels.

**Files:**

- Modify: `lib/providers/agui/schema.ts` (`attachmentsSettingsSchema`, the `attachments` field with its object default, `AGUI_DEFAULT_SETTINGS`)
- Modify: `lib/providers/agui/provider.ts` (`AguiChatFields`, `chatFields`)
- Modify: `lib/chat/adapter.ts` (`ChatAdapter.attachments`)
- Modify: `lib/providers/agui/chat.ts` (`attachments`)
- Modify: `components/provider-ui/agui/form-section.tsx` (the Attachments section)
- Create: `components/provider-ui/agui/form-section.module.css` (the number's width)
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (eleven `app_setting.*` keys)
- Test: `__tests__/agui-schema.test.ts` (the whole file, below)
- Test: `__tests__/provider-registry.test.ts`, `__tests__/provider-schemas.test.ts`, `__tests__/data-apps.test.ts`, `__tests__/app-management-schemas.test.ts`, `__tests__/agui-chat.test.ts` (expectations that change, and new cases)
- Test: `__tests__/agui-test-connection.test.ts`, `__tests__/chat-run.test.ts`, `__tests__/chat-session.test.ts`, `__tests__/provider-ui.test.ts` (typed fixtures gain `attachments`; the run test's adapter gains `attachments: vi.fn()`)

**Acceptance Criteria:**

- [ ] `aguiSettingsSchema` reads a document without `attachments` with `{ images: false, documents: 'text', maxImageEdge: null }`, fills the fields a partial `attachments` leaves out, keeps `off`, `text` and `native`, keeps `maxImageEdge` null, 256 and 8192, and refuses 255, 8193, 1.5 and `'1024'`, `images` `'true'` and null, `documents` `'pdf'`, `'Text'` and `true`, and `attachments` null or a list; `AGUI_DEFAULT_SETTINGS` is `{ agentUrl: '', audience: '', askUser: false, attachments: { images: false, documents: 'text', maxImageEdge: null } }`.
- [ ] `PROVIDERS.agui.chatFields(settings)` answers `{ askUser, attachments: { images, documents: documents !== 'off' } }`; `toChatAppDto` of an AG-UI app carries `attachments: { images: true, documents: true }` for `{ images: true, documents: 'native', maxImageEdge: 1024 }`, and its JSON has no `maxImageEdge`, `agentUrl`, `audience` or `jwtSecret`.
- [ ] `aguiChat.attachments(settings)` answers the settings' `attachments`, `maxImageEdge` included.
- [ ] `createAppFormSchema` and `updateAppFormSchema` carry `settings.attachments` from the form's JSON (a cleared `maxImageEdge` as null); a largest edge of 100 is refused as `{ 'settings.attachments.maxImageEdge': ['too_small'] }`, a documents mode of `'pdf'` as `{ 'settings.attachments.documents': ['invalid_value'] }`; a 2a row's admin DTO and a connection test read the defaults.
- [ ] The AG-UI form shows an "Attachments" divider after "Conversation settings" with an "Images" switch on `['settings', 'attachments', 'images']`, a "Documents" radio group (Off, As text, As PDF) on `['settings', 'attachments', 'documents']` and a "Largest image edge" InputNumber (256–8192, whole pixels, placeholder "Keep the size") on `['settings', 'attachments', 'maxImageEdge']`, each with its tooltip; the eleven keys exist in en, zh and ar.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the changed files; `npx -y @ant-design/cli lint ./ --format json` reports `"total": 0`.

**Verify:** `pnpm exec vitest run --project unit __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts __tests__/agui-chat.test.ts __tests__/i18n-locales.test.ts` → `Test Files  7 passed (7)`, `Tests  157 passed (157)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Replace the whole of `__tests__/agui-schema.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'

import {
	AGUI_DEFAULT_SECRETS,
	AGUI_DEFAULT_SETTINGS,
	aguiSecretsSchema,
	aguiSecretsUpdateSchema,
	aguiSettingsSchema,
	attachmentsSettingsSchema,
} from '@/lib/providers/agui/schema'

const settings = { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' }
/** Spec §2.2's defaults: images off, documents as text, images at their own size. */
const defaultAttachments = { images: false, documents: 'text', maxImageEdge: null }
const secret = 'k'.repeat(32)

describe("AG-UI's settings (Part 2 spec §2.2)", () => {
	// A key no slice of Part 2 writes.
	it('reads a valid document and drops keys it does not know', () => {
		expect(
			aguiSettingsSchema.parse({
				...settings,
				askUser: true,
				attachments: { images: true, audio: true },
				voice: { enabled: true },
			}),
		).toEqual({
			...settings,
			askUser: true,
			attachments: { ...defaultAttachments, images: true },
		})
	})
	it('takes a Docker service name and an https URL as the agent URL', () => {
		expect(aguiSettingsSchema.safeParse(settings).success).toBe(true)
		expect(
			aguiSettingsSchema.safeParse({ ...settings, agentUrl: 'https://agents.example/agents/a' })
				.success,
		).toBe(true)
	})
	it('trims the audience', () => {
		expect(aguiSettingsSchema.parse({ ...settings, audience: '  assistant ' }).audience).toBe(
			'assistant',
		)
	})
	it.each([
		['an agent URL that is not http(s)', { agentUrl: 'ftp://agents/a' }],
		['an agent URL that is not a URL', { agentUrl: 'agents' }],
		['a 501-character agent URL', { agentUrl: `http://a/${'x'.repeat(492)}` }],
		['an empty audience', { audience: '   ' }],
		['a 256-character audience', { audience: 'a'.repeat(256) }],
	])('refuses %s', (_label, over) => {
		expect(aguiSettingsSchema.safeParse({ ...settings, ...over }).success).toBe(false)
	})
})

// Spec §2.2, §6.2: the switch that advertises the hub's ask_user tool, off unless the admin turns it on.
describe('the ask_user switch', () => {
	it('is off by default, so a document 2a wrote reads with it off', () => {
		expect(aguiSettingsSchema.parse(settings)).toEqual({
			...settings,
			askUser: false,
			attachments: defaultAttachments,
		})
	})
	it('keeps the value it is given', () => {
		expect(aguiSettingsSchema.parse({ ...settings, askUser: true }).askUser).toBe(true)
		expect(aguiSettingsSchema.parse({ ...settings, askUser: false }).askUser).toBe(false)
	})
	it.each([
		['a string', 'true'],
		['a number', 1],
		['null', null],
	])('refuses %s', (_label, askUser) => {
		expect(aguiSettingsSchema.safeParse({ ...settings, askUser }).success).toBe(false)
	})
})

// Spec §2.2 and §7.1, 2c's plan call P2: which files the app's chat takes; zod defaults, so no data migration.
describe('the attachments settings', () => {
	const withAttachments = (attachments: unknown) =>
		aguiSettingsSchema.safeParse({ ...settings, askUser: true, attachments })

	it('read a document 2b wrote, which has none, with the defaults', () => {
		expect(aguiSettingsSchema.parse({ ...settings, askUser: true }).attachments).toEqual(
			defaultAttachments,
		)
	})
	it('fill the fields a document leaves out with their defaults', () => {
		expect(attachmentsSettingsSchema.parse({})).toEqual(defaultAttachments)
		expect(attachmentsSettingsSchema.parse({ images: true })).toEqual({
			...defaultAttachments,
			images: true,
		})
		expect(attachmentsSettingsSchema.parse({ maxImageEdge: 2048 })).toEqual({
			...defaultAttachments,
			maxImageEdge: 2048,
		})
	})
	it('keep the values they are given', () => {
		expect(
			withAttachments({ images: true, documents: 'native', maxImageEdge: 1024 }).data?.attachments,
		).toEqual({ images: true, documents: 'native', maxImageEdge: 1024 })
	})
	it.each(['off', 'text', 'native'])('take documents %s', documents => {
		expect(attachmentsSettingsSchema.parse({ documents }).documents).toBe(documents)
	})
	// Decision 53: null keeps each image's size; otherwise an integer 256–8192.
	it.each([null, 256, 8192])('take %s as the largest image edge', maxImageEdge => {
		expect(attachmentsSettingsSchema.parse({ maxImageEdge }).maxImageEdge).toBe(maxImageEdge)
	})
	it.each([
		['a largest edge under 256', { maxImageEdge: 255 }],
		['a largest edge over 8192', { maxImageEdge: 8193 }],
		['a largest edge that is not an integer', { maxImageEdge: 1.5 }],
		['a largest edge given as a string', { maxImageEdge: '1024' }],
		['images given as a string', { images: 'true' }],
		['images given as null', { images: null }],
		['a documents mode it does not know', { documents: 'pdf' }],
		['a documents mode in another case', { documents: 'Text' }],
		['documents given as a boolean', { documents: true }],
	])('refuse %s', (_label, attachments) => {
		expect(withAttachments(attachments).success).toBe(false)
	})
	// zod 4 `.default()` answers only a missing key: null is a value, and not an object.
	it('refuse null and a list in place of the object', () => {
		expect(withAttachments(null).success).toBe(false)
		expect(withAttachments([]).success).toBe(false)
	})
})

describe("AG-UI's secret (spec §2.2; decision 45)", () => {
	it('takes 32 to 512 characters after trimming', () => {
		expect(aguiSecretsSchema.parse({ jwtSecret: ` ${secret} ` })).toEqual({ jwtSecret: secret })
		expect(aguiSecretsSchema.safeParse({ jwtSecret: 'k'.repeat(512) }).success).toBe(true)
	})
	it.each([
		['31 characters', 'k'.repeat(31)],
		['31 characters padded with blanks', ` ${'k'.repeat(31)} `],
		['513 characters', 'k'.repeat(513)],
	])('refuses %s', (_label, jwtSecret) => {
		expect(aguiSecretsSchema.safeParse({ jwtSecret }).success).toBe(false)
	})
	// ADR-0032: a blank secret on Edit keeps the stored one.
	it('reads a blank or missing secret on an edit as not given', () => {
		expect(aguiSecretsUpdateSchema.parse({ jwtSecret: '   ' })).toEqual({ jwtSecret: undefined })
		expect(aguiSecretsUpdateSchema.parse({})).toEqual({ jwtSecret: undefined })
		expect(aguiSecretsUpdateSchema.parse({ jwtSecret: secret })).toEqual({ jwtSecret: secret })
	})
})

describe('the form’s defaults', () => {
	it('start with empty fields, ask_user off and the attachments’ defaults, which the schemas refuse until filled', () => {
		expect(AGUI_DEFAULT_SETTINGS).toEqual({
			agentUrl: '',
			audience: '',
			askUser: false,
			attachments: defaultAttachments,
		})
		expect(AGUI_DEFAULT_SECRETS).toEqual({ jwtSecret: '' })
		expect(aguiSettingsSchema.safeParse(AGUI_DEFAULT_SETTINGS).success).toBe(false)
		expect(aguiSecretsSchema.safeParse(AGUI_DEFAULT_SECRETS).success).toBe(false)
	})
})
```

In `__tests__/provider-registry.test.ts`, find:

```ts
describe("AG-UI's DTO fields", () => {
	const aguiSettings = {
		agentUrl: 'http://agents:8000/agents/assistant',
		audience: 'assistant',
		askUser: true,
	}
	it('give the chat the ask_user switch only, and the gallery nothing', () => {
		expect(PROVIDERS.agui.chatFields(aguiSettings)).toEqual({ askUser: true })
		expect(PROVIDERS.agui.chatFields({ ...aguiSettings, askUser: false })).toEqual({
			askUser: false,
		})
		expect(PROVIDERS.agui.summaryFields()).toEqual({})
	})
```

Replace with:

```ts
describe("AG-UI's DTO fields", () => {
	const aguiSettings = {
		agentUrl: 'http://agents:8000/agents/assistant',
		audience: 'assistant',
		askUser: true,
		attachments: { images: false, documents: 'text' as const, maxImageEdge: null },
	}
	it('give the chat the ask_user switch and the allowed kinds of file, and the gallery nothing', () => {
		expect(PROVIDERS.agui.chatFields(aguiSettings)).toEqual({
			askUser: true,
			attachments: { images: false, documents: true },
		})
		expect(PROVIDERS.agui.chatFields({ ...aguiSettings, askUser: false })).toEqual({
			askUser: false,
			attachments: { images: false, documents: true },
		})
		expect(PROVIDERS.agui.summaryFields()).toEqual({})
	})
	// 2c's plan call P2: `documents` is `documents !== 'off'`; the largest image edge stays on the server.
	it('give the chat the kinds of file, never the largest image edge', () => {
		const fields = PROVIDERS.agui.chatFields({
			...aguiSettings,
			attachments: { images: true, documents: 'off', maxImageEdge: 1024 },
		})
		expect(fields.attachments).toEqual({ images: true, documents: false })
		expect(JSON.stringify(fields)).not.toContain('maxImageEdge')
		expect(
			PROVIDERS.agui.chatFields({
				...aguiSettings,
				attachments: { images: false, documents: 'native', maxImageEdge: null },
			}).attachments,
		).toEqual({ images: false, documents: true })
	})
```

In `__tests__/provider-schemas.test.ts`, find:

```ts
				settings: { ...agui, askUser: false },
				secrets: { jwtSecret },
```

Replace with:

```ts
				settings: {
					...agui,
					askUser: false,
					attachments: { images: false, documents: 'text', maxImageEdge: null },
				},
				secrets: { jwtSecret },
```

In `__tests__/data-apps.test.ts`, find:

```ts
	// Part 2 spec §2.2: an AG-UI app's chat DTO carries the ask_user switch only, its card nothing of its documents.
	it('an AG-UI app’s chat DTO carries the ask_user switch, never the agent URL or the audience', () => {
		const agui = {
			...record,
			provider: 'agui' as const,
			settings: {
				agentUrl: 'http://agents:8000/agents/assistant',
				audience: 'assistant',
				askUser: true,
			},
		}
		const dto = toChatAppDto(agui)
		expect(dto).toEqual({
			id: 'a1',
			provider: 'agui',
			name: 'Tea',
			description: 'desc',
			enabled: true,
			hasIcon: true,
			askUser: true,
		})
		expect(dto).not.toHaveProperty('agentUrl')
		expect(dto).not.toHaveProperty('audience')
		expect(dto).not.toHaveProperty('jwtSecret')
```

Replace with:

```ts
	// Part 2 spec §2.2: an AG-UI app's chat DTO carries the ask_user switch and the allowed kinds of file only, its card
	// nothing of its documents.
	it('an AG-UI app’s chat DTO carries the ask_user switch and the allowed kinds, never the agent URL, the audience or the largest image edge', () => {
		const agui = {
			...record,
			provider: 'agui' as const,
			settings: {
				agentUrl: 'http://agents:8000/agents/assistant',
				audience: 'assistant',
				askUser: true,
				attachments: { images: true, documents: 'native' as const, maxImageEdge: 1024 },
			},
		}
		const dto = toChatAppDto(agui)
		expect(dto).toEqual({
			id: 'a1',
			provider: 'agui',
			name: 'Tea',
			description: 'desc',
			enabled: true,
			hasIcon: true,
			askUser: true,
			attachments: { images: true, documents: true },
		})
		expect(dto).not.toHaveProperty('agentUrl')
		expect(dto).not.toHaveProperty('audience')
		expect(dto).not.toHaveProperty('jwtSecret')
		expect(JSON.stringify(dto)).not.toContain('maxImageEdge')
```

In `__tests__/data-apps.test.ts`, find:

```ts
// Spec §2.2: a document 2a wrote reads with ask_user off, so the edit form opens with the switch off.
```

Replace with:

```ts
// Spec §2.2: a document 2a wrote reads with ask_user off and the attachments' defaults, so the edit form opens on them.
```

In `__tests__/data-apps.test.ts`, find:

```ts
			settings: { ...agui, askUser: false },
			secretsSet: { jwtSecret: true },
```

Replace with:

```ts
			settings: {
				...agui,
				askUser: false,
				attachments: { images: false, documents: 'text', maxImageEdge: null },
			},
			secretsSet: { jwtSecret: true },
```

In `__tests__/app-management-schemas.test.ts`, find:

```ts
describe('the AG-UI variants', () => {
	const agui = {
```

Replace with:

```ts
describe('the AG-UI variants', () => {
	/** Spec §2.2's defaults, which a form without the Attachments section reads as. */
	const defaultAttachments = { images: false, documents: 'text', maxImageEdge: null }
	const agui = {
```

In `__tests__/app-management-schemas.test.ts`, find:

```ts
expect(parsed.settings).toEqual({ ...agui.settings, askUser: false })
```

Replace with:

```ts
expect(parsed.settings).toEqual({
	...agui.settings,
	askUser: false,
	attachments: defaultAttachments,
})
```

In `__tests__/app-management-schemas.test.ts`, find:

```ts
		expect(formFieldErrors(parsed.error!)).toEqual({ 'settings.askUser': ['invalid_type'] })
	})
```

Replace with:

```ts
		expect(formFieldErrors(parsed.error!)).toEqual({ 'settings.askUser': ['invalid_type'] })
	})
	// Spec §2.2, 2c's plan call P2: the drawer's Attachments section reaches the stored settings; a cleared largest edge is
	// null (antd InputNumber's onChange), which keeps each image's size.
	it('carry the attachments into the settings, and refuse a mode or a largest edge they do not take', () => {
		const attachments = { images: true, documents: 'native', maxImageEdge: 2048 }
		const on = aguiForm({ settings: { ...agui.settings, attachments } })
		expect(createAppFormSchema.parse(on)).toMatchObject({ settings: { attachments } })
		expect(updateAppFormSchema.parse(on)).toMatchObject({ settings: { attachments } })
		const cleared = aguiForm({
			settings: { ...agui.settings, attachments: { ...attachments, maxImageEdge: null } },
		})
		expect(createAppFormSchema.parse(cleared).settings).toMatchObject({
			attachments: { maxImageEdge: null },
		})
		const small = createAppFormSchema.safeParse(
			aguiForm({
				settings: { ...agui.settings, attachments: { ...attachments, maxImageEdge: 100 } },
			}),
		)
		expect(formFieldErrors(small.error!)).toEqual({
			'settings.attachments.maxImageEdge': ['too_small'],
		})
		const mode = updateAppFormSchema.safeParse(
			aguiForm({
				settings: { ...agui.settings, attachments: { ...attachments, documents: 'pdf' } },
			}),
		)
		expect(formFieldErrors(mode.error!)).toEqual({
			'settings.attachments.documents': ['invalid_value'],
		})
	})
```

In `__tests__/app-management-schemas.test.ts`, find:

```ts
			settings: { ...agui.settings, askUser: false },
			secrets: { jwtSecret: undefined },
```

Replace with:

```ts
			settings: { ...agui.settings, askUser: false, attachments: defaultAttachments },
			secrets: { jwtSecret: undefined },
```

In `__tests__/agui-chat.test.ts`, find:

```ts
	settings: {
		agentUrl: 'http://agents.test:8000/agents/assistant',
		audience: 'assistant',
		askUser: false,
	},
```

Replace with:

```ts
	settings: {
		agentUrl: 'http://agents.test:8000/agents/assistant',
		audience: 'assistant',
		askUser: false,
		attachments: { images: false, documents: 'text' as const, maxImageEdge: null },
	},
```

In `__tests__/agui-chat.test.ts`, find:

```ts
		expect(aguiChat.hubTools({ ...app.settings, askUser: false })).toEqual([])
	})
})
```

Replace with:

```ts
		expect(aguiChat.hubTools({ ...app.settings, askUser: false })).toEqual([])
	})
})

// 2c's plan call P1: the upload and the run decide by the app's attachments settings as they are now.
describe('aguiChat.attachments', () => {
	it('answers the app’s attachments settings, the largest image edge included', () => {
		expect(aguiChat.attachments(app.settings)).toEqual({
			images: false,
			documents: 'text',
			maxImageEdge: null,
		})
		const attachments = { images: true, documents: 'native' as const, maxImageEdge: 2048 }
		expect(aguiChat.attachments({ ...app.settings, attachments })).toEqual(attachments)
	})
})
```

Each of these texts occurs once in its file (in `__tests__/data-apps.test.ts`, the comment is the line above `it('carries an AG-UI app’s settings and whether its secret is set, never the secret', …)`, and `settings: { ...agui, askUser: false },` is a few lines below it).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts __tests__/agui-chat.test.ts`

Expected: FAIL, `Test Files  6 failed (6)`, `Tests  31 failed | 116 passed (147)`, among them `TypeError: Cannot read properties of undefined (reading 'parse')` (`attachmentsSettingsSchema` is not exported yet), `TypeError: aguiChat.attachments is not a function` and `AssertionError: expected { askUser: true } to deeply equal { Object (askUser, attachments) }`.

- [ ] **Step 3: The settings, the chat DTO and the adapter's policy**

In `lib/providers/agui/schema.ts`, find:

```ts
import * as z from 'zod'
```

Replace with:

```ts
import * as z from 'zod'

import { DOCUMENTS_MODES } from '@/lib/chat/attachment-rules'
```

In `lib/providers/agui/schema.ts`, find:

```ts
export const aguiSettingsSchema = z.object({
```

Replace with:

```ts
/**
 * Spec §2.2 and §7.1 (2c's plan call P2): which files a user may attach in the app's chat. Images are off by default
 * (vision models only); PDFs and text files go as text the hub extracts by default (`text`), as the PDF itself
 * (`native`, a `document` part) or not at all (`off`); an image keeps its size unless the app sets the longest edge it
 * may have, 256 to 8192 pixels (decision 53). Each field has a zod default (zod 4 `.default()`: a missing key takes the
 * default), and so has the object, so a document 2a or 2b wrote reads with all three.
 */
export const attachmentsSettingsSchema = z.object({
	images: z.boolean().default(false),
	documents: z.enum(DOCUMENTS_MODES).default('text'),
	/** zod 4 `z.int()`: a safe integer, so 1.5 is refused; null keeps each image's size. */
	maxImageEdge: z.int().min(256).max(8192).nullable().default(null),
})

export const aguiSettingsSchema = z.object({
```

In `lib/providers/agui/schema.ts`, find:

```ts
	askUser: z.boolean().default(false),
})
```

Replace with:

```ts
	askUser: z.boolean().default(false),
	/**
	 * 2c's plan call P2: the object's own default is the output a missing key reads as (zod 4 `.default()` short-circuits:
	 * "the default value must be assignable to the output type"), so it names all three fields.
	 */
	attachments: attachmentsSettingsSchema.default({
		images: false,
		documents: 'text',
		maxImageEdge: null,
	}),
})
```

In `lib/providers/agui/schema.ts`, find:

```ts
/** What the form starts a new AG-UI app from: both connection fields empty, for the admin to fill, and `ask_user` off. */
export const AGUI_DEFAULT_SETTINGS: z.input<typeof aguiSettingsSchema> = {
	agentUrl: '',
	audience: '',
	askUser: false,
}
```

Replace with:

```ts
/**
 * What the form starts a new AG-UI app from: both connection fields empty, for the admin to fill, `ask_user` off and the
 * attachments' defaults (images off, documents as text, images at their own size).
 */
export const AGUI_DEFAULT_SETTINGS: z.input<typeof aguiSettingsSchema> = {
	agentUrl: '',
	audience: '',
	askUser: false,
	attachments: { images: false, documents: 'text', maxImageEdge: null },
}
```

In `lib/providers/agui/provider.ts`, find:

```ts
import 'server-only'

import { PROVIDER_SCHEMAS } from '../schemas'
```

Replace with:

```ts
import 'server-only'

import { kindsAllowedBy, type AttachmentKindsAllowed } from '@/lib/chat/attachment-rules'

import { PROVIDER_SCHEMAS } from '../schemas'
```

In `lib/providers/agui/provider.ts`, find:

```ts
/**
 * What the chat DTO carries of an AG-UI app's settings (Part 2 spec §2.2): whether the hub's `ask_user` tool is
 * advertised, which the chat reads to know a pending call waits for the user (decision 62); 2c adds the allowed
 * attachment kinds. Never the agent URL, the audience or the secret.
 */
export type AguiChatFields = { askUser: boolean }
```

Replace with:

```ts
/**
 * What the chat DTO carries of an AG-UI app's settings (Part 2 spec §2.2): whether the hub's `ask_user` tool is
 * advertised, which the chat reads to know a pending call waits for the user (decision 62), and the kinds of file its
 * composer offers (`images`, and `documents` for `documents !== 'off'`; 2c's plan call P2). Never the agent URL, the
 * audience, the largest image edge or the secret.
 */
export type AguiChatFields = { askUser: boolean; attachments: AttachmentKindsAllowed }
```

In `lib/providers/agui/provider.ts`, find:

```ts
	chatFields: (settings: AguiSettings): AguiChatFields => ({ askUser: settings.askUser }),
```

Replace with:

```ts
	chatFields: (settings: AguiSettings): AguiChatFields => ({
		askUser: settings.askUser,
		attachments: kindsAllowedBy(settings.attachments),
	}),
```

In `lib/chat/adapter.ts`, find:

```ts
import type { HubToolName } from './hub-tools'
```

Replace with:

```ts
import type { AttachmentPolicy } from './attachment-rules'
import type { HubToolName } from './hub-tools'
```

In `lib/chat/adapter.ts`, find:

```ts
	hubTools(settings: ProviderSettings<P>): HubToolName[]
```

Replace with:

```ts
	hubTools(settings: ProviderSettings<P>): HubToolName[]
	/**
	 * The files this app takes (2c's plan call P1; spec §7.1), read from its settings as they are now, as `hubTools` is
	 * (decision 62): the upload route checks a file's kind and the largest image edge with it, and the run the kinds of
	 * the message's files and how each goes to the agent (P9, P11).
	 */
	attachments(settings: ProviderSettings<P>): AttachmentPolicy
```

In `lib/providers/agui/chat.ts`, find:

```ts
	hubTools: settings => (settings.askUser ? [ASK_USER_TOOL_NAME] : []),
```

Replace with:

```ts
	hubTools: settings => (settings.askUser ? [ASK_USER_TOOL_NAME] : []),
	/** Spec §2.2, §7.1 (2c's plan call P1): the app's `attachments` settings are the policy, as they are now. */
	attachments: settings => settings.attachments,
```

`attachment-rules.ts` imports nothing, so `schema.ts` stays client-safe (the admin form validates with it).

- [ ] **Step 4: Give the typed fixtures the new field**

`AguiSettings` now requires `attachments` and `ChatAdapter` an `attachments` method, so four more test files fail tsc until they carry them; their tests do not change. A literal kept in a `const` without a type needs `'text' as const` (TypeScript widens a string in a mutable object literal); one written straight into a typed argument does not.

In `__tests__/agui-test-connection.test.ts`, find:

```ts
const settings = {
	agentUrl: 'http://agents:8000/agents/assistant',
	audience: 'assistant',
	askUser: false,
}
```

Replace with:

```ts
const settings = {
	agentUrl: 'http://agents:8000/agents/assistant',
	audience: 'assistant',
	askUser: false,
	attachments: { images: false, documents: 'text' as const, maxImageEdge: null },
}
```

In `__tests__/chat-run.test.ts`, find:

```ts
	settings: { agentUrl: 'http://agent/agents/a', audience: 'a', askUser: false },
```

Replace with:

```ts
	settings: {
		agentUrl: 'http://agent/agents/a',
		audience: 'a',
		askUser: false,
		attachments: { images: false, documents: 'text' as const, maxImageEdge: null },
	},
```

In `__tests__/chat-run.test.ts`, find:

```ts
const chat = { hubTools: vi.fn(), runTurn: vi.fn() }
```

Replace with:

```ts
const chat = { hubTools: vi.fn(), attachments: vi.fn(), runTurn: vi.fn() }
```

In `__tests__/chat-session.test.ts`, find:

```ts
				settings: {
					agentUrl: 'http://agents.test/agents/assistant',
					audience: 'assistant',
					askUser: false,
				},
```

Replace with:

```ts
				settings: {
					agentUrl: 'http://agents.test/agents/assistant',
					audience: 'assistant',
					askUser: false,
					attachments: { images: false, documents: 'text', maxImageEdge: null },
				},
```

In `__tests__/provider-ui.test.ts`, find:

```ts
				settings: { agentUrl: 'http://agents:8000/agents/a', audience: 'a', askUser: false },
```

Replace with:

```ts
				settings: {
					agentUrl: 'http://agents:8000/agents/a',
					audience: 'a',
					askUser: false,
					attachments: { images: false, documents: 'text', maxImageEdge: null },
				},
```

Each of these texts occurs once in its file.

- [ ] **Step 5: The Attachments section of the AG-UI form (plan call P2)**

Create `components/provider-ui/agui/form-section.module.css`:

```css
.number {
	width: 100%;
}
```

In `components/provider-ui/agui/form-section.tsx`, find:

```tsx
import { Divider, Form, Input, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import type * as z from 'zod'

import ConnectionTest from '@/components/admin/apps/connection-test'
import { aguiSecretsSchema, aguiSettingsSchema } from '@/lib/providers/agui/schema'
```

Replace with:

```tsx
import { Divider, Form, Input, InputNumber, Radio, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import type * as z from 'zod'

import ConnectionTest from '@/components/admin/apps/connection-test'
import { DOCUMENTS_MODES, type DocumentsMode } from '@/lib/chat/attachment-rules'
import { aguiSecretsSchema, aguiSettingsSchema } from '@/lib/providers/agui/schema'

import styles from './form-section.module.css'

/**
 * Each documents mode's option text (spec §2.2), in DOCUMENTS_MODES' order; `as const satisfies` keeps each value a
 * literal key, which the typed `t()` requires (types/i18next.d.ts), as Dify's APP_MODE_OPTION_KEYS do.
 */
const DOCUMENTS_MODE_KEYS = {
	off: 'app_setting.attachments_documents_off',
	text: 'app_setting.attachments_documents_text',
	native: 'app_setting.attachments_documents_native',
} as const satisfies Record<DocumentsMode, string>
```

In `components/provider-ui/agui/form-section.tsx`, find:

```tsx
/**
 * AG-UI's sections of the app form (Part 2 spec §2.1, §2.2): Connection (the agent URL, the JWT audience, the JWT secret,
 * Test connection) and Conversation (the hub's ask_user tool, spec §6.2). The secret is write-only as Dify's key is
 * (ADR-0032): required on a new app, and on an edit blank by default, which keeps the stored one. The server parses the
 * documents again.
 */
```

Replace with:

```tsx
/**
 * AG-UI's sections of the app form (Part 2 spec §2.1, §2.2): Connection (the agent URL, the JWT audience, the JWT secret,
 * Test connection), Conversation (the hub's ask_user tool, spec §6.2) and Attachments (the kinds of file the chat takes
 * and the largest image edge, spec §7.1). The secret is write-only as Dify's key is (ADR-0032): required on a new app,
 * and on an edit blank by default, which keeps the stored one. The server parses the documents again.
 */
```

In `components/provider-ui/agui/form-section.tsx`, find:

```tsx
			>
				<Switch />
			</Form.Item>
		</>
	)
}
```

Replace with:

```tsx
			>
				<Switch />
			</Form.Item>

			{/*
			 * 2c's plan call P2: the attachments' three settings, none a connection field. The documents modes as button
			 * options, as the access mode (antd 6.6.5 Radio.Group `options`, `optionType="button"`). The largest edge is an
			 * InputNumber in the schema's bounds, whole pixels (`precision` 0); out-of-range input is brought back into them on
			 * blur (`changeOnBlur`, "e.g. reset value in range by blur"), and a cleared field's value is null (`onChange`:
			 * `number | string | null`), which keeps each image's size (decision 53). It takes the row's width, as the Dify
			 * inputs form's number does (InputNumber has no `block`).
			 */}
			<Divider titlePlacement="start">{t('app_setting.section_attachments')}</Divider>
			<Form.Item
				label={t('app_setting.attachments_images')}
				name={['settings', 'attachments', 'images']}
				tooltip={t('app_setting.attachments_images_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			<Form.Item
				label={t('app_setting.attachments_documents')}
				name={['settings', 'attachments', 'documents']}
				tooltip={t('app_setting.attachments_documents_tooltip')}
			>
				<Radio.Group
					optionType="button"
					options={DOCUMENTS_MODES.map(mode => ({
						value: mode,
						label: t(DOCUMENTS_MODE_KEYS[mode]),
					}))}
				/>
			</Form.Item>
			<Form.Item
				label={t('app_setting.attachments_max_image_edge')}
				name={['settings', 'attachments', 'maxImageEdge']}
				tooltip={t('app_setting.attachments_max_image_edge_tooltip')}
			>
				<InputNumber
					className={styles.number}
					min={256}
					max={8192}
					precision={0}
					placeholder={t('app_setting.attachments_max_image_edge_placeholder')}
				/>
			</Form.Item>
		</>
	)
}
```

`app_setting.section_conversation` and the Conversation section stay as 2b left them; the Attachments section follows them.

- [ ] **Step 6: Add the eleven locale keys**

In each locale file, `app_setting` ends with `ask_user_tooltip` (2b). Add a comma after that line and the eleven keys after it, before the closing `},` of `app_setting`.

`locales/en/translation.json`, find:

```json
		"ask_user_tooltip": "Offer the agent the hub's ask_user tool, so it can ask questions with suggested answers. Leave it off if the agent has its own tool named ask_user."
	},
```

Replace with:

```json
		"ask_user_tooltip": "Offer the agent the hub's ask_user tool, so it can ask questions with suggested answers. Leave it off if the agent has its own tool named ask_user.",
		"section_attachments": "Attachments",
		"attachments_images": "Images",
		"attachments_images_tooltip": "Let users attach PNG, JPEG and WebP images. Turn it on only if the agent's model reads images.",
		"attachments_documents": "Documents",
		"attachments_documents_tooltip": "PDFs and text files (.txt, .md, .csv). As text: the hub reads the text and sends it to the agent. As PDF: the hub sends the PDF itself, which most models refuse, so As text is the safe choice. Text files always go as text.",
		"attachments_documents_off": "Off",
		"attachments_documents_text": "As text",
		"attachments_documents_native": "As PDF",
		"attachments_max_image_edge": "Largest image edge",
		"attachments_max_image_edge_tooltip": "The longest side an image may have, in pixels (256 to 8192). Larger images are scaled down to it before they are sent. Leave it empty to send images at their own size.",
		"attachments_max_image_edge_placeholder": "Keep the size"
	},
```

`locales/zh/translation.json`, find:

```json
		"ask_user_tooltip": "为智能体提供应用中心的 ask_user 工具，使其可以提出附带建议答案的问题。如果智能体已有名为 ask_user 的工具，请保持关闭。"
	},
```

Replace with:

```json
		"ask_user_tooltip": "为智能体提供应用中心的 ask_user 工具，使其可以提出附带建议答案的问题。如果智能体已有名为 ask_user 的工具，请保持关闭。",
		"section_attachments": "附件",
		"attachments_images": "图片",
		"attachments_images_tooltip": "允许用户附加 PNG、JPEG 和 WebP 图片。仅当智能体的模型能读取图片时开启。",
		"attachments_documents": "文档",
		"attachments_documents_tooltip": "PDF 和文本文件（.txt、.md、.csv）。作为文本：应用中心读取文本后发送给智能体。作为 PDF：应用中心直接发送 PDF 文件，但多数模型不接受，因此“作为文本”更稳妥。文本文件始终作为文本发送。",
		"attachments_documents_off": "关闭",
		"attachments_documents_text": "作为文本",
		"attachments_documents_native": "作为 PDF",
		"attachments_max_image_edge": "图片最长边",
		"attachments_max_image_edge_tooltip": "图片最长边的上限，单位为像素（256 到 8192）。更大的图片在发送前会按比例缩小到此尺寸。留空则按原尺寸发送。",
		"attachments_max_image_edge_placeholder": "保持原尺寸"
	},
```

`locales/ar/translation.json` (Modern Standard Arabic, ADR-0005), find:

```json
		"ask_user_tooltip": "يتيح للوكيل أداة ask_user الخاصة بالمنصة ليطرح أسئلة مع إجابات مقترحة. اتركه معطّلًا إذا كان لدى الوكيل أداة خاصة به باسم ask_user."
	},
```

Replace with:

```json
		"ask_user_tooltip": "يتيح للوكيل أداة ask_user الخاصة بالمنصة ليطرح أسئلة مع إجابات مقترحة. اتركه معطّلًا إذا كان لدى الوكيل أداة خاصة به باسم ask_user.",
		"section_attachments": "المرفقات",
		"attachments_images": "الصور",
		"attachments_images_tooltip": "يتيح للمستخدمين إرفاق صور PNG وJPEG وWebP. فعّله فقط إذا كان نموذج الوكيل يقرأ الصور.",
		"attachments_documents": "المستندات",
		"attachments_documents_tooltip": "ملفات PDF والملفات النصية (.txt و.md و.csv). كنص: تقرأ المنصة النص وترسله إلى الوكيل. كملف PDF: ترسل المنصة ملف PDF نفسه، وهو ما ترفضه معظم النماذج، لذا فإن «كنص» هو الخيار الآمن. تُرسل الملفات النصية دائمًا كنص.",
		"attachments_documents_off": "معطّل",
		"attachments_documents_text": "كنص",
		"attachments_documents_native": "كملف PDF",
		"attachments_max_image_edge": "أطول بُعد للصورة",
		"attachments_max_image_edge_tooltip": "أقصى طول لأطول ضلع في الصورة بالبكسل (من 256 إلى 8192). تُصغَّر الصور الأكبر إلى هذا الطول قبل إرسالها. اتركه فارغًا لإرسال الصور بحجمها الأصلي.",
		"attachments_max_image_edge_placeholder": "الإبقاء على الحجم"
	},
```

The zh and ar texts use the words the neighbouring keys use for "hub" (应用中心, المنصة), "agent" (智能体, الوكيل) and "off" (关闭, معطّل as in `ask_user_tooltip`'s "اتركه معطّلًا"). No key is a plural; the numbers are written into the texts.

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts __tests__/agui-chat.test.ts __tests__/i18n-locales.test.ts`

Expected: PASS, `Test Files  7 passed (7)`, `Tests  157 passed (157)`.

- [ ] **Step 8: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/providers/agui/schema.ts lib/providers/agui/provider.ts lib/providers/agui/chat.ts lib/chat/adapter.ts components/provider-ui/agui/form-section.tsx __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts __tests__/agui-chat.test.ts __tests__/agui-test-connection.test.ts __tests__/chat-run.test.ts __tests__/chat-session.test.ts __tests__/provider-ui.test.ts
pnpm exec oxfmt --check lib/providers/agui/schema.ts lib/providers/agui/provider.ts lib/providers/agui/chat.ts lib/chat/adapter.ts components/provider-ui/agui/form-section.tsx components/provider-ui/agui/form-section.module.css locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts __tests__/agui-chat.test.ts __tests__/agui-test-connection.test.ts __tests__/chat-run.test.ts __tests__/chat-session.test.ts __tests__/provider-ui.test.ts
pnpm test
npx -y @ant-design/cli lint ./ --format json
```

Expected: tsc exits 0 (without Step 4 it reports `Property 'attachments' is missing` in `agui-test-connection.test.ts`, `chat-run.test.ts` (the app and the adapter), `chat-session.test.ts` and `provider-ui.test.ts`); oxlint prints no finding; oxfmt "All matched files use the correct format"; vitest 0 failed (the pre-flight saw `Test Files  193 passed (193)`, `Tests  2607 passed (2607)`); the antd lint `"summary": { "total": 0, … }`. No `db/` or `lib/data/` file changed, so `pnpm test:db` is not needed.

- [ ] **Step 9: Commit**

```bash
git add lib/providers/agui/schema.ts lib/providers/agui/provider.ts lib/providers/agui/chat.ts lib/chat/adapter.ts components/provider-ui/agui/form-section.tsx components/provider-ui/agui/form-section.module.css locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts __tests__/agui-chat.test.ts __tests__/agui-test-connection.test.ts __tests__/chat-run.test.ts __tests__/chat-session.test.ts __tests__/provider-ui.test.ts
git commit -m "feat(agui): the attachments settings, the chat DTO's kinds and the adapter's policy

An AG-UI app's settings gain attachments: images off, documents as text
and no largest image edge by default, each a zod default and the object
too, so every document 2a and 2b wrote reads without a data migration.
The admin form shows them in an Attachments section (an Images switch, a
Documents radio group, a Largest image edge number); the chat DTO
carries the allowed kinds and never the largest edge; and ChatAdapter
answers the app's attachment policy as it is now, which the upload and
the run read (Part 2 spec §2.2, §4.1, §7.1; plan calls P1, P2).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the 19 files; lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": ["lib/providers/agui/schema.ts", "lib/providers/agui/provider.ts", "lib/chat/adapter.ts", "lib/providers/agui/chat.ts", "components/provider-ui/agui/form-section.tsx", "components/provider-ui/agui/form-section.module.css", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/agui-schema.test.ts", "__tests__/provider-registry.test.ts", "__tests__/provider-schemas.test.ts", "__tests__/data-apps.test.ts", "__tests__/app-management-schemas.test.ts", "__tests__/agui-chat.test.ts", "__tests__/agui-test-connection.test.ts", "__tests__/chat-run.test.ts", "__tests__/chat-session.test.ts", "__tests__/provider-ui.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts __tests__/agui-chat.test.ts __tests__/i18n-locales.test.ts", "acceptanceCriteria": ["aguiSettingsSchema reads a document without attachments as { images: false, documents: 'text', maxImageEdge: null }, fills a partial object, keeps off/text/native and maxImageEdge null/256/8192, refuses 255, 8193, 1.5, '1024', images 'true' or null, documents 'pdf', 'Text' or true, and attachments null or a list; AGUI_DEFAULT_SETTINGS carries the attachments defaults", "PROVIDERS.agui.chatFields answers { askUser, attachments: { images, documents: documents !== 'off' } }; toChatAppDto of an AG-UI app carries attachments and its JSON has no maxImageEdge, agentUrl, audience or jwtSecret", "aguiChat.attachments(settings) answers settings.attachments, maxImageEdge included", "createAppFormSchema and updateAppFormSchema carry settings.attachments (a cleared maxImageEdge as null); maxImageEdge 100 is settings.attachments.maxImageEdge too_small and documents 'pdf' is settings.attachments.documents invalid_value; a 2a row's admin DTO and a connection test read the defaults", "the AG-UI form shows the Attachments divider after Conversation settings with the Images switch, the Documents radio group (Off, As text, As PDF) and the Largest image edge InputNumber (256-8192, precision 0, placeholder Keep the size) on ['settings','attachments',…], each with its tooltip; the eleven keys exist in en, zh and ar", "tsc exits 0, pnpm test 0 failed, oxlint and oxfmt clean, antd lint total 0"], "modelTier": "standard"}
```

---

### Task 3: The tables and the migration

**Goal:** The two tables of spec §7 (`conversation_attachments` and `conversation_access_log`) exist in `db/schema/attachments.ts` with every column, CHECK, key and index the Shared contracts list (`position` included), created by one generated drizzle-kit migration (`chat_attachments`) and pinned by a live database test; `lib/chat/statuses.ts` gains `ACCESS_ACTIONS` and `LOG_STATUSES`.

Spec §7.1 ("`conversation_attachments`: `id` (uuid); `user_id`, `app_id` (both cascade) and `conversation_id` (NULL until sent, then cascade); `message_id` (text NULL); `kind` (`image`, `document`, `text`, CHECK); `mime` (detected); `name` (the original name, for display only); `size`; `sha256`; `data` (`bytea`); `extracted_text` (text NULL); `created_at`") and §7.2 ("`id`, `actor_id`, `conversation_id`, `app_id` (no foreign keys, so the row outlives the conversation, as `users.admin_deactivated_by` does), `action` (`view`, `download`), `at`. Indexes `(conversation_id, at)` and `(actor_id, at)`. Not purged in Part 2"), with this plan's additions: the access log's `attachment_id` and its CHECK (decision 70 (5)), its `(app_id, at)` index for the owner's tab (P19), the `position` column (P11: the file's index in its message's `attachmentIds`, from 0, so the agent and the history read the files in the order the user attached them, which the upload time is not), the sent CHECK (P9: a sent row has `conversation_id`, `message_id` and `position`, an unsent one none of them) and the partial index the purge reads (P21). ADR-0031: the migration is generated (`pnpm db:generate --name chat_attachments`, AGENTS.md "Database migrations"), read before it is committed, never `drizzle-kit push`; `snapshot.json` is generated by drizzle-kit, never written by hand. Docs checked: Drizzle through Context7 (`/drizzle-team/drizzle-orm-docs`): "PostgreSQL column types", `bytea()` (`"bytea" bytea`), and drizzle-orm 1.0.0-rc.4's own types read it as a Buffer (`node_modules/drizzle-orm/pg-core/columns/bytea.d.ts`: `data: Buffer`); "Indexes & Constraints": a partial index is ``index(name).on(…).where(sql`…`)`` (the form `users_one_owner` uses) and ``check(name, sql`…`)`` writes `CONSTRAINT "<name>" CHECK (…)` inside `CREATE TABLE`. PostgreSQL 18: "Binary Data Types" (`bytea`), "TOAST" (a value past `TOAST_TUPLE_THRESHOLD`, normally 2 kB, is compressed and moved out of the row: why Task 6's metadata reads never select `data`), "Check Constraints" ("satisfied if the check expression evaluates to true or the null value", so the pairing CHECKs compare `IS NULL`/`IS NOT NULL`, which never yield null, as `apps_icon_check` does), "Partial Indexes", "Foreign Keys" (index the referencing columns), "Numeric Types" (`integer` holds a 5 MB size). `listed`, the helper that writes a CHECK's value list, moves from `db/schema/conversations.ts` to `db/schema/columns.ts` (Shared contracts), so both schema files share it; the conversation tables' SQL does not change, which the generated migration shows (it alters no existing table). `__tests__/db/database.ts`'s `resetTables` must name `conversation_access_log` itself: `TRUNCATE … CASCADE` reaches only tables with a foreign key to the named ones (PostgreSQL 18 "TRUNCATE"), and the access log has none, so without it the rows of one test would leak into the next. Task 1's `ATTACHMENT_KINDS` builds the kind CHECK; Task 6 reads and writes both tables, Task 9 links the files in `startRun` (setting `conversation_id`, `message_id` and `position` in one UPDATE), Task 13 lists the access log, and Tasks 13 and 20 quote the table and index names below.

**Files:**

- Create: `db/schema/attachments.ts`
- Modify: `db/schema/columns.ts` (`listed`, moved here and exported)
- Modify: `db/schema/conversations.ts` (imports `listed` from `./columns`; its own copy removed)
- Modify: `db/schema/index.ts` (the two exports)
- Modify: `lib/chat/statuses.ts` (`ACCESS_ACTIONS`, `AccessAction`, `LOG_STATUSES`, `LogStatus`; the header names the new schema file)
- Create (generated): `db/migrations/<stamp>_chat_attachments/migration.sql` and `snapshot.json`
- Test: `__tests__/db/attachments-schema.db.test.ts` (the whole file, below)
- Modify: `__tests__/db/database.ts` (`resetTables` names `conversation_access_log`)
- Test: `__tests__/db/schema.db.test.ts` (the migration list gains `'chat_attachments'`)
- Test: `__tests__/db-apps-migrations.test.ts` (the folder list gains `'chat_attachments'`; a new case pins the migration's statements)

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project db __tests__/db/attachments-schema.db.test.ts __tests__/db/schema.db.test.ts` reports `Test Files  2 passed (2)`, `Tests  30 passed (30)` (16 in the new file): the kind CHECK, the sent CHECK four ways (a conversation, a message or a position alone, and a conversation and message without a position), the access log's action CHECK and its attachment CHECK both ways answer 23514 with the constraint's name; deleting the account or the app removes every file, deleting a conversation removes its files and keeps the account's unsent ones; the access log keeps its row after the conversation, the app and the actor are deleted; a 256-byte Buffer of every byte value reads back equal from `bytea`.
- [ ] The generated `migration.sql` is the SQL quoted in Step 7: two `CREATE TABLE`, seven `CREATE INDEX` (one partial, `WHERE "conversation_id" IS NULL`), three foreign keys, all `ON DELETE CASCADE` and all on `conversation_attachments`, four CHECKs, and no statement on an existing table; `pnpm exec vitest run --project unit __tests__/db-apps-migrations.test.ts` reports `Tests  6 passed (6)`.
- [ ] `ACCESS_ACTIONS` is `['view', 'download']` and `LOG_STATUSES` is `['failed', 'stopped', 'waiting']`, exported from `lib/chat/statuses.ts`; `listed` is exported from `db/schema/columns.ts` and defined nowhere else (`grep -rn "const listed" db/schema` prints one line, in `columns.ts`).
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; `pnpm test:db` reports 0 failed; oxlint and oxfmt clean on the changed files.

**Verify:** `pnpm exec vitest run --project unit __tests__/db-apps-migrations.test.ts && pnpm exec vitest run --project db __tests__/db/attachments-schema.db.test.ts __tests__/db/schema.db.test.ts` → `Tests  6 passed (6)`, then `Test Files  2 passed (2)`, `Tests  30 passed (30)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `__tests__/db/attachments-schema.db.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
	apps,
	conversationAccessLog,
	conversationAttachments,
	conversations,
	users,
} from '@/db/schema'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterAll(() => pool.end())

/** A query's refusal as the driver reported it (the helper of schema.db.test.ts: DrizzleQueryError's `cause`, or the DatabaseError itself). */
const refusal = async (query: PromiseLike<unknown>) => {
	const error: unknown = await query.then(
		() => null,
		(caught: unknown) => caught,
	)
	const fields = (value: unknown) => value as { code?: string; constraint?: string } | undefined
	const driver = error instanceof Error && error.cause ? fields(error.cause) : fields(error)
	return { code: driver?.code, constraint: driver?.constraint }
}

/** An account, an app and a conversation of that account in that app. */
const seed = async () => {
	const userId = crypto.randomUUID()
	const appId = crypto.randomUUID()
	const conversationId = crypto.randomUUID()
	await testDb
		.insert(users)
		.values({ id: userId, email: `${userId}@example.com`, password: 'hash', role: 'user' })
	await testDb
		.insert(apps)
		.values({ id: appId, provider: 'agui', name: 'Agent', settings: {}, secrets: {} })
	await testDb.insert(conversations).values({ id: conversationId, appId, userId, title: 'Hello' })
	return { userId, appId, conversationId }
}
type Seed = Awaited<ReturnType<typeof seed>>

/** An attachment row as the data layer writes one: unsent unless `over` makes it sent (conversation, message, position). */
const attachment = (
	ids: Seed,
	over: Partial<typeof conversationAttachments.$inferInsert> = {},
) => ({
	id: crypto.randomUUID(),
	userId: ids.userId,
	appId: ids.appId,
	kind: 'text' as const,
	mime: 'text/plain; charset=utf-8',
	name: 'notes.txt',
	size: 5,
	sha256: '0'.repeat(64),
	data: Buffer.from('hello'),
	extractedText: 'hello',
	...over,
})

const logRow = (ids: Seed, over: Partial<typeof conversationAccessLog.$inferInsert> = {}) => ({
	id: crypto.randomUUID(),
	actorId: crypto.randomUUID(),
	conversationId: ids.conversationId,
	appId: ids.appId,
	action: 'view' as const,
	...over,
})

const countIn = async (table: 'conversation_attachments' | 'conversation_access_log') =>
	Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n)

describe('conversation_attachments (Part 2 spec §7.1)', () => {
	// PostgreSQL 18 "Binary Data Types"; Drizzle's bytea reads and writes a Buffer.
	it('stores an unsent file with its bytes as given, every byte value included', async () => {
		const ids = await seed()
		const data = Buffer.from(Array.from({ length: 256 }, (_, byte) => byte))
		const row = attachment(ids, { kind: 'image', mime: 'image/png', size: data.length, data })
		await testDb.insert(conversationAttachments).values(row)
		const [stored] = await testDb
			.select()
			.from(conversationAttachments)
			.where(eq(conversationAttachments.id, row.id))
		expect(stored).toMatchObject({ conversationId: null, messageId: null, size: 256 })
		expect(Buffer.isBuffer(stored!.data)).toBe(true)
		expect(stored!.data.equals(data)).toBe(true)
		expect(stored!.createdAt).toBeInstanceOf(Date)
	})

	it('takes a sent file, with its conversation, its message and its place in it', async () => {
		const ids = await seed()
		const row = attachment(ids, {
			conversationId: ids.conversationId,
			messageId: 'm1',
			position: 0,
		})
		await testDb.insert(conversationAttachments).values(row)
		expect(await countIn('conversation_attachments')).toBe(1)
	})

	// PostgreSQL 18 "Check Constraints"; 23514 is check_violation (Appendix A).
	it('refuses a kind it does not know', async () => {
		const ids = await seed()
		expect(
			await refusal(
				testDb.insert(conversationAttachments).values(attachment(ids, { kind: 'video' as never })),
			),
		).toEqual({ code: '23514', constraint: 'conversation_attachments_kind_check' })
	})

	it.each([
		[
			'a conversation without a message',
			(ids: Seed) => ({ conversationId: ids.conversationId, position: 0 }),
		],
		['a message without a conversation', () => ({ messageId: 'm1', position: 0 })],
		['a position without a conversation', () => ({ position: 0 })],
		[
			'a conversation and a message without a position',
			(ids: Seed) => ({ conversationId: ids.conversationId, messageId: 'm1' }),
		],
	])('refuses %s (sent means all three)', async (_name, over) => {
		const ids = await seed()
		expect(
			await refusal(testDb.insert(conversationAttachments).values(attachment(ids, over(ids)))),
		).toEqual({ code: '23514', constraint: 'conversation_attachments_sent_check' })
	})

	// Spec §3.4: deleting an account, an app or a conversation removes its files at once (ON DELETE CASCADE).
	it.each([
		['the account', (ids: Seed) => testDb.delete(users).where(eq(users.id, ids.userId))],
		['the app', (ids: Seed) => testDb.delete(apps).where(eq(apps.id, ids.appId))],
	])('removes every file, sent or not, with %s', async (_name, remove) => {
		const ids = await seed()
		await testDb
			.insert(conversationAttachments)
			.values([
				attachment(ids),
				attachment(ids, { conversationId: ids.conversationId, messageId: 'm1', position: 0 }),
			])
		await remove(ids)
		expect(await countIn('conversation_attachments')).toBe(0)
	})

	it('removes a conversation’s files with it, and keeps the account’s unsent ones', async () => {
		const ids = await seed()
		const unsent = attachment(ids)
		await testDb
			.insert(conversationAttachments)
			.values([
				unsent,
				attachment(ids, { conversationId: ids.conversationId, messageId: 'm1', position: 0 }),
			])
		await testDb.delete(conversations).where(eq(conversations.id, ids.conversationId))
		const left = await testDb
			.select({ id: conversationAttachments.id })
			.from(conversationAttachments)
		expect(left).toEqual([{ id: unsent.id }])
	})

	// Plan call P21: the purge reads the unsent rows through a partial index (PostgreSQL 18 "Partial Indexes").
	it('indexes each foreign key’s column and the unsent files’ upload time', async () => {
		const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
			"SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'conversation_attachments' ORDER BY indexname",
		)
		expect(rows.map(row => row.indexname)).toEqual([
			'conversation_attachments_app_id_idx',
			'conversation_attachments_conversation_id_message_id_idx',
			'conversation_attachments_pkey',
			'conversation_attachments_unsent_created_at_idx',
			'conversation_attachments_user_id_idx',
		])
		expect(
			rows.find(row => row.indexname === 'conversation_attachments_unsent_created_at_idx')!
				.indexdef,
		).toMatch(/\(created_at\) WHERE \(conversation_id IS NULL\)$/)
	})
})

describe('conversation_access_log (Part 2 spec §7.2)', () => {
	it('takes a view without a file and a download that names one, stamped now', async () => {
		const ids = await seed()
		await testDb
			.insert(conversationAccessLog)
			.values([logRow(ids), logRow(ids, { action: 'download', attachmentId: crypto.randomUUID() })])
		const rows = await testDb.select().from(conversationAccessLog)
		expect(rows).toHaveLength(2)
		for (const row of rows) expect(row.at).toBeInstanceOf(Date)
	})

	it('refuses an action it does not know', async () => {
		const ids = await seed()
		expect(
			await refusal(
				testDb.insert(conversationAccessLog).values(logRow(ids, { action: 'edit' as never })),
			),
		).toEqual({ code: '23514', constraint: 'conversation_access_log_action_check' })
	})

	// Decision 70 (5): a download names its attachment, a view none.
	it.each([
		['a download without a file', { action: 'download' as const }],
		['a view with a file', { action: 'view' as const, attachmentId: crypto.randomUUID() }],
	])('refuses %s', async (_name, over) => {
		const ids = await seed()
		expect(await refusal(testDb.insert(conversationAccessLog).values(logRow(ids, over)))).toEqual({
			code: '23514',
			constraint: 'conversation_access_log_attachment_check',
		})
	})

	// No foreign keys: a row outlives the conversation, the app and the actor (spec §7.2).
	it('keeps its rows when the conversation, the app and the actor are gone', async () => {
		const ids = await seed()
		const admin = crypto.randomUUID()
		await testDb
			.insert(users)
			.values({ id: admin, email: `${admin}@example.com`, password: 'hash', role: 'admin' })
		await testDb.insert(conversationAccessLog).values(logRow(ids, { actorId: admin }))
		await testDb.delete(conversations).where(eq(conversations.id, ids.conversationId))
		await testDb.delete(apps).where(eq(apps.id, ids.appId))
		await testDb.delete(users).where(eq(users.id, admin))
		const rows = await testDb.select().from(conversationAccessLog)
		expect(rows).toEqual([
			expect.objectContaining({
				actorId: admin,
				conversationId: ids.conversationId,
				appId: ids.appId,
				action: 'view',
				attachmentId: null,
			}),
		])
	})
})
```

That is 16 cases (11 on the attachments, 5 on the access log).

In `__tests__/db/database.ts`, find:

```ts
/**
 * Every table the hub writes, emptied with the rows that reference them (PostgreSQL 18 "TRUNCATE": CASCADE
 * "Automatically truncate all tables that have foreign-key references to any of the named tables").
 */
export const resetTables = async (): Promise<void> => {
	await pool.query(
		'TRUNCATE users, user_groups, apps, directory_sync_runs, instance_settings, password_reset_tokens CASCADE',
	)
}
```

Replace it with:

```ts
/**
 * Every table the hub writes, emptied with the rows that reference them (PostgreSQL 18 "TRUNCATE": CASCADE
 * "Automatically truncate all tables that have foreign-key references to any of the named tables"). The access log
 * references nothing (Part 2 spec §7.2: no foreign keys), so it is named itself.
 */
export const resetTables = async (): Promise<void> => {
	await pool.query(
		'TRUNCATE users, user_groups, apps, directory_sync_runs, instance_settings, password_reset_tokens, conversation_access_log CASCADE',
	)
}
```

`conversation_attachments` needs no name: its foreign keys to `users`, `apps` and `conversations` bring it into the CASCADE.

In `__tests__/db/schema.db.test.ts`, the case "was applied with every migration in order…" ends its list with `'conversations',`. Find:

```ts
			'agui_provider',
			'conversations',
		])
```

Replace it with:

```ts
			'agui_provider',
			'conversations',
			'chat_attachments',
		])
```

In `__tests__/db-apps-migrations.test.ts`, find:

```ts
	it('follow the baseline as expand, data and contract, then Part 2’s provider and conversation migrations', () => {
```

Replace it with:

```ts
	it('follow the baseline as expand, data and contract, then Part 2’s provider, conversation and attachment migrations', () => {
```

Find (the same list, in this file):

```ts
			'agui_provider',
			'conversations',
		])
```

Replace it with:

```ts
			'agui_provider',
			'conversations',
			'chat_attachments',
		])
```

And append at the end of the file, after the "Part 2's provider migration" block:

```ts
// Part 2 spec §7 (2c): the two new tables, generated; no table that exists is changed (ADR-0031: read before commit).
describe("2c's attachment migration", () => {
	it('creates the attachments and the access log, and changes no table that exists', () => {
		const sql = sqlOf('chat_attachments')
		expect(sql.match(/CREATE TABLE "\w+"/g)).toEqual([
			'CREATE TABLE "conversation_access_log"',
			'CREATE TABLE "conversation_attachments"',
		])
		expect(new Set(sql.match(/ALTER TABLE "\w+"/g))).toEqual(
			new Set(['ALTER TABLE "conversation_attachments"']),
		)
		expect(sql).not.toMatch(/DROP/)
		expect(sql).toContain(
			'CREATE INDEX "conversation_attachments_unsent_created_at_idx" ON "conversation_attachments" ("created_at") WHERE "conversation_id" IS NULL;',
		)
	})
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm exec vitest run --project db __tests__/db/attachments-schema.db.test.ts`

Expected: FAIL, `Tests  16 failed (16)`, each with `error: relation "conversation_access_log" does not exist` from `resetTables` (the table does not exist yet).

Run: `pnpm exec vitest run --project unit __tests__/db-apps-migrations.test.ts`

Expected: FAIL, `Tests  2 failed | 4 passed (6)`: the folder list (`expected [ 'baseline', 'apps_expand', …(4) ] to deeply equal [ 'baseline', 'apps_expand', …(5) ]`) and the new case (`expected undefined to be defined`, no `chat_attachments` folder).

- [ ] **Step 3: Add the value sets to `lib/chat/statuses.ts`**

Find (the header):

```ts
/*
 * The conversation store's value sets (Part 2 spec §3.1), client-safe: the schema builds its CHECKs from them
 * (db/schema/conversations.ts), the data layer types its rows with them (lib/data/conversations.ts), and the turn
 * reducer reads a run's status with them (lib/chat/turn.ts). Text columns with a CHECK rather than PostgreSQL enums,
 * for the reason db/schema/apps.ts gives for `provider`: a value added to an enum "cannot be used until after the
 * transaction has been committed" (PostgreSQL 18 "ALTER TYPE", Notes) while the migrator applies every pending
 * migration in one transaction.
 */
```

Replace it with:

```ts
/*
 * The conversation store's value sets (Part 2 spec §3.1, §7.2), client-safe: the schema builds its CHECKs from them
 * (db/schema/conversations.ts, db/schema/attachments.ts), the data layer types its rows with them (lib/data/), and
 * the turn reducer reads a run's status with them (lib/chat/turn.ts). Text columns with a CHECK rather than PostgreSQL
 * enums, for the reason db/schema/apps.ts gives for `provider`: a value added to an enum "cannot be used until after
 * the transaction has been committed" (PostgreSQL 18 "ALTER TYPE", Notes) while the migrator applies every pending
 * migration in one transaction.
 */
```

Find:

```ts
/** Spec §3.4: a deleted conversation is purged after 30 days. */
export const PURGE_AFTER_DAYS = 30
```

Replace it with:

```ts
/** Spec §3.4: a deleted conversation is purged after 30 days. */
export const PURGE_AFTER_DAYS = 30

/**
 * Spec §7.2: what an access-log row records, an admin opening a transcript or fetching an attachment (decision 69 (4):
 * every fetch by anyone but the uploader is a download).
 */
export const ACCESS_ACTIONS = ['view', 'download'] as const

export type AccessAction = (typeof ACCESS_ACTIONS)[number]

/** 2c's plan call P17: a Logs row's tags, and the status filter's values, besides "deleted". */
export const LOG_STATUSES = ['failed', 'stopped', 'waiting'] as const

export type LogStatus = (typeof LOG_STATUSES)[number]
```

- [ ] **Step 4: Move `listed` to `db/schema/columns.ts`**

Replace the whole of `db/schema/columns.ts` with:

```ts
import { sql } from 'drizzle-orm'
import { timestamp } from 'drizzle-orm/pg-core'

/**
 * A point in time with its zone, as every hub table stores one (PostgreSQL wiki "Don't Do This": "Don't use timestamp
 * (without time zone)"; PostgreSQL 18 "Date/Time Types": "All timezone-aware dates and times are stored internally in
 * UTC"). No precision: "it rounds off the fractional part rather than truncating it" (the wiki's "Don't use
 * timestamp(0) or timestamptz(0)"), and a JS Date holds milliseconds anyway. Read as a Date (Drizzle "PostgreSQL column
 * types", timestamp, `mode: 'date'`). LobeHub's Drizzle schema keeps the same helper
 * (`lobehub/lobehub@canary:packages/database/src/schemas/_helpers.ts`).
 */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

/**
 * The value list of a CHECK: `'a', 'b', …`. The values are the code's own constants (lib/chat/statuses.ts,
 * lib/chat/attachment-rules.ts), never input, so they are written into the SQL as literals with `sql.raw` (Drizzle
 * "Magical sql operator", sql.raw()), as apps_provider_check writes the provider ids. Shared by the conversation
 * store's tables and 2c's (db/schema/conversations.ts, db/schema/attachments.ts).
 */
export const listed = (values: readonly string[]) =>
	sql.raw(values.map(value => `'${value}'`).join(', '))
```

In `db/schema/conversations.ts`, find:

```ts
import { apps } from './apps'
import { timestamptz } from './columns'
import { users } from './users'
```

Replace it with:

```ts
import { apps } from './apps'
import { listed, timestamptz } from './columns'
import { users } from './users'
```

Find, and delete (with the blank line after it):

```ts
/** The value list of a CHECK: `'a', 'b', …`. */
const listed = (values: readonly string[]) => sql.raw(values.map(value => `'${value}'`).join(', '))
```

`sql` stays imported there: the CHECKs still use it.

- [ ] **Step 5: Write the schema**

Create `db/schema/attachments.ts`:

```ts
import { sql } from 'drizzle-orm'
import { bytea, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { ATTACHMENT_KINDS } from '@/lib/chat/attachment-rules'
import { ACCESS_ACTIONS } from '@/lib/chat/statuses'

import { apps } from './apps'
import { listed, timestamptz } from './columns'
import { conversations } from './conversations'
import { users } from './users'

/*
 * 2c's two tables (Part 2 spec §7, ADR-0037): the files users attach to their messages, and the record of every
 * transcript and file an admin reads. The value sets are the code's own constants, written into the CHECKs as
 * literals (`listed`, db/schema/columns.ts), as the conversation store's are (PostgreSQL 18 "Check Constraints";
 * Drizzle "Indexes & Constraints", check()). Both ids are minted by the data layer (crypto.randomUUID): no default.
 */

/**
 * One per file a user attached (spec §7.1; decision 48): the bytes in the row, as the app icons and the brand images
 * are kept (`bytea`, PostgreSQL 18 "Binary Data Types"; Drizzle "PostgreSQL column types", bytea, which reads and
 * writes a Buffer), so several hub containers need no shared folder. A value this large is compressed and moved out of
 * the row (PostgreSQL 18 "TOAST": past `TOAST_TUPLE_THRESHOLD`, normally 2 kB), so a read that needs only the metadata
 * selects its columns and never `data` (lib/data/attachments.ts).
 *
 * An unsent file has no conversation (a new chat's files are uploaded before its conversation exists, plan call P8);
 * the run that sends it sets `conversation_id`, `message_id` and `position` together (P9), and the sent CHECK holds all
 * three or none, comparing `IS NULL`, which never yields null ("A check constraint is satisfied if the check expression
 * evaluates to true or the null value", PostgreSQL 18 "Check Constraints"), as apps_icon_check does. `position` keeps
 * the order the user attached the files in (P11), which the upload time does not: a large file picked first can be
 * stored after a small one picked second (lib/data/attachments.ts reads by it). The file goes with its account, its app
 * (spec §3.4: the hub hard-deletes both) or its conversation (the 30-day purge), by ON DELETE CASCADE (PostgreSQL 18
 * "Foreign Keys"). `message_id` has no foreign key: a message's key is `(conversation_id, message_id)`, both rows are
 * written in one transaction (P9), and the conversation's cascade removes both.
 *
 * Indexes: each foreign key's column leads one ("it is often a good idea to index the referencing columns too",
 * PostgreSQL 18 "Foreign Keys"); `(conversation_id, message_id)` also serves the run's and the history's reads (P10,
 * P15); and the purge of unsent files (P21) reads a partial index over the rows without a conversation (PostgreSQL 18
 * "Partial Indexes": the planner uses one when the query's WHERE implies the index's predicate; Drizzle "Indexes &
 * Constraints", `.where()`, as users_one_owner).
 */
export const conversationAttachments = pgTable(
	'conversation_attachments',
	{
		id: uuid().primaryKey(),
		/** The uploader: only they send it, see it in their chat, or delete it unsent (P14, P22). */
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		appId: uuid('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		/** NULL until the message is sent (spec §7.1). */
		conversationId: uuid('conversation_id').references(() => conversations.id, {
			onDelete: 'cascade',
		}),
		/** The AG-UI id of the user message it was sent with; NULL until then. */
		messageId: text('message_id'),
		/** Its index in that message's `attachmentIds`, from 0 (P11); NULL until sent. */
		position: integer('position'),
		/** `enum` types the column in TypeScript only; the CHECK refuses other values (db/schema/apps.ts). */
		kind: text({ enum: ATTACHMENT_KINDS }).notNull(),
		/** The type the bytes proved (plan call P3), never the browser's claim; a text file's carries its charset. */
		mime: text().notNull(),
		/** The name it was uploaded with, for display only (P3: at most 255 characters). */
		name: text().notNull(),
		/** The stored bytes (P8: what the caps count): at most 5 MB, inside `integer` (PostgreSQL 18 "Numeric Types"). */
		size: integer().notNull(),
		/** The stored bytes' SHA-256, in hex. */
		sha256: text().notNull(),
		data: bytea().notNull(),
		/** What the agent reads in `text` mode (P6: capped, the note included); NULL for an image. */
		extractedText: text('extracted_text'),
		/** The upload; the purge of unsent files counts from it (P21). */
		createdAt: timestamptz('created_at').defaultNow().notNull(),
	},
	table => [
		index('conversation_attachments_conversation_id_message_id_idx').on(
			table.conversationId,
			table.messageId,
		),
		index('conversation_attachments_user_id_idx').on(table.userId),
		index('conversation_attachments_app_id_idx').on(table.appId),
		index('conversation_attachments_unsent_created_at_idx')
			.on(table.createdAt)
			.where(sql`${table.conversationId} IS NULL`),
		check(
			'conversation_attachments_kind_check',
			sql`${table.kind} IN (${listed(ATTACHMENT_KINDS)})`,
		),
		check(
			'conversation_attachments_sent_check',
			sql`(${table.conversationId} IS NULL) = (${table.messageId} IS NULL) AND (${table.conversationId} IS NULL) = (${table.position} IS NULL)`,
		),
	],
)

/**
 * One per transcript opened or attachment fetched by an admin (spec §7.2; decisions 42, 49, 69 (4), 70 (5)): who, which
 * conversation of which app, what, and when (OWASP Logging Cheat Sheet: "when, where, who and what"). No foreign keys,
 * so a row outlives the conversation, the app, the file and the actor, as users.admin_deactivated_by does; it is never
 * purged in Part 2. A download names its file and a view none, held by the second CHECK. The indexes are spec §7.2's
 * two and the owner's tab's `(app_id, at)` (plan call P19).
 */
export const conversationAccessLog = pgTable(
	'conversation_access_log',
	{
		id: uuid().primaryKey(),
		actorId: uuid('actor_id').notNull(),
		conversationId: uuid('conversation_id').notNull(),
		appId: uuid('app_id').notNull(),
		action: text({ enum: ACCESS_ACTIONS }).notNull(),
		/** Decision 70 (5): the attachment a `download` fetched; NULL for a `view`. */
		attachmentId: uuid('attachment_id'),
		at: timestamptz('at').defaultNow().notNull(),
	},
	table => [
		index('conversation_access_log_conversation_id_at_idx').on(table.conversationId, table.at),
		index('conversation_access_log_actor_id_at_idx').on(table.actorId, table.at),
		index('conversation_access_log_app_id_at_idx').on(table.appId, table.at),
		check(
			'conversation_access_log_action_check',
			sql`${table.action} IN (${listed(ACCESS_ACTIONS)})`,
		),
		check(
			'conversation_access_log_attachment_check',
			sql`(${table.action} = 'download') = (${table.attachmentId} IS NOT NULL)`,
		),
	],
)
```

In `db/schema/index.ts`, find:

```ts
export { apps } from './apps'
```

Replace it with (the list is alphabetical by module):

```ts
export { apps } from './apps'
export { conversationAccessLog, conversationAttachments } from './attachments'
```

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit` Expected: exit 0. The schema compiles before drizzle-kit reads it (cross-task ordering: the migration is generated after the schema compiles).

- [ ] **Step 6: Generate the migration**

Run: `pnpm db:generate --name chat_attachments`

Expected: `[✓] Your SQL migration ➜ db/migrations/<stamp>_chat_attachments/migration.sql 🚀` (`drizzle-kit generate` reads no database, so no `DATABASE_URL` is needed).

drizzle-kit writes `snapshot.json` with two-space indentation; oxfmt formats it as it formatted every earlier snapshot through lint-staged (`.lintstagedrc.mjs`: `*.{json,…}` → oxfmt). Format it now, so the gates' `oxfmt --check` passes before the commit:

```bash
pnpm exec oxfmt db/migrations/*_chat_attachments/snapshot.json
```

Neither file is edited by hand.

- [ ] **Step 7: Read the generated SQL before going on (ADR-0031)**

Open `db/migrations/<stamp>_chat_attachments/migration.sql`. It must be exactly this (drizzle-kit 1.0.0-rc.4's output, generated in a scratch copy while planning):

```sql
CREATE TABLE "conversation_access_log" (
	"id" uuid PRIMARY KEY,
	"actor_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"action" text NOT NULL,
	"attachment_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_access_log_action_check" CHECK ("action" IN ('view', 'download')),
	CONSTRAINT "conversation_access_log_attachment_check" CHECK (("action" = 'download') = ("attachment_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "conversation_attachments" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" text,
	"position" integer,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" bytea NOT NULL,
	"extracted_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_attachments_kind_check" CHECK ("kind" IN ('image', 'document', 'text')),
	CONSTRAINT "conversation_attachments_sent_check" CHECK (("conversation_id" IS NULL) = ("message_id" IS NULL) AND ("conversation_id" IS NULL) = ("position" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "conversation_access_log_conversation_id_at_idx" ON "conversation_access_log" ("conversation_id","at");--> statement-breakpoint
CREATE INDEX "conversation_access_log_actor_id_at_idx" ON "conversation_access_log" ("actor_id","at");--> statement-breakpoint
CREATE INDEX "conversation_access_log_app_id_at_idx" ON "conversation_access_log" ("app_id","at");--> statement-breakpoint
CREATE INDEX "conversation_attachments_conversation_id_message_id_idx" ON "conversation_attachments" ("conversation_id","message_id");--> statement-breakpoint
CREATE INDEX "conversation_attachments_user_id_idx" ON "conversation_attachments" ("user_id");--> statement-breakpoint
CREATE INDEX "conversation_attachments_app_id_idx" ON "conversation_attachments" ("app_id");--> statement-breakpoint
CREATE INDEX "conversation_attachments_unsent_created_at_idx" ON "conversation_attachments" ("created_at") WHERE "conversation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_app_id_apps_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;
```

Check, in the file: no `ALTER TABLE` on `users`, `apps`, `conversations` or the other conversation tables (a statement there means the `listed` move changed a CHECK: compare `conversations.ts` with Step 4); the two value lists match `ATTACHMENT_KINDS` and `ACCESS_ACTIONS`; the sent CHECK pairs `conversation_id` with both `message_id` and `position`; the partial index's `WHERE "conversation_id" IS NULL`. A wrong statement means a wrong schema: fix the schema, delete the folder, generate again; never edit the file.

The names later tasks quote: tables `conversation_attachments`, `conversation_access_log`; indexes `conversation_attachments_conversation_id_message_id_idx`, `conversation_attachments_user_id_idx`, `conversation_attachments_app_id_idx`, `conversation_attachments_unsent_created_at_idx` (partial), `conversation_access_log_conversation_id_at_idx`, `conversation_access_log_actor_id_at_idx`, `conversation_access_log_app_id_at_idx`; CHECKs `conversation_attachments_kind_check`, `conversation_attachments_sent_check`, `conversation_access_log_action_check`, `conversation_access_log_attachment_check`; foreign keys `conversation_attachments_user_id_users_id_fkey`, `conversation_attachments_app_id_apps_id_fkey`, `conversation_attachments_conversation_id_conversations_id_fkey`.

- [ ] **Step 8: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/db-apps-migrations.test.ts && pnpm exec vitest run --project db __tests__/db/attachments-schema.db.test.ts __tests__/db/schema.db.test.ts`

Expected: PASS, `Tests  6 passed (6)`; then `Test Files  2 passed (2)`, `Tests  30 passed (30)` (the db project's global setup recreates `hub_dal` and runs `drizzle-kit migrate`, so the new migration is applied first).

- [ ] **Step 9: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint db/schema/attachments.ts db/schema/columns.ts db/schema/conversations.ts db/schema/index.ts lib/chat/statuses.ts __tests__/db/attachments-schema.db.test.ts __tests__/db/database.ts __tests__/db/schema.db.test.ts __tests__/db-apps-migrations.test.ts
pnpm exec oxfmt --check db/schema/attachments.ts db/schema/columns.ts db/schema/conversations.ts db/schema/index.ts lib/chat/statuses.ts __tests__/db/attachments-schema.db.test.ts __tests__/db/database.ts __tests__/db/schema.db.test.ts __tests__/db-apps-migrations.test.ts db/migrations/*_chat_attachments/snapshot.json
pnpm test
pnpm test:db
```

Expected: tsc exits 0; oxlint prints no finding; oxfmt "All matched files use the correct format."; `pnpm test` 0 failed; `pnpm test:db` 0 failed (`Test Files  11 passed (11)` at this task, the ten files of 2b plus this one; `resetTables` now empties the access log too, which no earlier file writes).

- [ ] **Step 10: Commit**

```bash
git add db/schema/attachments.ts db/schema/columns.ts db/schema/conversations.ts db/schema/index.ts lib/chat/statuses.ts db/migrations/ __tests__/db/attachments-schema.db.test.ts __tests__/db/database.ts __tests__/db/schema.db.test.ts __tests__/db-apps-migrations.test.ts
git commit -m "feat(chat): add the attachments and access log tables

conversation_attachments keeps each uploaded file as bytea, unsent until
its run links it to a conversation, a message and its place in the
message (all three or none, a CHECK); conversation_access_log records every transcript and file an
admin reads, with no foreign keys so a row outlives what it names, and a
download names its file. One generated migration, read before the commit
(ADR-0031), and a live database test. listed moves to columns.ts so both
schema files share it (Part 2 spec §7.1, §7.2; plan calls P9, P11, P19, P21;
decision 70 (5)).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the ten paths (the migration folder holds two files); lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": ["db/schema/attachments.ts", "db/schema/columns.ts", "db/schema/conversations.ts", "db/schema/index.ts", "lib/chat/statuses.ts", "db/migrations/<stamp>_chat_attachments/migration.sql", "db/migrations/<stamp>_chat_attachments/snapshot.json", "__tests__/db/attachments-schema.db.test.ts", "__tests__/db/database.ts", "__tests__/db/schema.db.test.ts", "__tests__/db-apps-migrations.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/db-apps-migrations.test.ts && pnpm exec vitest run --project db __tests__/db/attachments-schema.db.test.ts __tests__/db/schema.db.test.ts", "acceptanceCriteria": ["attachments-schema.db.test.ts and schema.db.test.ts report 30 passed (16 new): the kind, sent (four ways), action and attachment CHECKs answer 23514 with their names; account and app deletes remove every file, a conversation delete its files only; the access log keeps its row after the conversation, app and actor are deleted; bytea round-trips a 256-byte Buffer", "the generated migration.sql is the quoted SQL: two CREATE TABLE, seven CREATE INDEX (one partial), three cascading foreign keys on conversation_attachments, four CHECKs, nothing on an existing table; db-apps-migrations.test.ts reports 6 passed", "ACCESS_ACTIONS and LOG_STATUSES are exported from lib/chat/statuses.ts; listed is defined only in db/schema/columns.ts", "tsc exits 0, pnpm test and pnpm test:db 0 failed, oxlint and oxfmt clean"], "modelTier": "standard"}
```

---

### Task 4: Chat images

**Goal:** `lib/settings/images.ts` gains `processChatImage(input, { maxEdge })`, which decodes a PNG, JPEG or WebP of up to 50,000,000 pixels and re-encodes it in its own format (PNG lossless, JPEG and WebP at quality 90), upright, without metadata, shrunk only to the app's largest edge, and `ImageKind` gains `'chatImage'`, while logos, favicons and app icons keep their PNG pipeline and ADR-0030's 4096 × 4096 limit.

Spec §7.1 ("**Images:** PNG, JPEG or WebP, decoded by sharp … (SVG and anything else refused), metadata stripped, re-encoded in the same format at the original size; shrunk only to the app's `maxImageEdge` when set (decision 53). A new `chatImage` kind in `lib/settings/images.ts`"), plan call P7, decision 53, decision 69 (6) (the bytes decide the format; any of PNG, JPEG or WebP passes for an image extension) and decision 70 (2) (50,000,000 pixels for chat images, so a default 24 MP or a 48 MP phone photo passes; ADR-0030's 4096 × 4096 stays for logos and icons), (7) (an animated WebP is refused) and (8) (JPEG and WebP at quality 90); the Shared contracts' "Images and documents" (`ImageKind`, `ChatImageMime`, `ProcessedChatImage`, `processChatImage`). Docs checked, sharp 0.35.4 (the repo's pinned version) through Context7 `/lovell/sharp` and `node_modules/sharp/lib/index.d.ts`: `api-constructor.md` (`limitInputPixels` "Do not process input images where pixel count exceeds limit", default 268402689; `failOn` default `'warning'`, which sharp's docs recommend "with untrusted input"; `autoOrient` "rotate/flip the image to match EXIF `Orientation`"; `join.animated` "join the images as an animated image", which the test uses to make an animated WebP from three PNG buffers, since the typings' `SharpInput` holds no `create` objects); `api-input.md` (`metadata().pages`: "Number of pages/frames contained within the image (… animated GIF, animated WebP)"; it is undefined for a still WebP, measured); `api-output.md` (`toBuffer`: "If no explicit format is set, the output format will match the input image" and "By default all metadata will be removed, which includes EXIF-based orientation"; `keepMetadata`: without it, sharp converts to sRGB and strips "all metadata, including the removal of any ICC profile"; `jpeg` and `webp` `quality` default 80; `PngOptions` `compressionLevel` default 6 and `palette` default false, so PNG stays lossless; `timeout({ seconds })`, no limit by default); `api-resize.md` (`fit: 'inside'` keeps the proportions within both dimensions; `withoutEnlargement` "Do not scale up if the width _or_ height are already less than the target dimensions"). Plan research R2 measured what the defaults alone would do: an animated WebP flattened to its first frame without an error, and a re-encoded WebP grew 14%, which is why the caps count stored bytes (P8). The pipeline is processImage's (`metadata()` first, then one sharp pipeline, every sharp error an `ImageError('not_allowed')`), and `metadata()` already applies `limitInputPixels` (measured: "Input image exceeds pixel limit"), so an image over the limit is refused before any pixel is decoded. `processImage` keeps its signature for the three boxed kinds (`Exclude<ImageKind, 'chatImage'>`), so `lib/data/apps.ts` and `lib/settings/branding.ts` compile unchanged. The test makes every input with sharp itself (`create`, `noise`, `withMetadata({ orientation: 6 })`, `join`), as `__tests__/settings-images.test.ts` does, and pins JPEG and WebP at quality 90 by comparing the output with sharp's own encoding at `CHAT_IMAGE_QUALITY` and at its default (both encoders are deterministic for the same input, measured). It imports Task 1's `ATTACHMENT_MAX_BYTES`, `CHAT_IMAGE_MAX_PIXELS` and `CHAT_IMAGE_QUALITY`. Task 7's `acceptUpload` calls `processChatImage` with the app's `maxImageEdge`, stores `bytes` and answers `mime`.

**Files:**

- Modify: `lib/settings/images.ts` (`ImageKind` gains `'chatImage'` with `ATTACHMENT_MAX_BYTES` as its byte cap; `processChatImage`, `ChatImageMime`, `ProcessedChatImage`; the whole file below)
- Test: `__tests__/settings-chat-image.test.ts` (the whole file, below)

**Acceptance Criteria:**

- [ ] `processChatImage` answers a PNG, JPEG or WebP input in its own format with `mime` `image/png`, `image/jpeg` or `image/webp` and its own width and height; PNG bytes passed from a `File` named `photo.jpg` with type `image/jpeg` come back `image/png`.
- [ ] A JPEG's and a WebP's output equals sharp's own encoding of the input at `quality: CHAT_IMAGE_QUALITY` and differs from sharp's default quality; a PNG's equals `sharp(input).png()`.
- [ ] A 400 × 200 JPEG with EXIF orientation 6 (and an ICC profile) comes back 200 × 400 with no `orientation`, `exif` or `icc`; `maxEdge: 300` makes 1200 × 600 into 300 × 150, `maxEdge: 2000` leaves it 1200 × 600, and `maxEdge: 100` makes the rotated photo 50 × 100.
- [ ] `sha256` is the SHA-256 (hex) of `bytes`.
- [ ] `ATTACHMENT_MAX_BYTES + 1` zero bytes answer `too_large` (unread); `ATTACHMENT_MAX_BYTES` zero bytes answer `not_allowed`.
- [ ] A 5712 × 4284 (24 MP) JPEG passes at its own size; a 10,000 × 5,000 JPEG (exactly `CHAT_IMAGE_MAX_PIXELS`) passes with `maxEdge: 1000` as 1000 × 500; a 10,000 × 5,001 JPEG under 512 KB answers `not_allowed`; a 5000 × 5000 PNG passes as a chat image and is still `not_allowed` as an app icon.
- [ ] A three-frame animated WebP (`metadata().pages` 3), an SVG, a GIF, a TIFF, text, an empty file and a truncated JPEG answer `not_allowed`.
- [ ] `__tests__/settings-images.test.ts` passes unchanged (29 tests): logos, favicons and app icons keep their PNG output and the 4096 × 4096 limit.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the changed files.

**Verify:** `pnpm exec vitest run --project unit __tests__/settings-chat-image.test.ts __tests__/settings-images.test.ts` → `Test Files  2 passed (2)`, `Tests  52 passed (52)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `__tests__/settings-chat-image.test.ts`:

```ts
import { createHash } from 'node:crypto'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
	ATTACHMENT_MAX_BYTES,
	CHAT_IMAGE_MAX_PIXELS,
	CHAT_IMAGE_QUALITY,
} from '@/lib/chat/attachment-rules'
import { ImageError, MAX_INPUT_PIXELS, processChatImage, processImage } from '@/lib/settings/images'

/** A noisy picture, so each encoder's options change its bytes. */
const noisy = (width: number, height: number) =>
	sharp({
		create: {
			width,
			height,
			channels: 3,
			background: 'white',
			noise: { type: 'gaussian', mean: 128, sigma: 30 },
		},
	})
/** A plain picture: large in pixels, small in bytes. */
const solid = (width: number, height: number) =>
	sharp({ create: { width, height, channels: 3, background: 'white' } })

const keepSize = { maxEdge: null }

/** The refusal code, or 'accepted'. */
const outcome = async (work: Promise<unknown>) => {
	try {
		await work
		return 'accepted'
	} catch (error) {
		return error instanceof ImageError ? error.code : `other: ${String(error)}`
	}
}

// Part 2 spec §7.1; plan call P7: the format the bytes decode as, kept, at the original size.
describe('processChatImage', () => {
	it.each([
		['png', 'image/png'],
		['jpeg', 'image/jpeg'],
		['webp', 'image/webp'],
	] as const)('keeps a %s as %s at its own size', async (format, mime) => {
		const out = await processChatImage(await noisy(300, 200)[format]().toBuffer(), keepSize)
		expect(out.mime).toBe(mime)
		expect([out.width, out.height]).toEqual([300, 200])
		const meta = await sharp(out.bytes).metadata()
		expect(meta.format).toBe(format)
		expect([meta.width, meta.height]).toEqual([300, 200])
	})

	// Decision 69 (6): the extension claims the kind and the bytes decide the format; the browser's type is never read.
	it('answers PNG for PNG bytes sent as photo.jpg with a JPEG type', async () => {
		const file = new File([await noisy(64, 64).png().toBuffer()], 'photo.jpg', {
			type: 'image/jpeg',
		})
		const out = await processChatImage(Buffer.from(await file.arrayBuffer()), keepSize)
		expect(out.mime).toBe('image/png')
		expect((await sharp(out.bytes).metadata()).format).toBe('png')
	})

	// Decision 70 (8): JPEG and WebP at quality 90, not sharp's default 80; PNG with sharp's lossless defaults.
	it.each(['jpeg', 'webp'] as const)('re-encodes a %s at CHAT_IMAGE_QUALITY', async format => {
		const input = await noisy(300, 200)[format]().toBuffer()
		const out = await processChatImage(input, keepSize)
		const at = (quality?: number) =>
			format === 'jpeg'
				? sharp(input).jpeg({ quality }).toBuffer()
				: sharp(input).webp({ quality }).toBuffer()
		expect(out.bytes.equals(await at(CHAT_IMAGE_QUALITY))).toBe(true)
		expect(out.bytes.equals(await at())).toBe(false)
	})
	it('re-encodes a PNG with the PNG defaults of sharp, lossless', async () => {
		const input = await noisy(300, 200).png().toBuffer()
		const out = await processChatImage(input, keepSize)
		expect(out.bytes.equals(await sharp(input).png().toBuffer())).toBe(true)
	})

	it('stores a phone photo upright and without its metadata', async () => {
		// 400 × 200 stored with EXIF orientation 6 (and the sRGB profile withMetadata adds) is a 200 × 400 picture.
		const input = await noisy(400, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer()
		const before = await sharp(input).metadata()
		expect([before.orientation, Boolean(before.exif), Boolean(before.icc)]).toEqual([6, true, true])
		const out = await processChatImage(input, keepSize)
		expect([out.width, out.height]).toEqual([200, 400])
		const meta = await sharp(out.bytes).metadata()
		expect([meta.orientation, meta.exif, meta.icc]).toEqual([undefined, undefined, undefined])
	})

	// Decision 53: shrunk only to the app's largest edge, in proportion, never enlarged.
	it('shrinks the longer edge to maxEdge', async () => {
		const out = await processChatImage(await noisy(1200, 600).png().toBuffer(), { maxEdge: 300 })
		expect([out.width, out.height]).toEqual([300, 150])
	})
	it('never enlarges to maxEdge', async () => {
		const out = await processChatImage(await noisy(1200, 600).png().toBuffer(), { maxEdge: 2000 })
		expect([out.width, out.height]).toEqual([1200, 600])
	})
	it('fits the upright picture into maxEdge', async () => {
		const input = await noisy(400, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer()
		const out = await processChatImage(input, { maxEdge: 100 })
		expect([out.width, out.height]).toEqual([50, 100])
	})

	it('answers the SHA-256 of the stored bytes', async () => {
		const out = await processChatImage(await noisy(64, 64).webp().toBuffer(), keepSize)
		expect(out.sha256).toBe(createHash('sha256').update(out.bytes).digest('hex'))
	})

	it('refuses input over ATTACHMENT_MAX_BYTES before reading it', async () => {
		// Zero bytes do not decode: too_large shows they were never read.
		expect(await outcome(processChatImage(Buffer.alloc(ATTACHMENT_MAX_BYTES + 1), keepSize))).toBe(
			'too_large',
		)
		expect(await outcome(processChatImage(Buffer.alloc(ATTACHMENT_MAX_BYTES), keepSize))).toBe(
			'not_allowed',
		)
	})

	// Decision 70 (2): 50,000,000 pixels, so a default 24 MP phone photo (5712 × 4284) passes at its own size.
	it('takes a 24 MP photo at its own size', async () => {
		const out = await processChatImage(await solid(5712, 4284).jpeg().toBuffer(), keepSize)
		expect([out.width, out.height]).toEqual([5712, 4284])
	})
	it('takes exactly CHAT_IMAGE_MAX_PIXELS and refuses one row more, though the bytes are small', async () => {
		const at = await solid(10_000, 5000).jpeg().toBuffer()
		const over = await solid(10_000, 5001).jpeg().toBuffer()
		expect(10_000 * 5000).toBe(CHAT_IMAGE_MAX_PIXELS)
		expect(over.length).toBeLessThan(512 * 1024)
		const out = await processChatImage(at, { maxEdge: 1000 })
		expect([out.width, out.height]).toEqual([1000, 500])
		expect(await outcome(processChatImage(over, keepSize))).toBe('not_allowed')
	})

	// ADR-0030's limit stays for logos and icons: the same 25 MP picture is a chat image and not an icon.
	it('leaves the logo and icon pixel limit as it was', async () => {
		const picture = await solid(5000, 5000).png({ compressionLevel: 9 }).toBuffer()
		expect(5000 * 5000).toBeGreaterThan(MAX_INPUT_PIXELS)
		expect(await outcome(processImage('appIcon', picture))).toBe('not_allowed')
		expect(await outcome(processChatImage(picture, { maxEdge: 256 }))).toBe('accepted')
	})

	// Decision 70 (7): sharp joins an array of inputs into an animated WebP (constructor `join.animated`) and would keep
	// only the first frame of one.
	it('refuses an animated WebP', async () => {
		const frames = await Promise.all(
			[0, 80, 160].map(red =>
				sharp({
					create: { width: 32, height: 32, channels: 3, background: { r: red, g: 0, b: 0 } },
				})
					.png()
					.toBuffer(),
			),
		)
		const animated = await sharp(frames, { join: { animated: true } })
			.webp()
			.toBuffer()
		expect((await sharp(animated).metadata()).pages).toBe(3)
		expect(await outcome(processChatImage(animated, keepSize))).toBe('not_allowed')
	})

	it.each([
		[
			'an SVG',
			async () =>
				Buffer.from(
					'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>',
				),
		],
		['a GIF', () => solid(10, 10).gif().toBuffer()],
		['a TIFF', () => solid(10, 10).tiff().toBuffer()],
		['a text file', async () => Buffer.from('not an image')],
		['an empty file', async () => Buffer.alloc(0)],
		[
			'a truncated JPEG',
			async () => {
				const jpeg = await noisy(300, 300).jpeg().toBuffer()
				return jpeg.subarray(0, Math.floor(jpeg.length / 2))
			},
		],
	])('refuses %s as not_allowed', async (_name, make) => {
		expect(await outcome(processChatImage(await make(), keepSize))).toBe('not_allowed')
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/settings-chat-image.test.ts`

Expected: FAIL, `Tests  23 failed (23)`: `processChatImage` does not exist yet (`TypeError: processChatImage is not a function`; the cases that go through `outcome` fail on `other: TypeError: …`).

- [ ] **Step 3: Implement**

Replace the whole of `lib/settings/images.ts` with:

```ts
import 'server-only'

import { createHash } from 'node:crypto'

import sharp, { type Metadata, type Sharp } from 'sharp'

import {
	ATTACHMENT_MAX_BYTES,
	CHAT_IMAGE_MAX_PIXELS,
	CHAT_IMAGE_QUALITY,
} from '@/lib/chat/attachment-rules'

import { BRAND_IMAGE_MAX_BYTES, type BrandImageKind } from './branding-rules'
import { APP_ICON_MAX_BYTES, APP_ICON_SIZE, type ImageErrorCode } from './image-rules'

/** An image the hub produced (settings spec §4.4): a PNG, its SHA-256 (hex) and its size in pixels. */
export interface ProcessedImage {
	bytes: Buffer
	sha256: string
	width: number
	height: number
}

/**
 * The images the pipeline takes: the two brand images (ADR-0030), an app's icon (Part 1 spec §4.4) and an image a user
 * attaches in a chat (Part 2 spec §7.1).
 */
export type ImageKind = BrandImageKind | 'appIcon' | 'chatImage'

/** The kinds processImage fits into a box of their own; a chat image keeps its size (processChatImage). */
type BoxedImageKind = Exclude<ImageKind, 'chatImage'>

export class ImageError extends Error {
	constructor(
		public readonly code: ImageErrorCode,
		options?: ErrorOptions,
	) {
		super(code, options)
		this.name = 'ImageError'
	}
}

/** A resource limit in OWASP's sense, tighter than sharp's default `0x3FFF * 0x3FFF` (sharp src/common.h). */
export const MAX_INPUT_PIXELS = 4096 * 4096

/**
 * The decoded formats accepted (spec §4.4 step 3); the browser's declared type is never read. SVG is refused (OWASP File
 * Upload Cheat Sheet, "restricted formats", "resource limits"): librsvg, the renderer inside sharp, decodes `data:` rasters
 * itself while it renders, outside `limitInputPixels`, and sharp's `svg.stylesheet` cannot switch them off, because librsvg
 * lets author `!important` rules and `style` attributes override it (`rsvg/src/css.rs:861-867,1051-1059`,
 * `element.rs:430-444`, `properties.rs:946-953`) and cascades a nested `data:` document without it (`document.rs:501,718-726`,
 * librsvg 2.62.0). A 415 KB SVG reached 1.18 GB of memory that way.
 */
const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'webp'])

const MAX_BYTES: Readonly<Record<ImageKind, number>> = {
	...BRAND_IMAGE_MAX_BYTES,
	appIcon: APP_ICON_MAX_BYTES,
	chatImage: ATTACHMENT_MAX_BYTES,
}

/**
 * The box each kind is fitted into (sharp `resize`). The logo: three times its largest display height (64 px), up to 4:1,
 * never enlarged. The favicon: twice the 32 px tab size, padded to a square. The app icon: at most 256 px on its longer
 * side, in proportion, never enlarged (Part 1 spec §4.4).
 */
const SHAPE: Readonly<
	Record<
		BoxedImageKind,
		{ width: number; height: number; fit: 'inside' | 'contain'; withoutEnlargement: boolean }
	>
> = {
	logo: { width: 768, height: 192, fit: 'inside', withoutEnlargement: true },
	favicon: { width: 64, height: 64, fit: 'contain', withoutEnlargement: false },
	appIcon: { width: APP_ICON_SIZE, height: APP_ICON_SIZE, fit: 'inside', withoutEnlargement: true },
}

/**
 * Decode, check and re-encode an image as PNG (OWASP File Upload Cheat Sheet: "decode and re-encode to an allowed image
 * format, explicitly removing unnecessary metadata … restricted formats, resource limits"). sharp refuses input on any
 * decoder warning by default (`failOn`), removes metadata from its output by default ("By default all metadata will be
 * removed"), and `autoOrient` applies the EXIF orientation first, so a phone photo stays upright.
 */
export async function processImage(kind: BoxedImageKind, input: Buffer): Promise<ProcessedImage> {
	if (input.length > MAX_BYTES[kind]) throw new ImageError('too_large')
	const options = { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true }
	let meta: Metadata
	try {
		meta = await sharp(input, options).metadata()
	} catch (error) {
		throw new ImageError('not_allowed', { cause: error })
	}
	if (!meta.format || !ACCEPTED_FORMATS.has(meta.format) || !meta.width || !meta.height)
		throw new ImageError('not_allowed')
	try {
		const { data, info } = await sharp(input, options)
			.resize({ ...SHAPE[kind], background: { r: 0, g: 0, b: 0, alpha: 0 } })
			.png()
			.toBuffer({ resolveWithObject: true })
		return {
			bytes: data,
			sha256: createHash('sha256').update(data).digest('hex'),
			width: info.width,
			height: info.height,
		}
	} catch (error) {
		throw new ImageError('not_allowed', { cause: error })
	}
}

/** The media types a chat image is stored and served as: its decoded format's (P3). */
export type ChatImageMime = 'image/png' | 'image/jpeg' | 'image/webp'

/** A chat image as the hub stores it: the re-encoded bytes, their SHA-256 (hex), the size in pixels and the media type. */
export interface ProcessedChatImage {
	bytes: Buffer
	sha256: string
	width: number
	height: number
	mime: ChatImageMime
}

type ChatImageFormat = 'png' | 'jpeg' | 'webp'

const CHAT_IMAGE_MIME: Readonly<Record<ChatImageFormat, ChatImageMime>> = {
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
}

const isChatImageFormat = (format: string | undefined): format is ChatImageFormat =>
	format !== undefined && ACCEPTED_FORMATS.has(format)

/**
 * The encoder of each format (sharp output options): PNG with its defaults, lossless (`compressionLevel` 6, no palette);
 * JPEG and WebP at CHAT_IMAGE_QUALITY instead of sharp's default 80 (decision 70 (8)).
 */
const encode = (image: Sharp, format: ChatImageFormat): Sharp =>
	format === 'png'
		? image.png()
		: format === 'jpeg'
			? image.jpeg({ quality: CHAT_IMAGE_QUALITY })
			: image.webp({ quality: CHAT_IMAGE_QUALITY })

/**
 * P7: a chat image, decoded and re-encoded in its own format (Part 2 spec §7.1: "metadata stripped, re-encoded in the
 * same format at the original size; shrunk only to the app's `maxImageEdge` when set"). The bytes decide the format:
 * any of PNG, JPEG or WebP passes whatever the file's name claims (decision 69 (6)), and the answer carries the decoded
 * format's media type. sharp decodes within CHAT_IMAGE_MAX_PIXELS (`limitInputPixels`, decision 70 (2): a 24 or 48 MP
 * phone photo passes, ADR-0030's 4096 × 4096 stays for logos and icons), refuses input on any decoder warning
 * (`failOn`'s default, "Use the default 'warning' level with untrusted input"), applies the EXIF orientation
 * (`autoOrient`), and stops after ten seconds (`timeout`, which has no limit by default); an animated WebP, which sharp
 * would flatten to its first frame without an error (plan research R2), is refused by its frame count
 * (`metadata().pages`, decision 70 (7)). `resize` with `fit: 'inside'` and `withoutEnlargement` keeps the proportions
 * and never enlarges ("Do not scale up if the width or height are already less than the target dimensions"), and the
 * output keeps no metadata ("By default all metadata will be removed", sharp `toBuffer`). Throws ImageError('too_large')
 * over ATTACHMENT_MAX_BYTES, ImageError('not_allowed') for anything not a decodable PNG, JPEG or WebP.
 */
export async function processChatImage(
	input: Buffer,
	options: { maxEdge: number | null },
): Promise<ProcessedChatImage> {
	if (input.length > MAX_BYTES.chatImage) throw new ImageError('too_large')
	const decoding = { limitInputPixels: CHAT_IMAGE_MAX_PIXELS, autoOrient: true }
	let meta: Metadata
	try {
		meta = await sharp(input, decoding).metadata()
	} catch (error) {
		throw new ImageError('not_allowed', { cause: error })
	}
	const format = meta.format
	if (!isChatImageFormat(format) || !meta.width || !meta.height || (meta.pages ?? 1) > 1)
		throw new ImageError('not_allowed')
	try {
		let image = sharp(input, decoding).timeout({ seconds: 10 })
		if (options.maxEdge !== null)
			image = image.resize({
				width: options.maxEdge,
				height: options.maxEdge,
				fit: 'inside',
				withoutEnlargement: true,
			})
		const { data, info } = await encode(image, format).toBuffer({ resolveWithObject: true })
		return {
			bytes: data,
			sha256: createHash('sha256').update(data).digest('hex'),
			width: info.width,
			height: info.height,
			mime: CHAT_IMAGE_MIME[format],
		}
	} catch (error) {
		throw new ImageError('not_allowed', { cause: error })
	}
}
```

What changed against 09000df4: the `@/lib/chat/attachment-rules` import and `type Sharp`; `ImageKind` gains `'chatImage'` and `MAX_BYTES` its cap; `BoxedImageKind` types `SHAPE` and `processImage`'s `kind` (the box stays the three kinds'); and everything after `processImage` is new. `processImage`'s body is unchanged.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/settings-chat-image.test.ts __tests__/settings-images.test.ts`

Expected: PASS, `Test Files  2 passed (2)`, `Tests  52 passed (52)` (23 and 29).

- [ ] **Step 5: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/settings/images.ts __tests__/settings-chat-image.test.ts
pnpm exec oxfmt --check lib/settings/images.ts __tests__/settings-chat-image.test.ts
pnpm test
```

Expected: tsc exits 0; oxlint prints no finding; oxfmt "All matched files use the correct format."; vitest 0 failed. No `db/` or `lib/data/` file changed, so `pnpm test:db` is not needed; no component changed, so the antd lint is unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/settings/images.ts __tests__/settings-chat-image.test.ts
git commit -m "feat(settings): chat images, re-encoded in their own format

processChatImage decodes a PNG, JPEG or WebP of up to 50,000,000
pixels, refuses an animated WebP, applies the EXIF orientation, shrinks
the image only to the app's largest edge, and re-encodes it in the
format its bytes decode as (PNG lossless, JPEG and WebP at quality 90)
without metadata. ImageKind gains chatImage, whose byte cap is the
attachment cap; logos, favicons and app icons keep their PNG pipeline
and ADR-0030's 4096 x 4096 limit (Part 2 spec §7.1; plan call P7;
decisions 53, 69 (6), 70 (2, 7, 8)).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the two files; lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": ["lib/settings/images.ts", "__tests__/settings-chat-image.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/settings-chat-image.test.ts __tests__/settings-images.test.ts", "acceptanceCriteria": ["processChatImage keeps a PNG, JPEG or WebP in its own format with its own size and answers the decoded format's mime; PNG bytes in a File named photo.jpg with type image/jpeg come back image/png", "JPEG and WebP output equals sharp's encoding at CHAT_IMAGE_QUALITY and differs from sharp's default quality; PNG output equals sharp's png() defaults", "an EXIF-orientation-6 400 x 200 JPEG comes back 200 x 400 without orientation, exif or icc; maxEdge shrinks the longer edge in proportion and never enlarges", "sha256 is the hex SHA-256 of bytes", "over ATTACHMENT_MAX_BYTES answers too_large unread; a 24 MP photo passes at its own size; exactly CHAT_IMAGE_MAX_PIXELS passes and one row more answers not_allowed; a 5000 x 5000 PNG is a chat image and still not an app icon", "an animated WebP, SVG, GIF, TIFF, text, empty input and a truncated JPEG answer not_allowed", "settings-images.test.ts passes unchanged (29 tests)", "tsc exits 0, pnpm test 0 failed, oxlint and oxfmt clean"], "modelTier": "standard"}
```

---

### Task 5: PDF and text reading

**Goal:** `lib/chat/documents.ts` reads a PDF's text with `pdfjs-dist` 6.4.299 in a `worker_threads` worker bounded to a 256 MB heap and 10 seconds (stopping at 100,001 code points), proves a PDF by its header, and decodes a text file as UTF-8 or BOM-marked UTF-16 (refusing other encodings and NUL); the dependency is pinned without its optional native canvas, kept out of the server bundles, and traced with the worker into the standalone build.

Spec §7.1 ("**PDFs:** checked by their `%PDF-` header. In `text` mode the hub extracts the text (Mozilla's pdf.js, `pdfjs-dist` …; at most 100,000 characters per file). **Text files** (`.txt`, `.md`, `.csv`) must be valid UTF-8", which decision 70 (3) widens to UTF-16 with a byte-order mark), spec §9 (`pdfjs-dist`, "pinned there"), plan calls P3 (the `%PDF-` window, the decoders, NUL as binary), P5 (the worker, its limits, the R2 `getDocument` call, the early stop, `ignoredOptionalDependencies`, `serverExternalPackages`, `outputFileTracingIncludes`) and P6 (U+0000 dropped), decisions 69 (1) and 70 (1, 3, 6); the Shared contracts' "Images and documents" (`isPdf`, `DocumentError`, `extractPdfText`, `decodeText`). Docs checked: pdf.js 6.4.299 in its own package and tag (`examples/node/getinfo.mjs` and `examples/node/pdf2png/pdf2png.mjs`: the legacy build in Node, `cMapUrl` with `cMapPacked: true`, `standardFontDataUrl`; `types/src/display/api.d.ts`: `data` "will take ownership of the TypedArrays", `streamTextContent()` "@returns {ReadableStream} Stream for reading text content chunks"; `legacy/build/pdf.mjs`: `getFactoryUrlProp` throws unless the URL ends in `/`, `NodeBinaryDataFactory` reads it with `fs.readFile`, and a text stream is cancelled only with an Error, "cancel must have a valid reason"; `test/unit/api_spec.js` `mergeText`: `str` plus `\n` where `hasEOL`), with plan research R2 (`research/r2-documents.md`: the measurements behind P5, the warning that hides missing CMaps, `PasswordException` and `InvalidPDFException`, `isEvalSupported` removed by pdf.js #21005); Node 22.21.1's `doc/api/worker_threads.md` (`new Worker(filename[, options])`: the filename "must be either an absolute path or a relative path"; `workerData` is cloned with the structured clone algorithm and `transferList` may hold `ArrayBuffer`s, which are then moved; `resourceLimits` "only affect the JS engine, and no external data, including no `ArrayBuffer`s", and "Reaching these limits leads to termination of the `Worker` instance"; `stderr: true` keeps the worker's standard error from being "automatically piped through to `process.stderr`"; `'error'`, `'message'` ("All messages sent from the worker thread are emitted before the `'exit'` event") and `'exit'` ("the final event emitted by any `Worker` instance"); `terminate()` "Stop all JavaScript execution in the worker thread as soon as possible") and `errors.md` (`ERR_WORKER_OUT_OF_MEMORY`: "The `Worker` instance terminated because it reached its memory limit"); WHATWG Encoding and MDN `TextDecoder()` (`fatal`: a TypeError on invalid data; `ignoreBOM` false: the byte-order mark is skipped), with UTF-16BE decoding checked in the Docker image's Node (`node:22.21.1-alpine`, ICU 77.1); pnpm's dependency-resolution settings (Context7 `/pnpm/pnpm.io`, `ignoredOptionalDependencies`: "If an optional dependency has its name included in this array, it will be skipped", set in `pnpm-workspace.yaml`); Next's bundled `serverExternalPackages.md` ("opt-out specific dependencies from the Server Components bundling and use native Node.js `require`") and `output.md` (`outputFileTracingIncludes`: keys are "route globs (matched with picomatch … against the route path)", brackets escaped as in its `'/api/login/\\[\\[\\.\\.\\.slug\\]\\]'` example; values are "glob patterns resolved from the project root"; Next matches the keys with `contains: true`, `next/dist/build/collect-build-traces.js`, so Task 8's `[attachmentId]` route lists the files too, and the standalone build copies each file once). The worker's path carries the `turbopackIgnore` magic comment, `path.join(/* turbopackIgnore: true */ process.cwd(), …)`: the one recorded exception to ADR-0002, which the owner accepted (2026-10-15, "Magic comment (Recommended)") and ADR-0037 (Task 20) records with its build check. Next's lazy-loading guide describes the `webpackIgnore`/`turbopackIgnore` comments for `import()`, `require()` and `new Worker()` expressions, but Next 16.3.4's Turbopack ignores the comment on a `worker_threads` `new Worker`, reading it only for the browser's global `Worker` (`turbopack-ecmascript/src/analyzer/imports.rs` `visit_new_expr`, `references/mod.rs` `NodeWorkerConstructor`): with the comment there, `next build` bundled this worker as a `[worker thread]` chunk and turned its `createRequire(import.meta.url).resolve('pdfjs-dist/package.json')` into a module id, which fails at run time (`ERR_INVALID_ARG_TYPE`, "Received type number", measured from a standalone copy). On the path argument, the placement Next's own server code uses (`join(/* turbopackIgnore: true */ this.dir, …)` in `next/dist/server/next-server.js` and `image-optimizer.js`), the comment makes Turbopack leave the path and the `new Worker` call as written, so the worker runs the same file in tests, `next dev` and production. No route imports `lib/chat/documents.ts` before Task 7, so a build here would prove nothing: Task 7, which adds the upload route, holds the build check (no `[worker thread]` chunk, the worker and pdf.js's files in `.next/standalone`, a copy of it alone reading the fixtures), the test that fails if a Next upgrade changes this behaviour. The fixtures are written by a committed generator from ISO 32000-1 (PDF 1.7), as `e2e/fixtures/ldap/tls/generate.sh` remakes the test CA: five ASCII files of 64 to 1,175 bytes, nothing downloaded or copied (the CJK one uses the predefined CMap 90ms-RKSJ-H, the case R2 measured with pdf.js's own `90ms_rksj_h_sample.pdf`, so pdf.js's test files and their licences are not needed); the long-text, NUL, time and heap cases are generated in the test with `zlib`, as R2's `mkbomb.mjs` built its files. Task 7's `acceptUpload` calls `isPdf`, `extractPdfText` and `decodeText` and answers a `DocumentError` as `attachment_invalid`; Task 20's ADR-0037 records the worker and its gap (memory outside the JS heap).

**Files:**

- Create: `lib/chat/documents.ts`
- Create: `lib/chat/pdf-text.worker.mjs`
- Create: `__tests__/fixtures/pdf/generate.mjs`, and the files it writes: `__tests__/fixtures/pdf/text.pdf`, `cjk.pdf`, `no-text.pdf`, `encrypted.pdf`, `broken.pdf`
- Modify: `package.json`, `pnpm-lock.yaml` (`pnpm add -E pdfjs-dist@6.4.299`)
- Modify: `pnpm-workspace.yaml` (`ignoredOptionalDependencies: ['@napi-rs/canvas']`)
- Modify: `next.config.ts` (`serverExternalPackages`, `outputFileTracingIncludes`)
- Test: `__tests__/chat-documents.test.ts` (the whole file, below)

**Acceptance Criteria:**

- [ ] `package.json` holds `"pdfjs-dist": "6.4.299"` (exact); `node_modules/.pnpm` holds `pdfjs-dist@6.4.299` and no `@napi-rs+canvas`; `@napi-rs/canvas` does not resolve from pdfjs-dist's folder, and pdf.js still reads the text fixture.
- [ ] `isPdf` is true for the five fixtures, for a header ending at byte 1,024 and for a view at an offset, and false for a header ending at byte 1,025, a PNG, an empty file and `%PDF1.7`.
- [ ] `extractPdfText` answers `'Quarterly report\nRevenue grew by 12 percent.'` for `text.pdf`, `'Hello CJK\n日本語テスト'` for `cjk.pdf`, `''` for `no-text.pdf`, `'ab'` for a PDF whose text holds U+0000, and exactly `ATTACHMENT_TEXT_MAX + 1` code points for a 200,000-character page; it leaves its input bytes unchanged.
- [ ] `extractPdfText` rejects with a `DocumentError` whose `code` is `'invalid'` and whose message is `password` for `encrypted.pdf`, `broken` for `broken.pdf` and for non-PDF bytes, `time_limit` for 32 MB of inflated operators under `timeLimitMs: 500` (in under 2 s, while the test's own 10 ms interval keeps ticking), and `heap_limit` for 5,000,000 numbers in one `TJ` array under `heapMb: 64` (which still reads `text.pdf`).
- [ ] `decodeText` answers UTF-8 (BOM dropped), UTF-16LE and UTF-16BE after their byte-order marks, and `''` for no bytes; `encoding` for Windows-1256, GBK, Latin-1, an odd-length and a lone-surrogate UTF-16; `binary` for a NUL in UTF-8 or UTF-16 and for UTF-16 without a byte-order mark.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the changed files.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-documents.test.ts` → `Test Files  1 passed (1)`, `Tests  35 passed (35)`

**Steps:**

- [ ] **Step 1: Add pdfjs-dist without its native canvas**

Skip the canvas first, so the install never fetches it: `pnpm-workspace.yaml` ends with `allowBuilds` (its last line `  '@swc/core': false`); append a blank line and:

```yaml
# pdfjs-dist's optional native canvas (31 MB): rendering needs it, text extraction does not (Part 2 plan call P5).
ignoredOptionalDependencies:
  - '@napi-rs/canvas'
```

Then run:

```bash
pnpm add -E pdfjs-dist@6.4.299
grep -n '"pdfjs-dist"' package.json
ls node_modules/.pnpm | grep -c '^pdfjs-dist@6.4.299$'
ls node_modules/.pnpm | grep -c 'napi-rs+canvas'
```

Expected: `package.json` gains one line after `"pako": "^2.1.0",`, printed as `54:		"pdfjs-dist": "6.4.299",`; `pnpm-lock.yaml` gains `pdfjs-dist@6.4.299`; the counts are `1` and `0`. If pnpm lists `@napi-rs/canvas` among the packages it adds, stop: the setting did not apply.

- [ ] **Step 2: Write the fixtures**

Create `__tests__/fixtures/pdf/generate.mjs`:

```js
/*
 * Remakes the PDF fixtures of __tests__/chat-documents.test.ts beside this file (`node __tests__/fixtures/pdf/generate.mjs`),
 * as e2e/fixtures/ldap/tls/generate.sh remakes the test CA. Each file is at most 1.2 KB of ASCII written from
 * ISO 32000-1 (PDF 1.7): a catalog, one page tree, one page, and a cross-reference table of 20-byte entries (§7.5.4);
 * nothing is downloaded or copied from elsewhere.
 */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const write = (name, text) => writeFileSync(new URL(name, import.meta.url), text, 'latin1')

/** A PDF of these object bodies (numbered from 1), with the trailer entries beside /Size and /Root. */
const pdf = (objects, trailer = '') => {
	let body = '%PDF-1.7\n'
	const offsets = []
	objects.forEach((object, index) => {
		offsets.push(body.length)
		body += `${index + 1} 0 obj\n${object}\nendobj\n`
	})
	const xref = offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
	return `${body}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailer} >>\nstartxref\n${body.length}\n%%EOF\n`
}
const stream = content => `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
const catalog = '<< /Type /Catalog /Pages 2 0 R >>'
const pages = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
const helvetica = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
const page = (resources, contents) =>
	`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]${resources}${contents} >>`

// Two lines of text in a standard font.
write(
	'text.pdf',
	pdf([
		catalog,
		pages,
		page(' /Resources << /Font << /F1 4 0 R >> >>', ' /Contents 5 0 R'),
		helvetica,
		stream(
			'BT /F1 12 Tf 72 720 Td (Quarterly report) Tj 0 -16 Td (Revenue grew by 12 percent.) Tj ET',
		),
	]),
)

// A line of ASCII, then 日本語テスト in Shift-JIS through the predefined CMap 90ms-RKSJ-H (§9.7.5.2) and a CID font
// that is not embedded: pdf.js maps those codes to Unicode only with its CMap files (`cMapUrl`).
write(
	'cjk.pdf',
	pdf([
		catalog,
		pages,
		page(' /Resources << /Font << /F1 4 0 R /F2 6 0 R >> >>', ' /Contents 5 0 R'),
		helvetica,
		stream(
			'BT /F1 12 Tf 72 720 Td (Hello CJK) Tj ET BT /F2 12 Tf 72 700 Td <93FA967B8CEA836583588367> Tj ET',
		),
		'<< /Type /Font /Subtype /Type0 /BaseFont /MS-Gothic /Encoding /90ms-RKSJ-H /DescendantFonts [7 0 R] >>',
		'<< /Type /Font /Subtype /CIDFontType0 /BaseFont /MS-Gothic /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 8 0 R /DW 1000 >>',
		'<< /Type /FontDescriptor /FontName /MS-Gothic /Flags 6 /FontBBox [0 -141 1000 859] /ItalicAngle 0 /Ascent 859 /Descent -141 /CapHeight 709 /StemV 80 >>',
	]),
)

// A page that only draws a 2 × 2 grey inline image (§8.9.7), like a scan without a text layer.
write(
	'no-text.pdf',
	pdf([
		catalog,
		pages,
		page('', ' /Contents 4 0 R'),
		stream('q 200 0 0 200 72 500 cm BI /W 2 /H 2 /CS /G /BPC 8 /F /AHx ID 00FF00FF> EI Q'),
	]),
)

// The standard security handler, revision 2 (40-bit RC4, §7.6.3), user password "hub", owner password "hub-owner". The
// file holds no string or stream to encrypt, so it stays ASCII. RC4 is written out because Node's OpenSSL 3 keeps it in
// the legacy provider.
const PADDING = Buffer.from(
	'28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A',
	'hex',
)
const padded = password => Buffer.concat([Buffer.from(password, 'latin1'), PADDING]).subarray(0, 32)
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest()
const rc4 = (key, data) => {
	const s = Array.from({ length: 256 }, (_, index) => index)
	for (let i = 0, j = 0; i < 256; i += 1) {
		j = (j + s[i] + key[i % key.length]) % 256
		;[s[i], s[j]] = [s[j], s[i]]
	}
	const out = Buffer.alloc(data.length)
	for (let k = 0, i = 0, j = 0; k < data.length; k += 1) {
		i = (i + 1) % 256
		j = (j + s[i]) % 256
		;[s[i], s[j]] = [s[j], s[i]]
		out[k] = data[k] ^ s[(s[i] + s[j]) % 256]
	}
	return out
}
const id = Buffer.from('hub-encrypted-01', 'latin1')
const permissions = Buffer.alloc(4)
permissions.writeInt32LE(-44)
const owner = rc4(md5(padded('hub-owner')).subarray(0, 5), padded('hub')) // Algorithm 3
const user = rc4(md5(padded('hub'), owner, permissions, id).subarray(0, 5), PADDING) // Algorithms 2 and 4
const hex = bytes => bytes.toString('hex').toUpperCase()
write(
	'encrypted.pdf',
	pdf(
		[
			catalog,
			pages,
			page('', ''),
			`<< /Filter /Standard /V 1 /R 2 /O <${hex(owner)}> /U <${hex(user)}> /P -44 >>`,
		],
		` /Encrypt 4 0 R /ID [<${hex(id)}> <${hex(id)}>]`,
	),
)

// The header, and nothing else a PDF needs.
write('broken.pdf', '%PDF-1.7\nThis file has a PDF header and no PDF structure.\n%%EOF\n')
```

Run:

```bash
node __tests__/fixtures/pdf/generate.mjs
sha256sum __tests__/fixtures/pdf/*.pdf
```

Expected (the generator is deterministic):

```text
1726d47fcb21332cf40eaa09fcf76aebb139769dd300d9d51fbc55e27affc4c3  __tests__/fixtures/pdf/broken.pdf
17e431de6af606abf48908836c155c7ed0af3129b35ae686a418f33cc2283b2d  __tests__/fixtures/pdf/cjk.pdf
349e2480aa0c58d2d08689a6a409da69a2b1213f7d1d9bee8d92b9a389fc07e0  __tests__/fixtures/pdf/encrypted.pdf
81c18e07ce77716e37d95cb7ae47aeeaacc1e26c79ab5f74d3911934a8c75db3  __tests__/fixtures/pdf/no-text.pdf
31f6bd56bb5123cb42420046c3c5fa4fb600564fc69cfbfbd4205bdc22c8bab7  __tests__/fixtures/pdf/text.pdf
```

(64, 1,175, 636, 491 and 633 bytes.) pdf.js 6.4.299 reads `encrypted.pdf` with the password `hub` (and the owner password `hub-owner`) and refuses it without one (`PasswordException`, code 1), and reads `cjk.pdf` as `Hello CJK` alone when `cMapUrl` is missing: the fixtures test what they are named for (checked while this plan was written).

- [ ] **Step 3: Write the failing tests**

Create `__tests__/chat-documents.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { ATTACHMENT_TEXT_MAX } from '@/lib/chat/attachment-rules'
import { decodeText, DocumentError, extractPdfText, isPdf } from '@/lib/chat/documents'

/** The fixtures __tests__/fixtures/pdf/generate.mjs writes. */
const fixture = (name: string) =>
	new Uint8Array(readFileSync(path.join('__tests__/fixtures/pdf', name)))

const TEXT = 'Quarterly report\nRevenue grew by 12 percent.'

/**
 * A one-page PDF whose Helvetica content stream is `content`, deflated (FlateDecode), with its cross-reference table:
 * the way plan research R2 built its crafted files (r2/scripts/mkbomb.mjs).
 */
const pdfWith = (content: Buffer): Uint8Array => {
	const deflated = deflateSync(content)
	const objects = [
		Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
		Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
		Buffer.from(
			'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
		),
		Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
		Buffer.concat([
			Buffer.from(`<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n`),
			deflated,
			Buffer.from('\nendstream'),
		]),
	]
	const parts = [Buffer.from('%PDF-1.7\n')]
	const offsets: number[] = []
	let position = parts[0].length
	objects.forEach((object, index) => {
		const part = Buffer.concat([
			Buffer.from(`${index + 1} 0 obj\n`),
			object,
			Buffer.from('\nendobj\n'),
		])
		offsets.push(position)
		parts.push(part)
		position += part.length
	})
	const xref = offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
	parts.push(
		Buffer.from(
			`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`,
		),
	)
	return new Uint8Array(Buffer.concat(parts))
}

/** The DocumentError's code and failure, or 'read'. */
const outcome = async (work: Promise<unknown>) => {
	try {
		await work
		return 'read'
	} catch (error) {
		return error instanceof DocumentError
			? `${error.code}: ${error.message}`
			: `other: ${String(error)}`
	}
}

// Plan call P3: pdf.js's own header rule, `%PDF-` within the first 1,024 bytes.
describe('isPdf', () => {
	const at = (offset: number) =>
		new Uint8Array(Buffer.concat([Buffer.alloc(offset, 0x20), Buffer.from('%PDF-1.7\n')]))

	it.each(['text.pdf', 'cjk.pdf', 'no-text.pdf', 'encrypted.pdf', 'broken.pdf'])(
		'finds the header of %s',
		name => {
			expect(isPdf(fixture(name))).toBe(true)
		},
	)
	it('finds a header that ends at byte 1,024 and misses one that ends after it', () => {
		expect(isPdf(at(1019))).toBe(true)
		expect(isPdf(at(1020))).toBe(false)
	})
	it('reads a view from its own offset', () => {
		const bytes = Buffer.concat([Buffer.alloc(4096, 0x20), Buffer.from(fixture('text.pdf'))])
		expect(isPdf(bytes.subarray(4096))).toBe(true)
		expect(isPdf(bytes.subarray(0, 2048))).toBe(false)
	})
	it.each([
		['a PNG', Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')],
		['an empty file', Buffer.alloc(0)],
		['the header without its dash', Buffer.from('%PDF1.7\n')],
	])('refuses %s', (_name, bytes) => {
		expect(isPdf(bytes)).toBe(false)
	})
})

// Plan call P5: pdf.js in a worker thread, its text or a DocumentError.
describe('extractPdfText', () => {
	it('reads a text PDF, a line break where pdf.js reports one (hasEOL)', async () => {
		expect(await extractPdfText(fixture('text.pdf'))).toBe(TEXT)
	})
	it('reads CJK text through the CMaps (90ms-RKSJ-H)', async () => {
		expect(await extractPdfText(fixture('cjk.pdf'))).toBe('Hello CJK\n日本語テスト')
	})
	it('answers empty text for a page with only an image (a scan)', async () => {
		expect(await extractPdfText(fixture('no-text.pdf'))).toBe('')
	})
	it.each([
		['an encrypted PDF', 'encrypted.pdf', 'invalid: password'],
		['a header with no PDF behind it', 'broken.pdf', 'invalid: broken'],
	])('refuses %s', async (_name, name, expected) => {
		expect(await outcome(extractPdfText(fixture(name)))).toBe(expected)
	})
	it('refuses bytes that are no PDF at all', async () => {
		expect(await outcome(extractPdfText(new Uint8Array(Buffer.from('not a pdf'))))).toBe(
			'invalid: broken',
		)
	})
	it('leaves the bytes it was given as they were (pdf.js takes ownership of a copy)', async () => {
		const bytes = fixture('text.pdf')
		await extractPdfText(bytes)
		expect(Buffer.from(bytes).equals(Buffer.from(fixture('text.pdf')))).toBe(true)
	})
	it('drops U+0000, which PostgreSQL text cannot hold (P6)', async () => {
		expect(
			await extractPdfText(pdfWith(Buffer.from('BT /F1 12 Tf 72 720 Td (a\\000b) Tj ET'))),
		).toBe('ab')
	})

	// P5: the reading stops at ATTACHMENT_TEXT_MAX + 1 code points, so capText (P6) can tell a cut text from a full one.
	it('stops after ATTACHMENT_TEXT_MAX + 1 code points', async () => {
		const line = 'a'.repeat(1000)
		// 200 lines of 1,000 characters in a 1-point font, so every line stays on the page.
		const content = Buffer.from(`BT /F1 1 Tf 1 TL 0 791 Td ${`(${line}) '\n`.repeat(200)}ET`)
		const text = await extractPdfText(pdfWith(content))
		expect(Array.from(text)).toHaveLength(ATTACHMENT_TEXT_MAX + 1)
		expect(text).toBe(`${line}\n`.repeat(99) + 'a'.repeat(902))
	})

	// P5: a crafted PDF cannot stall the hub's thread. 32 MB of operators without text inflate from 33 KB, and pdf.js
	// needs seconds for them (R2 measured 2.7 s); the limit ends the worker while this thread keeps ticking.
	it('ends a worker over its time limit while this thread runs on', async () => {
		const bomb = pdfWith(Buffer.alloc(32 * 1024 * 1024, 'q Q\n'))
		expect(bomb.byteLength).toBeLessThan(64 * 1024)
		let ticks = 0
		const ticker = setInterval(() => (ticks += 1), 10)
		const started = performance.now()
		const result = await outcome(extractPdfText(bomb, { timeLimitMs: 500 }))
		const elapsed = performance.now() - started
		clearInterval(ticker)
		expect(result).toBe('invalid: time_limit')
		expect(elapsed).toBeLessThan(2000)
		expect(ticks).toBeGreaterThan(10)
	})

	// P5: a PDF whose content needs more JS heap than the limit (5,000,000 numbers in one TJ array) ends the worker, and
	// the same limit still reads an ordinary PDF.
	it('ends a worker over its heap limit', async () => {
		const heavy = pdfWith(
			Buffer.concat([
				Buffer.from('BT /F1 12 Tf 72 720 Td ['),
				Buffer.alloc(10_000_000, '0 '),
				Buffer.from('] TJ ET'),
			]),
		)
		expect(await outcome(extractPdfText(heavy, { heapMb: 64 }))).toBe('invalid: heap_limit')
		expect(await extractPdfText(fixture('text.pdf'), { heapMb: 64 })).toBe(TEXT)
	})
})

// P5: pdfjs-dist 6.4.299 reads text without its optional native canvas, which pnpm skips (`ignoredOptionalDependencies`
// in pnpm-workspace.yaml). A later release that needs the canvas again fails here, not in production.
describe('pdf.js without @napi-rs/canvas', () => {
	it('reads the text fixture while the canvas package is not installed', async () => {
		const fromPdfjs = createRequire(
			createRequire(import.meta.url).resolve('pdfjs-dist/package.json'),
		)
		expect(() => fromPdfjs.resolve('@napi-rs/canvas')).toThrow(/Cannot find module/)
		expect(await extractPdfText(fixture('text.pdf'))).toBe(TEXT)
	})
})

// P3, decision 70 (3, 6): UTF-8, or UTF-16 with its byte-order mark; anything else is refused.
describe('decodeText', () => {
	const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
	const UTF16LE_BOM = Buffer.from([0xff, 0xfe])
	const UTF16BE_BOM = Buffer.from([0xfe, 0xff])
	const utf16le = (text: string) => Buffer.from(text, 'utf16le')
	const utf16be = (text: string) => Buffer.from(text, 'utf16le').swap16()
	const sample = 'héllo 世界 𠮷'

	it('reads UTF-8', () => {
		expect(decodeText(Buffer.from('Prices, 价格, الأسعار ✓'))).toEqual({
			ok: true,
			text: 'Prices, 价格, الأسعار ✓',
			charset: 'utf-8',
		})
	})
	it('drops a UTF-8 byte-order mark', () => {
		expect(decodeText(Buffer.concat([UTF8_BOM, Buffer.from('name,amount\n')]))).toEqual({
			ok: true,
			text: 'name,amount\n',
			charset: 'utf-8',
		})
	})
	it('reads UTF-16LE after its byte-order mark', () => {
		expect(decodeText(Buffer.concat([UTF16LE_BOM, utf16le(sample)]))).toEqual({
			ok: true,
			text: sample,
			charset: 'utf-16le',
		})
	})
	it('reads UTF-16BE after its byte-order mark', () => {
		expect(decodeText(Buffer.concat([UTF16BE_BOM, utf16be(sample)]))).toEqual({
			ok: true,
			text: sample,
			charset: 'utf-16be',
		})
	})
	it('reads an empty file as empty UTF-8 text', () => {
		expect(decodeText(new Uint8Array(0))).toEqual({ ok: true, text: '', charset: 'utf-8' })
	})
	it.each([
		['Windows-1256 Arabic (مرحبا)', Buffer.from('E3D1CDC8C7', 'hex')],
		['GBK Chinese (中文)', Buffer.from('D6D0CEC4', 'hex')],
		['Latin-1 (café)', Buffer.from('636166E9', 'hex')],
		['UTF-16LE with an odd byte', Buffer.concat([UTF16LE_BOM, utf16le('hi'), Buffer.from([0x41])])],
		['UTF-16LE with a lone surrogate', Buffer.concat([UTF16LE_BOM, Buffer.from([0x00, 0xd8])])],
	])('refuses %s as encoding', (_name, bytes) => {
		expect(decodeText(bytes)).toEqual({ ok: false, reason: 'encoding' })
	})
	it.each([
		['a NUL in UTF-8 text', Buffer.from([0x61, 0x00, 0x62])],
		['UTF-16LE without a byte-order mark', utf16le('hi')],
		[
			'a NUL in UTF-16 text',
			Buffer.concat([UTF16LE_BOM, utf16le('a'), Buffer.from([0, 0]), utf16le('b')]),
		],
	])('refuses %s as binary', (_name, bytes) => {
		expect(decodeText(bytes)).toEqual({ ok: false, reason: 'binary' })
	})
})
```

- [ ] **Step 4: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-documents.test.ts`

Expected: FAIL, `Error: Cannot find package '@/lib/chat/documents' imported from …/__tests__/chat-documents.test.ts`, `Test Files  1 failed (1)`, `Tests  no tests`.

- [ ] **Step 5: Implement the worker**

Create `lib/chat/pdf-text.worker.mjs`:

```js
// @ts-check
/*
 * The PDF reader's thread (Part 2 spec §7.1; plan call P5; ADR-0037). lib/chat/documents.ts starts this file in a Node
 * `worker_threads` Worker with the file's bytes and limits the thread's heap and time, because pdf.js in Node runs on
 * the calling thread and nothing interrupts it: a crafted PDF of under 1 MB stalled the event loop for 3.9 s or ran the
 * process out of memory (plan research R2). A plain ES module that no bundler sees (documents.ts hides its path from
 * Turbopack): next.config.ts traces it, and the pdf.js files it loads, into the standalone build. It posts one message:
 * the text, or why there is none.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'

// The legacy build is pdf.js's documented Node path (examples/node/getinfo.mjs; the modern build warns "Please use the
// `legacy` build in Node.js environments").
import { getDocument, PasswordException, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** @typedef {{ ok: true, text: string } | { ok: false, reason: 'password' | 'broken' }} PdfTextMessage */

const { bytes, maxCodePoints } = /** @type {{ bytes: Uint8Array, maxCodePoints: number }} */ (
	workerData
)

// In Node pdf.js reads its CMaps and standard fonts with fs.readFile, so both are filesystem paths ending in "/"
// (legacy pdf.mjs, NodeBinaryDataFactory and getFactoryUrlProp); without the CMaps, CJK text disappears without an
// error (R2 measured). pdfjs-dist has no `exports` map, so its package.json resolves.
const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))

/** @param {PdfTextMessage} message */
const post = message => parentPort?.postMessage(message)

let text = ''
let count = 0

/**
 * Appends a piece of text without U+0000 (PostgreSQL text cannot hold it; plan call P6) until the text holds
 * maxCodePoints code points; answers false once it is full. Counting code points (`String.prototype[Symbol.iterator]`)
 * never splits a surrogate pair.
 * @param {string} piece
 */
const append = piece => {
	const chars = Array.from(piece.replaceAll('\0', ''))
	if (count + chars.length < maxCodePoints) {
		text += chars.join('')
		count += chars.length
		return true
	}
	text += chars.slice(0, maxCodePoints - count).join('')
	count = maxCodePoints
	return false
}

// R2's call: the options that matter for untrusted input stated on purpose, each its documented default in Node
// (api.js, DocumentInitParameters); `isEvalSupported` no longer exists (pdf.js #21005).
const task = getDocument({
	// This thread's own copy, which pdf.js takes ownership of (api.js, `data`).
	data: bytes,
	cMapUrl: `${root}/cmaps/`,
	cMapPacked: true,
	standardFontDataUrl: `${root}/standard_fonts/`,
	enableXfa: false,
	stopAtErrors: false,
	useSystemFonts: false,
	disableFontFace: true,
	verbosity: VerbosityLevel.ERRORS,
})
try {
	const doc = await task.promise
	reading: for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
		// A page ends a line.
		if (pageNumber > 1 && !append('\n')) break
		const page = await doc.getPage(pageNumber)
		// `streamTextContent` reads a page's text in chunks (api.js: "Stream for reading text content chunks"), so the
		// reading stops at the cap instead of collecting a whole page first (R2: a cut after collecting protects nothing).
		const reader = page.streamTextContent().getReader()
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			for (const item of value.items) {
				// Joined as pdf.js's own tests join a page's items (test/unit/api_spec.js): the string, then a line break
				// where `hasEOL` says one follows.
				if ('str' in item && !append(item.str + (item.hasEOL ? '\n' : ''))) {
					// pdf.js cancels its stream only for an Error ("cancel must have a valid reason", legacy pdf.mjs).
					await reader.cancel(new Error('The text is long enough'))
					break reading
				}
			}
		}
	}
	post({ ok: true, text })
} catch (error) {
	// Without a password pdf.js rejects with PasswordException (api.js, `onPassword`); anything else it cannot read is
	// InvalidPDFException or another error.
	post({ ok: false, reason: error instanceof PasswordException ? 'password' : 'broken' })
} finally {
	await task.destroy()
}
```

`tsconfig.json` includes only `.ts` and `.tsx`, so `tsc` does not see this file; `// @ts-check` gives editors its JSDoc types, and Step 9 checks them once with `--checkJs`.

- [ ] **Step 6: Implement `lib/chat/documents.ts`**

Create `lib/chat/documents.ts`:

```ts
import 'server-only'

import path from 'node:path'
import { Worker } from 'node:worker_threads'

import {
	ATTACHMENT_TEXT_MAX,
	PDF_HEADER_SEARCH_BYTES,
	PDF_WORKER_HEAP_MB,
	PDF_WORKER_TIME_LIMIT_MS,
	type TextCharset,
} from './attachment-rules'

/*
 * A document's text, read at upload (Part 2 spec §7.1; plan calls P3, P5, P6): a PDF's in a worker thread, a text
 * file's from its bytes as UTF-8 or UTF-16. lib/chat/uploads.ts decides what each answer means for the upload.
 */

/** The signature pdf.js looks for (`PDF_HEADER_SIGNATURE`, legacy pdf.worker.mjs). */
const PDF_HEADER = Buffer.from('%PDF-', 'latin1')

/** P3: `%PDF-` within the first PDF_HEADER_SEARCH_BYTES bytes, the window pdf.js searches (`checkHeader`, limit 1024). */
export const isPdf = (bytes: Uint8Array): boolean =>
	Buffer.from(
		bytes.buffer,
		bytes.byteOffset,
		Math.min(bytes.byteLength, PDF_HEADER_SEARCH_BYTES),
	).includes(PDF_HEADER)

/** Why a PDF gave no text, kept as the error's message for the log; the upload answers each as `attachment_invalid`. */
export type DocumentFailure = 'password' | 'broken' | 'time_limit' | 'heap_limit' | 'worker_exit'

export class DocumentError extends Error {
	readonly code = 'invalid'

	constructor(failure: DocumentFailure, options?: ErrorOptions) {
		super(failure, options)
		this.name = 'DocumentError'
	}
}

/**
 * The worker's file, started by path from the working directory: the repository in development and tests, the
 * standalone server's directory in production (its server.js runs `process.chdir(__dirname)`), where next.config.ts's
 * `outputFileTracingIncludes` copies the file (Node, `new Worker`: the filename "must be either an absolute path or a
 * relative path"). The `turbopackIgnore` magic comment keeps Turbopack from resolving the path: the one exception to
 * ADR-0002, accepted by the owner and recorded in ADR-0037 (2026-10-15). Next's docs describe the comment on `import()`,
 * `require()` and `new Worker()` expressions, but Turbopack 16.3.4 ignores it on a `worker_threads` `new Worker` (it
 * bundled this worker and turned its `require.resolve` into a module id, which fails at run time); on the path argument
 * it is where Next's own server code puts it (next/dist/server/next-server.js, image-optimizer.js). ADR-0037's build
 * check fails if a Next upgrade changes this.
 */
const WORKER_FILE = path.join(
	/* turbopackIgnore: true */ process.cwd(),
	'lib/chat/pdf-text.worker.mjs',
)

/** What the worker posts (PdfTextMessage in lib/chat/pdf-text.worker.mjs). */
type PdfTextMessage = { ok: true; text: string } | { ok: false; reason: 'password' | 'broken' }

/**
 * P5: the PDF's text, read in the worker (`lib/chat/pdf-text.worker.mjs`) under PDF_WORKER_HEAP_MB and
 * PDF_WORKER_TIME_LIMIT_MS, pages joined, no further than ATTACHMENT_TEXT_MAX + 1 code points; DocumentError for a
 * password, a broken file, the time limit or the heap limit.
 *
 * Node `worker_threads`: `resourceLimits` "only affect the JS engine, and no external data, including no
 * `ArrayBuffer`s" (the gap ADR-0037 records) and end a worker over them with ERR_WORKER_OUT_OF_MEMORY on `'error'`;
 * `terminate()` will "stop all JavaScript execution in the worker thread as soon as possible", which no timer can do to
 * pdf.js on the hub's own thread (R2); and `'exit'` is "the final event emitted by any `Worker` instance", after every
 * message.
 */
export function extractPdfText(
	bytes: Uint8Array,
	/** Tests pass smaller limits; the hub uses the defaults. */
	limits: { heapMb?: number; timeLimitMs?: number } = {},
): Promise<string> {
	const { heapMb = PDF_WORKER_HEAP_MB, timeLimitMs = PDF_WORKER_TIME_LIMIT_MS } = limits
	// A copy, moved to the worker (`transferList`): pdf.js takes ownership of its data, and the caller stores the bytes.
	const data = new Uint8Array(bytes)
	return new Promise<string>((resolve, reject) => {
		// `stderr: true`: the worker's standard error is "not automatically piped through to `process.stderr`" (Node),
		// where pdf.js would warn on every import that it cannot polyfill DOMMatrix and Path2D without @napi-rs/canvas,
		// which only rendering needs (R2; P5).
		const worker = new Worker(WORKER_FILE, {
			workerData: { bytes: data, maxCodePoints: ATTACHMENT_TEXT_MAX + 1 },
			transferList: [data.buffer],
			resourceLimits: { maxOldGenerationSizeMb: heapMb },
			stderr: true,
		})
		let settled = false
		const settle = (outcome: { text: string } | { failure: DocumentFailure; cause?: unknown }) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			void worker.terminate()
			if ('text' in outcome) resolve(outcome.text)
			else reject(new DocumentError(outcome.failure, { cause: outcome.cause }))
		}
		const timer = setTimeout(() => settle({ failure: 'time_limit' }), timeLimitMs)
		worker.on('message', (message: PdfTextMessage) =>
			settle(message.ok ? { text: message.text } : { failure: message.reason }),
		)
		worker.on('error', (error: Error & { code?: string }) =>
			settle({
				failure: error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'heap_limit' : 'broken',
				cause: error,
			}),
		)
		worker.on('exit', () => settle({ failure: 'worker_exit' }))
	})
}

const UTF16LE_BOM = [0xff, 0xfe]
const UTF16BE_BOM = [0xfe, 0xff]
const startsWith = (bytes: Uint8Array, mark: readonly number[]) =>
	mark.every((byte, index) => bytes[index] === byte)

/**
 * P3: the bytes as text: UTF-16LE or UTF-16BE when they start with that byte-order mark, else UTF-8 (a leading BOM
 * dropped), each with `fatal: true`; 'encoding' when they do not decode, 'binary' when the text holds U+0000.
 *
 * WHATWG Encoding, `TextDecoder`: with `fatal` a decoder throws a TypeError on invalid data, and with `ignoreBOM` left
 * false "the byte order mark will be skipped over" (MDN). U+0000 is valid UTF-8, so a binary file named `.txt` is refused
 * by it (decision 70 (6); Open WebUI's rule, R1 §2).
 */
export const decodeText = (
	bytes: Uint8Array,
):
	| { ok: true; text: string; charset: TextCharset }
	| { ok: false; reason: 'encoding' | 'binary' } => {
	const charset: TextCharset = startsWith(bytes, UTF16LE_BOM)
		? 'utf-16le'
		: startsWith(bytes, UTF16BE_BOM)
			? 'utf-16be'
			: 'utf-8'
	let text: string
	try {
		text = new TextDecoder(charset, { fatal: true }).decode(bytes)
	} catch {
		return { ok: false, reason: 'encoding' }
	}
	if (text.includes('\0')) return { ok: false, reason: 'binary' }
	return { ok: true, text, charset }
}
```

- [ ] **Step 7: Keep pdf.js out of the bundles and trace it into the standalone build**

In `next.config.ts`, find:

```ts
	devIndicators: {
		position: 'bottom-right',
	},
}
```

Replace it with:

```ts
	devIndicators: {
		position: 'bottom-right',
	},
	// pdfjs-dist runs only in the PDF worker thread (lib/chat/pdf-text.worker.mjs; Part 2 plan call P5), never in a
	// server bundle: Node loads it as it is (next.config.js `serverExternalPackages`: "opt-out specific dependencies from
	// the Server Components bundling and use native Node.js `require`").
	serverExternalPackages: ['pdfjs-dist'],
	// No import leads the trace to the worker, which lib/chat/documents.ts starts by path, or to the pdf.js files it
	// loads, so the upload route's trace lists them and the standalone build copies them (next.config.js `output`,
	// "outputFileTracingIncludes": keys are route globs, brackets escaped; values are globs from the project root).
	outputFileTracingIncludes: {
		'/api/apps/\\[appId\\]/attachments': [
			'./lib/chat/pdf-text.worker.mjs',
			'./node_modules/pdfjs-dist/package.json',
			'./node_modules/pdfjs-dist/legacy/build/pdf.mjs',
			'./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
			'./node_modules/pdfjs-dist/cmaps/**/*',
			'./node_modules/pdfjs-dist/standard_fonts/**/*',
		],
	},
}
```

- [ ] **Step 8: Run them to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-documents.test.ts`

Expected: PASS, `Test Files  1 passed (1)`, `Tests  35 passed (35)` (about 2 s: the time-limit case waits 500 ms, the heap case about 600 ms).

- [ ] **Step 9: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec tsc --noEmit --allowJs --checkJs --module nodenext --moduleResolution nodenext --target es2023 --skipLibCheck --types node lib/chat/pdf-text.worker.mjs
pnpm exec oxlint next.config.ts lib/chat/documents.ts lib/chat/pdf-text.worker.mjs __tests__/chat-documents.test.ts __tests__/fixtures/pdf/generate.mjs
pnpm exec oxfmt --check package.json pnpm-workspace.yaml next.config.ts lib/chat/documents.ts lib/chat/pdf-text.worker.mjs __tests__/chat-documents.test.ts __tests__/fixtures/pdf/generate.mjs
pnpm test
```

Expected: both tsc runs exit 0; oxlint prints no finding; oxfmt "All matched files use the correct format."; vitest 0 failed. No `db/` or `lib/data/` file changed, so `pnpm test:db` is not needed.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml next.config.ts lib/chat/documents.ts lib/chat/pdf-text.worker.mjs __tests__/chat-documents.test.ts __tests__/fixtures/pdf/
git commit -m "feat(chat): read PDF text in a worker thread, and text files as UTF-8 or UTF-16

pdfjs-dist 6.4.299, pinned exactly and without its optional native
canvas, reads a PDF's text in a worker_threads worker limited to a
256 MB heap and 10 seconds, so a crafted PDF can no longer stall or
crash the hub; it stops at 100,001 code points and drops U+0000. A
password, a broken file and either limit are a DocumentError. pdfjs-dist
is a server external package, and the worker and the pdf.js files it
loads are traced into the standalone build. The worker's path carries
turbopackIgnore, without which Turbopack 16.3 bundles the worker and
breaks it: the one exception to ADR-0002, accepted by the owner and
recorded in ADR-0037, whose build check Task 7 runs. decodeText reads
UTF-8, or UTF-16 with its byte-order mark, and refuses other encodings
and NUL. The PDF fixtures come from a
committed generator (Part 2 spec §7.1, §9; plan calls P3, P5, P6;
decisions 69 (1), 70 (1, 3, 6)).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the files above (the fixtures folder holds `generate.mjs` and the five PDFs); lint-staged runs oxfmt and oxlint on the code files and changes nothing.

```json:metadata
{"files": ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "next.config.ts", "lib/chat/documents.ts", "lib/chat/pdf-text.worker.mjs", "__tests__/chat-documents.test.ts", "__tests__/fixtures/pdf/generate.mjs", "__tests__/fixtures/pdf/text.pdf", "__tests__/fixtures/pdf/cjk.pdf", "__tests__/fixtures/pdf/no-text.pdf", "__tests__/fixtures/pdf/encrypted.pdf", "__tests__/fixtures/pdf/broken.pdf"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-documents.test.ts", "acceptanceCriteria": ["package.json pins pdfjs-dist 6.4.299 exactly; node_modules/.pnpm holds pdfjs-dist@6.4.299 and no @napi-rs+canvas; @napi-rs/canvas does not resolve from pdfjs-dist and pdf.js still reads the text fixture", "isPdf finds %PDF- ending within the first 1,024 bytes (views at an offset included) and refuses a later header, a PNG, an empty file and %PDF without its dash", "extractPdfText reads text.pdf, cjk.pdf through the CMaps, no-text.pdf as empty, drops U+0000, stops at ATTACHMENT_TEXT_MAX + 1 code points and leaves its input bytes unchanged", "extractPdfText rejects with DocumentError code invalid: password for encrypted.pdf, broken for broken.pdf and non-PDF bytes, time_limit for an inflated-operator bomb under timeLimitMs 500 while the test's event loop ticks, heap_limit for a 5,000,000-number TJ array under heapMb 64", "decodeText reads UTF-8 (BOM dropped) and BOM-marked UTF-16LE/BE; refuses Windows-1256, GBK, Latin-1 and broken UTF-16 as encoding, and NUL or BOM-less UTF-16 as binary", "tsc exits 0 (and the worker's JSDoc with --checkJs), pnpm test 0 failed, oxlint and oxfmt clean"], "modelTier": "standard"}
```

---

### Task 6: The attachments' data layer, the access log and the purge

**Goal:** `lib/data/attachments.ts` stores, counts, deletes, reads and serves attachments as the Shared contracts give them, `lib/data/access-log.ts` writes the access log's rows, and the 03:00 job also purges attachments never sent within 24 hours, each proven against a live PostgreSQL.

Spec §7.1 ("Serving back: `GET /api/apps/[appId]/attachments/[attachmentId]` to the conversation's owner, or an admin through the Logs (audited, §7.2)"), §7.2 ("Audit: opening a transcript, or downloading an attachment through the Logs, writes a `conversation_access_log` row"), §3.4 ("deletes conversations whose `deleted_at` is more than 30 days old (cascade: runs, messages, attachments) and, from 2c, attachments never sent after 24 hours"); decisions 69 (4) (every fetch by anyone but the uploader is a download, thumbnails included) and 70 (4, 5) (a removed card deletes its unsent file; at most 25 unsent files a user; a download names its file); plan calls P8 (the caps count stored bytes and sent files), P14 (serving and the download audit), P21 (the purge) and P22 (the delete); the Shared contracts' "The attachments' data layer (Task 6)" (every function but `startRun`'s and `ThreadPage`'s changes, Tasks 9 and 10) and "lib/data/access-log.ts (Task 6)". The style is `lib/data/conversations.ts`'s: the verified actor first, a user's write matching only the actor's own row, the system's purge with no actor, and the role checks from `lib/auth/` (`hasAdminRights`, `assertAdmin`; ADR-0024). `readAttachment` tries the uploader's path first (the row's `user_id` is the actor, `appUsable`, and the file is unsent or its conversation is not deleted: no row), then the admin's (`hasAdminRights(actor)`, the file is sent and its conversation is of `appId`, deleted or not: a `download` row naming the file is awaited before the bytes are answered), so the uploader is never recorded, and an admin who uploaded a file and reaches it only through the admin path (their conversation deleted, the app closed to them) is recorded as any admin is; a user's query matches their own row only, so no other account's bytes are read for them. `recordAccess` refuses an actor without admin rights (`assertAdmin`): only admins' reads are recorded, and every caller (this task's `readAttachment`, Task 13's `readLogThread`) has checked the role already. Docs checked: Drizzle through Context7 (`/drizzle-team/drizzle-orm-docs`): "Select", the aggregation helpers (`count()` "casts its result to a number at runtime"; `sum()` is ``sql`sum(…)`.mapWith(String)``), "Joins" (`innerJoin`; in a partial select with `leftJoin`, "non-matching table fields are inferred as nullable"), the guide "Conditional filters in query" ("Any filter evaluating to `undefined` will be excluded" from `and()`), "Delete" with node-postgres's `rowCount` as `conversations.ts` reads it; PostgreSQL 18 "Aggregate Functions" (`sum(integer)` is a bigint; "sum of no rows returns null, not zero"), "Transaction Isolation", Read Committed ("The search condition of the command (the WHERE clause) is re-evaluated to see if the updated version of the row still matches": a delete or the purge racing Task 9's link of the same row never removes a file the run linked), "Partial Indexes" (the purge reads Task 3's `conversation_attachments_unsent_created_at_idx`); Node.js "Crypto", `createHash('sha256')` (as `lib/auth/password.ts`); Vitest "Mocking Specific Exports of a Module" (`vi.mock(import(…), async importOriginal => …)`, as `__tests__/data-users.test.ts`), for the case that makes `recordAccess` fail. The two reads that order files join each file to its user message on `conversation_messages`' UNIQUE key `(conversation_id, message_id)` and read them by the message's `seq`, then the file's `position` (Task 3's column, P11: the order the user attached them in, which the upload time is not; Task 9's linking UPDATE sets it from the index in `attachmentIds`), so the db test writes user message rows for them. Ids reach these functions checked (`lib/ids.ts`): Task 8's routes check the attachment id with `isId` and Task 9's body schema checks `attachmentIds` with `idSchema`. Later tasks call: Task 7 `storeAttachment`, `countUnsentAttachments`, `conversationAttachmentBytes`; Task 8 `readAttachment` (with `appUsable` from its `resolveChatRoute`) and `deleteUnsentAttachment`; Task 9 `unsentAttachments`, `conversationAttachmentBytes`, `attachmentsForAgent`; Task 10 `attachmentFilesOf`; Task 13 `recordAccess` for its `view` rows.

**Files:**

- Create: `lib/data/access-log.ts`
- Create: `lib/data/attachments.ts`
- Modify: `lib/chat/purge.ts` (the job also purges unsent attachments and logs both counts)
- Test: `__tests__/db/attachments.db.test.ts` (the whole file, below)
- Test: `__tests__/chat-purge.test.ts` (the whole file, below)

**Acceptance Criteria:**

- [ ] `storeAttachment` stores an unsent row of the actor with `size` and `sha256` computed from the bytes and answers its `TurnFile`; `countUnsentAttachments` counts the actor's unsent files across apps (2 for two unsent of two apps, beside a sent one and another's); `deleteUnsentAttachment` answers true once for the actor's own unsent file of the app, and false (the row kept) for a sent one, another's, one of another app and an unknown id.
- [ ] `conversationAttachmentBytes` answers 0 for a conversation without files and 3002 for files of 3000 and 2 bytes beside an unsent 9000-byte file and another conversation's 7-byte file; `unsentAttachments` answers the actor's unsent files of the app in the order of the ids, leaving out a sent one, another's, another app's and an unknown id, and `[]` for `[]`; `attachmentsForAgent` answers the conversation's sent files with bytes, text and message id message by message (the message's `seq`), then by `position`, not by upload time (two files of `m1` uploaded in the reverse of their positions, and `m2`'s file uploaded first, come back `m1`/0, `m1`/1, `m2`/0); `attachmentFilesOf` answers the named messages' files by `position`, without `data`, and `[]` for `[]`.
- [ ] `readAttachment` serves the uploader their unsent and sent files with no access-log row; answers null to the uploader while `appUsable` is false or the conversation is deleted, to another user (sent or unsent), and to an admin for a user's unsent file or another app's id; serves an admin and the owner a sent file of a deleted conversation of the app and writes one `download` row with the actor, conversation, app and `attachmentId`, one row per fetch; rejects without answering bytes when the row cannot be written.
- [ ] `recordAccess` writes a `view` row with a null `attachmentId` and a `download` row naming its file, and refuses a `user` with `AuthError('forbidden')`, writing nothing; `purgeUnsentAttachments(now)` deletes the unsent files uploaded more than 24 hours before `now` (24 h 1 ms and 100 h), keeps one uploaded exactly 24 hours before and a fresh one, never deletes a sent file 1,000 hours old, and answers 2.
- [ ] The 03:00 job calls `purgeDeletedConversations()` then `purgeUnsentAttachments()`, and logs `conversationPurge: { purged, unsentAttachments }`.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; `pnpm test:db` reports 0 failed; oxlint and oxfmt clean on the changed files.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-purge.test.ts && pnpm exec vitest run --project db __tests__/db/attachments.db.test.ts` → `Tests  4 passed (4)`, then `Test Files  1 passed (1)`, `Tests  19 passed (19)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `__tests__/db/attachments.db.test.ts`:

```ts
import { createHash } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', async () => {
	const { testDb } = await import('./database')
	return { getDb: () => testDb }
})
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
// Vitest "Mocking Specific Exports of a Module": recordAccess keeps its own behaviour, wrapped so one case can make it
// fail and show that readAttachment answers no bytes without its row.
vi.mock(import('@/lib/data/access-log'), async importOriginal => {
	const actual = await importOriginal()
	return { ...actual, recordAccess: vi.fn(actual.recordAccess) }
})

import {
	apps,
	conversationAccessLog,
	conversationAttachments,
	conversationMessages,
	conversations,
	users,
} from '@/db/schema'
import { recordAccess } from '@/lib/data/access-log'
import {
	attachmentFilesOf,
	attachmentsForAgent,
	conversationAttachmentBytes,
	countUnsentAttachments,
	deleteUnsentAttachment,
	purgeUnsentAttachments,
	readAttachment,
	storeAttachment,
	unsentAttachments,
} from '@/lib/data/attachments'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterEach(() => {
	vi.mocked(recordAccess).mockClear()
})
afterAll(() => pool.end())

const HOUR_MS = 60 * 60 * 1000

const actorFor = (role: 'owner' | 'admin' | 'user' = 'user') => ({
	id: crypto.randomUUID(),
	email: `${crypto.randomUUID()}@example.com`,
	name: null,
	role,
	source: 'local' as const,
})
type Actor = ReturnType<typeof actorFor>

const insertAccount = async (actor: Actor) => {
	await testDb
		.insert(users)
		.values({ id: actor.id, email: actor.email, password: 'hash', role: actor.role })
	return actor
}

const insertApp = async () => {
	const id = crypto.randomUUID()
	await testDb
		.insert(apps)
		.values({ id, provider: 'agui', name: 'Agent', settings: {}, secrets: {} })
	return id
}

const insertConversation = async (
	actor: Actor,
	appId: string,
	over: Partial<typeof conversations.$inferInsert> = {},
) => {
	const id = crypto.randomUUID()
	await testDb.insert(conversations).values({ id, appId, userId: actor.id, title: 'Chat', ...over })
	return id
}

/** A stored file as the upload leaves it (unsent), or sent when `over` names its conversation, message and position. */
const insertAttachment = async (
	actor: Actor,
	appId: string,
	over: Partial<typeof conversationAttachments.$inferInsert> = {},
) => {
	const data = over.data ?? Buffer.from('hello')
	const row = {
		id: crypto.randomUUID(),
		userId: actor.id,
		appId,
		kind: 'text' as const,
		mime: 'text/plain; charset=utf-8',
		name: 'notes.txt',
		size: data.length,
		sha256: createHash('sha256').update(data).digest('hex'),
		data,
		extractedText: 'hello',
		...over,
	}
	await testDb.insert(conversationAttachments).values(row)
	return row
}

/** A user message as startRun stores it (spec §3.1): a sent file is read in its message's `seq` order. */
const insertUserMessage = async (conversationId: string, messageId: string) => {
	await testDb.insert(conversationMessages).values({
		conversationId,
		messageId,
		role: 'user',
		body: { id: messageId, role: 'user', content: '' },
		status: 'complete',
	})
}

const accessRows = () => testDb.select().from(conversationAccessLog)

const idsOf = (rows: readonly { id: string }[]) => rows.map(row => row.id)

describe('storing an upload (spec §7.1; plan call P8)', () => {
	it('stores an unsent file of the actor, its size and sha256 computed from the bytes', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
		const file = await storeAttachment(actor, {
			appId,
			kind: 'image',
			mime: 'image/png',
			name: 'dot.png',
			data,
			extractedText: null,
		})
		expect(file).toEqual({
			id: expect.any(String),
			name: 'dot.png',
			kind: 'image',
			mime: 'image/png',
			size: 6,
		})
		const [row] = await testDb
			.select()
			.from(conversationAttachments)
			.where(eq(conversationAttachments.id, file.id))
		expect(row).toMatchObject({
			userId: actor.id,
			appId,
			conversationId: null,
			messageId: null,
			size: 6,
			sha256: createHash('sha256').update(data).digest('hex'),
			extractedText: null,
		})
		expect(row!.data.equals(data)).toBe(true)
	})

	it('counts the actor’s unsent files across apps, not sent ones and not another’s', async () => {
		const actor = await insertAccount(actorFor())
		const stranger = await insertAccount(actorFor())
		const appId = await insertApp()
		const otherApp = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		await insertAttachment(actor, appId)
		await insertAttachment(actor, otherApp)
		await insertAttachment(actor, appId, { conversationId, messageId: 'm1', position: 0 })
		await insertAttachment(stranger, appId)
		expect(await countUnsentAttachments(actor)).toBe(2)
		expect(await countUnsentAttachments(actorFor())).toBe(0)
	})
})

// Decision 70 (4), plan call P22.
describe('deleting an unsent file', () => {
	it('deletes the actor’s own unsent file of the app once', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const file = await insertAttachment(actor, appId)
		expect(await deleteUnsentAttachment(actor, appId, file.id)).toBe(true)
		expect(await deleteUnsentAttachment(actor, appId, file.id)).toBe(false)
		expect(await testDb.select().from(conversationAttachments)).toEqual([])
	})

	it('refuses a sent file, another’s, one of another app and an unknown id, and keeps them', async () => {
		const actor = await insertAccount(actorFor())
		const stranger = await insertAccount(actorFor())
		const appId = await insertApp()
		const otherApp = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		const sent = await insertAttachment(actor, appId, {
			conversationId,
			messageId: 'm1',
			position: 0,
		})
		const theirs = await insertAttachment(stranger, appId)
		const elsewhere = await insertAttachment(actor, otherApp)
		for (const id of [sent.id, theirs.id, elsewhere.id, crypto.randomUUID()])
			expect(await deleteUnsentAttachment(actor, appId, id)).toBe(false)
		expect(
			idsOf(
				await testDb.select({ id: conversationAttachments.id }).from(conversationAttachments),
			).toSorted(),
		).toEqual([sent.id, theirs.id, elsewhere.id].toSorted())
	})
})

describe('a run’s files (plan calls P8–P10)', () => {
	it('sums the stored bytes of the conversation’s sent files only', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		const other = await insertConversation(actor, appId)
		expect(await conversationAttachmentBytes(conversationId)).toBe(0)
		await insertAttachment(actor, appId, {
			conversationId,
			messageId: 'm1',
			position: 0,
			data: Buffer.alloc(3000),
		})
		await insertAttachment(actor, appId, {
			conversationId,
			messageId: 'm2',
			position: 0,
			data: Buffer.alloc(2),
		})
		await insertAttachment(actor, appId, { data: Buffer.alloc(9000) })
		await insertAttachment(actor, appId, {
			conversationId: other,
			messageId: 'm3',
			position: 0,
			data: Buffer.alloc(7),
		})
		expect(await conversationAttachmentBytes(conversationId)).toBe(3002)
	})

	it('answers the actor’s unsent files of the app in the order of the ids, leaving the rest out', async () => {
		const actor = await insertAccount(actorFor())
		const stranger = await insertAccount(actorFor())
		const appId = await insertApp()
		const otherApp = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		const first = await insertAttachment(actor, appId, { name: 'a.txt' })
		const second = await insertAttachment(actor, appId, { name: 'b.txt' })
		const sent = await insertAttachment(actor, appId, {
			conversationId,
			messageId: 'm1',
			position: 0,
		})
		const theirs = await insertAttachment(stranger, appId)
		const elsewhere = await insertAttachment(actor, otherApp)
		const files = await unsentAttachments(actor, appId, [
			second.id,
			sent.id,
			theirs.id,
			first.id,
			elsewhere.id,
			crypto.randomUUID(),
		])
		expect(files).toEqual([
			{ id: second.id, name: 'b.txt', kind: 'text', mime: 'text/plain; charset=utf-8', size: 5 },
			{ id: first.id, name: 'a.txt', kind: 'text', mime: 'text/plain; charset=utf-8', size: 5 },
		])
		expect(await unsentAttachments(actor, appId, [])).toEqual([])
	})

	// P11: the order the user attached them in, not the upload's: by their message's seq, then their position.
	it('answers every sent file of the conversation with its bytes, message by message, by position', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		const other = await insertConversation(actor, appId)
		await insertUserMessage(conversationId, 'm1')
		await insertUserMessage(conversationId, 'm2')
		await insertUserMessage(other, 'm9')
		const now = Date.now()
		const second = await insertAttachment(actor, appId, {
			conversationId,
			messageId: 'm1',
			position: 1,
			kind: 'document',
			mime: 'application/pdf',
			name: 'report.pdf',
			data: Buffer.from('%PDF-1.7'),
			extractedText: 'Quarterly',
			createdAt: new Date(now - 2000),
		})
		const first = await insertAttachment(actor, appId, {
			conversationId,
			messageId: 'm1',
			position: 0,
			kind: 'image',
			mime: 'image/png',
			name: 'dot.png',
			data: Buffer.from([1, 2, 3]),
			extractedText: null,
			createdAt: new Date(now - 1000),
		})
		const third = await insertAttachment(actor, appId, {
			conversationId,
			messageId: 'm2',
			position: 0,
			createdAt: new Date(now - 3000),
		})
		await insertAttachment(actor, appId)
		await insertAttachment(actor, appId, { conversationId: other, messageId: 'm9', position: 0 })
		const files = await attachmentsForAgent(conversationId)
		expect(idsOf(files)).toEqual([first.id, second.id, third.id])
		expect(files.slice(0, 2).map(({ data, ...file }) => ({ ...file, bytes: [...data] }))).toEqual([
			{
				id: first.id,
				name: 'dot.png',
				kind: 'image',
				mime: 'image/png',
				size: 3,
				messageId: 'm1',
				extractedText: null,
				bytes: [1, 2, 3],
			},
			{
				id: second.id,
				name: 'report.pdf',
				kind: 'document',
				mime: 'application/pdf',
				size: 8,
				messageId: 'm1',
				extractedText: 'Quarterly',
				bytes: [...Buffer.from('%PDF-1.7')],
			},
		])
	})
})

describe('a history page’s files (plan call P15)', () => {
	it('answers the metadata of the named messages’ files by position, without their bytes', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		await insertUserMessage(conversationId, 'm1')
		await insertUserMessage(conversationId, 'm2')
		const now = Date.now()
		const second = await insertAttachment(actor, appId, {
			conversationId,
			messageId: 'm1',
			position: 1,
			name: 'b.txt',
			createdAt: new Date(now - 2000),
		})
		const first = await insertAttachment(actor, appId, {
			conversationId,
			messageId: 'm1',
			position: 0,
			name: 'a.txt',
			createdAt: new Date(now - 1000),
		})
		await insertAttachment(actor, appId, { conversationId, messageId: 'm2', position: 0 })
		expect(await attachmentFilesOf(conversationId, ['m1', 'm3'])).toEqual([
			{
				id: first.id,
				name: 'a.txt',
				kind: 'text',
				mime: 'text/plain; charset=utf-8',
				size: 5,
				messageId: 'm1',
			},
			{
				id: second.id,
				name: 'b.txt',
				kind: 'text',
				mime: 'text/plain; charset=utf-8',
				size: 5,
				messageId: 'm1',
			},
		])
		expect(await attachmentFilesOf(conversationId, [])).toEqual([])
	})
})

// Plan call P14; decisions 69 (4) and 70 (5).
describe('serving a file', () => {
	it('serves the uploader their unsent file and their sent one, and records nothing', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		const unsent = await insertAttachment(actor, appId)
		const sent = await insertAttachment(actor, appId, {
			conversationId,
			messageId: 'm1',
			position: 0,
		})
		for (const file of [unsent, sent]) {
			const served = await readAttachment(actor, appId, file.id, { appUsable: true })
			expect(served).toMatchObject({ id: file.id, name: 'notes.txt', kind: 'text', size: 5 })
			expect(served!.data.toString('utf8')).toBe('hello')
		}
		expect(await accessRows()).toEqual([])
	})

	it('refuses the uploader while the app is not usable to them, or their conversation is deleted', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const live = await insertConversation(actor, appId)
		const deleted = await insertConversation(actor, appId, { deletedAt: new Date() })
		const unsent = await insertAttachment(actor, appId)
		const inDeleted = await insertAttachment(actor, appId, {
			conversationId: deleted,
			messageId: 'm1',
			position: 0,
		})
		const inLive = await insertAttachment(actor, appId, {
			conversationId: live,
			messageId: 'm2',
			position: 0,
		})
		expect(await readAttachment(actor, appId, unsent.id, { appUsable: false })).toBeNull()
		expect(await readAttachment(actor, appId, inLive.id, { appUsable: false })).toBeNull()
		expect(await readAttachment(actor, appId, inDeleted.id, { appUsable: true })).toBeNull()
		expect(await accessRows()).toEqual([])
	})

	it('refuses another user’s file, sent or not, and an unknown id', async () => {
		const actor = await insertAccount(actorFor())
		const stranger = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(stranger, appId)
		const unsent = await insertAttachment(stranger, appId)
		const sent = await insertAttachment(stranger, appId, {
			conversationId,
			messageId: 'm1',
			position: 0,
		})
		for (const id of [unsent.id, sent.id, crypto.randomUUID()])
			expect(await readAttachment(actor, appId, id, { appUsable: true })).toBeNull()
		expect(await accessRows()).toEqual([])
	})

	it.each(['admin', 'owner'] as const)(
		'serves an %s a sent file of a conversation of the app, deleted too, and records a download naming it',
		async role => {
			const admin = await insertAccount(actorFor(role))
			const user = await insertAccount(actorFor())
			const appId = await insertApp()
			const deleted = await insertConversation(user, appId, { deletedAt: new Date() })
			const file = await insertAttachment(user, appId, {
				conversationId: deleted,
				messageId: 'm1',
				position: 0,
			})
			const served = await readAttachment(admin, appId, file.id, { appUsable: false })
			expect(served).toMatchObject({ id: file.id, name: 'notes.txt' })
			expect(served!.data.toString('utf8')).toBe('hello')
			expect(await accessRows()).toEqual([
				{
					id: expect.any(String),
					actorId: admin.id,
					conversationId: deleted,
					appId,
					action: 'download',
					attachmentId: file.id,
					at: expect.any(Date),
				},
			])
		},
	)

	it('records a download for every fetch by an admin', async () => {
		const admin = await insertAccount(actorFor('admin'))
		const user = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(user, appId)
		const file = await insertAttachment(user, appId, {
			conversationId,
			messageId: 'm1',
			position: 0,
		})
		await readAttachment(admin, appId, file.id, { appUsable: true })
		await readAttachment(admin, appId, file.id, { appUsable: true })
		expect(await accessRows()).toHaveLength(2)
	})

	it('refuses an admin a user’s unsent file and a file of another app, and records nothing', async () => {
		const admin = await insertAccount(actorFor('admin'))
		const user = await insertAccount(actorFor())
		const appId = await insertApp()
		const otherApp = await insertApp()
		const conversationId = await insertConversation(user, appId)
		const unsent = await insertAttachment(user, appId)
		const sent = await insertAttachment(user, appId, {
			conversationId,
			messageId: 'm1',
			position: 0,
		})
		expect(await readAttachment(admin, appId, unsent.id, { appUsable: true })).toBeNull()
		expect(await readAttachment(admin, otherApp, sent.id, { appUsable: true })).toBeNull()
		expect(await accessRows()).toEqual([])
	})

	it('answers no bytes when the download row cannot be written', async () => {
		const admin = await insertAccount(actorFor('admin'))
		const user = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(user, appId)
		const file = await insertAttachment(user, appId, {
			conversationId,
			messageId: 'm1',
			position: 0,
		})
		vi.mocked(recordAccess).mockRejectedValueOnce(new Error('log down'))
		await expect(readAttachment(admin, appId, file.id, { appUsable: true })).rejects.toThrow(
			'log down',
		)
	})
})

// Spec §7.2.
describe('the access log’s write', () => {
	it('records a view without a file and a download with one', async () => {
		const admin = await insertAccount(actorFor('admin'))
		const conversationId = crypto.randomUUID()
		const appId = crypto.randomUUID()
		const attachmentId = crypto.randomUUID()
		await recordAccess(admin, { conversationId, appId, action: 'view' })
		await recordAccess(admin, { conversationId, appId, action: 'download', attachmentId })
		const rows = await accessRows()
		expect(rows).toHaveLength(2)
		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ actorId: admin.id, conversationId, appId, action: 'view' }),
				expect.objectContaining({ action: 'view', attachmentId: null }),
				expect.objectContaining({ actorId: admin.id, action: 'download', attachmentId }),
			]),
		)
	})

	it('refuses an actor without admin rights and writes nothing', async () => {
		const user = await insertAccount(actorFor())
		await expect(
			recordAccess(user, {
				conversationId: crypto.randomUUID(),
				appId: crypto.randomUUID(),
				action: 'view',
			}),
		).rejects.toMatchObject({ code: 'forbidden' })
		expect(await accessRows()).toEqual([])
	})
})

// Spec §3.4, plan call P21.
describe('the purge of unsent files', () => {
	it('deletes files unsent for more than 24 hours, and never a sent one', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		const now = new Date('2026-11-20T03:00:00Z')
		const at = (hours: number, ms = 0) => new Date(now.getTime() - hours * HOUR_MS - ms)
		const expired = await insertAttachment(actor, appId, { createdAt: at(24, 1) })
		const old = await insertAttachment(actor, appId, { createdAt: at(100) })
		const boundary = await insertAttachment(actor, appId, { createdAt: at(24) })
		const fresh = await insertAttachment(actor, appId, { createdAt: at(1) })
		const sent = await insertAttachment(actor, appId, {
			conversationId,
			messageId: 'm1',
			position: 0,
			createdAt: at(1000),
		})
		expect(await purgeUnsentAttachments(now)).toBe(2)
		const left = await testDb
			.select({ id: conversationAttachments.id })
			.from(conversationAttachments)
		// `created_at < now − 24 h`: the file uploaded exactly 24 hours before stays until the next run.
		expect(idsOf(left).toSorted()).toEqual([boundary.id, fresh.id, sent.id].toSorted())
		expect(idsOf(left)).not.toContain(expired.id)
		expect(idsOf(left)).not.toContain(old.id)
	})
})
```

That is 19 cases (2 + 2 + 3 + 1 + 8 + 2 + 1).

Replace the whole of `__tests__/chat-purge.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
	const jobs: {
		pattern: string
		options: Record<string, unknown>
		run: (...args: unknown[]) => unknown
	}[] = []
	class Cron {
		constructor(
			pattern: string,
			options: Record<string, unknown>,
			run: (...args: unknown[]) => unknown,
		) {
			jobs.push({ pattern, options, run })
		}
		stop() {}
	}
	return { jobs, Cron, purgeDeletedConversations: vi.fn(), purgeUnsentAttachments: vi.fn() }
})
vi.mock('croner', () => ({ Cron: mocks.Cron }))
vi.mock('@/lib/data/conversations', () => ({
	purgeDeletedConversations: mocks.purgeDeletedConversations,
}))
vi.mock('@/lib/data/attachments', () => ({
	purgeUnsentAttachments: mocks.purgeUnsentAttachments,
}))

import { PURGE_SCHEDULE, startPurgeSchedule } from '@/lib/chat/purge'

const reset = () => {
	delete (globalThis as { aiAppHubConversationPurge?: unknown }).aiAppHubConversationPurge
}

beforeEach(() => {
	reset()
	mocks.jobs.length = 0
	mocks.purgeDeletedConversations.mockReset()
	mocks.purgeUnsentAttachments.mockReset()
})
afterEach(reset)

describe('startPurgeSchedule (spec §3.4; 2a plan call P13, 2c plan call P21)', () => {
	it('starts one protected, unref’d five-field job at 03:00, once per process', () => {
		startPurgeSchedule()
		startPurgeSchedule()
		expect(mocks.jobs).toHaveLength(1)
		expect(mocks.jobs[0].pattern).toBe('0 3 * * *')
		expect(mocks.jobs[0].options).toMatchObject({ mode: '5-part', protect: true, unref: true })
		expect(mocks.jobs[0].options.catch).toEqual(expect.any(Function))
	})

	// croner calls the job with itself and its context: the purge must not read them as its clock.
	it('purges deleted conversations, then unsent attachments, with the current time, and logs both counts', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {})
		mocks.purgeDeletedConversations.mockResolvedValue(3)
		mocks.purgeUnsentAttachments.mockResolvedValue(2)
		startPurgeSchedule()
		await mocks.jobs[0].run({ croner: 'job' }, 'context')
		expect(mocks.purgeDeletedConversations).toHaveBeenCalledWith()
		expect(mocks.purgeUnsentAttachments).toHaveBeenCalledWith()
		expect(mocks.purgeDeletedConversations.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.purgeUnsentAttachments.mock.invocationCallOrder[0]!,
		)
		expect(info).toHaveBeenCalledWith('conversationPurge:', { purged: 3, unsentAttachments: 2 })
		info.mockRestore()
	})

	it('routes a failing run through the catch option to the log', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		startPurgeSchedule()
		const boom = new Error('db down')
		;(mocks.jobs[0].options.catch as (e: unknown) => void)(boom)
		expect(error).toHaveBeenCalledWith('conversationPurge:', boom)
		error.mockRestore()
	})

	it('is a pattern croner runs daily at 03:00', async () => {
		const { Cron } = await vi.importActual<typeof import('croner')>('croner')
		const job = new Cron(PURGE_SCHEDULE, { mode: '5-part', timezone: 'UTC' })
		expect(job.nextRun(new Date('2026-10-14T12:00:00Z'))?.toISOString()).toBe(
			'2026-10-15T03:00:00.000Z',
		)
		job.stop()
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project db __tests__/db/attachments.db.test.ts`

Expected: FAIL, `Test Files  1 failed (1)`, `Tests  no tests`, with `Error: Cannot find package '@/lib/data/access-log'` (neither module exists yet).

Run: `pnpm exec vitest run --project unit __tests__/chat-purge.test.ts`

Expected: FAIL, `Tests  1 failed | 3 passed (4)`: "purges deleted conversations, then unsent attachments…" with `AssertionError: expected "vi.fn()" to be called with arguments: []` (the job does not call `purgeUnsentAttachments` yet).

- [ ] **Step 3: Write the access log's write**

Create `lib/data/access-log.ts`:

```ts
import 'server-only'

import { getDb } from '@/db'
import { conversationAccessLog } from '@/db/schema'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'

/*
 * The access log's write (Part 2 spec §7.2; ADR-0024, ADR-0037): an admin's read of a user's conversation leaves a row,
 * the transcript opened in the Logs (`view`, lib/data/logs.ts) and every attachment fetched (`download`,
 * lib/data/attachments.ts; decision 69 (4), thumbnails included; decision 70 (5), the file named). OWASP's Logging
 * Cheat Sheet lists access by administrators and access to sensitive data among the events to record, each with "when,
 * where, who and what"; the row holds ids only, never what was read (ASVS 5.0 16.3.2: "without logging the sensitive
 * data itself"). The owner's listing of it is lib/data/logs.ts's.
 */

/**
 * Spec §7.2: one row per transcript opened or attachment fetched by someone other than the conversation's user. Only an
 * admin's read is recorded, so an actor without admin rights is refused here as every admin function of the DAL refuses
 * one (assertAdmin, ADR-0024). The id is minted here and `at` is the database's now() (db/schema/attachments.ts). The
 * callers await it before they answer, so a read the log could not record is never served.
 */
export async function recordAccess(
	actor: SessionUser,
	entry:
		| { conversationId: string; appId: string; action: 'view' }
		| { conversationId: string; appId: string; action: 'download'; attachmentId: string },
): Promise<void> {
	assertAdmin(actor)
	await getDb()
		.insert(conversationAccessLog)
		.values({
			id: crypto.randomUUID(),
			actorId: actor.id,
			conversationId: entry.conversationId,
			appId: entry.appId,
			action: entry.action,
			attachmentId: entry.action === 'download' ? entry.attachmentId : null,
		})
}
```

- [ ] **Step 4: Write the attachments' data layer**

Create `lib/data/attachments.ts`:

```ts
import 'server-only'

import { createHash } from 'node:crypto'

import { and, asc, count, eq, inArray, isNull, lt, sum } from 'drizzle-orm'

import { getDb } from '@/db'
import { conversationAttachments, conversationMessages, conversations } from '@/db/schema'
import { hasAdminRights } from '@/lib/auth/roles'
import type { SessionUser } from '@/lib/auth/session'
import {
	UNSENT_ATTACHMENT_HOURS,
	type AttachmentKind,
	type TurnFile,
} from '@/lib/chat/attachment-rules'

import { recordAccess } from './access-log'

/*
 * The attachments' Data Access Layer (Part 2 spec §7.1; ADR-0024, ADR-0037). The upload, the count and the delete take
 * the verified actor first and reach only the actor's own unsent files (plan calls P8, P22); the run's and the
 * history's reads are keyed by a conversation the caller already found for the actor (findConversation,
 * lib/data/conversations.ts; P9, P10, P15), as a run's later writes are keyed by its RunKey; serving a file decides
 * here between its uploader and an admin, and records an admin's fetch before the bytes are answered (P14,
 * lib/data/access-log.ts); the daily purge takes no actor (P21), as the conversations' does. Only the two reads that
 * send the bytes (to the agent, to the browser) select `data`, a value of up to 5 MB kept out of the row
 * (db/schema/attachments.ts); every other read names the metadata columns. Ids from outside are UUIDs by the time they
 * get here (lib/ids.ts: the routes and the run's body schema check them).
 */

/** What the upload stores (P3–P7: proven, processed and capped by lib/chat/uploads.ts first). */
export interface NewAttachment {
	appId: string
	kind: AttachmentKind
	mime: string
	name: string
	data: Buffer
	/** P6: the text the agent reads (capped, the note included); null for an image. */
	extractedText: string | null
}

export interface AttachmentForAgent extends TurnFile {
	messageId: string
	data: Buffer
	extractedText: string | null
}

export interface ServedAttachment extends TurnFile {
	data: Buffer
}

/** A file as the browser and the caps know it (TurnFile): never the bytes. */
const fileColumns = {
	id: conversationAttachments.id,
	name: conversationAttachments.name,
	kind: conversationAttachments.kind,
	mime: conversationAttachments.mime,
	size: conversationAttachments.size,
}

/** The actor's own files that are not sent yet. */
const unsentOf = (actor: Pick<SessionUser, 'id'>) =>
	and(eq(conversationAttachments.userId, actor.id), isNull(conversationAttachments.conversationId))

/**
 * A sent row has its message id: the schema's sent CHECK holds `conversation_id` and `message_id` both or neither
 * (db/schema/attachments.ts), so every row read by its conversation has one, and the flatMap only narrows the type.
 */
const withMessageId = <Row extends { messageId: string | null }>(rows: readonly Row[]) =>
	rows.flatMap(({ messageId, ...row }) => (messageId === null ? [] : [{ ...row, messageId }]))

/**
 * A sent file joined to its user message, on the message's UNIQUE key `(conversation_id, message_id)`
 * (db/schema/conversations.ts; Drizzle "Joins", innerJoin): startRun writes the message in the transaction that links
 * the file (P9), so every sent file has one.
 */
const fileMessage = () =>
	and(
		eq(conversationMessages.conversationId, conversationAttachments.conversationId),
		eq(conversationMessages.messageId, conversationAttachments.messageId),
	)

/**
 * P11: the order the user attached the files in, message by message: the message's `seq` (the transcript's order,
 * spec §3.1), then the file's `position` in its message; the upload time is not that order (db/schema/attachments.ts).
 */
const attachedOrder = () => [
	asc(conversationMessages.seq),
	asc(conversationAttachments.position),
	asc(conversationAttachments.id),
]

/**
 * Stores an unsent attachment of the actor (spec §7.1). `size` and `sha256` are computed from the bytes stored, so the
 * caps count what is stored and re-sent (P8; Node.js "Crypto", createHash), and the id is minted here as the run mints
 * a conversation's. `created_at` is the database's now(), the purge's clock (P21).
 */
export async function storeAttachment(actor: SessionUser, input: NewAttachment): Promise<TurnFile> {
	const file: TurnFile = {
		id: crypto.randomUUID(),
		name: input.name,
		kind: input.kind,
		mime: input.mime,
		size: input.data.byteLength,
	}
	await getDb()
		.insert(conversationAttachments)
		.values({
			...file,
			userId: actor.id,
			appId: input.appId,
			sha256: createHash('sha256').update(input.data).digest('hex'),
			data: input.data,
			extractedText: input.extractedText,
		})
	return file
}

/** P8 (decision 70 (4)): the actor's unsent attachments, across apps (Drizzle "Select", count()). */
export async function countUnsentAttachments(actor: SessionUser): Promise<number> {
	const [row] = await getDb()
		.select({ files: count() })
		.from(conversationAttachments)
		.where(unsentOf(actor))
	return row?.files ?? 0
}

/**
 * P22 (decision 70 (4)): deletes the actor's own unsent attachment of this app; false when there is none, or it is
 * sent, or another's. A send racing the delete is safe both ways: the run's UPDATE and this DELETE lock the row, and
 * the one that waits re-evaluates its WHERE on the row the other committed (PostgreSQL 18 "Transaction Isolation", Read
 * Committed: "The search condition of the command (the WHERE clause) is re-evaluated"), so a file the run linked is
 * kept, and a file deleted first is missing from the run's count (P9: the send is refused).
 */
export async function deleteUnsentAttachment(
	actor: SessionUser,
	appId: string,
	attachmentId: string,
): Promise<boolean> {
	const result = await getDb()
		.delete(conversationAttachments)
		.where(
			and(
				eq(conversationAttachments.id, attachmentId),
				eq(conversationAttachments.appId, appId),
				unsentOf(actor),
			),
		)
	return (result.rowCount ?? 0) > 0
}

/**
 * P8: the stored bytes of the conversation's sent attachments (every row with a conversation is sent). `sum(integer)`
 * is a bigint, and "sum of no rows returns null, not zero" (PostgreSQL 18 "Aggregate Functions"); Drizzle's sum() maps
 * it to a string (Drizzle "Select", aggregations helpers), read as a number here: 6 MB is far inside 2^53.
 */
export async function conversationAttachmentBytes(conversationId: string): Promise<number> {
	const [row] = await getDb()
		.select({ bytes: sum(conversationAttachments.size) })
		.from(conversationAttachments)
		.where(eq(conversationAttachments.conversationId, conversationId))
	return Number(row?.bytes ?? 0)
}

/**
 * P9: the actor's unsent attachments of this app among `ids`, in the order of `ids` (the order the user attached them,
 * P11); an id that is not one of them (another's, sent, of another app, deleted or purged) is left out, so the caller
 * compares the lengths.
 */
export async function unsentAttachments(
	actor: SessionUser,
	appId: string,
	ids: readonly string[],
): Promise<TurnFile[]> {
	if (!ids.length) return []
	const rows = await getDb()
		.select(fileColumns)
		.from(conversationAttachments)
		.where(
			and(
				inArray(conversationAttachments.id, [...ids]),
				eq(conversationAttachments.appId, appId),
				unsentOf(actor),
			),
		)
	const byId = new Map(rows.map(row => [row.id, row]))
	return ids.flatMap(id => {
		const row = byId.get(id)
		return row ? [row] : []
	})
}

/**
 * P10: every sent attachment of the conversation with its bytes, its text and its message, in the order the user
 * attached them (P11), on the `(conversation_id, message_id)` index: what a run's input is built from (decision 54:
 * every run re-sends every attachment).
 */
export async function attachmentsForAgent(conversationId: string): Promise<AttachmentForAgent[]> {
	const rows = await getDb()
		.select({
			...fileColumns,
			messageId: conversationAttachments.messageId,
			data: conversationAttachments.data,
			extractedText: conversationAttachments.extractedText,
		})
		.from(conversationAttachments)
		.innerJoin(conversationMessages, fileMessage())
		.where(eq(conversationAttachments.conversationId, conversationId))
		.orderBy(...attachedOrder())
	return withMessageId(rows)
}

/** P15: the metadata of the attachments of these user messages of the conversation, in attached order (P11). */
export async function attachmentFilesOf(
	conversationId: string,
	messageIds: readonly string[],
): Promise<(TurnFile & { messageId: string })[]> {
	if (!messageIds.length) return []
	const rows = await getDb()
		.select({ ...fileColumns, messageId: conversationAttachments.messageId })
		.from(conversationAttachments)
		.innerJoin(conversationMessages, fileMessage())
		.where(
			and(
				eq(conversationAttachments.conversationId, conversationId),
				inArray(conversationAttachments.messageId, [...messageIds]),
			),
		)
		.orderBy(...attachedOrder())
	return withMessageId(rows)
}

/**
 * P14 (decisions 69 (4), 70 (5)): the attachment of this app the actor may fetch, with its bytes, or null.
 *
 * - Its uploader, while the app is usable to them (`appUsable`: visible and enabled, the route's resolveChatRoute) and
 *   the file is unsent or its conversation is not deleted: no row is written, the user reads their own file.
 * - Otherwise an owner or admin (hasAdminRights, ADR-0024), for a sent file of a conversation of this app, deleted or
 *   not until the purge: a `download` row naming the file is written first, so the bytes never leave unrecorded. An
 *   admin who uploaded the file and reaches it only this way (their conversation deleted, the app closed to them) is
 *   recorded like any admin.
 *
 * A user's query matches their own row only, so another account's bytes are never read for them (the admin's query
 * leaves that term out: "Any filter evaluating to `undefined` will be excluded", Drizzle guide "Conditional filters in
 * query"). The conversation is a LEFT JOIN, so an unsent file still matches, its conversation's columns null (Drizzle
 * "Joins", partial select: "non-matching table fields are inferred as nullable").
 */
export async function readAttachment(
	actor: SessionUser,
	appId: string,
	attachmentId: string,
	options: { appUsable: boolean },
): Promise<ServedAttachment | null> {
	const [row] = await getDb()
		.select({
			...fileColumns,
			data: conversationAttachments.data,
			userId: conversationAttachments.userId,
			conversationId: conversationAttachments.conversationId,
			conversationAppId: conversations.appId,
			deletedAt: conversations.deletedAt,
		})
		.from(conversationAttachments)
		.leftJoin(conversations, eq(conversations.id, conversationAttachments.conversationId))
		.where(
			and(
				eq(conversationAttachments.id, attachmentId),
				eq(conversationAttachments.appId, appId),
				hasAdminRights(actor) ? undefined : eq(conversationAttachments.userId, actor.id),
			),
		)
		.limit(1)
	if (!row) return null
	const { userId, conversationId, conversationAppId, deletedAt, ...file } = row
	if (userId === actor.id && options.appUsable && (conversationId === null || deletedAt === null))
		return file
	if (!hasAdminRights(actor) || conversationId === null || conversationAppId !== appId) return null
	await recordAccess(actor, { conversationId, appId, action: 'download', attachmentId: file.id })
	return file
}

const HOUR_MS = 60 * 60 * 1000

/**
 * P21 (spec §3.4): the daily job's delete of attachments never sent, uploaded more than UNSENT_ATTACHMENT_HOURS before
 * `now`, on the partial index over the unsent rows (db/schema/attachments.ts). A sent file is never touched: the run
 * links a file under the row lock this DELETE waits on, and the WHERE is re-evaluated on the linked row (PostgreSQL 18
 * "Transaction Isolation", Read Committed). No actor: the system runs it (lib/chat/purge.ts). Answers how many went.
 */
export async function purgeUnsentAttachments(now: Date = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - UNSENT_ATTACHMENT_HOURS * HOUR_MS)
	const result = await getDb()
		.delete(conversationAttachments)
		.where(
			and(
				isNull(conversationAttachments.conversationId),
				lt(conversationAttachments.createdAt, cutoff),
			),
		)
	return result.rowCount ?? 0
}
```

- [ ] **Step 5: The purge**

Replace the whole of `lib/chat/purge.ts` with:

```ts
import 'server-only'

import { Cron } from 'croner'

import { purgeUnsentAttachments } from '@/lib/data/attachments'
import { purgeDeletedConversations } from '@/lib/data/conversations'
import { logActionError } from '@/lib/error-log'

/*
 * The daily purge of deleted conversations and, from 2c, of attachments never sent (Part 2 spec §3.4; 2a's plan call
 * P13, 2c's P21), registered beside the directory sync in instrumentation.ts the way lib/directory/schedule.ts
 * registers it: one croner job per process, kept on globalThis so a development reload does not start a second one
 * (Rallly's guard, cited there).
 */

/** Every day at 03:00 in the server's zone (croner reads a five-field pattern in `mode: '5-part'`, croner.d.ts). */
export const PURGE_SCHEDULE = '0 3 * * *'

const globalForPurge = globalThis as unknown as { aiAppHubConversationPurge?: Cron }

/**
 * One run: conversations deleted more than PURGE_AFTER_DAYS ago go, with their runs, messages and attachments
 * (cascade); then the attachments never sent within UNSENT_ATTACHMENT_HOURS of their upload. Both counts are logged.
 */
const runPurge = async (): Promise<void> => {
	const purged = await purgeDeletedConversations()
	const unsentAttachments = await purgeUnsentAttachments()
	console.info('conversationPurge:', { purged, unsentAttachments })
}

/**
 * Starts the job once per process. croner's README, Options: `protect` "Will block new triggers as long as an old trigger
 * is in progress", `unref` "allows the process to exit even if a cron job is running", and `catch` receives a run's
 * error, logged here by logActionError (decision g of B3b: a database error by its name and code). croner calls the job
 * with itself and its context, so the purge is wrapped and takes no argument from it.
 */
export function startPurgeSchedule(): void {
	if (globalForPurge.aiAppHubConversationPurge) return
	globalForPurge.aiAppHubConversationPurge = new Cron(
		PURGE_SCHEDULE,
		{
			mode: '5-part',
			protect: true,
			unref: true,
			catch: (error: unknown) => logActionError(error, 'conversationPurge'),
		},
		() => runPurge(),
	)
}
```

`instrumentation.ts` and `__tests__/instrumentation.test.ts` need no change: the job is the same one, started the same way.

- [ ] **Step 6: Run them to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-purge.test.ts && pnpm exec vitest run --project db __tests__/db/attachments.db.test.ts`

Expected: PASS, `Tests  4 passed (4)`; then `Test Files  1 passed (1)`, `Tests  19 passed (19)`.

- [ ] **Step 7: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/data/access-log.ts lib/data/attachments.ts lib/chat/purge.ts __tests__/db/attachments.db.test.ts __tests__/chat-purge.test.ts
pnpm exec oxfmt --check lib/data/access-log.ts lib/data/attachments.ts lib/chat/purge.ts __tests__/db/attachments.db.test.ts __tests__/chat-purge.test.ts
pnpm test
pnpm test:db
```

Expected: tsc exits 0; oxlint prints no finding; oxfmt "All matched files use the correct format."; `pnpm test` 0 failed; `pnpm test:db` 0 failed (`Test Files  12 passed (12)` at this task).

- [ ] **Step 8: Commit**

```bash
git add lib/data/access-log.ts lib/data/attachments.ts lib/chat/purge.ts __tests__/db/attachments.db.test.ts __tests__/chat-purge.test.ts
git commit -m "feat(chat): the attachments' data layer, the access log and the purge

Uploads are stored unsent with their size and sha256 from the stored
bytes; a user's unsent files are counted and deleted by their owner only,
and the run's and history's reads go by conversation. A file is served to
its uploader while the app is usable and the conversation is not deleted,
or to an owner or admin for a sent file of the app with a download row
naming it written first. The 03:00 job also deletes files unsent for 24
hours (Part 2 spec §3.4, §7.1, §7.2; plan calls P8, P14, P21, P22;
decisions 69 (4), 70 (4, 5)).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the five files; lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": ["lib/data/access-log.ts", "lib/data/attachments.ts", "lib/chat/purge.ts", "__tests__/db/attachments.db.test.ts", "__tests__/chat-purge.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-purge.test.ts && pnpm exec vitest run --project db __tests__/db/attachments.db.test.ts", "acceptanceCriteria": ["storeAttachment stores an unsent row with size and sha256 from the bytes; countUnsentAttachments counts the actor's unsent files across apps; deleteUnsentAttachment deletes the actor's own unsent file once and refuses a sent one, another's, another app's and an unknown id", "conversationAttachmentBytes sums the sent files of the conversation only (0 for none, 3002 in the case); unsentAttachments answers in the order of the ids and leaves the rest out; attachmentsForAgent answers sent files with bytes by their message's seq, then position, not upload time; attachmentFilesOf answers the named messages' files by position without bytes", "readAttachment serves the uploader without a row, refuses them while the app is not usable or the conversation is deleted, refuses other users, serves an admin or the owner a sent file of a deleted conversation of the app with one download row naming it per fetch, and answers no bytes when the row cannot be written", "recordAccess writes view and download rows and refuses a user with forbidden; purgeUnsentAttachments deletes unsent files older than 24 hours, keeps the exactly-24-hours one and every sent file, answers 2", "the 03:00 job purges conversations then unsent attachments and logs both counts", "tsc exits 0, pnpm test and pnpm test:db 0 failed, oxlint and oxfmt clean"], "modelTier": "standard"}
```

---

### Task 7: The upload route

**Goal:** `POST /api/apps/[appId]/attachments` takes one file of the shared chat's composer, proves it by its bytes against the app's settings as they are now, stores it unsent through Task 6's data layer and answers 201 with the `UploadedAttachment`, or the hub's envelope with one of the upload codes, which the browser words in en, zh and ar.

Spec §7.1 ("Upload: `POST /api/apps/[appId]/attachments`, one multipart part named `file` (the shape of Dify's upload route, `parseFilePart`), guarded by `resolveChatRoute`. Checks (OWASP File Upload Cheat Sheet): the kind is allowed by the app's settings; the type is detected from the bytes, never the browser's claim; at most 5 MB per file (under Next's 10 MB `proxyClientMaxBodySize`, which would truncate silently); at most 6 MB of attachments per conversation") and §8 (the codes), plan calls P1 (the policy from `chat.attachments(app.settings)`, read now), P3 (the extension claims the kind, the bytes prove it; a name of at most 255 characters), P4 (the eight codes and the `Content-Length` pre-check), P6 (`capText` and the `truncated` flag), P7 (images through `processChatImage`) and P8 (the waiting limit, the conversation's sent total plus this file's stored size, unsent files never counted), and the Shared contracts' "Uploads, serving and runs" (`UploadResult`, `acceptUpload`), with Task 1's `UploadRefusalCode` and `UPLOAD_REFUSALS` for each refusal's status and message (kept in the rules, so Task 9's run answers the same codes without importing this module's sharp and PDF worker). Docs checked: Next 16.3.4's bundled `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` lines 501–523 ("Request Body FormData": `const formData = await request.formData()` in a Route Handler) and `…/05-config/01-next-config-js/proxyClientMaxBodySize.md` ("Behavior": a body over the limit is buffered "up to the limit", "The request will **not** fail", "only the partial body will be available", 10 MB by default; the hub has a `proxy.ts`, so it applies), which is why a declared length over one file's worth (`ATTACHMENT_MAX_BYTES + UPLOAD_BODY_SLACK_BYTES`) is answered 413 before `formData()` is called, where a cut body would read as a broken form (research R1, "Upload timing"); zod 4.6.5 through Context7 (`/colinhacks/zod/v4.6.5`, "z.array": `z.array(z.string()).max(5); // must contain 5 or fewer items`; `.transform()` on any schema) for the optional `conversationId`, read with `FormData.getAll` (MDN `FormData.getAll()`: every value of the name, a string or a File, so a File or a second value is refused); MDN `Blob.type` (the browser's type "is assumed based on the file extension", so it is never read) and the OWASP File Upload Cheat Sheet ("List allowed extensions", "Validate the file type, don't trust the Content-Type header"; research R1 §2). `lib/http/parse.ts` gains `parseFileForm`, `parseFilePart`'s rule answering the form beside the file so the route reads the body once; `parseFilePart` keeps its answers, which `__tests__/http-parse.test.ts` and the Dify upload's tests pin. The checks run cheapest first, so a refusal costs no PDF worker run and no sharp decode: the claimed kind and the policy (415), the name (400: more than `ATTACHMENT_NAME_MAX` code points, as P6 counts lengths, or a U+0000, which PostgreSQL's `text` cannot store), the size (413), the actor's waiting files (413), the conversation when one is named (404, through 2a's `findConversation`: the actor's, of this app, not deleted), then the bytes once, proven by kind (an `ImageError` `too_large` is 413 and `not_allowed` 400; a missing `%PDF-` header or a `DocumentError` 400 in both modes; blank text after `capText` 400 `attachment_no_text` in `text` mode only; `decodeText`'s `'encoding'` 400 `attachment_encoding` and `'binary'` 400 `attachment_invalid`), then the conversation's cap on the stored size, then `storeAttachment`, so nothing is stored on any refusal (the cross-task ordering's rule). The test mocks Tasks 4, 5 and 6's modules (`vi.mock`, as `__tests__/chat-routes.test.ts` mocks the data layer), with the two error classes defined in `vi.hoisted` so `instanceof` in the module under test sees the test's classes (the route tests' `AuthError` pattern); the database side of `storeAttachment`, `countUnsentAttachments` and `conversationAttachmentBytes` is Task 6's `attachments.db.test.ts`. `components/shared-chat/run-error.ts`'s `HUB_CODE_KEYS` gains every `AttachmentErrorCode` (`satisfies Record<AttachmentErrorCode, string>`, so a code Task 1 adds later fails tsc here), each worded by `shared_chat.error.<code>`, P4's texts for `attachment_no_text`, `attachment_encoding` and `unsent_attachments_full`. Task 11's `api.uploadAttachment` posts to this route, and a refused card is worded with these keys through `requestFailureText`; Task 8 answers `attachment_not_found` with the same key; Task 9 links the stored rows; Task 19's `agui-files.spec.ts` drives it in the browser.

**Files:**

- Create: `lib/chat/uploads.ts`
- Create: `app/api/apps/[appId]/attachments/route.ts`
- Modify: `lib/http/parse.ts` (`parseFileForm`; `parseFilePart` built on it)
- Modify: `components/shared-chat/run-error.ts` (`ATTACHMENT_CODE_KEYS` in `HUB_CODE_KEYS`)
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (eight `shared_chat.error.*` keys)
- Test: `__tests__/chat-uploads.test.ts` (the whole file, below)
- Test: `__tests__/http-parse.test.ts`, `__tests__/shared-chat-view.test.ts` (new cases), `__tests__/api-routes.test.ts` (the route pinned)

**Acceptance Criteria:**

- [ ] `acceptUpload` answers `{ ok: false, code: 'attachment_type_not_allowed', status: 415 }` for `README`, `setup.exe`, `.png`, `photo.png` while `images` is false and `report.pdf` or `notes.txt` while `documents` is `'off'`, without reading the bytes; 400 `attachment_invalid` for a 256-code-point name and a name holding U+0000 (a 255-character name and a 200-emoji name pass); 413 `attachment_too_large` for 5 MB + 1 byte (5 MB passes); 413 `unsent_attachments_full` when `countUnsentAttachments` answers 25 (24 passes); 404 `conversation_not_found` when `findConversation(actor, appId, conversationId)` answers null; and `storeAttachment` is never called on any refusal.
- [ ] An image is passed to `processChatImage(bytes, { maxEdge: policy.maxImageEdge })` and stored with its returned bytes and `mime` (`photo.png` decoded as WebP is stored `image/webp`, `extractedText: null`); `ImageError('not_allowed')` → 400 `attachment_invalid`, `ImageError('too_large')` → 413, any other error rethrown. A PDF without the header → 400 before `extractPdfText`; a `DocumentError` → 400 in `text` and `native` mode; blank or NUL-only text → 400 `attachment_no_text` in `text` mode, stored with `extractedText: ''` in `native` mode; otherwise stored as uploaded, `application/pdf`, with its text. A text file is stored as uploaded with `<TEXT_MIME>; charset=<charset>` (`table.csv` read as UTF-16LE → `text/csv; charset=utf-16le`); `decodeText` `'encoding'` → 400 `attachment_encoding`, `'binary'` → 400 `attachment_invalid`.
- [ ] A PDF's or a text file's text of 100,001 code points is stored as the first 100,000 followed by `TRUNCATED_NOTE`, and the upload answers `truncated: true`; one of exactly 100,000 is stored whole with `truncated: false`.
- [ ] With a `conversationId`, a file whose stored size brings the conversation's sent total to 6 MB is taken and one byte more is 413 `conversation_attachments_full`; an image counts its re-encoded bytes; without one, no conversation is read.
- [ ] `POST /api/apps/[appId]/attachments` answers 401 signed out; 201 with `{ id, name, kind, mime, size, truncated }` and `cache-control: private, no-store`, the policy read by `chat.attachments(app.settings)`; 413 `attachment_too_large` for a declared `Content-Length` over 5,308,416 bytes without calling `request.formData()` (5,308,416 is read); 400 `invalid_param` with `parseFilePart`'s messages for a non-multipart body, two file parts and no file part, and `Invalid request: conversationId` for a non-UUID or a repeated `conversationId`; a refusal as `{ code, message: UPLOAD_REFUSALS[code].message, status }`; a thrown store as a logged 500.
- [ ] `runErrorView({ code })` answers `{ titleKey: 'shared_chat.error.<code>' }` for each of the eight `ATTACHMENT_ERROR_CODES`, and the eight keys exist in en, zh and ar; `__tests__/api-routes.test.ts` pins `apps/[appId]/attachments/route.ts`.
- [ ] `pnpm build` makes no `[worker thread]` chunk and puts no `pdfjs` or `pdf.worker` in `.next/static`; the route's chunk keeps `join(process.cwd(),"lib/chat/pdf-text.worker.mjs")` once; `.next/standalone` holds the worker, pdf.js's `legacy/build/pdf.mjs` and `pdf.worker.mjs`, its `package.json`, 169 CMaps and 16 standard fonts; a standalone copy on its own reads `text.pdf` and `cjk.pdf` (Japanese included) through the worker (Step 10).
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the changed files.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-uploads.test.ts __tests__/http-parse.test.ts __tests__/shared-chat-view.test.ts __tests__/api-routes.test.ts __tests__/i18n-locales.test.ts __tests__/dify-routes-files.test.ts` → `Test Files  6 passed (6)`, `Tests  141 passed (141)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `__tests__/chat-uploads.test.ts`:

```ts
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NewAttachment } from '@/lib/data/attachments'

const m = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	findConversation: vi.fn(),
	storeAttachment: vi.fn(),
	countUnsentAttachments: vi.fn(),
	conversationAttachmentBytes: vi.fn(),
	processChatImage: vi.fn(),
	isPdf: vi.fn(),
	extractPdfText: vi.fn(),
	decodeText: vi.fn(),
	chat: { attachments: vi.fn() },
	// Task 4's and Task 5's errors as the tests throw them: acceptUpload reads them with instanceof, so the module under
	// test and the tests share these classes (the AuthError mocks of the route tests do the same).
	ImageError: class ImageError extends Error {
		constructor(readonly code: 'too_large' | 'not_allowed') {
			super(code)
		}
	},
	DocumentError: class DocumentError extends Error {
		readonly code = 'invalid' as const
	},
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession: m.verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess: m.getAppAccess }))
vi.mock('@/lib/providers/registry', () => ({
	chatAdapterOf: (provider: string) => (provider === 'agui' ? m.chat : undefined),
}))
vi.mock('@/lib/data/conversations', () => ({ findConversation: m.findConversation }))
vi.mock('@/lib/data/attachments', () => ({
	storeAttachment: m.storeAttachment,
	countUnsentAttachments: m.countUnsentAttachments,
	conversationAttachmentBytes: m.conversationAttachmentBytes,
}))
vi.mock('@/lib/settings/images', () => ({
	processChatImage: m.processChatImage,
	ImageError: m.ImageError,
}))
vi.mock('@/lib/chat/documents', () => ({
	isPdf: m.isPdf,
	extractPdfText: m.extractPdfText,
	decodeText: m.decodeText,
	DocumentError: m.DocumentError,
}))

import { POST } from '@/app/api/apps/[appId]/attachments/route'
import {
	ATTACHMENT_MAX_BYTES,
	ATTACHMENT_TEXT_MAX,
	CONVERSATION_ATTACHMENTS_MAX_BYTES,
	TRUNCATED_NOTE,
	UNSENT_ATTACHMENTS_MAX,
	UPLOAD_BODY_SLACK_BYTES,
	UPLOAD_REFUSALS,
	type AttachmentPolicy,
} from '@/lib/chat/attachment-rules'
import { acceptUpload, type UploadResult } from '@/lib/chat/uploads'

const APP_ID = '0b1c2d3e-4f50-4a61-8b72-9c8dae0f1a2b'
const CONVERSATION_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const ATTACHMENT_ID = '7d444840-9dc0-41d5-8d6b-0a4b6f8b3c11'
const actor = {
	id: 'u1',
	email: 'jane@example.com',
	name: null,
	role: 'user' as const,
	source: 'local' as const,
}
const policy: AttachmentPolicy = { images: true, documents: 'text', maxImageEdge: null }
const agui = {
	id: APP_ID,
	enabled: true,
	provider: 'agui',
	settings: {
		agentUrl: 'http://agent/agents/a',
		audience: 'a',
		askUser: false,
		attachments: policy,
	},
	secrets: { jwtSecret: 'x'.repeat(32) },
}
const file = (name: string, content: string | Uint8Array<ArrayBuffer> = 'content') =>
	new File([content], name)
const upload = (
	name: string,
	{
		content,
		with: over = {},
		conversationId,
	}: {
		content?: string | Uint8Array<ArrayBuffer>
		with?: Partial<AttachmentPolicy>
		conversationId?: string
	} = {},
) =>
	acceptUpload({
		actor,
		appId: APP_ID,
		policy: { ...policy, ...over },
		file: file(name, content),
		conversationId,
	})
/** The input storeAttachment was given. */
const stored = (): NewAttachment => m.storeAttachment.mock.calls[0][1]
const refused = (result: UploadResult, code: string, status: number) => {
	expect(result).toEqual({ ok: false, code, status })
	expect(m.storeAttachment).not.toHaveBeenCalled()
}

beforeEach(() => {
	for (const fn of [
		m.verifySession,
		m.getAppAccess,
		m.findConversation,
		m.storeAttachment,
		m.countUnsentAttachments,
		m.conversationAttachmentBytes,
		m.processChatImage,
		m.isPdf,
		m.extractPdfText,
		m.decodeText,
		m.chat.attachments,
	])
		fn.mockReset()
	m.verifySession.mockResolvedValue(actor)
	m.getAppAccess.mockResolvedValue(agui)
	m.chat.attachments.mockImplementation(
		(settings: { attachments: AttachmentPolicy }) => settings.attachments,
	)
	m.findConversation.mockResolvedValue({ id: CONVERSATION_ID, appId: APP_ID })
	m.countUnsentAttachments.mockResolvedValue(0)
	m.conversationAttachmentBytes.mockResolvedValue(0)
	// The DAL's answer (Task 6): the stored row as a TurnFile, its size the stored bytes'.
	m.storeAttachment.mockImplementation(async (_actor: unknown, input: NewAttachment) => ({
		id: ATTACHMENT_ID,
		name: input.name,
		kind: input.kind,
		mime: input.mime,
		size: input.data.length,
	}))
	m.processChatImage.mockResolvedValue({
		bytes: Buffer.from('webp'),
		sha256: 'f'.repeat(64),
		width: 640,
		height: 480,
		mime: 'image/webp',
	})
	m.isPdf.mockReturnValue(true)
	m.extractPdfText.mockResolvedValue('Quarterly report')
	m.decodeText.mockReturnValue({ ok: true, text: 'a,b\n1,2', charset: 'utf-8' })
})

// Plan call P3: the extension claims the kind, the app's settings as they are now allow it (OWASP: allow-list first).
describe('acceptUpload: the claimed kind', () => {
	it.each([
		['a name without an extension', 'README', {}],
		['an extension of no kind', 'setup.exe', {}],
		['a dot file', '.png', {}],
		['an image while the app takes none', 'photo.png', { images: false }],
		['a PDF while documents are off', 'report.pdf', { documents: 'off' as const }],
		['a text file while documents are off', 'notes.txt', { documents: 'off' as const }],
	])('refuses %s with 415, never reading the bytes', async (_label, name, over) => {
		refused(await upload(name, { with: over }), 'attachment_type_not_allowed', 415)
		expect(m.processChatImage).not.toHaveBeenCalled()
		expect(m.extractPdfText).not.toHaveBeenCalled()
		expect(m.decodeText).not.toHaveBeenCalled()
	})
	it('reads the extension in any case', async () => {
		expect((await upload('PHOTO.JPG')).ok).toBe(true)
		expect(stored().kind).toBe('image')
	})
})

describe('acceptUpload: the name and the size (P3, P4)', () => {
	it('refuses a name over 255 code points, and takes 255', async () => {
		refused(await upload(`${'a'.repeat(252)}.txt`), 'attachment_invalid', 400)
		expect((await upload(`${'a'.repeat(251)}.txt`)).ok).toBe(true)
	})
	it('counts a name in code points, so 200 emoji pass', async () => {
		expect((await upload(`${'😀'.repeat(200)}.txt`)).ok).toBe(true)
	})
	it('refuses a name holding U+0000', async () => {
		refused(await upload('notes\u0000.txt'), 'attachment_invalid', 400)
	})
	it('refuses a file over 5 MB with 413, and takes exactly 5 MB', async () => {
		refused(
			await upload('big.txt', { content: new Uint8Array(ATTACHMENT_MAX_BYTES + 1) }),
			'attachment_too_large',
			413,
		)
		expect(m.decodeText).not.toHaveBeenCalled()
		expect((await upload('big.txt', { content: new Uint8Array(ATTACHMENT_MAX_BYTES) })).ok).toBe(
			true,
		)
	})
})

// P8, decision 70 (4): at most 25 files waiting to be sent, across apps.
describe('acceptUpload: the files waiting to be sent', () => {
	it('refuses a 26th unsent file with 413 before the bytes are read', async () => {
		m.countUnsentAttachments.mockResolvedValue(UNSENT_ATTACHMENTS_MAX)
		refused(await upload('notes.txt'), 'unsent_attachments_full', 413)
		expect(m.countUnsentAttachments).toHaveBeenCalledWith(actor)
		expect(m.decodeText).not.toHaveBeenCalled()
	})
	it('takes the 25th', async () => {
		m.countUnsentAttachments.mockResolvedValue(UNSENT_ATTACHMENTS_MAX - 1)
		expect((await upload('notes.txt')).ok).toBe(true)
	})
})

describe('acceptUpload: an image (P3, P7)', () => {
	it('stores the re-encoded bytes under the decoded format’s type, shrunk to the app’s edge', async () => {
		const result = await upload('photo.png', { content: 'png-bytes', with: { maxImageEdge: 1024 } })
		expect(m.processChatImage).toHaveBeenCalledWith(Buffer.from('png-bytes'), { maxEdge: 1024 })
		expect(stored()).toEqual({
			appId: APP_ID,
			kind: 'image',
			mime: 'image/webp',
			name: 'photo.png',
			data: Buffer.from('webp'),
			extractedText: null,
		})
		expect(result).toEqual({
			ok: true,
			attachment: {
				id: ATTACHMENT_ID,
				name: 'photo.png',
				kind: 'image',
				mime: 'image/webp',
				size: 4,
				truncated: false,
			},
		})
	})
	it('keeps the size when the app sets no edge', async () => {
		await upload('photo.jpg')
		expect(m.processChatImage).toHaveBeenCalledWith(expect.any(Buffer), { maxEdge: null })
	})
	it('refuses bytes sharp does not decode as PNG, JPEG or WebP with 400', async () => {
		m.processChatImage.mockRejectedValue(new m.ImageError('not_allowed'))
		refused(await upload('photo.png'), 'attachment_invalid', 400)
	})
	it('refuses an image the pipeline finds too large with 413', async () => {
		m.processChatImage.mockRejectedValue(new m.ImageError('too_large'))
		refused(await upload('photo.png'), 'attachment_too_large', 413)
	})
	it('lets any other failure through to the route’s 500', async () => {
		m.processChatImage.mockRejectedValue(new Error('sharp crashed'))
		await expect(upload('photo.png')).rejects.toThrow('sharp crashed')
		expect(m.storeAttachment).not.toHaveBeenCalled()
	})
})

describe('acceptUpload: a PDF (P3, P5, P6)', () => {
	it('stores the bytes as uploaded with their text, in text mode', async () => {
		const result = await upload('report.pdf', { content: '%PDF-1.7 body' })
		expect(m.isPdf).toHaveBeenCalledWith(Buffer.from('%PDF-1.7 body'))
		expect(m.extractPdfText).toHaveBeenCalledWith(Buffer.from('%PDF-1.7 body'))
		expect(stored()).toEqual({
			appId: APP_ID,
			kind: 'document',
			mime: 'application/pdf',
			name: 'report.pdf',
			data: Buffer.from('%PDF-1.7 body'),
			extractedText: 'Quarterly report',
		})
		expect(result).toMatchObject({ ok: true, attachment: { kind: 'document', truncated: false } })
	})
	it('refuses bytes without the PDF header with 400, never starting the reader', async () => {
		m.isPdf.mockReturnValue(false)
		refused(await upload('report.pdf'), 'attachment_invalid', 400)
		expect(m.extractPdfText).not.toHaveBeenCalled()
	})
	it.each(['text', 'native'] as const)(
		'refuses a PDF pdf.js cannot read with 400 in %s mode',
		async documents => {
			m.extractPdfText.mockRejectedValue(new m.DocumentError('password'))
			refused(await upload('report.pdf', { with: { documents } }), 'attachment_invalid', 400)
		},
	)
	it.each([
		['blank', ' \n\t '],
		['NUL only', '\u0000\u0000'],
	])('refuses a PDF whose text is %s with 400 in text mode', async (_label, text) => {
		m.extractPdfText.mockResolvedValue(text)
		refused(await upload('scan.pdf'), 'attachment_no_text', 400)
	})
	it('stores a PDF without text in native mode, with its empty text', async () => {
		m.extractPdfText.mockResolvedValue('')
		expect((await upload('scan.pdf', { with: { documents: 'native' } })).ok).toBe(true)
		expect(stored()).toMatchObject({ kind: 'document', extractedText: '' })
	})
})

describe('acceptUpload: a text file (P3, decision 70 (3, 6))', () => {
	it('stores the bytes as uploaded under its extension’s type and the charset it was read in', async () => {
		const bytes = new Uint8Array([0xff, 0xfe, 0x61, 0x00])
		m.decodeText.mockReturnValue({ ok: true, text: 'a', charset: 'utf-16le' })
		const result = await upload('table.csv', { content: bytes })
		expect(m.decodeText).toHaveBeenCalledWith(Buffer.from(bytes))
		expect(stored()).toEqual({
			appId: APP_ID,
			kind: 'text',
			mime: 'text/csv; charset=utf-16le',
			name: 'table.csv',
			data: Buffer.from(bytes),
			extractedText: 'a',
		})
		expect(result).toMatchObject({
			ok: true,
			attachment: { kind: 'text', mime: 'text/csv; charset=utf-16le', size: 4 },
		})
	})
	it.each([
		['notes.txt', 'text/plain; charset=utf-8'],
		['README.md', 'text/markdown; charset=utf-8'],
	])('types %s as %s', async (name, mime) => {
		await upload(name)
		expect(stored().mime).toBe(mime)
	})
	it('refuses another encoding with 400 attachment_encoding', async () => {
		m.decodeText.mockReturnValue({ ok: false, reason: 'encoding' })
		refused(await upload('table.csv'), 'attachment_encoding', 400)
	})
	it('refuses text holding NUL as binary with 400 attachment_invalid', async () => {
		m.decodeText.mockReturnValue({ ok: false, reason: 'binary' })
		refused(await upload('notes.txt'), 'attachment_invalid', 400)
	})
})

// P6, decision 69 (3): the text is cut at 100,000 code points with a note the agent reads, and the composer is told.
describe('acceptUpload: the text cap', () => {
	it('cuts a PDF’s text and answers truncated', async () => {
		m.extractPdfText.mockResolvedValue('a'.repeat(ATTACHMENT_TEXT_MAX + 1))
		const result = await upload('long.pdf')
		expect(result).toMatchObject({ ok: true, attachment: { truncated: true } })
		const text = stored().extractedText ?? ''
		expect(text.startsWith('a'.repeat(ATTACHMENT_TEXT_MAX))).toBe(true)
		expect(text.endsWith(TRUNCATED_NOTE)).toBe(true)
		expect(text).not.toContain('a'.repeat(ATTACHMENT_TEXT_MAX + 1))
	})
	it('cuts a text file’s text the same way, in native mode too', async () => {
		m.decodeText.mockReturnValue({
			ok: true,
			text: 'b'.repeat(ATTACHMENT_TEXT_MAX + 1),
			charset: 'utf-8',
		})
		const result = await upload('long.txt', { with: { documents: 'native' } })
		expect(result).toMatchObject({ ok: true, attachment: { truncated: true } })
		expect(stored().extractedText?.endsWith(TRUNCATED_NOTE)).toBe(true)
	})
	it('keeps a text of exactly 100,000 code points whole', async () => {
		m.extractPdfText.mockResolvedValue('a'.repeat(ATTACHMENT_TEXT_MAX))
		expect(await upload('full.pdf')).toMatchObject({ ok: true, attachment: { truncated: false } })
		expect(stored().extractedText).toBe('a'.repeat(ATTACHMENT_TEXT_MAX))
	})
})

// P8: a conversation's cap counts its sent files' stored bytes plus this file's; a new chat's upload names none.
describe('acceptUpload: the conversation', () => {
	it('checks nothing of a conversation when the composer names none', async () => {
		expect((await upload('notes.txt')).ok).toBe(true)
		expect(m.findConversation).not.toHaveBeenCalled()
		expect(m.conversationAttachmentBytes).not.toHaveBeenCalled()
	})
	it('refuses a conversation that is not the actor’s of this app with 404, before the bytes are read', async () => {
		m.findConversation.mockResolvedValue(null)
		refused(
			await upload('notes.txt', { conversationId: CONVERSATION_ID }),
			'conversation_not_found',
			404,
		)
		expect(m.findConversation).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID)
		expect(m.decodeText).not.toHaveBeenCalled()
	})
	it('takes a file that fills the conversation to the cap, and refuses one byte more with 413', async () => {
		m.conversationAttachmentBytes.mockResolvedValue(CONVERSATION_ATTACHMENTS_MAX_BYTES - 7)
		expect(
			(await upload('notes.txt', { content: '7 bytes', conversationId: CONVERSATION_ID })).ok,
		).toBe(true)
		expect(m.conversationAttachmentBytes).toHaveBeenCalledWith(CONVERSATION_ID)
		m.storeAttachment.mockClear()
		refused(
			await upload('notes.txt', { content: '8 bytes!', conversationId: CONVERSATION_ID }),
			'conversation_attachments_full',
			413,
		)
	})
	it('counts an image’s stored bytes, not the upload’s', async () => {
		m.conversationAttachmentBytes.mockResolvedValue(CONVERSATION_ATTACHMENTS_MAX_BYTES - 4)
		const result = await upload('photo.png', {
			content: 'a much larger upload',
			conversationId: CONVERSATION_ID,
		})
		expect(result).toMatchObject({ ok: true, attachment: { size: 4 } })
	})
})

const base = `http://hub/api/apps/${APP_ID}/attachments`
const ctx = { params: Promise.resolve({ appId: APP_ID }) }
const multipart = (parts: Array<[string, File | string]>) => {
	const form = new FormData()
	for (const [name, value] of parts) form.append(name, value)
	return new NextRequest(base, { method: 'POST', body: form })
}
const read = async (response: Response) => ({
	status: response.status,
	body: await response.json(),
})

describe('POST attachments', () => {
	it('answers 401 signed out, storing nothing', async () => {
		m.verifySession.mockResolvedValue(null)
		expect((await POST(multipart([['file', file('notes.txt')]]), ctx)).status).toBe(401)
		expect(m.storeAttachment).not.toHaveBeenCalled()
	})
	it('answers 201 with the file as the composer shows it, uncached, by the app’s settings now', async () => {
		const response = await POST(
			multipart([
				['file', file('notes.txt', 'hello')],
				['conversationId', CONVERSATION_ID],
			]),
			ctx,
		)
		expect(await read(response)).toEqual({
			status: 201,
			body: {
				id: ATTACHMENT_ID,
				name: 'notes.txt',
				kind: 'text',
				mime: 'text/plain; charset=utf-8',
				size: 5,
				truncated: false,
			},
		})
		expect(response.headers.get('cache-control')).toBe('private, no-store')
		expect(m.chat.attachments).toHaveBeenCalledWith(agui.settings)
		expect(m.findConversation).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID)
	})
	it('answers a refusal as the hub’s envelope', async () => {
		expect(await read(await POST(multipart([['file', file('setup.exe')]]), ctx))).toEqual({
			status: 415,
			body: {
				code: 'attachment_type_not_allowed',
				message: UPLOAD_REFUSALS.attachment_type_not_allowed.message,
				status: 415,
			},
		})
	})
	// P4: a body past Next's 10 MB proxy limit would arrive cut short and read as a broken form.
	it('refuses a declared length over 5 MB and 64 KB with 413 before reading the body', async () => {
		const request = new NextRequest(base, {
			method: 'POST',
			headers: { 'content-length': String(ATTACHMENT_MAX_BYTES + UPLOAD_BODY_SLACK_BYTES + 1) },
			body: 'x',
		})
		const formData = vi.spyOn(request, 'formData')
		expect(await read(await POST(request, ctx))).toEqual({
			status: 413,
			body: {
				code: 'attachment_too_large',
				message: UPLOAD_REFUSALS.attachment_too_large.message,
				status: 413,
			},
		})
		expect(formData).not.toHaveBeenCalled()
	})
	it('reads a body whose declared length is exactly 5 MB and 64 KB', async () => {
		const request = new NextRequest(base, {
			method: 'POST',
			headers: { 'content-length': String(ATTACHMENT_MAX_BYTES + UPLOAD_BODY_SLACK_BYTES) },
			body: 'x',
		})
		const formData = vi.spyOn(request, 'formData')
		expect((await POST(request, ctx)).status).toBe(400)
		expect(formData).toHaveBeenCalledOnce()
	})
	it.each([
		[
			'a body that is not multipart',
			() => new NextRequest(base, { method: 'POST', body: 'plain' }),
			'Expected a multipart body with one file part.',
		],
		[
			'two file parts',
			() =>
				multipart([
					['file', file('a.txt')],
					['file', file('b.txt')],
				]),
			'Expected exactly one non-empty file part named file.',
		],
		[
			'no file part',
			() => multipart([['conversationId', CONVERSATION_ID]]),
			'Expected exactly one non-empty file part named file.',
		],
		[
			'a conversationId that is not a UUID',
			() =>
				multipart([
					['file', file('notes.txt')],
					['conversationId', 'abc'],
				]),
			'Invalid request: conversationId',
		],
		[
			'two conversationIds',
			() =>
				multipart([
					['file', file('notes.txt')],
					['conversationId', CONVERSATION_ID],
					['conversationId', CONVERSATION_ID],
				]),
			'Invalid request: conversationId',
		],
	])('refuses %s with 400 invalid_param, storing nothing', async (_label, request, message) => {
		expect(await read(await POST(request(), ctx))).toEqual({
			status: 400,
			body: { code: 'invalid_param', message, status: 400 },
		})
		expect(m.storeAttachment).not.toHaveBeenCalled()
	})
	it('answers a logged 500 envelope when the store throws', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		m.storeAttachment.mockRejectedValue(new Error('boom'))
		expect((await POST(multipart([['file', file('notes.txt')]]), ctx)).status).toBe(500)
		expect(errorSpy).toHaveBeenCalledWith('POST /api/apps/[appId]/attachments:', expect.any(Error))
		errorSpy.mockRestore()
	})
})
```

In `__tests__/http-parse.test.ts`, find:

```ts
import { parseFilePart, parsePathParams } from '@/lib/http/parse'
```

Replace with:

```ts
import { parseFileForm, parseFilePart, parsePathParams } from '@/lib/http/parse'
```

Then find:

```ts
		expect(parsed.ok).toBe(true)
		if (parsed.ok) expect(parsed.data.name).toBe('a.txt')
	})
	// FormData cannot build these (it names a Blob "blob"), so the body is written out with a fixed boundary.
```

Replace with:

```ts
		expect(parsed.ok).toBe(true)
		if (parsed.ok) expect(parsed.data.name).toBe('a.txt')
	})
	// Part 2 spec §7.1: the shared chat's upload reads conversationId from the same form, which is read once.
	it('parseFileForm hands the form beside the file part', async () => {
		const parsed = await parseFileForm(
			multipart([
				['file', new File(['x'], 'a.txt')],
				['conversationId', UUID],
			]),
		)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		expect(parsed.data.file.name).toBe('a.txt')
		expect(parsed.data.form.get('conversationId')).toBe(UUID)
	})
	// FormData cannot build these (it names a Blob "blob"), so the body is written out with a fixed boundary.
```

In `__tests__/shared-chat-view.test.ts`, find:

```ts
import { groupParts, inputHint, standaloneInterrupts } from '@/components/shared-chat/turn-parts'
```

Replace with:

```ts
import { groupParts, inputHint, standaloneInterrupts } from '@/components/shared-chat/turn-parts'
import { ATTACHMENT_ERROR_CODES } from '@/lib/chat/attachment-rules'
```

Then find:

```ts
	it('names only keys the English file has', () => {
		for (const code of [...AGENT_ERROR_CODES, ...HUB_ERROR_CODES, 'other'])
			expect(english(runErrorView({ code, message: '' }).titleKey)).toEqual(expect.any(String))
	})
})
```

Replace with:

```ts
	it('names only keys the English file has', () => {
		for (const code of [...AGENT_ERROR_CODES, ...HUB_ERROR_CODES, 'other'])
			expect(english(runErrorView({ code, message: '' }).titleKey)).toEqual(expect.any(String))
	})
	// 2c's plan call P4: every refusal of a file is a hub code with its own text.
	it.each([...ATTACHMENT_ERROR_CODES])('words the attachment code %s by its own key', code => {
		expect(runErrorView({ code, message: 'English from the hub' })).toEqual({
			titleKey: `shared_chat.error.${code}`,
		})
		expect(english(`shared_chat.error.${code}`)).toEqual(expect.any(String))
	})
})
```

In `__tests__/api-routes.test.ts`, find:

```ts
// two public brand image routes; Part 2 spec §4.2 adds the shared chat's four routes under apps/[appId]/ (a run, the
// conversation list, one conversation, a run's stop). The forgot and reset password handlers stay as inherited (plan
// deviation 6, ADR-0024); they are named here so a new handler under auth/ still fails the test.
```

Replace with:

```ts
// two public brand image routes; Part 2 spec §4.2 adds the shared chat's four routes under apps/[appId]/ (a run, the
// conversation list, one conversation, a run's stop) and §7.1 the attachment upload. The forgot and reset password
// handlers stay as inherited (plan deviation 6, ADR-0024); they are named here so a new handler under auth/ still fails
// the test.
```

Then, in the same file's long regular expression, find `apps\/\[appId\]\/(icon|runs|conversations(` and replace it with `apps\/\[appId\]\/(icon|runs|attachments|conversations(` (the rest of the expression stays). Then find:

```ts
	it('holds exactly the shared chat routes of spec §4.2 under apps/[appId]/', () => {
```

Replace with:

```ts
	it('holds exactly the shared chat routes of spec §4.2 and §7.1 under apps/[appId]/', () => {
```

And find:

```ts
		).toEqual([
			'apps/[appId]/conversations/[conversationId]/route.ts',
```

Replace with:

```ts
		).toEqual([
			'apps/[appId]/attachments/route.ts',
			'apps/[appId]/conversations/[conversationId]/route.ts',
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-uploads.test.ts __tests__/http-parse.test.ts __tests__/shared-chat-view.test.ts __tests__/api-routes.test.ts __tests__/i18n-locales.test.ts __tests__/dify-routes-files.test.ts`

Expected: FAIL, `Test Files  4 failed | 2 passed (6)`, `Tests  10 failed | 75 passed (85)`: `chat-uploads.test.ts` cannot load (`Cannot find package '@/app/api/apps/[appId]/attachments/route'`); `parseFileForm is not a function`; the eight new `runErrorView` cases answer the generic title; the exact route list lacks `apps/[appId]/attachments/route.ts`.

- [ ] **Step 3: Read the file and the form together**

In `lib/http/parse.ts`, find:

```ts
/**
 * Exactly one non-empty `file` part with a name (Dify: one part, filename required; Review Focus 2 of the B1 plan).
 * Other parts (a client-sent `user`) are dropped: the route builds its own form for the provider.
 */
export const parseFilePart = async (request: Request): Promise<Parsed<File>> => {
	let form: FormData
	try {
		form = await request.formData()
	} catch {
		return {
			ok: false,
			response: errorResponse(
				'invalid_param',
				'Expected a multipart body with one file part.',
				400,
			),
		}
	}
	const files = form.getAll('file')
	const file = files[0]
	if (files.length !== 1 || !(file instanceof File) || !file.name || file.size === 0) {
		return {
			ok: false,
			response: errorResponse(
				'invalid_param',
				'Expected exactly one non-empty file part named file.',
				400,
			),
		}
	}
	return { ok: true, data: file }
}
```

Replace with:

```ts
/**
 * Exactly one non-empty `file` part with a name (Dify: one part, filename required; Review Focus 2 of the B1 plan), and
 * the form it came in, for a route that reads a field beside it (the shared chat's upload reads `conversationId`, Part 2
 * spec §7.1). The body is read once (Next's route.md, "Request Body FormData": `request.formData()`).
 */
export const parseFileForm = async (
	request: Request,
): Promise<Parsed<{ file: File; form: FormData }>> => {
	let form: FormData
	try {
		form = await request.formData()
	} catch {
		return {
			ok: false,
			response: errorResponse(
				'invalid_param',
				'Expected a multipart body with one file part.',
				400,
			),
		}
	}
	const files = form.getAll('file')
	const file = files[0]
	if (files.length !== 1 || !(file instanceof File) || !file.name || file.size === 0) {
		return {
			ok: false,
			response: errorResponse(
				'invalid_param',
				'Expected exactly one non-empty file part named file.',
				400,
			),
		}
	}
	return { ok: true, data: { file, form } }
}

/**
 * The one file part alone (parseFileForm's rule). Other parts (a client-sent `user`) are dropped: the route builds its own
 * form for the provider.
 */
export const parseFilePart = async (request: Request): Promise<Parsed<File>> => {
	const parsed = await parseFileForm(request)
	return parsed.ok ? { ok: true, data: parsed.data.file } : parsed
}
```

- [ ] **Step 4: The upload's checks**

Create `lib/chat/uploads.ts`:

```ts
import 'server-only'

import type { SessionUser } from '@/lib/auth/session'
import {
	conversationAttachmentBytes,
	countUnsentAttachments,
	storeAttachment,
} from '@/lib/data/attachments'
import { findConversation } from '@/lib/data/conversations'
import { ImageError, processChatImage } from '@/lib/settings/images'

import {
	allowedKinds,
	ATTACHMENT_MAX_BYTES,
	ATTACHMENT_NAME_MAX,
	capText,
	claimedKind,
	CONVERSATION_ATTACHMENTS_MAX_BYTES,
	extensionOf,
	kindsAllowedBy,
	TEXT_MIME,
	UNSENT_ATTACHMENTS_MAX,
	UPLOAD_REFUSALS,
	type AttachmentErrorCode,
	type AttachmentKind,
	type AttachmentPolicy,
	type DocumentsMode,
	type UploadedAttachment,
	type UploadRefusalCode,
} from './attachment-rules'
import { decodeText, DocumentError, extractPdfText, isPdf } from './documents'

/*
 * One upload of the shared chat's composer (Part 2 spec §7.1; plan calls P3, P4, P6, P8): the name claims the kind, the
 * app's settings as they are now allow it or not, the bytes prove it, and the file is stored unsent in the shape the agent
 * will read. OWASP File Upload Cheat Sheet: "List allowed extensions", then "Validate the file type, don't trust the
 * Content-Type header" (the browser's type is never read: MDN `Blob.type` says it is the extension's guess anyway).
 * Every check answers before storeAttachment, so a refused upload stores nothing.
 */

export type UploadResult =
	| { ok: true; attachment: UploadedAttachment }
	| { ok: false; code: UploadRefusalCode; status: number }

/**
 * A refusal with its status (spec §8, P4). UPLOAD_REFUSALS lives with the rules (lib/chat/attachment-rules.ts), so the
 * run (lib/chat/run.ts) answers the same codes without importing this module's sharp and PDF worker.
 */
const refuse = (code: UploadRefusalCode): UploadResult => ({
	ok: false,
	code,
	status: UPLOAD_REFUSALS[code].status,
})

/** What the bytes proved: the file as it is stored (P8: `size` is what is stored) and what the agent reads of it. */
type Proof =
	| { ok: true; data: Buffer; mime: string; extractedText: string | null; truncated: boolean }
	| { ok: false; code: AttachmentErrorCode }

/**
 * P3, P7: an image is what sharp decodes as PNG, JPEG or WebP, whichever image extension it came with, stored re-encoded
 * under the decoded format's type (LobeHub relabels the same way); shrunk only to the app's largest edge.
 */
const proveImage = async (bytes: Buffer, maxEdge: number | null): Promise<Proof> => {
	try {
		const image = await processChatImage(bytes, { maxEdge })
		return { ok: true, data: image.bytes, mime: image.mime, extractedText: null, truncated: false }
	} catch (error) {
		if (!(error instanceof ImageError)) throw error
		return {
			ok: false,
			code: error.code === 'too_large' ? 'attachment_too_large' : 'attachment_invalid',
		}
	}
}

/**
 * P3, P5, P6: a PDF has `%PDF-` in its head and pdf.js reads it (in the worker, lib/chat/documents.ts); its text is read
 * in both modes, so a later switch to `text` has it. A PDF without text is refused in `text` mode only: in `native` mode
 * the model reads its pages, scans included, and the empty text is stored.
 */
const proveDocument = async (bytes: Buffer, documents: DocumentsMode): Promise<Proof> => {
	if (!isPdf(bytes)) return { ok: false, code: 'attachment_invalid' }
	let raw: string
	try {
		raw = await extractPdfText(bytes)
	} catch (error) {
		if (!(error instanceof DocumentError)) throw error
		return { ok: false, code: 'attachment_invalid' }
	}
	const { text, truncated } = capText(raw)
	if (documents === 'text' && text.trim() === '') return { ok: false, code: 'attachment_no_text' }
	return { ok: true, data: bytes, mime: 'application/pdf', extractedText: text, truncated }
}

/**
 * P3, P6 (decision 70 (3, 6)): a text file is UTF-8, or UTF-16 with its byte-order mark, and holds no NUL; stored as
 * uploaded, its type naming the charset it was read in, so it is served back as it came.
 */
const proveText = (bytes: Buffer, extension: string): Proof => {
	const decoded = decodeText(bytes)
	if (!decoded.ok)
		return {
			ok: false,
			code: decoded.reason === 'encoding' ? 'attachment_encoding' : 'attachment_invalid',
		}
	const { text, truncated } = capText(decoded.text)
	const mime = `${TEXT_MIME[extension]}; charset=${decoded.charset}`
	return { ok: true, data: bytes, mime, extractedText: text, truncated }
}

const prove = (
	kind: AttachmentKind,
	bytes: Buffer,
	extension: string,
	policy: AttachmentPolicy,
): Promise<Proof> | Proof => {
	switch (kind) {
		case 'image':
			return proveImage(bytes, policy.maxImageEdge)
		case 'document':
			return proveDocument(bytes, policy.documents)
		case 'text':
			return proveText(bytes, extension)
	}
}

/**
 * P3–P8, the cheap checks first: the kind the name claims and whether the app takes it now (415); the name (at most
 * ATTACHMENT_NAME_MAX code points, and no U+0000, which a PostgreSQL text column cannot hold); the size (413); the files
 * the actor already has waiting (413, decision 70 (4)); the conversation, when the composer names one (the actor's, of
 * this app, not deleted, else 404); only then the bytes, read once and proven by kind; the conversation's sent total plus
 * this file's stored size (413; unsent files never count, so removing and re-adding a file never locks a user out); and
 * the store.
 */
export async function acceptUpload({
	actor,
	appId,
	policy,
	file,
	conversationId,
}: {
	actor: SessionUser
	appId: string
	policy: AttachmentPolicy
	file: File
	conversationId?: string
}): Promise<UploadResult> {
	const kind = claimedKind(file.name)
	if (!kind || !allowedKinds(kindsAllowedBy(policy)).includes(kind))
		return refuse('attachment_type_not_allowed')
	if ([...file.name].length > ATTACHMENT_NAME_MAX || file.name.includes('\u0000'))
		return refuse('attachment_invalid')
	if (file.size > ATTACHMENT_MAX_BYTES) return refuse('attachment_too_large')
	if ((await countUnsentAttachments(actor)) >= UNSENT_ATTACHMENTS_MAX)
		return refuse('unsent_attachments_full')
	if (conversationId !== undefined && !(await findConversation(actor, appId, conversationId)))
		return refuse('conversation_not_found')
	const proof = await prove(
		kind,
		Buffer.from(await file.arrayBuffer()),
		extensionOf(file.name),
		policy,
	)
	if (!proof.ok) return refuse(proof.code)
	if (
		conversationId !== undefined &&
		(await conversationAttachmentBytes(conversationId)) + proof.data.length >
			CONVERSATION_ATTACHMENTS_MAX_BYTES
	)
		return refuse('conversation_attachments_full')
	const stored = await storeAttachment(actor, {
		appId,
		kind,
		mime: proof.mime,
		name: file.name,
		data: proof.data,
		extractedText: proof.extractedText,
	})
	return { ok: true, attachment: { ...stored, truncated: proof.truncated } }
}
```

- [ ] **Step 5: The route**

Create `app/api/apps/[appId]/attachments/route.ts`:

```ts
import type { NextRequest } from 'next/server'
import * as z from 'zod'

import {
	ATTACHMENT_MAX_BYTES,
	UPLOAD_BODY_SLACK_BYTES,
	UPLOAD_REFUSALS,
} from '@/lib/chat/attachment-rules'
import { resolveChatRoute } from '@/lib/chat/route'
import { acceptUpload } from '@/lib/chat/uploads'
import { errorResponse, errorResponseFrom } from '@/lib/http/errors'
import { parseFileForm } from '@/lib/http/parse'
import { jsonNoStore } from '@/lib/http/response'
import { idSchema } from '@/lib/ids'

/** P4: the largest body a single file at ATTACHMENT_MAX_BYTES arrives in, its multipart framing included. */
const BODY_MAX_BYTES = ATTACHMENT_MAX_BYTES + UPLOAD_BODY_SLACK_BYTES

/** P8: the conversation the composer is in, when it has one: at most one value, a UUID (lib/ids.ts). */
const conversationIdSchema = z
	.array(idSchema)
	.max(1)
	.transform(ids => ids[0])

/**
 * POST attachments (Part 2 spec §7.1; plan calls P3, P4, P8): one file the composer uploads when it is picked, one
 * multipart part named `file` as Dify's upload route takes it (parseFileForm), and an optional `conversationId`; 201 with
 * the file as the composer shows it (UploadedAttachment), or the hub's envelope. A body over Next's
 * `proxyClientMaxBodySize` (10 MB by default) reaches the handler cut short rather than refused ("The request will not
 * fail", Next's proxyClientMaxBodySize.md), and would read as a broken form, so a declared length over one file's worth
 * is answered as too large before the body is read (R1 "Upload timing").
 */
export async function POST(
	request: NextRequest,
	ctx: RouteContext<'/api/apps/[appId]/attachments'>,
) {
	const resolved = await resolveChatRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	if (Number(request.headers.get('content-length')) > BODY_MAX_BYTES) {
		const { status, message } = UPLOAD_REFUSALS.attachment_too_large
		return errorResponse('attachment_too_large', message, status)
	}
	const part = await parseFileForm(request)
	if (!part.ok) return part.response
	const conversationId = conversationIdSchema.safeParse(part.data.form.getAll('conversationId'))
	if (!conversationId.success)
		return errorResponse('invalid_param', 'Invalid request: conversationId', 400)
	try {
		const { actor, app, chat } = resolved
		const result = await acceptUpload({
			actor,
			appId: app.id,
			// P1: the app's settings as they are now, so an admin's change applies to the next upload.
			policy: chat.attachments(app.settings),
			file: part.data.file,
			conversationId: conversationId.data,
		})
		return result.ok
			? jsonNoStore(result.attachment, { status: 201 })
			: errorResponse(result.code, UPLOAD_REFUSALS[result.code].message, result.status)
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/apps/[appId]/attachments')
	}
}
```

- [ ] **Step 6: The codes in the browser's map**

In `components/shared-chat/run-error.ts`, find:

```ts
import type { Turn } from '@/lib/chat/turn'
```

Replace with:

```ts
import type { AttachmentErrorCode } from '@/lib/chat/attachment-rules'
import type { Turn } from '@/lib/chat/turn'
```

Then find:

```ts
/**
 * The hub's own codes (spec §8; the route guard's access codes, ADR-0023): worded by key, never by their English
```

Replace with:

```ts
/**
 * The refusals of a file (spec §8, 2c's plan call P4): the upload's, the run's and the serve and delete routes', one key
 * each, so the composer words a refused card as the turn words a refused run. `satisfies` keeps every code of
 * lib/chat/attachment-rules.ts worded.
 */
const ATTACHMENT_CODE_KEYS = {
	attachment_too_large: 'shared_chat.error.attachment_too_large',
	conversation_attachments_full: 'shared_chat.error.conversation_attachments_full',
	unsent_attachments_full: 'shared_chat.error.unsent_attachments_full',
	attachment_type_not_allowed: 'shared_chat.error.attachment_type_not_allowed',
	attachment_invalid: 'shared_chat.error.attachment_invalid',
	attachment_encoding: 'shared_chat.error.attachment_encoding',
	attachment_no_text: 'shared_chat.error.attachment_no_text',
	attachment_not_found: 'shared_chat.error.attachment_not_found',
} as const satisfies Record<AttachmentErrorCode, string>

/**
 * The hub's own codes (spec §8; the route guard's access codes, ADR-0023): worded by key, never by their English
```

Then find:

```ts
	app_disabled: 'chat.error_app_disabled',
} as const
```

Replace with:

```ts
	app_disabled: 'chat.error_app_disabled',
	...ATTACHMENT_CODE_KEYS,
} as const
```

`HUB_ERROR_CODES` (its keys) and `runErrorView`, `requestFailureText` read the spread keys with no other change; `shared-chat-view.test.ts`'s existing `it.each([...HUB_ERROR_CODES])` now covers the eight codes too.

- [ ] **Step 7: The eight texts**

In each locale file, `shared_chat.error` ends with `answers_invalid`. Add a comma after that line and the eight keys after it.

`locales/en/translation.json`, find:

```json
			"answers_invalid": "The answers do not match the open questions"
		}
```

Replace with:

```json
			"answers_invalid": "The answers do not match the open questions",
			"attachment_too_large": "This file is larger than 5 MB",
			"conversation_attachments_full": "This conversation already holds 6 MB of files",
			"unsent_attachments_full": "Too many files are waiting to be sent",
			"attachment_type_not_allowed": "This app does not accept this kind of file",
			"attachment_invalid": "This file could not be read",
			"attachment_encoding": "Save the file as UTF-8 text, in Excel: CSV UTF-8",
			"attachment_no_text": "This PDF has no text the agent can read",
			"attachment_not_found": "This file is no longer available"
		}
```

`locales/zh/translation.json`, find:

```json
			"answers_invalid": "回答与待处理的问题不匹配"
		}
```

Replace with:

```json
			"answers_invalid": "回答与待处理的问题不匹配",
			"attachment_too_large": "此文件超过 5 MB",
			"conversation_attachments_full": "此对话中的文件已达 6 MB",
			"unsent_attachments_full": "等待发送的文件过多",
			"attachment_type_not_allowed": "此应用不接受此类文件",
			"attachment_invalid": "无法读取此文件",
			"attachment_encoding": "请将文件另存为 UTF-8 文本（在 Excel 中：CSV UTF-8）",
			"attachment_no_text": "此 PDF 中没有智能体可读取的文本",
			"attachment_not_found": "此文件已不可用"
		}
```

`locales/ar/translation.json` (Modern Standard Arabic, ADR-0005), find:

```json
			"answers_invalid": "لا تطابق الإجابات الأسئلة المفتوحة"
		}
```

Replace with:

```json
			"answers_invalid": "لا تطابق الإجابات الأسئلة المفتوحة",
			"attachment_too_large": "حجم هذا الملف أكبر من 5 MB",
			"conversation_attachments_full": "تحتوي هذه المحادثة بالفعل على 6 MB من الملفات",
			"unsent_attachments_full": "توجد ملفات كثيرة جدًا بانتظار الإرسال",
			"attachment_type_not_allowed": "لا يقبل هذا التطبيق هذا النوع من الملفات",
			"attachment_invalid": "تعذّرت قراءة هذا الملف",
			"attachment_encoding": "احفظ الملف نصًّا بترميز UTF-8، وفي Excel اختر: CSV UTF-8",
			"attachment_no_text": "لا يحتوي ملف PDF هذا على نص يستطيع الوكيل قراءته",
			"attachment_not_found": "لم يعد هذا الملف متاحًا"
		}
```

The size texts keep "MB" in Latin letters, as the neighbouring `logo_too_large` and `icon_too_large` keep "KB" in every language; the zh and ar texts use the words the neighbouring keys use for "app" (应用, التطبيق) and "agent" (智能体, الوكيل). The Excel menu name "CSV UTF-8" stays as Excel shows it. No e2e text changes: `e2e/` has none of these strings yet (Task 19 adds the specs that read them).

- [ ] **Step 8: Run them to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-uploads.test.ts __tests__/http-parse.test.ts __tests__/shared-chat-view.test.ts __tests__/api-routes.test.ts __tests__/i18n-locales.test.ts __tests__/dify-routes-files.test.ts`

Expected: PASS, `Test Files  6 passed (6)`, `Tests  141 passed (141)`.

- [ ] **Step 9: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/uploads.ts 'app/api/apps/[appId]/attachments/route.ts' lib/http/parse.ts components/shared-chat/run-error.ts __tests__/chat-uploads.test.ts __tests__/http-parse.test.ts __tests__/shared-chat-view.test.ts __tests__/api-routes.test.ts
pnpm exec oxfmt --check lib/chat/uploads.ts 'app/api/apps/[appId]/attachments/route.ts' lib/http/parse.ts components/shared-chat/run-error.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/chat-uploads.test.ts __tests__/http-parse.test.ts __tests__/shared-chat-view.test.ts __tests__/api-routes.test.ts
pnpm test
```

Expected: typegen generates `RouteContext<'/api/apps/[appId]/attachments'>` and tsc exits 0; oxlint prints no finding; oxfmt "All matched files use the correct format"; vitest 0 failed. No `db/` or `lib/data/` file changed, so `pnpm test:db` is not needed; no component changed, so the antd lint is not needed.

- [ ] **Step 10: The standalone build ships the PDF worker**

This route is the first code that imports `lib/chat/documents.ts` (through `uploads.ts`), so this is where the build proves Task 5's two config entries: `serverExternalPackages` keeps pdf.js out of the bundle, the worker's path marked `/* turbopackIgnore: true */` survives unresolved (the owner's accepted exception to ADR-0002, decision 70; ADR-0037), and `outputFileTracingIncludes` ships the worker and pdf.js's files. A Next upgrade that changes either shows here first. Stop `pnpm dev` if it runs (one Next process per checkout), then:

```bash
pnpm build
ls .next/server/chunks | grep -c 'worker thread'
grep -o 'join(process.cwd(),"lib/chat/pdf-text.worker.mjs")' -r .next/server/chunks | wc -l
grep -rlE 'pdfjs|pdf\.worker' .next/static | wc -l
ls .next/standalone/lib/chat/pdf-text.worker.mjs .next/standalone/node_modules/pdfjs-dist/legacy/build/pdf.mjs .next/standalone/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs .next/standalone/node_modules/pdfjs-dist/package.json
ls .next/standalone/node_modules/pdfjs-dist/cmaps | wc -l
ls .next/standalone/node_modules/pdfjs-dist/standard_fonts | wc -l
```

Expected: `✓ Compiled successfully` with no warning; `0` (no bundled worker); `1` (the path survives unresolved in the route's chunk); `0`; the four paths listed; `169`; `16`.

Then run the worker from a copy of the standalone build on its own (a script file, not `node --input-type`, because a Worker inherits the parent's `execArgv`):

```bash
STANDALONE=$(mktemp -d) && cp -a .next/standalone/. "$STANDALONE"
cat > "$STANDALONE/check-pdf.mjs" <<'JS'
// Reads two fixtures through the worker as lib/chat/documents.ts starts it, from this standalone copy alone.
import { readFileSync } from 'node:fs'
import { Worker } from 'node:worker_threads'

for (const name of ['text.pdf', 'cjk.pdf']) {
	const bytes = new Uint8Array(readFileSync(`${process.env.FIXTURES}/${name}`))
	const worker = new Worker(`${process.cwd()}/lib/chat/pdf-text.worker.mjs`, {
		workerData: { bytes, maxCodePoints: 100_001 },
		stderr: true,
	})
	const message = await new Promise((resolve, reject) => worker.on('message', resolve).on('error', reject))
	console.log(name, JSON.stringify(message))
	await worker.terminate()
}
JS
FIXTURES="$PWD/__tests__/fixtures/pdf"; (cd "$STANDALONE" && FIXTURES="$FIXTURES" node check-pdf.mjs)
rm -rf "$STANDALONE" .next && pnpm exec next typegen
```

Expected:

```text
text.pdf {"ok":true,"text":"Quarterly report\nRevenue grew by 12 percent."}
cjk.pdf {"ok":true,"text":"Hello CJK\n日本語テスト"}
```

Stop and report if a `[worker thread]` chunk appears, the path count is not `1`, or the copy cannot read the fixtures: the worker would then not start in the Docker image.

- [ ] **Step 11: Commit**

```bash
git add lib/chat/uploads.ts 'app/api/apps/[appId]/attachments/route.ts' lib/http/parse.ts components/shared-chat/run-error.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/chat-uploads.test.ts __tests__/http-parse.test.ts __tests__/shared-chat-view.test.ts __tests__/api-routes.test.ts
git commit -m "feat(chat): the attachment upload route

POST /api/apps/[appId]/attachments takes one file of the shared chat's
composer: the name's extension claims the kind, the app's settings as
they are now allow it, the bytes prove it (sharp for images, the PDF
header and pdf.js for PDFs, UTF-8 or UTF-16 for text), long text is cut
with its note, and the file is stored unsent. The cheap checks run
first, a declared length over one file is refused before the body is
read (Next's proxy would cut it), and nothing is stored on any refusal.
The eight upload codes join the browser's code map in en, zh and ar
(Part 2 spec §7.1, §8; plan calls P1, P3, P4, P6, P8).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the 11 files; lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": ["lib/chat/uploads.ts", "app/api/apps/[appId]/attachments/route.ts", "lib/http/parse.ts", "components/shared-chat/run-error.ts", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/chat-uploads.test.ts", "__tests__/http-parse.test.ts", "__tests__/shared-chat-view.test.ts", "__tests__/api-routes.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-uploads.test.ts __tests__/http-parse.test.ts __tests__/shared-chat-view.test.ts __tests__/api-routes.test.ts __tests__/i18n-locales.test.ts __tests__/dify-routes-files.test.ts", "acceptanceCriteria": ["acceptUpload refuses an extension of no kind or of a kind the policy does not allow with 415 before reading the bytes, a name over 255 code points or holding U+0000 with 400, a file over 5 MB with 413, a 26th waiting file with 413 unsent_attachments_full, an unknown conversation with 404; storeAttachment is never called on a refusal", "images go through processChatImage with the app's maxImageEdge and are stored under the decoded mime (ImageError not_allowed 400, too_large 413); PDFs need the header and pdf.js (DocumentError 400 in both modes), blank text is 400 attachment_no_text in text mode only; text files are stored as uploaded with '<type>; charset=<charset>' (encoding 400 attachment_encoding, binary 400 attachment_invalid)", "text over 100,000 code points is stored cut with TRUNCATED_NOTE and answered truncated: true", "with a conversationId the sent total plus the stored size over 6 MB is 413 conversation_attachments_full; without one no conversation is read", "the route answers 401, 201 UploadedAttachment uncached, 413 from Content-Length before formData, 400 invalid_param for a non-multipart body, two or no file parts, a bad or repeated conversationId, refusals in the envelope, a logged 500", "every AttachmentErrorCode has a shared_chat.error key in HUB_CODE_KEYS and in en, zh and ar; api-routes pins the route", "pnpm build: no worker-thread chunk, no pdfjs or pdf.worker in .next/static, the worker path kept once in the route chunk; .next/standalone holds the worker, pdf.mjs, pdf.worker.mjs, package.json, 169 CMaps and 16 standard fonts; a standalone copy reads text.pdf and cjk.pdf through the worker", "tsc exits 0, pnpm test 0 failed, oxlint and oxfmt clean"], "modelTier": "standard"}
```

---

### Task 8: The serve and delete routes

**Goal:** `GET /api/apps/[appId]/attachments/[attachmentId]` serves a stored file back, to its uploader or to an owner or admin through Task 6's audited read, with the headers of `lib/chat/attachment-response.ts`, and `DELETE` on the same route removes the actor's own unsent file when the composer drops its card.

Spec §7.1 ("Serving back: `GET /api/apps/[appId]/attachments/[attachmentId]` to the conversation's owner, or an admin through the Logs (audited, §7.2); `Content-Type` as detected, `X-Content-Type-Options: nosniff`, the icon route's sandbox CSP, `Content-Disposition: inline` only for re-encoded images and `attachment` otherwise") and §10 ("the attachment response headers" among 2c's unit tests), plan calls P14 (who may read, `Cache-Control: private, no-store` after ASVS 5.0 14.3.2, `attachment; filename*=UTF-8''<RFC 8187 encoded name>`, a malformed id 404) and P22 (the delete route, decision 70 (4): "deletes the actor's own unsent attachment of this app and answers 204; a sent one, another's, an unknown or a malformed id answer 404 `attachment_not_found`. Guarded by `resolveChatRoute`, as the upload"), and the Shared contracts' `attachmentHeaders`, `readAttachment` and `deleteUnsentAttachment`. Sources for the name's encoding: RFC 8187 §3.2.1 (`ext-value = charset "'" [ language ] "'" value-chars`, `value-chars = *( pct-encoded / attr-char )`, ``attr-char = ALPHA / DIGIT / "!" / "#" / "$" / "&" / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"``), RFC 6266 §4.3 (`filename*` uses that encoding, and only "user agent implementations predating this specification" do not understand it), MDN Content-Disposition (`attachment; filename*=UTF-8''file%20name.jpg`; it recommends a plain `filename` beside it "for maximum compatibility", by "substituting non-ASCII characters with ASCII equivalents", which would be an ASCII copy of the name of the hub's own making, so P14's `filename*` alone stands) and MDN `encodeURIComponent()` ("Encoding for Content-Disposition and Link headers": its `encodeRFC5987ValueChars`, which encodes `'()*` on top of `encodeURIComponent` and gives back `|`, `` ` `` and `^`; "Encoding a lone surrogate throws", avoided with `String.prototype.toWellFormed()`, which Node 22 has). The GET imitates the icon route (`app/api/apps/[appId]/icon/route.ts`): `verifySession` first and a 401 envelope, ids checked with `isId` before any query, the same `nosniff` and sandbox CSP, `new Response(new Uint8Array(bytes), { headers })`. It is not guarded by `resolveChatRoute`, which refuses a disabled app with 403: an admin reads a disabled app's conversations in the Logs too, so the app's state reaches `readAttachment` as `appUsable` (`getAppAccess` answers the app as the actor may see it, `visibleTo` in `lib/data/apps.ts`; usable when it answers one that is enabled), which governs only the uploader's own read (P14). Every view through the Logs is a fetch, and so a `download` row: `readAttachment` writes it before answering (Task 6's rule), and the route sends the body after. The DELETE answers what `deleteUnsentAttachment` (Task 6) did; its database rule (only the actor's own unsent file of this app) is Task 6's `attachments.db.test.ts`. The test mocks Task 6's module; `attachmentNotFound` sits beside `attachmentHeaders`, as `lib/chat/route.ts` keeps `conversationNotFound` beside its guard, and its code is Task 7's `attachment_not_found`, already worded in the browser. Task 11's `api.attachmentUrl` and `api.deleteAttachment` call these two handlers, Task 12's `TurnFiles` links to the GET, Task 16's drawer shows a transcript's files through it, and Task 19's specs check a `download` row after an admin's fetch.

**Files:**

- Create: `lib/chat/attachment-response.ts`
- Create: `app/api/apps/[appId]/attachments/[attachmentId]/route.ts` (GET, DELETE)
- Test: `__tests__/chat-attachment-response.test.ts` (the whole file, below)
- Test: `__tests__/api-routes.test.ts` (the route pinned)

**Acceptance Criteria:**

- [ ] `attachmentHeaders` of an image answers exactly `content-type` (as stored), `content-length`, `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, `cache-control: private, no-store` and `content-disposition: inline`; of `Q3 report.pdf` the same with `content-disposition: attachment; filename*=UTF-8''Q3%20report.pdf`; a UTF-16 text file keeps `text/csv; charset=utf-16le`.
- [ ] Names encode as RFC 8187 value-chars that decode back to the name: `"final" 'draft' (2).txt` → `%22final%22%20%27draft%27%20%282%29.txt`, `تقرير الربع.pdf` → `%D8%AA%D9%82%D8%B1%D9%8A%D8%B1%20%D8%A7%D9%84%D8%B1%D8%A8%D8%B9.pdf`, `😀 notes.md` → `%F0%9F%98%80%20notes.md`, ``a!#$&+-.^_`|~*b.txt`` → ``a!%23%24%26%2B-.^_`|~%2Ab.txt``, a CR LF → `%0D%0A`; a lone surrogate → `%EF%BF%BD`, no throw.
- [ ] GET answers 401 signed out and 404 `attachment_not_found` for a malformed attachment or app id, reading nothing; 404 when `readAttachment` answers null; 200 with the bytes and `attachmentHeaders(file)` otherwise, `readAttachment(actor, appId, attachmentId, { appUsable })` with `appUsable` true for a visible enabled app and false for a disabled or invisible one; a thrown read is a logged 500.
- [ ] DELETE answers 401 signed out and the guard's 404 for an app without the shared chat; 204 with no body when `deleteUnsentAttachment(actor, appId, attachmentId)` answers true; 404 `attachment_not_found` when it answers false or the id is malformed (then it is never called).
- [ ] `__tests__/api-routes.test.ts` pins `apps/[appId]/attachments/[attachmentId]/route.ts`.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the changed files.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-attachment-response.test.ts __tests__/api-routes.test.ts` → `Test Files  2 passed (2)`, `Tests  24 passed (24)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `__tests__/chat-attachment-response.test.ts`:

```ts
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	readAttachment: vi.fn(),
	deleteUnsentAttachment: vi.fn(),
	chat: { attachments: vi.fn() },
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession: m.verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess: m.getAppAccess }))
vi.mock('@/lib/providers/registry', () => ({
	chatAdapterOf: (provider: string) => (provider === 'agui' ? m.chat : undefined),
}))
vi.mock('@/lib/data/conversations', () => ({ findConversation: vi.fn() }))
vi.mock('@/lib/data/attachments', () => ({
	readAttachment: m.readAttachment,
	deleteUnsentAttachment: m.deleteUnsentAttachment,
}))

import { DELETE, GET } from '@/app/api/apps/[appId]/attachments/[attachmentId]/route'
import { attachmentHeaders } from '@/lib/chat/attachment-response'

const APP_ID = '0b1c2d3e-4f50-4a61-8b72-9c8dae0f1a2b'
const ATTACHMENT_ID = '7d444840-9dc0-41d5-8d6b-0a4b6f8b3c11'
const SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
const actor = {
	id: 'u1',
	email: 'jane@example.com',
	name: null,
	role: 'user' as const,
	source: 'local' as const,
}
const agui = {
	id: APP_ID,
	enabled: true,
	provider: 'agui',
	settings: {
		agentUrl: 'http://agent/agents/a',
		audience: 'a',
		askUser: false,
		attachments: { images: true, documents: 'text', maxImageEdge: null },
	},
	secrets: { jwtSecret: 'x'.repeat(32) },
}
const image = {
	id: ATTACHMENT_ID,
	name: 'photo.png',
	kind: 'image' as const,
	mime: 'image/webp',
	size: 4,
	data: Buffer.from('webp'),
}
const pdf = {
	id: ATTACHMENT_ID,
	name: 'Q3 report.pdf',
	kind: 'document' as const,
	mime: 'application/pdf',
	size: 8,
	data: Buffer.from('%PDF-1.7'),
}
/** RFC 8187 §3.2.1: value-chars = *( pct-encoded / attr-char ). */
const VALUE_CHARS = /^(?:%[0-9A-F]{2}|[A-Za-z0-9!#$&+\-.^_`|~])*$/
const disposition = (name: string) =>
	attachmentHeaders({ kind: 'text', mime: 'text/plain; charset=utf-8', name, size: 1 })[
		'content-disposition'
	]
const valueOf = (header: string) => header.replace("attachment; filename*=UTF-8''", '')

// Part 2 spec §7.1 "Serving back", §10 ("the attachment response headers"); plan call P14.
describe('attachmentHeaders', () => {
	it('shows an image in place, under its stored type, never sniffed, sandboxed and never cached', () => {
		expect(attachmentHeaders(image)).toEqual({
			'content-type': 'image/webp',
			'content-length': '4',
			'x-content-type-options': 'nosniff',
			'content-security-policy': SANDBOX_CSP,
			'cache-control': 'private, no-store',
			'content-disposition': 'inline',
		})
	})
	it('downloads a PDF under its own name', () => {
		expect(attachmentHeaders(pdf)).toEqual({
			'content-type': 'application/pdf',
			'content-length': '8',
			'x-content-type-options': 'nosniff',
			'content-security-policy': SANDBOX_CSP,
			'cache-control': 'private, no-store',
			'content-disposition': "attachment; filename*=UTF-8''Q3%20report.pdf",
		})
	})
	it('serves a UTF-16 text file under the type and charset it was stored with', () => {
		expect(
			attachmentHeaders({
				kind: 'text',
				mime: 'text/csv; charset=utf-16le',
				name: 'table.csv',
				size: 12,
			}),
		).toMatchObject({
			'content-type': 'text/csv; charset=utf-16le',
			'content-length': '12',
			'content-disposition': "attachment; filename*=UTF-8''table.csv",
		})
	})
	// RFC 8187 §3.2.1 and MDN's encodeRFC5987ValueChars: UTF-8 bytes percent-encoded, attr-chars as they are.
	it.each([
		[
			'quotes, spaces and brackets',
			`"final" 'draft' (2).txt`,
			'%22final%22%20%27draft%27%20%282%29.txt',
		],
		[
			'Arabic',
			'تقرير الربع.pdf',
			'%D8%AA%D9%82%D8%B1%D9%8A%D8%B1%20%D8%A7%D9%84%D8%B1%D8%A8%D8%B9.pdf',
		],
		['an emoji', '😀 notes.md', '%F0%9F%98%80%20notes.md'],
		['the attr-chars and a star', 'a!#$&+-.^_`|~*b.txt', 'a!%23%24%26%2B-.^_`|~%2Ab.txt'],
		[
			'a line break, which cannot start a header',
			'a\r\nSet-Cookie: x.txt',
			'a%0D%0ASet-Cookie%3A%20x.txt',
		],
	])('encodes a name with %s', (_label, name, encoded) => {
		const header = disposition(name)
		expect(header).toBe(`attachment; filename*=UTF-8''${encoded}`)
		expect(valueOf(header)).toMatch(VALUE_CHARS)
		expect(decodeURIComponent(valueOf(header))).toBe(name)
	})
	it('encodes a lone surrogate as U+FFFD instead of throwing', () => {
		expect(disposition('a\uD800.txt')).toBe("attachment; filename*=UTF-8''a%EF%BF%BD.txt")
	})
})

const ctx = (attachmentId = ATTACHMENT_ID, appId = APP_ID) => ({
	params: Promise.resolve({ appId, attachmentId }),
})
const request = (method: 'GET' | 'DELETE') =>
	new NextRequest(`http://hub/api/apps/${APP_ID}/attachments/${ATTACHMENT_ID}`, { method })
const notFound = {
	status: 404,
	body: { code: 'attachment_not_found', message: 'No such attachment.', status: 404 },
}
const read = async (response: Response) => ({
	status: response.status,
	body: await response.json(),
})

beforeEach(() => {
	for (const fn of [m.verifySession, m.getAppAccess, m.readAttachment, m.deleteUnsentAttachment])
		fn.mockReset()
	m.verifySession.mockResolvedValue(actor)
	m.getAppAccess.mockResolvedValue(agui)
})

describe('GET attachments/[attachmentId] (P14)', () => {
	it('answers 401 signed out, reading nothing', async () => {
		m.verifySession.mockResolvedValue(null)
		expect((await GET(request('GET'), ctx())).status).toBe(401)
		expect(m.getAppAccess).not.toHaveBeenCalled()
		expect(m.readAttachment).not.toHaveBeenCalled()
	})
	it.each([
		['attachment id', ctx('not-a-uuid')],
		['app id', ctx(ATTACHMENT_ID, 'not-a-uuid')],
	])('answers a malformed %s as not found, reading nothing', async (_label, params) => {
		expect(await read(await GET(request('GET'), params))).toEqual(notFound)
		expect(m.getAppAccess).not.toHaveBeenCalled()
		expect(m.readAttachment).not.toHaveBeenCalled()
	})
	it('answers 404 when the data layer gives the caller nothing', async () => {
		m.readAttachment.mockResolvedValue(null)
		expect(await read(await GET(request('GET'), ctx()))).toEqual(notFound)
	})
	it('serves an image in place with its headers, for an app the caller may use', async () => {
		m.readAttachment.mockResolvedValue(image)
		const response = await GET(request('GET'), ctx())
		expect(response.status).toBe(200)
		expect(Object.fromEntries(response.headers)).toMatchObject(attachmentHeaders(image))
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(image.data))
		expect(m.getAppAccess).toHaveBeenCalledWith(actor, APP_ID)
		expect(m.readAttachment).toHaveBeenCalledWith(actor, APP_ID, ATTACHMENT_ID, {
			appUsable: true,
		})
	})
	it('serves a PDF as a download under its name', async () => {
		m.readAttachment.mockResolvedValue(pdf)
		const response = await GET(request('GET'), ctx())
		expect(response.status).toBe(200)
		expect(response.headers.get('content-disposition')).toBe(
			"attachment; filename*=UTF-8''Q3%20report.pdf",
		)
		expect(await response.text()).toBe('%PDF-1.7')
	})
	// An admin reads a disabled app's conversations in the Logs; the uploader's own read needs a usable app.
	it.each([
		['disabled', { ...agui, enabled: false }],
		['not visible to the caller', null],
	])('asks for the uploader’s read only while the app is usable (%s)', async (_label, app) => {
		m.getAppAccess.mockResolvedValue(app)
		m.readAttachment.mockResolvedValue(pdf)
		expect((await GET(request('GET'), ctx())).status).toBe(200)
		expect(m.readAttachment).toHaveBeenCalledWith(actor, APP_ID, ATTACHMENT_ID, {
			appUsable: false,
		})
	})
	it('answers a logged 500 envelope when the read throws', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		m.readAttachment.mockRejectedValue(new Error('boom'))
		expect((await GET(request('GET'), ctx())).status).toBe(500)
		expect(errorSpy).toHaveBeenCalledWith(
			'GET /api/apps/[appId]/attachments/[attachmentId]:',
			expect.any(Error),
		)
		errorSpy.mockRestore()
	})
})

describe('DELETE attachments/[attachmentId] (P22)', () => {
	it('answers 401 signed out and the guard’s 404 for an app without the shared chat, deleting nothing', async () => {
		m.verifySession.mockResolvedValue(null)
		expect((await DELETE(request('DELETE'), ctx())).status).toBe(401)
		m.verifySession.mockResolvedValue(actor)
		m.getAppAccess.mockResolvedValue({ ...agui, provider: 'dify' })
		expect((await DELETE(request('DELETE'), ctx())).status).toBe(404)
		expect(m.deleteUnsentAttachment).not.toHaveBeenCalled()
	})
	it('deletes the actor’s unsent file of this app and answers 204', async () => {
		m.deleteUnsentAttachment.mockResolvedValue(true)
		const response = await DELETE(request('DELETE'), ctx())
		expect(response.status).toBe(204)
		expect(await response.text()).toBe('')
		expect(m.deleteUnsentAttachment).toHaveBeenCalledWith(actor, APP_ID, ATTACHMENT_ID)
	})
	it('answers 404 for a file it did not delete (sent, another’s, unknown)', async () => {
		m.deleteUnsentAttachment.mockResolvedValue(false)
		expect(await read(await DELETE(request('DELETE'), ctx()))).toEqual(notFound)
	})
	it('answers a malformed id as not found, deleting nothing', async () => {
		expect(await read(await DELETE(request('DELETE'), ctx('not-a-uuid')))).toEqual(notFound)
		expect(m.deleteUnsentAttachment).not.toHaveBeenCalled()
	})
})
```

In `__tests__/api-routes.test.ts` (as of Task 7), find:

```ts
// conversation list, one conversation, a run's stop) and §7.1 the attachment upload. The forgot and reset password
// handlers stay as inherited (plan deviation 6, ADR-0024); they are named here so a new handler under auth/ still fails
// the test.
```

Replace with:

```ts
// conversation list, one conversation, a run's stop) and §7.1 the attachment upload and one attachment's read and
// delete. The forgot and reset password handlers stay as inherited (plan deviation 6, ADR-0024); they are named here so a
// new handler under auth/ still fails the test.
```

Then, in the same file's long regular expression, find `(icon|runs|attachments|conversations(` and replace it with `(icon|runs|attachments(\/\[attachmentId\])?|conversations(` (the rest of the expression stays). And find:

```ts
			'apps/[appId]/attachments/route.ts',
```

Replace with:

```ts
			'apps/[appId]/attachments/[attachmentId]/route.ts',
			'apps/[appId]/attachments/route.ts',
```

(`[` sorts before `r`, so the new route comes first in the sorted list.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-attachment-response.test.ts __tests__/api-routes.test.ts`

Expected: FAIL, `Test Files  2 failed (2)`, `Tests  1 failed | 1 passed (2)`: `chat-attachment-response.test.ts` cannot load (`Cannot find package '@/app/api/apps/[appId]/attachments/[attachmentId]/route'`); the exact route list lacks `apps/[appId]/attachments/[attachmentId]/route.ts`.

- [ ] **Step 3: The headers**

Create `lib/chat/attachment-response.ts`:

```ts
import 'server-only'

import { errorResponse } from '@/lib/http/errors'

import type { TurnFile } from './attachment-rules'

/**
 * The icon route's sandbox (app/api/apps/[appId]/icon/route.ts): a file opened on its own runs nothing on the hub's
 * origin, as GitHub raw serves user content. An <img> ignores it.
 */
const SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"

/**
 * A name as an RFC 8187 `ext-value`'s value-chars: its UTF-8 bytes percent-encoded except the `attr-char`s (RFC 8187
 * §3.2.1: ALPHA, DIGIT and ``!#$&+-.^_`|~``). This is MDN's `encodeRFC5987ValueChars` (encodeURIComponent, "Encoding for
 * Content-Disposition and Link headers"): encodeURIComponent leaves `'()*` as they are, which are not attr-chars, so they
 * are encoded too, and `|`, `` ` `` and `^` are given back. `toWellFormed` first, since encodeURIComponent throws on a lone
 * surrogate (MDN, "Encoding a lone surrogate throws").
 */
const encodeExtValue = (name: string): string =>
	encodeURIComponent(name.toWellFormed())
		.replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
		.replace(/%(7C|60|5E)/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))

/**
 * The headers of a served attachment (Part 2 spec §7.1 "Serving back"; plan call P14): its stored type, which the upload
 * proved from the bytes, never sniffed (`nosniff`); the icon route's sandbox; nothing kept by any cache (`private,
 * no-store`, ASVS 5.0 14.3.2 for sensitive data), so every view of an admin is a fetch and an access-log row; an image,
 * re-encoded by the hub, shown in place, and anything else downloaded under its own name. The name goes as `filename*`
 * alone, in RFC 8187's UTF-8 form (RFC 6266 §4.3, MDN Content-Disposition): only user agents that predate RFC 6266 miss
 * it, and a plain `filename` for them would need an ASCII copy of the name the hub does not make.
 */
export const attachmentHeaders = (
	file: Pick<TurnFile, 'kind' | 'mime' | 'name' | 'size'>,
): Record<string, string> => ({
	'content-type': file.mime,
	'content-length': String(file.size),
	'x-content-type-options': 'nosniff',
	'content-security-policy': SANDBOX_CSP,
	'cache-control': 'private, no-store',
	'content-disposition':
		file.kind === 'image' ? 'inline' : `attachment; filename*=UTF-8''${encodeExtValue(file.name)}`,
})

/** P14, P22: an attachment the caller may not have, of another app, unknown or malformed, answers as one that is gone. */
export const attachmentNotFound = (): Response =>
	errorResponse('attachment_not_found', 'No such attachment.', 404)
```

- [ ] **Step 4: The route**

Create `app/api/apps/[appId]/attachments/[attachmentId]/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { verifySession } from '@/lib/auth/session'
import { attachmentHeaders, attachmentNotFound } from '@/lib/chat/attachment-response'
import { resolveChatRoute } from '@/lib/chat/route'
import { getAppAccess } from '@/lib/data/apps'
import { deleteUnsentAttachment, readAttachment } from '@/lib/data/attachments'
import { errorResponse, errorResponseFrom } from '@/lib/http/errors'
import { isId } from '@/lib/ids'

/**
 * GET attachments/[attachmentId] (Part 2 spec §7.1 "Serving back", §7.2; plan call P14): the file's bytes to its uploader
 * while the app is usable to them, or to an owner or admin reading the conversation in the Logs, with a `download` row
 * written first (readAttachment, decision 69 (4)). The session comes first, as the icon route's: a signed-out caller
 * learns nothing. It is not guarded by resolveChatRoute, because an admin reads a disabled app's conversations too; the
 * app's state only decides the uploader's own reads (`appUsable`: visible to them and enabled). A malformed id, a file
 * of another app, someone else's unsent file and a file the caller may not read all answer 404 attachment_not_found.
 */
export async function GET(
	_request: NextRequest,
	ctx: RouteContext<'/api/apps/[appId]/attachments/[attachmentId]'>,
) {
	const actor = await verifySession()
	if (!actor) return errorResponse('unauthorized', 'Sign in required.', 401)
	try {
		const { appId, attachmentId } = await ctx.params
		// Spec §3.2: an id that is not a UUID is answered before any query (lib/ids.ts).
		if (!isId(appId) || !isId(attachmentId)) return attachmentNotFound()
		const app = await getAppAccess(actor, appId)
		const file = await readAttachment(actor, appId, attachmentId, {
			appUsable: app?.enabled === true,
		})
		if (!file) return attachmentNotFound()
		return new Response(new Uint8Array(file.data), { headers: attachmentHeaders(file) })
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/apps/[appId]/attachments/[attachmentId]')
	}
}

/**
 * DELETE attachments/[attachmentId] (plan call P22, decision 70 (4)): the composer removed a card, so its file goes at
 * once, as LibreChat and LobeHub delete a removed upload and assistant-ui's documented attachment adapter calls a DELETE
 * route. Only the actor's own unsent file of this app; a sent one, another's, an unknown or a malformed id answer 404.
 * Guarded by resolveChatRoute, as the upload.
 */
export async function DELETE(
	_request: NextRequest,
	ctx: RouteContext<'/api/apps/[appId]/attachments/[attachmentId]'>,
) {
	const resolved = await resolveChatRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	try {
		const { actor, app } = resolved
		const { attachmentId } = await ctx.params
		const deleted =
			isId(attachmentId) && (await deleteUnsentAttachment(actor, app.id, attachmentId))
		return deleted ? new Response(null, { status: 204 }) : attachmentNotFound()
	} catch (error) {
		return errorResponseFrom(error, 'DELETE /api/apps/[appId]/attachments/[attachmentId]')
	}
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-attachment-response.test.ts __tests__/api-routes.test.ts`

Expected: PASS, `Test Files  2 passed (2)`, `Tests  24 passed (24)`.

- [ ] **Step 6: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/attachment-response.ts 'app/api/apps/[appId]/attachments/[attachmentId]/route.ts' __tests__/chat-attachment-response.test.ts __tests__/api-routes.test.ts
pnpm exec oxfmt --check lib/chat/attachment-response.ts 'app/api/apps/[appId]/attachments/[attachmentId]/route.ts' __tests__/chat-attachment-response.test.ts __tests__/api-routes.test.ts
pnpm test
```

Expected: typegen generates `RouteContext<'/api/apps/[appId]/attachments/[attachmentId]'>` and tsc exits 0; oxlint prints no finding; oxfmt "All matched files use the correct format"; vitest 0 failed. No `db/` or `lib/data/` file changed, so `pnpm test:db` is not needed.

- [ ] **Step 7: Commit**

```bash
git add lib/chat/attachment-response.ts 'app/api/apps/[appId]/attachments/[attachmentId]/route.ts' __tests__/chat-attachment-response.test.ts __tests__/api-routes.test.ts
git commit -m "feat(chat): serve and delete one attachment

GET /api/apps/[appId]/attachments/[attachmentId] serves a stored file
to its uploader while the app is usable to them, or to an owner or admin
through the audited read, which writes the download row first. The file
goes out under its stored type, never sniffed, sandboxed as the icon
route, never cached (so every admin view is a fetch and a row), images
inline and the rest as a download named with RFC 8187's UTF-8 form.
DELETE on the same route removes the actor's own unsent file when the
composer drops its card (Part 2 spec §7.1, §10; plan calls P14, P22).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the 4 files; lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": ["lib/chat/attachment-response.ts", "app/api/apps/[appId]/attachments/[attachmentId]/route.ts", "__tests__/chat-attachment-response.test.ts", "__tests__/api-routes.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-attachment-response.test.ts __tests__/api-routes.test.ts", "acceptanceCriteria": ["attachmentHeaders answers the stored type, content-length, nosniff, the icon route's sandbox CSP, private no-store, inline for an image and attachment; filename*=UTF-8''<encoded> otherwise", "names with quotes, spaces, brackets, Arabic, an emoji, the attr-chars, a star and CR LF encode as RFC 8187 value-chars that decode back; a lone surrogate encodes as %EF%BF%BD without throwing", "GET answers 401 signed out, 404 attachment_not_found for a malformed id or a null read (nothing read for a malformed id), 200 with the bytes and the headers, appUsable true only for a visible enabled app, a logged 500 on a throw", "DELETE answers 401, the guard's 404, 204 when deleteUnsentAttachment deleted, 404 attachment_not_found otherwise or for a malformed id", "api-routes pins the route", "tsc exits 0, pnpm test 0 failed, oxlint and oxfmt clean"], "modelTier": "standard"}
```

---

### Task 9: Runs carry attachments

**Goal:** A run's message names its uploaded files (`attachmentIds`, its text may then be blank); the run checks them before anything is stored, `startRun` links each to the stored user message at its place in the message in the same transaction (or stores nothing), and every run hands the agent each user message with files as AG-UI content parts built from the stored bytes and the app's settings as they are now, while the session never writes a user row.

Spec §4.2 (the run body: "`message?: { text: string ≤ 32,000, attachmentIds?: uuid[] ≤ 5 }`"), spec §7.1 ("**To the agent:** the user message's `content` array holds the text part, then per attachment: `{ type: 'image', source: { type: 'data', value: <base64>, mimeType } }`; in `native` mode `{ type: 'document', source: { type: 'data', value, mimeType: 'application/pdf' } }`; in `text` mode a text part `[file report.pdf]` followed by the extracted text (text files always go this way) … Never a hub URL … Every run re-sends every attachment (decision 54)"; "at most 6 MB of attachments per conversation; at most 5 files per message") and §8 (413 `conversation_attachments_full`, 415 `attachment_type_not_allowed`, 400 `attachment_invalid`); decision 69 (2) (a message may hold files and no text); plan calls P8 (the run counts the conversation's sent bytes plus the message's files, a new conversation's alone), P9 (the checks before `startRun`; the link inside its transaction after the user message, one UPDATE per id setting `conversation_id`, `message_id` and `position`, the id's index in `attachmentIds`; fewer rows rolls back and answers 400 `attachment_invalid`), P10 (the stored user message keeps its text, `''` for files alone; the session never writes a `user` row), P11 (the parts and their order; a blank text part left out; `NO_TEXT_LINE` and `notAcceptedLine` by the settings at run time) and the body half of P12 (the browser half is Task 11's); the Shared contracts' `runBodySchema`, `StartRunInput.attachments`, `StartRunResult`, `attachmentPart` and `withAttachmentParts`. Docs checked: AG-UI 1.0 content parts through Context7 (`/ag-ui-protocol/ag-ui`, `docs/concepts/messages.mdx`: `UserMessage.content` is `string | ContentPart[]`, `DataSource { type: "data", value, mimeType }`; `docs/sdk/js/core/multimodal-inputs.mdx`: text first, then the media parts) and the installed typings, `node_modules/@ag-ui/core/dist/version-DEKfpZNa.d.ts` lines 434–630 (`TextPart`; `DataSource.value`: "The bytes, base64-encoded", `mimeType` "Required here … because nothing else can tell a consumer how to read them"; `ImagePart`, `DocumentPart`, `ContentPart`) and `dist/schemas.mjs` lines 423–431 (`UserMessageSchema.content: z.union([z.string(), z.array(ContentPartSchema)])`), which the new test applies to an expanded message; Node.js "Buffer", `buf.toString('base64')`; zod 4 "Refinements" (zod.dev/api, read with crawl4ai on 2026-10-15 because Context7's quota was spent): `path` "To customize the error path … typically only useful in the context of object schemas", and `when`: "By default, refinements don't run if any non-continuable issues have already been encountered", so the message's refinement never sees a text `.max` refused; Drizzle "Transactions" (Context7 `/drizzle-team/drizzle-orm-docs`: "Invoking `tx.rollback()` throws an exception that immediately aborts and rolls back the active transaction") with the installed code, `node_modules/drizzle-orm/pg-core/async/session.js` lines 121–123 (`rollback()` throws `TransactionRollbackError`, exported by `drizzle-orm`) and `node-postgres/session.js` line 50 (`transaction()` runs `rollback` and rethrows), so `startRun` turns that error, and only it, into `attachment_invalid`; node-postgres "Result" (`rowCount`, as `renameConversation` reads it). The run's three refusals reuse Task 1's `UPLOAD_REFUSALS` (`lib/chat/attachment-rules.ts`, kept with the rules so the run imports none of the upload pipeline's sharp and PDF worker) for their status and message, and the browser words each code by Task 7's keys in `run-error.ts`. The checks run after 2b's open-item checks (a message while something is open stays 409 `answer_pending`) and before the run is registered, so a refusal stores nothing and holds nothing. `startRun`'s link needs the user message stored first (Task 6's `attachmentsForAgent` and `attachmentFilesOf` join `conversation_messages` on `(conversation_id, message_id)` and read by its `seq`, then `position`), which the transaction's order gives. The session is seeded with the expanded thread (2a's rule: the history it was given is never written again) and now skips user rows both in that memory and in `save()`, so the inlined bytes never reach `conversation_messages`. `__tests__/chat-run.test.ts` is quoted as of Task 2 (its `app.settings` carries `attachments`, and its adapter mock is `{ hubTools: vi.fn(), attachments: vi.fn(), runTurn: vi.fn() }` with no implementation): this task gives `chat.attachments` AG-UI's rule in `beforeEach`. Task 10 reads the linked files back for history; Task 11's composer sends `attachmentIds` and a blank text; Task 18's stub `files` scenario reads the parts; Task 19 proves them end to end.

**Files:**

- Create: `lib/chat/attachment-parts.ts`
- Modify: `lib/chat/schemas.ts` (`message.attachmentIds`; the text rule)
- Modify: `lib/chat/run.ts` (the files' checks, the link's input and refusal, the parts)
- Modify: `lib/chat/session.ts` (no user row is remembered or written)
- Modify: `lib/data/conversations.ts` (`StartRunInput.attachments`, `StartRunResult`'s `attachment_invalid`, the link and its rollback)
- Test: `__tests__/chat-attachment-parts.test.ts` (the whole file, below)
- Test: `__tests__/chat-schemas.test.ts` (new cases)
- Test: `__tests__/chat-run.test.ts` (the attachments mock, the policy, a new `describe`; as of Task 2)
- Test: `__tests__/chat-session.test.ts` (one new case)
- Test: `__tests__/db/conversations-run.db.test.ts` (a new `describe`)

**Acceptance Criteria:**

- [ ] `runBodySchema` takes a message with one file id, five ids and an empty text, and one id with the text `' \n '`; it refuses an empty id list, six ids, the same id twice, an id that is no UUID and a blank text without ids; a blank text without ids fails at the path `message.text`, a repeated id at `message.attachmentIds`; `attachmentIds` beside the message is dropped.
- [ ] `attachmentPart` answers an image as `{ type: 'image', source: { type: 'data', value: <base64 of the bytes>, mimeType: <stored mime> } }` in every documents mode while images are on; a PDF as `{ type: 'document', source: { type: 'data', value, mimeType: 'application/pdf' } }` in `native` mode and as the text part `[file report.pdf]\n<stored text>` in `text` mode; a text file as that text part in `text` and `native` mode; `[file <name>]\n(no text could be read from this file)` for a blank or null stored text; `notAcceptedLine(name)` for a kind the policy refuses (an image with images off, a PDF or a text file with documents off).
- [ ] `withAttachmentParts` puts the text part first only when the text is not blank, then one part per file in the order given, on the message the file names; every other message is the same object, and with no files the same array; an expanded message passes `@ag-ui/core/schemas`' `MessageSchema`.
- [ ] `runTurn` with files answers, before `startRun` is called: 400 `attachment_invalid` when `unsentAttachments` finds fewer files than ids; 415 `attachment_type_not_allowed` when one is of a kind `chat.attachments(app.settings)` refuses; 413 `conversation_attachments_full` when `conversationAttachmentBytes(conversationId)` plus the files' sizes exceeds 6 MB (exactly 6 MB passes; a new conversation counts its files alone and never calls it); each with `UPLOAD_REFUSALS[code]`'s status and message.
- [ ] `runTurn` stores the user message with its text (`''` and the title `''` for a blank text with files), passes `attachments: { ids, messageId: <the user message's id> }` to `startRun` (no `attachments` key without files), answers 400 `attachment_invalid` and releases the run when `startRun` answers it, and hands the adapter `withAttachmentParts(threadForAgent(rows), attachmentsForAgent(conversationId), policy)` as `messages`, the very array the session gets as `history`.
- [ ] `RunSession` writes no `user` row, not one whose copy differs from its history, nor a new one.
- [ ] `startRun` sets `conversation_id`, `message_id` and `position` (0, 1, … in the order of `ids`) on each file; when one id is another account's, another app's, already sent or unknown it answers `{ ok: false, code: 'attachment_invalid' }` and stores no conversation, run or message, the other file stays unsent; on an existing conversation the refused start leaves no run or message, its continued run and a null `activeRunId`.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; `pnpm test:db` reports 0 failed; oxlint and oxfmt clean on the changed files.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-attachment-parts.test.ts __tests__/chat-schemas.test.ts __tests__/chat-run.test.ts __tests__/chat-session.test.ts` → `Test Files  4 passed (4)`, `Tests  107 passed (107)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `__tests__/chat-attachment-parts.test.ts`:

```ts
import type { Message } from '@ag-ui/core'
import { MessageSchema } from '@ag-ui/core/schemas'
import { describe, expect, it } from 'vitest'

import { attachmentPart, withAttachmentParts } from '@/lib/chat/attachment-parts'
import {
	NO_TEXT_LINE,
	notAcceptedLine,
	TRUNCATED_NOTE,
	type AttachmentPolicy,
	type DocumentsMode,
} from '@/lib/chat/attachment-rules'
import type { AttachmentForAgent } from '@/lib/data/attachments'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PDF = Buffer.from('%PDF-1.7\n')

const image: AttachmentForAgent = {
	id: 'f-image',
	messageId: 'u-1',
	name: 'chart.png',
	kind: 'image',
	mime: 'image/png',
	size: PNG.length,
	data: PNG,
	extractedText: null,
}
const pdf: AttachmentForAgent = {
	id: 'f-pdf',
	messageId: 'u-1',
	name: 'report.pdf',
	kind: 'document',
	mime: 'application/pdf',
	size: PDF.length,
	data: PDF,
	extractedText: 'Page one',
}
const notes: AttachmentForAgent = {
	id: 'f-notes',
	messageId: 'u-1',
	name: 'notes.md',
	kind: 'text',
	mime: 'text/markdown; charset=utf-8',
	size: 7,
	data: Buffer.from('# Notes'),
	extractedText: '# Notes',
}

const policy = (documents: DocumentsMode, images = true): AttachmentPolicy => ({
	images,
	documents,
	maxImageEdge: null,
})

const imagePart = {
	type: 'image',
	source: { type: 'data', value: PNG.toString('base64'), mimeType: 'image/png' },
}
const documentPart = {
	type: 'document',
	source: { type: 'data', value: PDF.toString('base64'), mimeType: 'application/pdf' },
}
const pdfText = { type: 'text', text: '[file report.pdf]\nPage one' }
const notesText = { type: 'text', text: '[file notes.md]\n# Notes' }

// Plan call P11 (spec §7.1): each kind by the app's settings as they are now.
describe('attachmentPart', () => {
	it.each([
		['an image, documents as text', image, policy('text'), imagePart],
		['an image, documents native', image, policy('native'), imagePart],
		['an image, documents off', image, policy('off'), imagePart],
		['an image the app no longer takes', image, policy('text', false), null],
		['a PDF as text', pdf, policy('text'), pdfText],
		['a PDF native', pdf, policy('native'), documentPart],
		['a PDF with documents off', pdf, policy('off'), null],
		['a text file, documents as text', notes, policy('text'), notesText],
		[
			'a text file, documents native (text files always go as text)',
			notes,
			policy('native'),
			notesText,
		],
		['a text file with documents off', notes, policy('off'), null],
	])('builds %s', (_case, attachment, rule, part) => {
		expect(attachmentPart(attachment, rule)).toEqual(
			part ?? { type: 'text', text: notAcceptedLine(attachment.name) },
		)
	})

	it('stands in a line for a PDF whose stored text is blank, read in text mode', () => {
		for (const extractedText of ['', ' \n\t', null])
			expect(attachmentPart({ ...pdf, extractedText }, policy('text'))).toEqual({
				type: 'text',
				text: `[file report.pdf]\n${NO_TEXT_LINE}`,
			})
	})

	it('sends a cut text as stored, its note included (plan call P6)', () => {
		const cut = `${'x'.repeat(10)}\n\n${TRUNCATED_NOTE}`
		expect(attachmentPart({ ...notes, extractedText: cut }, policy('text'))).toEqual({
			type: 'text',
			text: `[file notes.md]\n${cut}`,
		})
	})
})

// Plan calls P10, P11: the stored user message keeps its text; the run expands it.
describe('withAttachmentParts', () => {
	const user = (id: string, content: string): Message => ({ id, role: 'user', content })
	const answer: Message = { id: 'a-1', role: 'assistant', content: 'Seen.' }

	it('puts the text part first, then one part per file in the order given', () => {
		const [expanded] = withAttachmentParts(
			[user('u-1', 'Compare these')],
			[notes, image, pdf],
			policy('text'),
		)
		expect(expanded).toEqual({
			id: 'u-1',
			role: 'user',
			content: [{ type: 'text', text: 'Compare these' }, notesText, imagePart, pdfText],
		})
		// The protocol's own schema reads the result (@ag-ui/core/schemas MessageSchema).
		expect(MessageSchema.safeParse(expanded).success).toBe(true)
	})

	it('leaves out a blank text part (decision 69 (2): a message of files alone)', () => {
		for (const text of ['', '  \n'])
			expect(withAttachmentParts([user('u-1', text)], [image], policy('text'))[0]).toEqual({
				id: 'u-1',
				role: 'user',
				content: [imagePart],
			})
	})

	it('puts each file on its own message and leaves every other message as it was', () => {
		const first = user('u-1', 'One')
		const second = user('u-2', 'Two')
		const messages = [first, answer, second]
		const expanded = withAttachmentParts(
			messages,
			[{ ...pdf, messageId: 'u-2' }, image],
			policy('native'),
		)
		expect(expanded[0]).toEqual({
			...first,
			content: [{ type: 'text', text: 'One' }, imagePart],
		})
		expect(expanded[1]).toBe(answer)
		expect(expanded[2]).toEqual({
			...second,
			content: [{ type: 'text', text: 'Two' }, documentPart],
		})
		expect(messages[0]).toEqual(user('u-1', 'One'))
	})

	it('answers the same messages when the conversation has no files', () => {
		const messages = [user('u-1', 'Hi'), answer]
		expect(withAttachmentParts(messages, [], policy('text'))).toBe(messages)
		const unrelated = withAttachmentParts(
			messages,
			[{ ...image, messageId: 'u-9' }],
			policy('text'),
		)
		expect(unrelated[0]).toBe(messages[0])
		expect(unrelated[1]).toBe(answer)
	})

	it('reads the settings as they are now: a kind turned off goes as a line, the run is not refused', () => {
		expect(withAttachmentParts([user('u-1', 'Earlier')], [image], policy('text', false))).toEqual([
			{
				id: 'u-1',
				role: 'user',
				content: [
					{ type: 'text', text: 'Earlier' },
					{ type: 'text', text: notAcceptedLine('chart.png') },
				],
			},
		])
	})
})
```

In `__tests__/chat-schemas.test.ts`, find:

```ts
const ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const resolved = { interruptId: 'int-1', status: 'resolved', payload: { approved: true } }

// Spec §4.2: exactly one of message and answers; answers continue a conversation; the text is 1–32,000 characters; a
// payload is an object or a boolean (plan call P6).
```

Replace with:

```ts
const ID = '3b241101-e2bb-4255-8caf-4136c566a962'
/** Uploaded files' ids (2c, plan call P12). */
const FILES = [
	'6f9619ff-8b86-4011-b42d-00c04fc964ff',
	'7c9e6679-7425-40de-944b-e07fc1f90ae7',
	'9b2d3c4e-5f60-4a71-8b82-93a4b5c6d7e8',
	'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
	'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
	'c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f',
]
const resolved = { interruptId: 'int-1', status: 'resolved', payload: { approved: true } }

// Spec §4.2: exactly one of message and answers; answers continue a conversation; the text is 1–32,000 characters, or
// blank beside 1–5 distinct files (2c's plan call P12); a payload is an object or a boolean (plan call P6).
```

In the same file, find:

```ts
		['a message of the longest length', { message: { text: 'x'.repeat(MESSAGE_TEXT_MAX) } }],
	])('takes %s', (_case, body) => {
```

Replace with:

```ts
		['a message of the longest length', { message: { text: 'x'.repeat(MESSAGE_TEXT_MAX) } }],
		['a message with a file', { message: { text: 'Read this', attachmentIds: [FILES[0]] } }],
		[
			'five files and no text (decision 69 (2))',
			{ message: { text: '', attachmentIds: FILES.slice(0, 5) } },
		],
		['files with a blank text', { message: { text: ' \n ', attachmentIds: [FILES[0]] } }],
	])('takes %s', (_case, body) => {
```

In the same file, find:

```ts
		['a conversation id that is no UUID', { conversationId: 'nope', message: { text: 'hi' } }],
```

Replace with:

```ts
		['a conversation id that is no UUID', { conversationId: 'nope', message: { text: 'hi' } }],
		['an empty list of files', { message: { text: 'hi', attachmentIds: [] } }],
		['six files', { message: { text: 'hi', attachmentIds: FILES } }],
		['the same file twice', { message: { text: 'hi', attachmentIds: [FILES[0], FILES[0]] } }],
		['a file id that is no UUID', { message: { text: 'hi', attachmentIds: ['nope'] } }],
```

In the same file, find:

```ts
// zod 4 "Objects": unknown keys are stripped by default, so 2c's attachmentIds sent early change nothing.
it('drops keys it does not know, and keeps the text as typed', () => {
	expect(runBodySchema.parse({ message: { text: ' hi ' }, attachmentIds: [ID] })).toEqual({
		message: { text: ' hi ' },
	})
})
```

Replace with:

```ts
// zod 4 "Objects": unknown keys are stripped by default, so attachmentIds outside the message change nothing.
it('drops keys it does not know, and keeps the text as typed', () => {
	expect(runBodySchema.parse({ message: { text: ' hi ' }, attachmentIds: [ID] })).toEqual({
		message: { text: ' hi ' },
	})
	expect(
		runBodySchema.parse({ message: { text: ' ', attachmentIds: [FILES[0]], files: [] } }),
	).toEqual({ message: { text: ' ', attachmentIds: [FILES[0]] } })
})

// parseJsonBody names the paths (lib/http/parse.ts): a blank text without files is the text's fault, a repeated file
// the list's.
it('names the field that failed', () => {
	const paths = (body: unknown) =>
		runBodySchema.safeParse(body).error?.issues.map(issue => issue.path.join('.'))
	expect(paths({ message: { text: ' ' } })).toEqual(['message.text'])
	expect(paths({ message: { text: 'hi', attachmentIds: [FILES[0], FILES[0]] } })).toEqual([
		'message.attachmentIds',
	])
})
```

In `__tests__/chat-run.test.ts` (as of Task 2), find:

```ts
const { dal, sessions } = vi.hoisted(() => ({
	dal: {
		findConversation: vi.fn(),
		continuedRun: vi.fn(),
		loadThread: vi.fn(),
		startRun: vi.fn(),
		finishRun: vi.fn(),
		truncateStaleRun: vi.fn(),
	},
	sessions: [] as FakeSession[],
}))
```

Replace with:

```ts
const { dal, files, sessions } = vi.hoisted(() => ({
	dal: {
		findConversation: vi.fn(),
		continuedRun: vi.fn(),
		loadThread: vi.fn(),
		startRun: vi.fn(),
		finishRun: vi.fn(),
		truncateStaleRun: vi.fn(),
	},
	/** The attachments' reads the run makes (lib/data/attachments.ts, Task 6). */
	files: {
		unsentAttachments: vi.fn(),
		conversationAttachmentBytes: vi.fn(),
		attachmentsForAgent: vi.fn(),
	},
	sessions: [] as FakeSession[],
}))
```

In the same file, find:

```ts
vi.mock('@/lib/data/conversations', () => dal)
```

Replace with:

```ts
vi.mock('@/lib/data/conversations', () => dal)
vi.mock('@/lib/data/attachments', () => files)
```

In the same file, find:

```ts
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
```

Replace with:

```ts
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import {
	CONVERSATION_ATTACHMENTS_MAX_BYTES,
	UPLOAD_REFUSALS,
	type AttachmentPolicy,
} from '@/lib/chat/attachment-rules'
```

In the same file, find:

```ts
chat.hubTools.mockImplementation((settings: { askUser: boolean }) =>
	settings.askUser ? [ASK_USER_TOOL_NAME] : [],
)
sessions.length = 0
```

Replace with:

```ts
chat.hubTools.mockImplementation((settings: { askUser: boolean }) =>
	settings.askUser ? [ASK_USER_TOOL_NAME] : [],
)
// …and the attachment policy is the settings' own (plan call P1).
chat.attachments.mockReset()
chat.attachments.mockImplementation(
	(settings: { attachments: AttachmentPolicy }) => settings.attachments,
)
sessions.length = 0
for (const fn of Object.values(files)) fn.mockReset()
files.unsentAttachments.mockResolvedValue([])
files.conversationAttachmentBytes.mockResolvedValue(0)
files.attachmentsForAgent.mockResolvedValue([])
```

In the same file, find (the end of the file):

```ts
		expect(dal.finishRun).not.toHaveBeenCalled()
	})
})
```

Replace with:

```ts
		expect(dal.finishRun).not.toHaveBeenCalled()
	})
})

// Plan calls P8–P12 (spec §7.1): a message's files are checked before anything is stored, linked by startRun, and
// reach the agent as content parts built by the app's settings as they are now.
describe('runTurn: a message’s files', () => {
	const FILE_A = '6f9619ff-8b86-4011-b42d-00c04fc964ff'
	const FILE_B = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
	/** The app with images allowed (spec §2.2); AG-UI's adapter answers the settings' `attachments` (Task 2). */
	const imagesApp = {
		...app,
		settings: { ...app.settings, attachments: { ...app.settings.attachments, images: true } },
	}
	const stored = (id: string, kind: 'image' | 'text', size = 1_000) => ({
		id,
		name: kind === 'image' ? 'chart.png' : 'data.csv',
		kind,
		mime: kind === 'image' ? 'image/png' : 'text/csv; charset=utf-8',
		size,
	})

	it('refuses ids that are not the actor’s unsent files of this app, storing nothing', async () => {
		files.unsentAttachments.mockResolvedValue([stored(FILE_A, 'text')])
		const response = await run({ message: { text: 'Read these', attachmentIds: [FILE_A, FILE_B] } })
		expect(await envelope(response)).toEqual({
			status: 400,
			body: {
				code: 'attachment_invalid',
				message: UPLOAD_REFUSALS.attachment_invalid.message,
				status: 400,
			},
		})
		expect(files.unsentAttachments).toHaveBeenCalledWith(actor, APP_ID, [FILE_A, FILE_B])
		expect(dal.startRun).not.toHaveBeenCalled()
	})

	it('refuses a kind the app does not take now (plan call P1), storing nothing', async () => {
		files.unsentAttachments.mockResolvedValue([stored(FILE_A, 'image')])
		const response = await run({ message: { text: 'Look', attachmentIds: [FILE_A] } })
		expect(await envelope(response)).toEqual({
			status: 415,
			body: {
				code: 'attachment_type_not_allowed',
				message: UPLOAD_REFUSALS.attachment_type_not_allowed.message,
				status: 415,
			},
		})
		expect(chat.attachments).toHaveBeenCalledWith(app.settings)
		expect(dal.startRun).not.toHaveBeenCalled()
	})

	it('refuses files past the conversation’s 6 MB, its sent files counted, and takes them up to it', async () => {
		files.unsentAttachments.mockResolvedValue([stored(FILE_A, 'text', 1_000)])
		files.conversationAttachmentBytes.mockResolvedValue(CONVERSATION_ATTACHMENTS_MAX_BYTES - 999)
		const body = {
			conversationId: CONVERSATION_ID,
			message: { text: 'More', attachmentIds: [FILE_A] },
		}
		expect(await envelope(await run(body))).toEqual({
			status: 413,
			body: {
				code: 'conversation_attachments_full',
				message: UPLOAD_REFUSALS.conversation_attachments_full.message,
				status: 413,
			},
		})
		expect(files.conversationAttachmentBytes).toHaveBeenCalledWith(CONVERSATION_ID)
		expect(dal.startRun).not.toHaveBeenCalled()
		opens({ ok: true })
		files.conversationAttachmentBytes.mockResolvedValue(CONVERSATION_ATTACHMENTS_MAX_BYTES - 1_000)
		expect((await run(body)).status).toBe(200)
		expect(dal.startRun).toHaveBeenCalledTimes(1)
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())
	})

	it('counts a new conversation’s files alone against the cap', async () => {
		files.unsentAttachments.mockResolvedValue([
			stored(FILE_A, 'text', 3_500_000),
			stored(FILE_B, 'text', 3_500_000),
		])
		const response = await run({
			message: { text: 'Two big files', attachmentIds: [FILE_A, FILE_B] },
		})
		expect(response.status).toBe(413)
		expect(files.conversationAttachmentBytes).not.toHaveBeenCalled()
		expect(dal.startRun).not.toHaveBeenCalled()
	})

	it('stores the user message with its text and links the files to it (plan call P9)', async () => {
		opens({ ok: true })
		files.unsentAttachments.mockResolvedValue([stored(FILE_A, 'image'), stored(FILE_B, 'text')])
		await run(
			{ message: { text: 'Compare', attachmentIds: [FILE_A, FILE_B] } },
			{ target: imagesApp },
		)
		const [user] = started().messages
		expect(user).toEqual({ id: expect.any(String), role: 'user', content: 'Compare' })
		expect(started().attachments).toEqual({ ids: [FILE_A, FILE_B], messageId: user.id })
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())
	})

	it('stores a message of files alone with an empty text and an empty title (decision 69 (2))', async () => {
		opens({ ok: true })
		files.unsentAttachments.mockResolvedValue([stored(FILE_A, 'text')])
		await run({ message: { text: ' \n ', attachmentIds: [FILE_A] } })
		expect(started()).toMatchObject({
			conversation: { title: '', isNew: true },
			messages: [{ role: 'user', content: '' }],
		})
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())
	})

	it('reads no files and links none for a message without them', async () => {
		opens({ ok: true })
		await run({ message: { text: 'hi' } })
		expect(files.unsentAttachments).not.toHaveBeenCalled()
		expect(started()).not.toHaveProperty('attachments')
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())
	})

	it('answers 400 when startRun finds a file gone since the checks, and releases the run', async () => {
		files.unsentAttachments.mockResolvedValue([stored(FILE_A, 'text')])
		dal.startRun.mockResolvedValue({ ok: false, code: 'attachment_invalid' })
		const response = await run({ message: { text: 'Read', attachmentIds: [FILE_A] } })
		expect(await envelope(response)).toEqual({
			status: 400,
			body: {
				code: 'attachment_invalid',
				message: UPLOAD_REFUSALS.attachment_invalid.message,
				status: 400,
			},
		})
		expect(chat.runTurn).not.toHaveBeenCalled()
		expect(activeRuns.has(started().runId)).toBe(false)
	})

	it('hands the agent each user message with its files as content parts, and seeds the session with that thread', async () => {
		opens({ ok: true })
		dal.loadThread.mockResolvedValue([userRow(1, 'm1', 'Compare these')])
		const png = Buffer.from('png-bytes')
		files.attachmentsForAgent.mockResolvedValue([
			{ ...stored(FILE_A, 'image'), messageId: 'm1', data: png, extractedText: null },
			{
				...stored(FILE_B, 'text'),
				messageId: 'm1',
				data: Buffer.from('a,b'),
				extractedText: 'a,b',
			},
		])
		await run(
			{ conversationId: CONVERSATION_ID, message: { text: 'And this?' } },
			{ target: imagesApp },
		)
		expect(files.attachmentsForAgent).toHaveBeenCalledWith(CONVERSATION_ID)
		expect(chat.attachments).toHaveBeenCalledWith(imagesApp.settings)
		expect(adapterInput().messages).toEqual([
			{
				id: 'm1',
				role: 'user',
				content: [
					{ type: 'text', text: 'Compare these' },
					{
						type: 'image',
						source: { type: 'data', value: png.toString('base64'), mimeType: 'image/png' },
					},
					{ type: 'text', text: '[file data.csv]\na,b' },
				],
			},
		])
		expect(sessions[0].args.history).toBe(adapterInput().messages)
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())
	})
})
```

In `__tests__/chat-session.test.ts` (as of Task 2), find:

```ts
		await session.finish({ failed: false })
		expect(Object.keys(writtenRows())).toEqual(['t-1'])
	})
```

Replace with:

```ts
		await session.finish({ failed: false })
		expect(Object.keys(writtenRows())).toEqual(['t-1'])
	})

	// 2c's plan call P10: startRun stored the user message with its text; the agent's copy carries the files' bytes.
	it('never writes a user message, not even one whose agent copy differs from the stored one', async () => {
		const { session } = setup()
		const withFiles: Message = {
			...USER,
			content: [
				{ type: 'text', text: 'Hi' },
				{ type: 'image', source: { type: 'data', value: 'iVBORw0KGgo=', mimeType: 'image/png' } },
			],
		}
		session.event(ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }))
		session.messages([withFiles, assistant('')])
		session.event(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'Seen' }))
		session.messages([
			withFiles,
			assistant('Seen'),
			{ id: 'user-2', role: 'user', content: 'Echo' },
		])
		session.event(ev('TEXT_MESSAGE_END', { messageId: 'm-1' }))
		await session.finish({ failed: false })
		expect(Object.keys(writtenRows())).toEqual(['m-1'])
	})
```

In `__tests__/db/conversations-run.db.test.ts`, find:

```ts
import { apps, conversationMessages, conversationRuns, conversations, users } from '@/db/schema'
```

Replace with:

```ts
import {
	apps,
	conversationAttachments,
	conversationMessages,
	conversationRuns,
	conversations,
	users,
} from '@/db/schema'
```

In the same file, find (the end of the file):

```ts
		expect(runs).toEqual([{ id: key.runId }])
		expect(messages).toEqual([{ runId: key.runId }])
	})
})
```

Replace with:

```ts
		expect(runs).toEqual([{ id: key.runId }])
		expect(messages).toEqual([{ runId: key.runId }])
	})
})

// 2c's plan call P9: a message's files are linked in the transaction that stores it, after it, or nothing is stored.
describe('a message’s attachments', () => {
	let actor: Actor
	let appId: string
	beforeEach(async () => {
		actor = actorFor()
		await insertAccount(actor)
		appId = await insertApp()
	})

	/** A file as the upload stores it (lib/data/attachments.ts storeAttachment): unsent unless `over` says otherwise. */
	const insertAttachment = async (
		owner: Actor,
		app: string,
		over: Partial<typeof conversationAttachments.$inferInsert> = {},
	) => {
		const id = crypto.randomUUID()
		await testDb.insert(conversationAttachments).values({
			id,
			userId: owner.id,
			appId: app,
			kind: 'text',
			mime: 'text/plain; charset=utf-8',
			name: 'notes.txt',
			size: 5,
			sha256: 'a'.repeat(64),
			data: Buffer.from('notes'),
			extractedText: 'notes',
			...over,
		})
		return id
	}
	const linkOf = async (id: string) => {
		const [row] = await testDb
			.select({
				conversationId: conversationAttachments.conversationId,
				messageId: conversationAttachments.messageId,
				position: conversationAttachments.position,
			})
			.from(conversationAttachments)
			.where(eq(conversationAttachments.id, id))
		return row
	}
	/** A run whose user message names `ids`; a new conversation unless one is given. */
	const send = async (ids: string[], conversationId?: string) => {
		const message = userMessage('Read these')
		const key = {
			conversationId: conversationId ?? crypto.randomUUID(),
			runId: crypto.randomUUID(),
		}
		const result = await startRun(actor, {
			appId,
			conversation: conversationId
				? { id: conversationId }
				: { id: key.conversationId, title: 'Read these', isNew: true },
			runId: key.runId,
			messages: [message],
			attachments: { ids, messageId: message.id },
		})
		return { key, message, result }
	}
	/** What a refused start left: the conversation (when new), the run and the message, by their ids. */
	const leftOf = async (conversationId: string, runId: string, messageId: string) => {
		const { rows } = await pool.query<{ conversations: string; runs: string; messages: string }>(
			'SELECT (SELECT count(*) FROM conversations WHERE id = $1) AS conversations, (SELECT count(*) FROM conversation_runs WHERE id = $2) AS runs, (SELECT count(*) FROM conversation_messages WHERE message_id = $3) AS messages',
			[conversationId, runId, messageId],
		)
		return rows[0]
	}

	it('links them to the conversation and the user message, each at its place in the message', async () => {
		const uploadedFirst = await insertAttachment(actor, appId)
		const uploadedSecond = await insertAttachment(actor, appId)
		const { key, message, result } = await send([uploadedSecond, uploadedFirst])
		expect(result).toEqual({ ok: true, key })
		const sent = { conversationId: key.conversationId, messageId: message.id }
		expect(await linkOf(uploadedSecond)).toEqual({ ...sent, position: 0 })
		expect(await linkOf(uploadedFirst)).toEqual({ ...sent, position: 1 })
	})

	it('rolls everything back when one is not the actor’s unsent file of this app (attachment_invalid)', async () => {
		const stranger = actorFor()
		await insertAccount(stranger)
		const earlier = await begin(actor, appId)
		const [earlierMessage] = await loadThread(earlier.conversationId)
		const foreign = [
			await insertAttachment(stranger, appId),
			await insertAttachment(actor, await insertApp()),
			// Sent already, with the earlier conversation's user message.
			await insertAttachment(actor, appId, {
				conversationId: earlier.conversationId,
				messageId: earlierMessage!.messageId,
				position: 0,
			}),
			crypto.randomUUID(),
		]
		const own = await insertAttachment(actor, appId)
		for (const id of foreign) {
			const { key, message, result } = await send([own, id])
			expect(result).toEqual({ ok: false, code: 'attachment_invalid' })
			expect(await leftOf(key.conversationId, key.runId, message.id)).toEqual({
				conversations: '0',
				runs: '0',
				messages: '0',
			})
			expect(await linkOf(own)).toEqual({ conversationId: null, messageId: null, position: null })
		}
	})

	it('leaves a conversation it continues as it was when a file is gone', async () => {
		const earlier = await begin(actor, appId)
		await done(earlier)
		const { key, message, result } = await send(
			[await insertAttachment(actor, appId), crypto.randomUUID()],
			earlier.conversationId,
		)
		expect(result).toEqual({ ok: false, code: 'attachment_invalid' })
		expect(await leftOf(key.conversationId, key.runId, message.id)).toEqual({
			conversations: '1',
			runs: '0',
			messages: '0',
		})
		expect(await continuedRun(earlier.conversationId)).toMatchObject({ id: earlier.runId })
		expect((await findConversation(actor, appId, earlier.conversationId))?.activeRunId).toBeNull()
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-attachment-parts.test.ts __tests__/chat-schemas.test.ts __tests__/chat-run.test.ts __tests__/chat-session.test.ts`

Expected: FAIL, `Test Files  4 failed (4)`, `Tests  17 failed | 73 passed (90)`: `__tests__/chat-attachment-parts.test.ts` with `Error: Cannot find package '@/lib/chat/attachment-parts' imported from …/__tests__/chat-attachment-parts.test.ts`; eight `chat-schemas` cases (the 2a schema refuses a blank text beside files and strips `attachmentIds`); the eight new `runTurn` cases (the refusals reach `chat.runTurn`, which no `opens()` prepared: `TypeError: Cannot read properties of undefined (reading 'opened')`; `started().attachments` is `undefined`; the agent gets the bare thread); the session case (`expected [ 'user-1', 'm-1', 'user-2' ] to deeply equal [ 'm-1' ]`).

Run: `pnpm exec vitest run --project db __tests__/db/conversations-run.db.test.ts`

Expected: FAIL, `Tests  3 failed | 18 passed (21)` (`startRun` ignores `attachments`: the files stay unsent, and the refused starts answer `{ ok: true, … }`).

- [ ] **Step 3: The run body's files**

In `lib/chat/schemas.ts`, find:

```ts
import { idSchema } from '@/lib/ids'

/*
 * The shared chat's request schemas (Part 2 spec §4.2; ADR-0025). Client-safe: the browser's own checks may reuse the
 * limits. zod 4 "Objects": unknown keys are stripped by default, so a field a later slice adds (2c's attachmentIds) is
 * dropped here until that slice reads it.
 */
```

Replace with:

```ts
import { idSchema } from '@/lib/ids'

import { ATTACHMENTS_PER_MESSAGE } from './attachment-rules'

/*
 * The shared chat's request schemas (Part 2 spec §4.2; ADR-0025). Client-safe: the browser's own checks may reuse the
 * limits. zod 4 "Objects": unknown keys are stripped by default, so a field the hub does not read is dropped here.
 */
```

In the same file, find:

```ts
/**
 * POST runs (spec §4.2): exactly one of `message` and `answers`, and `answers` only in a conversation. A text must hold a
 * non-blank character and is stored as typed (zod 4 "Refinements": `.refine` with a `path`, so parseJsonBody names the
 * field). 2a has no `attachmentIds` (2c adds them).
 */
export const runBodySchema = z
	.object({
		conversationId: idSchema.optional(),
		message: z
			.object({
				text: z
					.string()
					.max(MESSAGE_TEXT_MAX)
					.refine(text => text.trim() !== ''),
			})
			.optional(),
```

Replace with:

```ts
/**
 * POST runs (spec §4.2): exactly one of `message` and `answers`, and `answers` only in a conversation. A message names
 * 1–5 distinct uploaded files (`attachmentIds`, spec §4.2 and §7.1); its text is stored as typed and must hold a
 * non-blank character unless the message has files (decision 69 (2), plan call P12). zod 4 "Refinements": `.refine` with
 * a `path`, so parseJsonBody names the field (`message.text`, `message.attachmentIds`).
 */
export const runBodySchema = z
	.object({
		conversationId: idSchema.optional(),
		message: z
			.object({
				text: z.string().max(MESSAGE_TEXT_MAX),
				attachmentIds: z
					.array(idSchema)
					.min(1)
					.max(ATTACHMENTS_PER_MESSAGE)
					.refine(ids => new Set(ids).size === ids.length, { message: 'each file once' })
					.optional(),
			})
			.refine(message => message.attachmentIds !== undefined || message.text.trim() !== '', {
				path: ['text'],
				message: 'a message without files needs a text',
			})
			.optional(),
```

- [ ] **Step 4: The parts**

Create `lib/chat/attachment-parts.ts`:

```ts
import 'server-only'

import type { ContentPart, Message } from '@ag-ui/core'

import type { AttachmentForAgent } from '@/lib/data/attachments'

import {
	allowedKinds,
	fileMarker,
	kindsAllowedBy,
	NO_TEXT_LINE,
	notAcceptedLine,
	type AttachmentPolicy,
} from './attachment-rules'

/*
 * A user message's files as the agent reads them (Part 2 spec §7.1; plan calls P10, P11). The stored user message keeps
 * its text; each run joins its files back by message id and builds AG-UI 1.0 content parts from the stored bytes and the
 * app's settings as they are now, so every run re-sends every file of the conversation (decision 54). The parts are
 * @ag-ui/core 1.0.2's (`dist/version-DEKfpZNa.d.ts`: `TextPart`, `ImagePart`, `DocumentPart`, the `DataSource`
 * `{ type: 'data', value, mimeType }` whose value is "the bytes, base64-encoded"); docs.ag-ui.com "Messages" and
 * "Multimodal inputs": `content` is `string | ContentPart[]`, text first. Always a data source, never a hub URL
 * (decision 48: a model provider cannot reach the hub). Server-only: it reads the stored bytes.
 */

/**
 * P11: one file's part under the policy. An image is an `image` part; a PDF a `document` part in `native` mode; a PDF in
 * `text` mode and every text file one text part, `[file <name>]` on its own line, then the stored text, or NO_TEXT_LINE
 * when that is blank (a PDF stored under `native` with no text, read now in `text` mode). A kind the app no longer
 * allows goes as a line saying so, so the history stays readable and the run is not refused for an old file. Base64 is
 * the Buffer's own encoding (Node.js "Buffer", `buf.toString('base64')`).
 */
export const attachmentPart = (
	attachment: AttachmentForAgent,
	policy: AttachmentPolicy,
): ContentPart => {
	if (!allowedKinds(kindsAllowedBy(policy)).includes(attachment.kind))
		return { type: 'text', text: notAcceptedLine(attachment.name) }
	if (attachment.kind === 'image')
		return {
			type: 'image',
			source: {
				type: 'data',
				value: attachment.data.toString('base64'),
				mimeType: attachment.mime,
			},
		}
	if (attachment.kind === 'document' && policy.documents === 'native')
		return {
			type: 'document',
			source: {
				type: 'data',
				value: attachment.data.toString('base64'),
				mimeType: 'application/pdf',
			},
		}
	const text = attachment.extractedText?.trim() ? attachment.extractedText : NO_TEXT_LINE
	return { type: 'text', text: `${fileMarker(attachment.name)}\n${text}` }
}

/**
 * P10, P11: the thread with each user message that has files expanded into content parts: its text part when the text
 * is not blank (Anthropic refuses an empty text block; CopilotKit leaves it out the same way, research R1 §1), then one
 * part per file in the order given (lib/data/attachments.ts `attachmentsForAgent` answers them by `position`, the
 * order of the message's `attachmentIds`, P9). Every other message is the same object as before.
 */
export const withAttachmentParts = (
	messages: Message[],
	attachments: readonly AttachmentForAgent[],
	policy: AttachmentPolicy,
): Message[] => {
	if (!attachments.length) return messages
	const byMessage = new Map<string, AttachmentForAgent[]>()
	for (const attachment of attachments)
		byMessage.set(attachment.messageId, [
			...(byMessage.get(attachment.messageId) ?? []),
			attachment,
		])
	return messages.map(message => {
		const files = message.role === 'user' ? byMessage.get(message.id) : undefined
		if (message.role !== 'user' || !files) return message
		const lead: ContentPart[] =
			typeof message.content !== 'string'
				? message.content
				: message.content.trim()
					? [{ type: 'text', text: message.content }]
					: []
		return { ...message, content: [...lead, ...files.map(file => attachmentPart(file, policy))] }
	})
}
```

- [ ] **Step 5: The link in `startRun`**

In `lib/data/conversations.ts`, find:

```ts
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
```

Replace with:

```ts
import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	sql,
	TransactionRollbackError,
} from 'drizzle-orm'
```

In the same file, find:

```ts
import { conversationMessages, conversationRuns, conversations } from '@/db/schema'
```

Replace with:

```ts
import {
	conversationAttachments,
	conversationMessages,
	conversationRuns,
	conversations,
} from '@/db/schema'
```

In the same file, find:

```ts
	messages: Message[]
	resume?: unknown
}

export type StartRunResult =
	| { ok: true; key: RunKey }
	| { ok: false; code: 'run_in_progress' | 'conversation_not_found' }
```

Replace with:

```ts
	messages: Message[]
	resume?: unknown
	/** The message's attachments, linked to `messageId` in the same transaction, each with its index in `ids` as `position`. */
	attachments?: { ids: string[]; messageId: string }
}

export type StartRunResult =
	| { ok: true; key: RunKey }
	| { ok: false; code: 'run_in_progress' | 'conversation_not_found' | 'attachment_invalid' }
```

In the same file, find:

```ts
 * AG-UI schema refuses is the hub's own fault here (the hub built it), so it throws before anything is written.
 */
export async function startRun(actor: SessionUser, input: StartRunInput): Promise<StartRunResult> {
	if (input.messages.some(message => !asMessage(message)))
		throw new Error('startRun: a message the hub built is not an AG-UI message')
	const conversationId = input.conversation.id
```

Replace with:

```ts
 * AG-UI schema refuses is the hub's own fault here (the hub built it), so it throws before anything is written.
 *
 * Plan call P9: after the messages, each of the message's attachments is linked to the conversation and the user
 * message, at its index in `ids` as `position` (the order the user attached them, which nothing else keeps, P11), one
 * UPDATE per id as the messages are one INSERT each, and only while it is still the actor's unsent attachment of this
 * app. An UPDATE that changes no row (a race with a delete, the purge or another send) rolls the whole transaction back
 * with `tx.rollback()` (Drizzle "Transactions": it "throws an exception that rollbacks the transaction"; drizzle-orm's
 * `TransactionRollbackError`), so no conversation, run or message stays, and answers attachment_invalid. node-postgres's
 * `rowCount` counts the rows an UPDATE changed (node-postgres "Result"; it may be null, as renameConversation reads it).
 */
export async function startRun(actor: SessionUser, input: StartRunInput): Promise<StartRunResult> {
	if (input.messages.some(message => !asMessage(message)))
		throw new Error('startRun: a message the hub built is not an AG-UI message')
	try {
		return await writeRunStart(actor, input)
	} catch (error) {
		if (error instanceof TransactionRollbackError) return { ok: false, code: 'attachment_invalid' }
		throw error
	}
}

const writeRunStart = (actor: SessionUser, input: StartRunInput): Promise<StartRunResult> => {
	const conversationId = input.conversation.id
```

In the same file, find (the end of `startRun`'s transaction):

```ts
				createdAt: now,
				updatedAt: now,
			})
		await tx
			.update(conversations)
			.set({ activeRunId: input.runId, updatedAt: now })
			.where(eq(conversations.id, conversationId))
		return { ok: true, key: { conversationId, runId: input.runId } }
```

Replace with:

```ts
				createdAt: now,
				updatedAt: now,
			})
		const files = input.attachments
		if (files)
			for (const [position, id] of files.ids.entries()) {
				const linked = await tx
					.update(conversationAttachments)
					.set({ conversationId, messageId: files.messageId, position })
					.where(
						and(
							eq(conversationAttachments.id, id),
							eq(conversationAttachments.userId, actor.id),
							eq(conversationAttachments.appId, input.appId),
							isNull(conversationAttachments.conversationId),
						),
					)
				if (linked.rowCount !== 1) tx.rollback()
			}
		await tx
			.update(conversations)
			.set({ activeRunId: input.runId, updatedAt: now })
			.where(eq(conversations.id, conversationId))
		return { ok: true, key: { conversationId, runId: input.runId } }
```

- [ ] **Step 6: The session writes no user row**

In `lib/chat/session.ts`, find:

```ts
/** The thread the agent was given (lib/chat/thread.ts threadForAgent): its rows are stored already. */
```

Replace with:

```ts
/** The thread the agent was given (lib/chat/run.ts `streamRun`): its rows are stored already. */
```

In the same file, find:

```ts
for (const message of args.history) this.written.set(message.id, rowJson(message, 'complete'))
```

Replace with:

```ts
// A user row is never written (`save`), so only the others are remembered (a user message with files carries their
// bytes, plan call P10).
for (const message of args.history)
	if (message.role !== 'user') this.written.set(message.id, rowJson(message, 'complete'))
```

In the same file, find:

```ts
		const rows = this.latest.flatMap(message => {
			const status = this.statusOf(message)
```

Replace with:

```ts
		const rows = this.latest.flatMap(message => {
			// Plan call P10: startRun stored the user message with its text; the agent's copy carries the files' bytes inline
			// (lib/chat/attachment-parts.ts), which never reach conversation_messages.
			if (message.role === 'user') return []
			const status = this.statusOf(message)
```

- [ ] **Step 7: The run**

In `lib/chat/run.ts`, find:

```ts
import type { SessionUser } from '@/lib/auth/session'
import {
	continuedRun,
```

Replace with:

```ts
import type { SessionUser } from '@/lib/auth/session'
import {
	attachmentsForAgent,
	conversationAttachmentBytes,
	unsentAttachments,
} from '@/lib/data/attachments'
import {
	continuedRun,
```

In the same file, find:

```ts
import { anyOpen, checkAnswers, openItemsOf } from './answers'
```

Replace with:

```ts
import { anyOpen, checkAnswers, openItemsOf } from './answers'
import { withAttachmentParts } from './attachment-parts'
import {
	allowedKinds,
	CONVERSATION_ATTACHMENTS_MAX_BYTES,
	kindsAllowedBy,
	UPLOAD_REFUSALS,
	type AttachmentPolicy,
	type UploadRefusalCode,
} from './attachment-rules'
```

In the same file, find:

```ts
/** Spec §4.4: log lines carry the app, the run and a code, never content. */
```

Replace with:

```ts
/** A refusal of the message's files with the upload's status and message for its code (spec §8; plan call P4). */
const refuseFiles = (code: UploadRefusalCode): Response =>
	errorResponse(code, UPLOAD_REFUSALS[code].message, UPLOAD_REFUSALS[code].status)

/**
 * Plan calls P8 and P9: the message's files, checked before anything is stored, as they are now: each must be the actor's
 * unsent attachment of this app (fewer found than named: 400 attachment_invalid), of a kind the app allows now (415
 * attachment_type_not_allowed; P1, decision 62's rule for a setting), and the conversation's sent files plus these must
 * stay within CONVERSATION_ATTACHMENTS_MAX_BYTES (413 conversation_attachments_full; a new conversation has none yet).
 * Null when they may be sent.
 */
const refuseAttachments = async (
	actor: SessionUser,
	appId: string,
	conversationId: string | undefined,
	ids: readonly string[],
	policy: AttachmentPolicy,
): Promise<Response | null> => {
	const files = await unsentAttachments(actor, appId, ids)
	if (files.length < ids.length) return refuseFiles('attachment_invalid')
	const allowed = allowedKinds(kindsAllowedBy(policy))
	if (files.some(file => !allowed.includes(file.kind)))
		return refuseFiles('attachment_type_not_allowed')
	const sent = conversationId ? await conversationAttachmentBytes(conversationId) : 0
	const adding = files.reduce((total, file) => total + file.size, 0)
	if (sent + adding > CONVERSATION_ATTACHMENTS_MAX_BYTES)
		return refuseFiles('conversation_attachments_full')
	return null
}

/** Spec §4.4: log lines carry the app, the run and a code, never content. */
```

In the same file, find:

```ts
	} else if (anyOpen(open)) return errorResponse('answer_pending', ANSWER_PENDING, 409)
```

Replace with:

```ts
	} else if (anyOpen(open)) return errorResponse('answer_pending', ANSWER_PENDING, 409)

	// The attachment policy is the app's settings as they are now (plan call P1): the checks and the parts read the same.
	const policy = chat.attachments(app.settings)
	const attachmentIds = body.message?.attachmentIds ?? []
	if (attachmentIds.length) {
		const refused = await refuseAttachments(actor, app.id, conversation?.id, attachmentIds, policy)
		if (refused) return refused
	}
```

In the same file, find:

```ts
const text = body.message?.text
const userMessage: Message[] =
	text === undefined ? [] : [{ id: crypto.randomUUID(), role: 'user', content: text }]
```

Replace with:

```ts
const text = body.message?.text
// Plan call P10: the stored user message keeps its text, '' for a message of files alone (decision 69 (2)).
const user: Message | undefined =
	text === undefined
		? undefined
		: { id: crypto.randomUUID(), role: 'user', content: text.trim() ? text : '' }
const userMessage = user ? [user] : []
```

In the same file, find:

```ts
			messages: [...notAvailable, ...answers, ...userMessage],
			resume,
		})
```

Replace with:

```ts
			messages: [...notAvailable, ...answers, ...userMessage],
			resume,
			...(user && attachmentIds.length
				? { attachments: { ids: attachmentIds, messageId: user.id } }
				: {}),
		})
```

In the same file, find:

```ts
if (!started.ok) {
	activeRuns.release(runId)
	return started.code === 'run_in_progress'
		? errorResponse('run_in_progress', RUN_IN_PROGRESS, 409)
		: conversationNotFound()
}
```

Replace with:

```ts
if (!started.ok) {
	activeRuns.release(runId)
	if (started.code === 'run_in_progress')
		return errorResponse('run_in_progress', RUN_IN_PROGRESS, 409)
	// Plan call P9: a file was deleted, purged or sent elsewhere since the checks; nothing was stored.
	if (started.code === 'attachment_invalid') return refuseFiles('attachment_invalid')
	return conversationNotFound()
}
```

In the same file, find:

```ts
		resume,
		tools: hubToolDefinitions(hubTools),
```

Replace with:

```ts
		resume,
		policy,
		tools: hubToolDefinitions(hubTools),
```

In the same file, find:

```ts
 * Steps 3–5. The thread is read back from the store (§3.3), the rows just written included, and handed to the adapter
 * with the run's own AbortController, which the stop route (§4.5) and a disconnect abort through activeRuns, and with
 * the hub's tools the app advertises (§6.2). The session writes `hub:run` before the adapter can report an event. A
 * refusal before any stream (§4.3 step 4) answers the envelope and stores the run failed, unless a stop caused it: then,
 * as every other run, it is settled by the session (§4.5).
```

Replace with:

```ts
 * Steps 3–5. The thread is read back from the store (§3.3), the rows just written included, each user message with files
 * expanded into content parts by the policy (plan calls P10, P11), and handed to the adapter with the run's own
 * AbortController, which the stop route (§4.5) and a disconnect abort through activeRuns, and with the hub's tools the
 * app advertises (§6.2). The session writes `hub:run` before the adapter can report an event. A refusal before any
 * stream (§4.3 step 4) answers the envelope and stores the run failed, unless a stop caused it: then, as every other
 * run, it is settled by the session (§4.5).
```

In the same file, find:

```ts
	resume,
	tools,
	withdraw,
}: Omit<RunTurnArgs, 'body'> & {
	key: RunKey
	controller: AbortController
	title: string
	state: unknown
	resume: ResumeEntry[] | undefined
	tools: Tool[]
```

Replace with:

```ts
	resume,
	policy,
	tools,
	withdraw,
}: Omit<RunTurnArgs, 'body'> & {
	key: RunKey
	controller: AbortController
	title: string
	state: unknown
	resume: ResumeEntry[] | undefined
	policy: AttachmentPolicy
	tools: Tool[]
```

In the same file, find:

```ts
const messages = threadForAgent(await loadThread(key.conversationId))
// The session seeds its write memory with the thread the agent is given, so no history row is written again (Task 10).
```

Replace with:

```ts
const messages = withAttachmentParts(
	threadForAgent(await loadThread(key.conversationId)),
	await attachmentsForAgent(key.conversationId),
	policy,
)
// The session seeds its write memory with the thread the agent is given, so no history row is written again (Task 10);
// it never writes a user row, whose copy here carries the files' bytes (plan call P10).
```

- [ ] **Step 8: Run them to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-attachment-parts.test.ts __tests__/chat-schemas.test.ts __tests__/chat-run.test.ts __tests__/chat-session.test.ts`

Expected: PASS, `Test Files  4 passed (4)`, `Tests  107 passed (107)`.

Run: `pnpm exec vitest run --project db __tests__/db/conversations-run.db.test.ts`

Expected: PASS, `Test Files  1 passed (1)`, `Tests  21 passed (21)`.

- [ ] **Step 9: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/attachment-parts.ts lib/chat/schemas.ts lib/chat/run.ts lib/chat/session.ts lib/data/conversations.ts __tests__/chat-attachment-parts.test.ts __tests__/chat-schemas.test.ts __tests__/chat-run.test.ts __tests__/chat-session.test.ts __tests__/db/conversations-run.db.test.ts
pnpm exec oxfmt --check lib/chat/attachment-parts.ts lib/chat/schemas.ts lib/chat/run.ts lib/chat/session.ts lib/data/conversations.ts __tests__/chat-attachment-parts.test.ts __tests__/chat-schemas.test.ts __tests__/chat-run.test.ts __tests__/chat-session.test.ts __tests__/db/conversations-run.db.test.ts
pnpm test
pnpm test:db
```

Expected: tsc exits 0; oxlint prints no finding; oxfmt "All matched files use the correct format"; `pnpm test` and `pnpm test:db` 0 failed (`lib/data/` changed, so the live suite runs; it never runs beside `pnpm test:e2e`).

- [ ] **Step 10: Commit**

```bash
git add lib/chat/attachment-parts.ts lib/chat/schemas.ts lib/chat/run.ts lib/chat/session.ts lib/data/conversations.ts __tests__/chat-attachment-parts.test.ts __tests__/chat-schemas.test.ts __tests__/chat-run.test.ts __tests__/chat-session.test.ts __tests__/db/conversations-run.db.test.ts
git commit -m "feat(chat): runs carry the message's attachments

A run's message names 1-5 uploaded files and may leave its text blank
when it does. Before anything is stored the run checks them as they are
now: each the actor's unsent file of this app, of a kind the app takes,
and the conversation's sent files plus these within 6 MB. startRun links
each file to the stored user message at its place in the message, in the
same transaction, or rolls everything back with attachment_invalid. Every
run then hands the agent each user message with files as AG-UI content
parts built from the stored bytes and the app's settings, and the session
never writes a user row, so the inlined bytes stay out of
conversation_messages (Part 2 spec §4.2, §7.1, §8; plan calls P8-P12).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the 10 files; lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": ["lib/chat/attachment-parts.ts", "lib/chat/schemas.ts", "lib/chat/run.ts", "lib/chat/session.ts", "lib/data/conversations.ts", "__tests__/chat-attachment-parts.test.ts", "__tests__/chat-schemas.test.ts", "__tests__/chat-run.test.ts", "__tests__/chat-session.test.ts", "__tests__/db/conversations-run.db.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-attachment-parts.test.ts __tests__/chat-schemas.test.ts __tests__/chat-run.test.ts __tests__/chat-session.test.ts", "acceptanceCriteria": ["runBodySchema takes one id, five ids with an empty text, one id with a blank text; refuses [], six ids, a repeated id, a non-UUID id and a blank text without ids; paths message.text and message.attachmentIds", "attachmentPart: image part with base64 data in every mode while images are on; PDF document part in native, '[file report.pdf]\\n<text>' in text mode; text files as text in both modes; NO_TEXT_LINE for blank text; notAcceptedLine for a kind the policy refuses", "withAttachmentParts: text part first only when not blank, files in the order given on their own message, other messages the same object, no files the same array; MessageSchema accepts the result", "runTurn refuses before startRun: 400 attachment_invalid (fewer found), 415 attachment_type_not_allowed (kind refused now), 413 conversation_attachments_full (sent + files > 6 MB; a new conversation counts its files alone), with UPLOAD_REFUSALS' status and message", "runTurn stores the text ('' and title '' for files alone), passes attachments { ids, messageId } to startRun, answers startRun's attachment_invalid with 400 and releases the run, and hands the adapter withAttachmentParts(threadForAgent(rows), attachmentsForAgent(id), policy), the same array as the session's history", "RunSession never writes a user row", "startRun sets conversation_id, message_id and position 0..n-1 per id; a foreign, sent or unknown id answers attachment_invalid and stores no conversation, run or message", "tsc exits 0, pnpm test and pnpm test:db 0 failed, oxlint and oxfmt clean"], "modelTier": "standard"}
```

---

### Task 10: Files in history

**Goal:** A history page carries the files of its user messages (metadata only, in the order attached), and the server's grouping puts each on the user turn of its message, so a reload shows a user turn's files as the live turn does.

Spec §7.1 ("**UI:** … `FileCard` and image thumbnails in the user bubble, as `message-files.tsx`"), spec §3.3 ("**Turns for the browser:** `turnsFromMessages(rows, runs)` groups the rows into turns on the server"; "Grouping happens on the server because 'nothing on the wire carries run identity'"), plan calls P10 ("the attachments are joined by `message_id` … when history is read (`files`, metadata only)") and P15 ("`Turn` gains `files?: TurnFile[]` (`id`, `name`, `kind`, `mime`, `size`), set on user turns only: live from the composer's uploaded items, in history from `readThreadPage`'s `files` (the attachments whose `message_id` is among the page's user messages) through `turnsFromMessages`' third argument"), and the Shared contracts' `Turn.files`, `userTurn`, `turnsFromMessages` and `ThreadPage.files`. No new library API: the files come from Task 6's `attachmentFilesOf(conversationId, messageIds)`, which selects the metadata columns only (never `data`), joins each file to its user message on `(conversation_id, message_id)` and orders by that message's `seq`, then `position` (P9: the order of the message's `attachmentIds`, which the upload time does not keep), so the page's files come back in the order the user attached them; `TurnFile` is Task 1's client-safe type, imported with `import type`, so `lib/chat/turn.ts` stays client-safe (spec §9: the browser imports it). The page asks for the files of its own user messages only, so an older page's, an unsent file and another conversation's never come back; the grouping drops each file's `messageId` before it reaches the browser, and a file naming no user turn of the page is ignored. A message of files alone keeps 2a's single text part with `''` (`turnText` answers `''`; Task 12 shows the text only when there is any). The route passes `page.files` on; its body is otherwise 2a's, and `__tests__/chat-routes.test.ts` pins the call. `lib/data/conversations.ts` is quoted as of Task 9. Task 11 builds the live user turn with `userTurn('local', text, files)` from the composer's uploaded files; Task 12 renders `turn.files`; Task 13 splits `readThreadPageOf` out of `readThreadPage` and keeps `files`, which the Logs drawer (Task 16) shows through the same turns.

**Files:**

- Modify: `lib/chat/turn.ts` (`Turn.files`, `userTurn`'s third argument, `turnsFromMessages`' third argument)
- Modify: `lib/data/conversations.ts` (`ThreadPage.files`, read by `readThreadPage`; as of Task 9)
- Modify: `app/api/apps/[appId]/conversations/[conversationId]/route.ts` (passes `page.files`)
- Test: `__tests__/chat-turn.test.ts` (a new `describe`)
- Test: `__tests__/chat-routes.test.ts` (the GET's page and expectation)
- Test: `__tests__/db/conversations-read.db.test.ts` (`insertTurn` answers the message id; the empty page's `files`; a new case)

**Acceptance Criteria:**

- [ ] `turnsFromMessages(rows, runs, files)` puts each file, without its `messageId`, on the user turn of the message it names, in the order given; no assistant turn and no other user turn has `files`; a file naming no user message of the rows is ignored; called with two arguments it answers as before.
- [ ] A user message with the text `''` and one file gives a user turn whose `parts` are `[{ kind: 'text', messageId, text: '' }]`, whose `files` is that file, and whose `turnText` is `''`; `userTurn(id, text)` and `userTurn(id, text, [])` have no `files` key.
- [ ] `readThreadPage` answers `files: []` for a conversation without messages, and for a page of one turn the files of that turn's user message only, ordered by `position` (attached first, uploaded last comes first), each `{ id, name, kind, mime, size, messageId }`, never an older page's, an unsent one or another conversation's.
- [ ] `GET /api/apps/[appId]/conversations/[conversationId]` calls `turnsFromMessages(page.rows, page.runs, page.files)`.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; `pnpm test:db` reports 0 failed; oxlint and oxfmt clean on the changed files.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-turn.test.ts __tests__/chat-routes.test.ts` → `Test Files  2 passed (2)`, `Tests  59 passed (59)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

In `__tests__/chat-turn.test.ts`, find (the end of the `turnsFromMessages` block):

```ts
			expect(turn.interrupts).toEqual([])
		})
	})
})

describe('contentText and turnText', () => {
```

Replace with:

```ts
			expect(turn.interrupts).toEqual([])
		})
	})

	// 2c's plan call P15: a history page's files, by message id (lib/data/conversations.ts readThreadPage).
	describe('a user turn’s files', () => {
		const file = (
			id: string,
			messageId: string,
			name: string,
			kind: 'image' | 'text' = 'text',
		) => ({
			id,
			messageId,
			name,
			kind,
			mime: kind === 'image' ? 'image/png' : 'text/plain; charset=utf-8',
			size: 5,
		})
		const shown = ({ messageId: _messageId, ...rest }: ReturnType<typeof file>) => rest

		it('puts each file on the user turn of its message, in the order given, and none elsewhere', () => {
			const files = [
				file('f-2', 'u-2', 'b.txt'),
				file('f-1', 'u-2', 'a.png', 'image'),
				file('f-9', 'u-9', 'elsewhere.txt'),
			]
			const turns = turnsFromMessages(
				[
					user('u-1', 'r-1', 'One'),
					assistant('a-1', 'r-1', { content: 'First answer' }),
					user('u-2', 'r-2', 'Two'),
					assistant('a-2', 'r-2', { content: 'Second answer' }),
				],
				[runRow({ id: 'r-1', startedAt: at(0) }), runRow({ id: 'r-2', startedAt: at(1) })],
				files,
			)
			expect(turns.map(({ turn }) => turn.files)).toEqual([
				undefined,
				undefined,
				[shown(files[0]), shown(files[1])],
				undefined,
			])
		})

		it('gives a message of files alone a user turn with an empty text (decision 69 (2))', () => {
			const files = [file('f-1', 'u-1', 'chart.png', 'image')]
			const [first] = turnsFromMessages(
				[user('u-1', 'r-1', ''), assistant('a-1', 'r-1', { content: 'A chart.' })],
				[runRow({ id: 'r-1' })],
				files,
			)
			expect(first.id).toBe('u-1')
			expect(first.turn.files).toEqual([shown(files[0])])
			expect(first.turn.parts).toEqual([{ kind: 'text', messageId: 'u-1', text: '' }])
			expect(turnText(first.turn)).toBe('')
		})

		it('leaves `files` off a turn without any', () => {
			expect(userTurn('u-1', 'Hi', [shown(file('f-1', 'u-1', 'a.txt'))]).files).toHaveLength(1)
			expect(userTurn('u-1', 'Hi')).not.toHaveProperty('files')
			expect(userTurn('u-1', 'Hi', [])).not.toHaveProperty('files')
			const turns = turnsFromMessages([user('u-1', 'r-1', 'Hi')], [runRow({ id: 'r-1' })])
			expect(turns[0].turn).not.toHaveProperty('files')
		})
	})
})

describe('contentText and turnText', () => {
```

In `__tests__/chat-routes.test.ts`, find:

```ts
const page = { conversation, rows: ['rows'], runs: ['runs'], cursor: '12' }
```

Replace with:

```ts
const page = { conversation, rows: ['rows'], runs: ['runs'], cursor: '12', files: ['files'] }
```

In the same file, find:

```ts
expect(m.turnsFromMessages).toHaveBeenCalledWith(['rows'], ['runs'])
```

Replace with:

```ts
// 2c's plan call P15: the page's files go to the grouping, which puts them on their user turns.
expect(m.turnsFromMessages).toHaveBeenCalledWith(['rows'], ['runs'], ['files'])
```

In `__tests__/db/conversations-read.db.test.ts`, find:

```ts
import { apps, conversationMessages, conversationRuns, conversations, users } from '@/db/schema'
```

Replace with:

```ts
import {
	apps,
	conversationAttachments,
	conversationMessages,
	conversationRuns,
	conversations,
	users,
} from '@/db/schema'
```

In the same file, find:

```ts
/** One turn: a run started at `startedAt`, its user message and the assistant's answer. Answers the user message's seq. */
const insertTurn = async (conversationId: string, startedAt: Date, text: string) => {
	const runId = await insertRun(conversationId, startedAt)
	const seq = await insertMessage(conversationId, runId, {
		id: crypto.randomUUID(),
		role: 'user',
		content: text,
	})
```

Replace with:

```ts
/**
 * One turn: a run started at `startedAt`, its user message and the assistant's answer. Answers the run's id, the user
 * message's seq and its id.
 */
const insertTurn = async (conversationId: string, startedAt: Date, text: string) => {
	const runId = await insertRun(conversationId, startedAt)
	const messageId = crypto.randomUUID()
	const seq = await insertMessage(conversationId, runId, {
		id: messageId,
		role: 'user',
		content: text,
	})
```

In the same file, find:

```ts
	return { runId, seq }
}
```

Replace with:

```ts
	return { runId, seq, messageId }
}
```

In the same file, find:

```ts
		expect(await readThreadPage(actor, appId, conversationId, { turns: 20 })).toMatchObject({
			rows: [],
			runs: [],
			cursor: null,
		})
	})
```

Replace with:

```ts
		expect(await readThreadPage(actor, appId, conversationId, { turns: 20 })).toMatchObject({
			rows: [],
			runs: [],
			cursor: null,
			files: [],
		})
	})

	// 2c's plan call P15: the files of the page's user messages, metadata only, which the grouping puts on their turns.
	it('answers the files of the page’s user messages in the order attached, and none of other messages', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		const other = await insertConversation(actor, appId)
		const base = Date.now() - 60_000
		const turn1 = await insertTurn(conversationId, new Date(base), 'one')
		const turn2 = await insertTurn(conversationId, new Date(base + 1000), 'two')
		const elsewhere = await insertTurn(other, new Date(base), 'elsewhere')
		/** A file uploaded at `at`; sent with `messageId` at `position` unless both are null. */
		const insertFile = async (
			name: string,
			at: number,
			messageId: string | null,
			position: number | null,
			inConversation = conversationId,
		) => {
			const id = crypto.randomUUID()
			await testDb.insert(conversationAttachments).values({
				id,
				userId: actor.id,
				appId,
				conversationId: messageId ? inConversation : null,
				messageId,
				position,
				kind: 'text',
				mime: 'text/plain; charset=utf-8',
				name,
				size: 4,
				sha256: 'a'.repeat(64),
				data: Buffer.from('text'),
				extractedText: 'text',
				createdAt: new Date(at),
			})
			return id
		}
		// Attached first, uploaded last (a large file picked first): `position` keeps the order attached (P9).
		const first = await insertFile('first.txt', base + 20, turn2.messageId, 0)
		const second = await insertFile('second.txt', base + 10, turn2.messageId, 1)
		await insertFile('older.txt', base, turn1.messageId, 0)
		await insertFile('unsent.txt', base, null, null)
		await insertFile('elsewhere.txt', base, elsewhere.messageId, 0, other)
		const file = (id: string, name: string) => ({
			id,
			name,
			kind: 'text',
			mime: 'text/plain; charset=utf-8',
			size: 4,
		})

		const page = await readThreadPage(actor, appId, conversationId, { turns: 1 })
		expect(page?.files).toEqual([
			{ ...file(first, 'first.txt'), messageId: turn2.messageId },
			{ ...file(second, 'second.txt'), messageId: turn2.messageId },
		])
		const turns = turnsFromMessages(page!.rows, page!.runs, page!.files)
		expect(turns.map(({ turn }) => turn.files)).toEqual([
			[file(first, 'first.txt'), file(second, 'second.txt')],
			undefined,
		])
	})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-turn.test.ts __tests__/chat-routes.test.ts`

Expected: FAIL, `Test Files  2 failed (2)`, `Tests  4 failed | 55 passed (59)`: the three new `turnsFromMessages` cases (no turn has `files`: `expected undefined to deeply equal [ { id: 'f-1', …(4) } ]`; `userTurn` ignores its third argument: `Target cannot be null or undefined.`) and the route case (`expected "vi.fn()" to be called with arguments: [ [ 'rows' ], [ 'runs' ], [ 'files' ] ]`).

Run: `pnpm exec vitest run --project db __tests__/db/conversations-read.db.test.ts`

Expected: FAIL, `Tests  2 failed | 11 passed (13)` (the page has no `files`).

- [ ] **Step 3: A user turn's files**

In `lib/chat/turn.ts`, find:

```ts
import {
	readResume,
	withSentAnswers,
```

Replace with:

```ts
import type { TurnFile } from './attachment-rules'
import {
	readResume,
	withSentAnswers,
```

In the same file, find:

```ts
	answered: AnsweredInterrupt[]
}

/** The hub's first event on every run stream (spec §4.4): the browser learns the conversation and the run to stop. */
```

Replace with:

```ts
	answered: AnsweredInterrupt[]
	/** 2c's plan call P15: a user turn's files; absent on an assistant turn and on a user turn without files. */
	files?: TurnFile[]
}

/** The hub's first event on every run stream (spec §4.4): the browser learns the conversation and the run to stop. */
```

In the same file, find:

```ts
export const userTurn = (messageId: string, text: string): Turn => ({
	role: 'user',
	parts: [{ kind: 'text', messageId, text }],
	runs: [],
	interrupts: [],
	answered: [],
})
```

Replace with:

```ts
/** A user message as a turn: its text and, when it has any, its files (2c's plan call P15; '' for files alone). */
export const userTurn = (messageId: string, text: string, files?: TurnFile[]): Turn => ({
	role: 'user',
	parts: [{ kind: 'text', messageId, text }],
	runs: [],
	interrupts: [],
	answered: [],
	...(files?.length ? { files } : {}),
})
```

In the same file, find:

```ts
 * The answers the turn's runs sent are recorded in it (`withAnswersSent`), as the browser recorded them when they went.
 */
export const turnsFromMessages = (
	rows: readonly TurnMessageRow[],
	runs: readonly TurnRunRow[],
): HistoryTurn[] => {
	const runById = new Map(runs.map(run => [run.id, run]))
```

Replace with:

```ts
 * The answers the turn's runs sent are recorded in it (`withAnswersSent`), as the browser recorded them when they went.
 * Each user turn carries the files its message sent (2c's plan call P15: lib/data/conversations.ts `readThreadPage`
 * answers them with their message's id, in the order attached), without that id.
 */
export const turnsFromMessages = (
	rows: readonly TurnMessageRow[],
	runs: readonly TurnRunRow[],
	files: readonly (TurnFile & { messageId: string })[] = [],
): HistoryTurn[] => {
	const runById = new Map(runs.map(run => [run.id, run]))
	const filesOf = new Map<string, TurnFile[]>()
	for (const { messageId, ...file } of files)
		filesOf.set(messageId, [...(filesOf.get(messageId) ?? []), file])
```

In the same file, find:

```ts
				turn: userTurn(user.messageId, contentText(user.body.content)),
```

Replace with:

```ts
				turn: userTurn(user.messageId, contentText(user.body.content), filesOf.get(user.messageId)),
```

- [ ] **Step 4: The page's files**

In `lib/data/conversations.ts` (as of Task 9), find:

```ts
import type { SessionUser } from '@/lib/auth/session'
import {
	PURGE_AFTER_DAYS,
```

Replace with:

```ts
import type { SessionUser } from '@/lib/auth/session'
import type { TurnFile } from '@/lib/chat/attachment-rules'
import {
	PURGE_AFTER_DAYS,
```

In the same file, find:

```ts
	unansweredToolCalls,
} from '@/lib/chat/thread'
```

Replace with:

```ts
	unansweredToolCalls,
} from '@/lib/chat/thread'

import { attachmentFilesOf } from './attachments'
```

In the same file, find:

```ts
	/** The seq of the oldest user message shown, as a string; null when nothing is older (plan call P8). */
	cursor: string | null
}
```

Replace with:

```ts
	/** The seq of the oldest user message shown, as a string; null when nothing is older (plan call P8). */
	cursor: string | null
	/** 2c's plan call P15: the files of the page's user messages, each with its message's id, in the order attached. */
	files: (TurnFile & { messageId: string })[]
}
```

In the same file, find:

```ts
 * run that answered it, each with the answers it was started with. Null when the conversation is not the actor's of
 * this app, or deleted.
 */
```

Replace with:

```ts
 * run that answered it, each with the answers it was started with, and the files of its user messages (2c's plan call
 * P15; their metadata, never the bytes). Null when the conversation is not the actor's of this app, or deleted.
 */
```

In the same file, find:

```ts
if (first === undefined) return { conversation, rows: [], runs: [], cursor: null }
```

Replace with:

```ts
if (first === undefined) return { conversation, rows: [], runs: [], cursor: null, files: [] }
```

In the same file, find:

```ts
		.orderBy(asc(conversationRuns.startedAt), asc(conversationRuns.id))
	return {
		conversation,
		rows,
		runs: runs.map(({ resume, ...run }) => ({ ...toStoredRun(run), resume })),
		cursor: starts.length > page.turns ? String(first) : null,
	}
```

Replace with:

```ts
		.orderBy(asc(conversationRuns.startedAt), asc(conversationRuns.id))
	const files = await attachmentFilesOf(
		conversationId,
		rows.filter(row => row.role === 'user').map(row => row.messageId),
	)
	return {
		conversation,
		rows,
		runs: runs.map(({ resume, ...run }) => ({ ...toStoredRun(run), resume })),
		cursor: starts.length > page.turns ? String(first) : null,
		files,
	}
```

- [ ] **Step 5: The route passes them on**

In `app/api/apps/[appId]/conversations/[conversationId]/route.ts`, find:

```ts
/**
 * GET conversations/[conversationId] (spec §4.2, §3.3): the latest turns, grouped on the server, with a "load earlier"
 * cursor and the state. A run this process lost is truncated first (§3.2 step 5), so a reload after a crash shows it
 * stopped, not running.
 */
```

Replace with:

```ts
/**
 * GET conversations/[conversationId] (spec §4.2, §3.3): the latest turns, grouped on the server, each user turn with its
 * files (2c's plan call P15), with a "load earlier" cursor and the state. A run this process lost is truncated first
 * (§3.2 step 5), so a reload after a crash shows it stopped, not running.
 */
```

In the same file, find:

```ts
			turns: turnsFromMessages(page.rows, page.runs),
```

Replace with:

```ts
			turns: turnsFromMessages(page.rows, page.runs, page.files),
```

- [ ] **Step 6: Run them to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-turn.test.ts __tests__/chat-routes.test.ts`

Expected: PASS, `Test Files  2 passed (2)`, `Tests  59 passed (59)`.

Run: `pnpm exec vitest run --project db __tests__/db/conversations-read.db.test.ts`

Expected: PASS, `Test Files  1 passed (1)`, `Tests  13 passed (13)`.

- [ ] **Step 7: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/turn.ts lib/data/conversations.ts 'app/api/apps/[appId]/conversations/[conversationId]/route.ts' __tests__/chat-turn.test.ts __tests__/chat-routes.test.ts __tests__/db/conversations-read.db.test.ts
pnpm exec oxfmt --check lib/chat/turn.ts lib/data/conversations.ts 'app/api/apps/[appId]/conversations/[conversationId]/route.ts' __tests__/chat-turn.test.ts __tests__/chat-routes.test.ts __tests__/db/conversations-read.db.test.ts
pnpm test
pnpm test:db
```

Expected: tsc exits 0; oxlint prints no finding; oxfmt "All matched files use the correct format"; `pnpm test` and `pnpm test:db` 0 failed (`lib/data/` changed).

- [ ] **Step 8: Commit**

```bash
git add lib/chat/turn.ts lib/data/conversations.ts 'app/api/apps/[appId]/conversations/[conversationId]/route.ts' __tests__/chat-turn.test.ts __tests__/chat-routes.test.ts __tests__/db/conversations-read.db.test.ts
git commit -m "feat(chat): history pages show each user turn's files

A history page now carries the files of its user messages, metadata only
and in the order they were attached, and the server's grouping puts each
on the user turn of its message, so a reload shows the files the live
turn showed. A message of files alone keeps its empty text part (Part 2
spec §3.3, §7.1; plan calls P10, P15).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the 6 files; lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": ["lib/chat/turn.ts", "lib/data/conversations.ts", "app/api/apps/[appId]/conversations/[conversationId]/route.ts", "__tests__/chat-turn.test.ts", "__tests__/chat-routes.test.ts", "__tests__/db/conversations-read.db.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-turn.test.ts __tests__/chat-routes.test.ts", "acceptanceCriteria": ["turnsFromMessages(rows, runs, files) puts each file, without messageId, on the user turn of its message in the order given; no other turn has files; a file naming no message is ignored; two arguments answer as before", "a user message '' with one file gives parts [{ kind: 'text', text: '' }], that file and turnText ''; userTurn(id, text) and userTurn(id, text, []) have no files key", "readThreadPage answers files [] for an empty conversation, and the files of the page's user messages only, by position, each { id, name, kind, mime, size, messageId }", "GET conversations/[conversationId] calls turnsFromMessages(page.rows, page.runs, page.files)", "tsc exits 0, pnpm test and pnpm test:db 0 failed, oxlint and oxfmt clean"], "modelTier": "standard"}
```

---

### Task 11: The composer's files and file-only sends

**Goal:** In an AG-UI app's chat the Sender takes files (X `Attachments` in a `Sender.Header`, a prefix button with a `Badge`, paste and drop), uploads each one when it is picked, shows a refusal on its card and deletes a removed one, sends the stored files with the message by their ids (or alone, with no text), and the local user bubble carries the files; the Dify chat's Sender behaves exactly as before.

Spec §7.1 ("**UI:** X `Attachments` in the `Sender.Header`, as the Dify chat's `sender-attachments.tsx`, limited to the app's allowed kinds"; "**Upload:** `POST /api/apps/[appId]/attachments`, one multipart part named `file`"), decision 69 (2) ("a message may carry files and no text") and plan calls P12 (file-only messages, `ChatSender`'s `canSendEmpty`), P13 (the composer's files: the Dify pattern on the hub's routes, upload at pick, a refusal kept on its card, Send waiting with the Dify chat's toasts, a removed card deleted), P6 (the "Only the first 100,000 characters are sent" note on a cut file's card) and P15 (the local bubble's files). Docs checked: X 2.9.0's Sender demo "Disable Ctrl" (`packages/x/components/sender/demo/disable-ctrl.tsx` at `fc3a0cc7`, `gh api repos/ant-design/x/contents/…`: `const submitDisabled = items.length === 0 && !value && !loading` and `suffix={(_, info) => … <SendButton disabled={submitDisabled} />}`), and why it governs Enter too: `node_modules/@ant-design/x/es/sender/components/ActionButton.js` lines 19–22 (`restProps.disabled ?? rootDisabled ?? context.onSendDisabled`, reported through `setSubmitDisabled`), `es/sender/Sender.js` lines 133–137 (`triggerSend` checks `!submitDisabled`) and 184 (X's own rule `onSendDisabled: !innerValue`, untrimmed); an explicit `disabled={false}` would also override a disabled Sender, so `ChatSender` folds its own `disabled` in. X's Sender demo "paste-image" (same commit: `Sender.Header … forceRender`, `onPasteFile` → `attachmentsRef.current?.upload(file)`), which the Dify chat's `useSenderAttachments` follows. X 2.9.0 `Attachments` (`es/attachments/index.d.ts`, `index.js` line 98: `onItemRemove` runs `Promise.resolve(onRemove(item)).then(ret => { if (ret === false) return; … })`, so a rejected promise keeps the card too; `FileList/index.js` lines 36–44: an item's own `description` first, then `percent%` while uploading, then a failed item's string `response`). antd 6.6.5 `Upload` (`npx -y @ant-design/cli doc Upload --version 6.6.5`): `beforeUpload` "When returned value is `Upload.LIST_IGNORE`, the list of files that have been uploaded will ignore it"; `customRequest` replaces the XHR with `onSuccess(body)` and `onError(event, body)`; `accept` as an `AcceptObject` whose `filter: 'native'` "uses browser native filtering behavior"; `onRemove` "remove event will be prevented when the return value is false or a Promise which resolve(false) or reject"; `maxCount` "Limit the number of uploaded files"; and the FAQ "`onChange` will only trigger when the file is in the list, it will ignore any events removed from the list" (`node_modules/antd/es/upload/Upload.js` line 194: `onSuccess` returns for a removed file), which is why a card removed while it uploads has its stored file deleted when the answer comes. antd `Badge` (`doc Badge`: `count` hidden at zero unless `showZero`, `size="small"`). MDN "Using FormData objects": with `fetch` and `multipart/form-data`, "_do not_ explicitly set the `Content-Type` header", so the browser writes the boundary. Task 1 gives the rules (`claimedKind`, `allowedKinds`, `acceptOf`, `KIND_EXTENSIONS`, `extensionOf`, `ATTACHMENT_MAX_BYTES`, `ATTACHMENTS_PER_MESSAGE`, `UploadedAttachment`, `TurnFile`), Task 2 the DTO's `attachments` (`AguiChatApp['attachments']`), Task 7 the upload route and the text of each attachment code (`shared_chat.error.<code>` in en, zh and ar, spread into run-error.ts's `HUB_CODE_KEYS`), so a refused upload's card is worded by `requestFailureText`, as a refused run is, Task 8 the delete route, Task 9 the run body's `attachmentIds`, Task 10 `Turn.files` and `userTurn`'s third argument. Unlike the Dify chat, whose kinds arrive from Dify's parameters after the page has loaded, the AG-UI chat knows its kinds on the server, so its `Sender.Header` would be server-rendered: X's header is an rc-motion `CSSMotion` (`node_modules/@ant-design/x/es/sender/SenderHeader.js`), which renders the closed panel with `forceRender` on the server but nothing in the browser's first render (`@rc-component/motion` `useStatus`: before mount, with motion supported and `motionAppear`, its style step is `'NONE'`), a hydration mismatch; the hook renders the header after hydration, the two-pass rendering of react.dev `hydrateRoot` ("Handling different client and server content") that `components/admin/client-date-time.tsx` uses. The Dify chat is left as it is (spec §5.1: Part 3 replaces it): `useSenderAttachments` and `useDifyUpload` stay, and only their helpers that are not Dify's are imported (`formatCount`; `withinLimit` is not needed, since the contract's `preCheck` counts the files ahead). The rules are pure (`attachment-items.ts`) and unit-tested, as is the client; the hook and the view are proven in the browser by Task 19 (`e2e/agui-files.spec.ts`: a refused send keeps its files, a file-only send, a removed card). Task 12 renders the bubble's files; Task 16's drawer reuses `UserTurn`.

**Files:**

- Create: `components/shared-chat/attachment-items.ts` (`preCheck`, `preCheckAll`, `refusalKey`, `uploadedOf`, `itemDescriptionKey`, `toTurnFile`)
- Create: `components/shared-chat/hooks/use-shared-attachments.tsx`
- Modify: `components/shared-chat/api.ts` (the whole file: `uploadAttachment`, `deleteAttachment`, `attachmentUrl`)
- Modify: `components/shared-chat/provider/ag-ui-chat-provider.ts` (`SharedChatInput.message`, `transformParams`, `transformLocalMessage`)
- Modify: `components/shared-chat/hooks/use-shared-chat.ts` (`send(text, files?)`)
- Modify: `components/shared-chat/shared-chat.tsx` (the hook, the send, the Sender's props)
- Modify: `components/chat/chat-view/chat-sender.tsx` (the whole file: `canSendEmpty`)
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (`shared_chat.attachment_truncated`)
- Test: `__tests__/shared-chat-attachment-items.test.ts` (the whole file, below)
- Test: `__tests__/shared-chat-api.test.ts` (the whole file, below)
- Test: `__tests__/shared-chat-provider.test.ts` (new cases)

**Acceptance Criteria:**

- [ ] A refused upload's card text is `requestFailureText(error, t, t('common.request_failed_retry'))` (run-error.ts: every attachment code by its `shared_chat.error.<code>` key since Task 7, the access codes and `conversation_not_found` by theirs, anything else the generic text); `refusalKey` words the browser's own refusals: `type` → `common.unsupported_file_type`, `too_large` → `shared_chat.error.attachment_too_large`, `too_many` → `sender.too_many_files`, each defined in en, zh and ar.
- [ ] `preCheck(file, allowed, count)` answers `'type'` for a name that claims no kind the app allows (`anim.gif`, `README`, a `.png` with images off, a `.txt` with documents off), then `'too_large'` above 5 MB (5 MB exactly passes), then `'too_many'` when `count` is 5, else `'ok'`; `preCheckAll` counts a batch in order, a refused file taking no place (`[a.png, b.exe, c.md, d.pdf, e.txt]` after 2 files: `ok, type, ok, ok, too_many`).
- [ ] `uploadedOf` answers the route's attachment for a `done` item whose `response` has a string `id`, else `undefined`; `itemDescriptionKey` answers `sender.uploading` while an item uploads, `shared_chat.attachment_truncated` for a stored file with `truncated: true`, else `undefined`; `toTurnFile` drops `truncated`.
- [ ] `createSharedChatApi('app 1').uploadAttachment(file, 'conv-1')` POSTs a `FormData` with `file` (its name kept) and `conversationId` to `/api/apps/app%201/attachments` with no Content-Type header, sends no `conversationId` when none is given, resolves the 201 body and rejects a 413 with a `RequestError` whose `code` is `attachment_too_large`; `deleteAttachment('att 1')` sends `DELETE /api/apps/app%201/attachments/att%201` and resolves on 204; `attachmentUrl('att 1')` is `/api/apps/app%201/attachments/att%201` and fetches nothing.
- [ ] `transformParams` sends `message: { text, attachmentIds }` when the message holds at least one id and `message: { text }` otherwise, never `files`; `transformLocalMessage` answers `userTurn('local', text, files)`.
- [ ] `ChatSender` gains `canSendEmpty?: boolean`: given, its suffix renders X's `SendButton` with `disabled={Boolean(disabled) || (!canSendEmpty && !value.trim())}` and `onSubmit` passes a blank text on when `canSendEmpty` is true; left out, the suffix and the submit rule are as before; `grep -c canSendEmpty components/chat/chat-view/chat-view.tsx` prints `0`.
- [ ] `SharedChat` calls `useSharedAttachments({ allowed: app.attachments, senderRef, upload, remove: api.deleteAttachment })` with `upload = file => api.uploadAttachment(file, getConversationId(activeKey))`, passes its `header`, `prefix` and `onPasteFile` and `canSendEmpty={files.length > 0 && ready}` to `ChatSender`; a send while a file uploads or failed shows `sender.wait_for_uploads` or `sender.remove_failed_uploads` and answers false; a taken send calls `chat.send(text, files)`, scrolls to the bottom and resets the attachments, and an ignored one keeps them.
- [ ] `shared_chat.attachment_truncated` is "Only the first 100,000 characters are sent" in en, with zh and Modern Standard Arabic.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the changed files; `pnpm i18n:lint` passes; `npx -y @ant-design/cli lint ./ --format json` reports `"total": 0`; `pnpm test:e2e e2e/chat-files.spec.ts e2e/agui-chat.spec.ts e2e/agui-hitl.spec.ts --project desktop-light` passes (the Dify chat's files and the 2a and 2b AG-UI specs stay green), and its web server logs no `Hydration failed` (the header is rendered after hydration).

**Verify:** `pnpm exec vitest run --project unit __tests__/shared-chat-attachment-items.test.ts __tests__/shared-chat-api.test.ts __tests__/shared-chat-provider.test.ts __tests__/i18n-locales.test.ts` → `Test Files  4 passed (4)`, `Tests  49 passed (49)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `__tests__/shared-chat-attachment-items.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	itemDescriptionKey,
	preCheck,
	preCheckAll,
	refusalKey,
	toTurnFile,
	uploadedOf,
} from '@/components/shared-chat/attachment-items'
import { ATTACHMENT_MAX_BYTES, type UploadedAttachment } from '@/lib/chat/attachment-rules'
import ar from '@/locales/ar/translation.json'
import en from '@/locales/en/translation.json'
import zh from '@/locales/zh/translation.json'

/** A dotted key's value in a locale file, or undefined. */
const valueOf = (tree: object, key: string): unknown =>
	key
		.split('.')
		.reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree)

const file = (name: string, size = 1) => new File([new Uint8Array(size)], name)
const all = { images: true, documents: true }
const imagesOnly = { images: true, documents: false }
const documentsOnly = { images: false, documents: true }

const uploaded: UploadedAttachment = {
	id: 'a1',
	name: 'notes.md',
	kind: 'text',
	mime: 'text/markdown; charset=utf-8',
	size: 12,
	truncated: false,
}

// Plan call P13: the browser's own refusals, worded as the Dify chat words them and as the route words a large file.
describe('refusalKey', () => {
	it.each([
		['type', 'common.unsupported_file_type'],
		['too_large', 'shared_chat.error.attachment_too_large'],
		['too_many', 'sender.too_many_files'],
	] as const)('words %s by %s, in en, zh and ar', (check, key) => {
		expect(refusalKey(check)).toBe(key)
		for (const locale of [en, zh, ar]) expect(valueOf(locale, key)).toEqual(expect.any(String))
	})
})

// Spec §7.1, P3, P8: what the browser can refuse before uploading; the route checks the same again.
describe('preCheck', () => {
	it('takes a file whose extension claims an allowed kind, whatever its case', () => {
		expect(preCheck(file('photo.PNG'), imagesOnly, 0)).toBe('ok')
		expect(preCheck(file('report.pdf'), documentsOnly, 0)).toBe('ok')
		expect(preCheck(file('data.csv'), documentsOnly, 4)).toBe('ok')
	})
	it('refuses a kind the app does not allow, and a name that claims none', () => {
		expect(preCheck(file('photo.png'), documentsOnly, 0)).toBe('type')
		expect(preCheck(file('notes.txt'), imagesOnly, 0)).toBe('type')
		expect(preCheck(file('anim.gif'), all, 0)).toBe('type')
		expect(preCheck(file('README'), all, 0)).toBe('type')
	})
	it('refuses a file over 5 MB, and takes one of exactly 5 MB', () => {
		expect(preCheck(file('big.pdf', ATTACHMENT_MAX_BYTES + 1), all, 0)).toBe('too_large')
		expect(preCheck(file('edge.pdf', ATTACHMENT_MAX_BYTES), all, 0)).toBe('ok')
	})
	it('refuses a sixth file of a message', () => {
		expect(preCheck(file('six.txt'), all, 5)).toBe('too_many')
	})
	it('names the kind before the size and the count', () => {
		expect(preCheck(file('big.gif', ATTACHMENT_MAX_BYTES + 1), all, 5)).toBe('type')
		expect(preCheck(file('big.txt', ATTACHMENT_MAX_BYTES + 1), all, 5)).toBe('too_large')
	})
})

describe('preCheckAll', () => {
	it('counts a batch in order, the refused files taking no place', () => {
		const batch = [file('a.png'), file('b.exe'), file('c.md'), file('d.pdf'), file('e.txt')]
		expect(preCheckAll(batch, all, 2)).toEqual(['ok', 'type', 'ok', 'ok', 'too_many'])
		expect(preCheckAll([], all, 5)).toEqual([])
	})
})

describe('uploadedOf', () => {
	it('answers the route’s attachment for a done item', () => {
		expect(uploadedOf({ status: 'done', response: uploaded })).toBe(uploaded)
	})
	it('answers nothing for an item that uploads, failed, or holds no attachment', () => {
		expect(uploadedOf({ status: 'uploading' })).toBeUndefined()
		expect(uploadedOf({ status: 'error', response: 'The file could not be read' })).toBeUndefined()
		expect(uploadedOf({ status: 'done', response: 'text' })).toBeUndefined()
		expect(uploadedOf({ status: 'done', response: null })).toBeUndefined()
		expect(uploadedOf({ status: 'done' })).toBeUndefined()
	})
})

// P6: a cut file says so on its card; the Dify chat's "Uploading..." while the upload runs.
describe('itemDescriptionKey', () => {
	it('says an item uploads, and that a file’s text was cut', () => {
		expect(itemDescriptionKey({ status: 'uploading' })).toBe('sender.uploading')
		expect(itemDescriptionKey({ status: 'done', response: { ...uploaded, truncated: true } })).toBe(
			'shared_chat.attachment_truncated',
		)
	})
	it('leaves a whole file and a failed one to X’s own text', () => {
		expect(itemDescriptionKey({ status: 'done', response: uploaded })).toBeUndefined()
		expect(itemDescriptionKey({ status: 'error', response: 'Refused' })).toBeUndefined()
	})
	it('names keys that exist in en, zh and ar', () => {
		for (const key of ['sender.uploading', 'shared_chat.attachment_truncated'])
			for (const locale of [en, zh, ar]) expect(valueOf(locale, key)).toEqual(expect.any(String))
	})
})

describe('toTurnFile', () => {
	it('keeps what the bubble shows and drops `truncated`', () => {
		expect(toTurnFile({ ...uploaded, truncated: true })).toEqual({
			id: 'a1',
			name: 'notes.md',
			kind: 'text',
			mime: 'text/markdown; charset=utf-8',
			size: 12,
		})
	})
})
```

Create `__tests__/shared-chat-api.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSharedChatApi } from '@/components/shared-chat/api'
import { RequestError } from '@/lib/http/browser'

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
const lastCall = () => {
	const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined]
	return { url, init: init ?? {} }
}
const api = createSharedChatApi('app 1')
const uploaded = {
	id: 'att-1',
	name: 'notes.md',
	kind: 'text',
	mime: 'text/markdown; charset=utf-8',
	size: 1,
	truncated: false,
}

// Part 2 spec §7.1; plan calls P13, P14, P22: the attachment routes, uploaded as the Dify browser client does.
describe('createSharedChatApi: attachments', () => {
	it('uploads one file part, with the conversation id when there is one', async () => {
		fetchMock.mockImplementation(() => jsonResponse(201, uploaded))
		await expect(api.uploadAttachment(new File(['x'], 'notes.md'), 'conv-1')).resolves.toEqual(
			uploaded,
		)
		expect(lastCall().url).toBe('/api/apps/app%201/attachments')
		expect(lastCall().init.method).toBe('POST')
		const form = lastCall().init.body as FormData
		expect(form.get('file')).toBeInstanceOf(File)
		expect((form.get('file') as File).name).toBe('notes.md')
		expect(form.get('conversationId')).toBe('conv-1')
		// The browser writes the multipart boundary itself (MDN, "Using FormData objects").
		expect(new Headers(lastCall().init.headers).has('content-type')).toBe(false)
		await api.uploadAttachment(new File(['x'], 'notes.md'))
		expect((lastCall().init.body as FormData).has('conversationId')).toBe(false)
	})
	it('rejects a refused upload with the envelope’s code', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(413, { code: 'attachment_too_large', message: 'Too large', status: 413 }),
		)
		const failure = await api.uploadAttachment(new File(['x'], 'big.pdf')).catch(error => error)
		expect(failure).toBeInstanceOf(RequestError)
		expect(failure).toMatchObject({ status: 413, code: 'attachment_too_large' })
	})
	it('deletes an unsent file, and rejects a refusal', async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
		await expect(api.deleteAttachment('att 1')).resolves.toBeUndefined()
		expect(lastCall().url).toBe('/api/apps/app%201/attachments/att%201')
		expect(lastCall().init.method).toBe('DELETE')
		fetchMock.mockResolvedValue(
			jsonResponse(404, { code: 'attachment_not_found', message: 'Gone', status: 404 }),
		)
		await expect(api.deleteAttachment('att-1')).rejects.toMatchObject({
			code: 'attachment_not_found',
		})
	})
	it('names the serve route of a file, encoded', () => {
		expect(api.attachmentUrl('att 1')).toBe('/api/apps/app%201/attachments/att%201')
		expect(fetchMock).not.toHaveBeenCalled()
	})
})
```

In `__tests__/shared-chat-provider.test.ts`, find:

```ts
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import { INVALID_QUESTION_CONTENT } from '@/lib/chat/statuses'
```

Replace with:

```ts
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import type { TurnFile } from '@/lib/chat/attachment-rules'
import { INVALID_QUESTION_CONTENT } from '@/lib/chat/statuses'
```

Find:

```ts
const hubRun = {
	type: 'CUSTOM',
```

Replace with:

```ts
/** A sent file as the composer hands it over (plan call P15). */
const pdf: TurnFile = {
	id: 'att-1',
	name: 'report.pdf',
	kind: 'document',
	mime: 'application/pdf',
	size: 2048,
}

const hubRun = {
	type: 'CUSTOM',
```

Find (the end of the test "sends no conversation id for a new chat"):

```ts
		expect(provider.transformParams({ message: { text: 'hi' } })).toEqual({
			message: { text: 'hi' },
		})
	})
```

Replace with:

```ts
		expect(provider.transformParams({ message: { text: 'hi' } })).toEqual({
			message: { text: 'hi' },
		})
	})
	// Spec §7.1, plan call P12: the files go as their ids, and a message may be files alone.
	it('sends the files’ ids with the message, and never their client-only metadata', () => {
		const body = makeProvider().transformParams({
			message: { text: '', attachmentIds: ['att-1', 'att-2'], files: [pdf] },
		})
		expect(body).toEqual({
			conversationId: 'conv-1',
			message: { text: '', attachmentIds: ['att-1', 'att-2'] },
		})
		expect(body.message).not.toHaveProperty('files')
	})
	it('sends no attachmentIds for a message without files', () => {
		expect(makeProvider().transformParams({ message: { text: 'hi', attachmentIds: [] } })).toEqual({
			conversationId: 'conv-1',
			message: { text: 'hi' },
		})
	})
```

Find:

```ts
		expect(provider.transformLocalMessage({ answers: { resume: [] } })).toEqual([])
	})
```

Replace with:

```ts
		expect(provider.transformLocalMessage({ answers: { resume: [] } })).toEqual([])
	})
	// Plan call P15: the bubble shows the files at once, before the server stores the message.
	it('shows a message’s files in its user turn', () => {
		const turn = makeProvider().transformLocalMessage({
			message: { text: 'Read this', attachmentIds: ['att-1'], files: [pdf] },
		})
		expect(turn).toEqual(userTurn('local', 'Read this', [pdf]))
		expect((turn as Turn).files).toEqual([pdf])
	})
```

Each of these four texts occurs once in the file.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-attachment-items.test.ts __tests__/shared-chat-api.test.ts __tests__/shared-chat-provider.test.ts`

Expected: FAIL, `Test Files  3 failed (3)`, `Tests  6 failed | 18 passed (24)`: `shared-chat-attachment-items.test.ts` does not load (`Cannot find package '@/components/shared-chat/attachment-items'`), the four API cases fail with `TypeError: api.uploadAttachment is not a function` (and `deleteAttachment`, `attachmentUrl`), and the provider's two new cases with `AssertionError: expected { conversationId: 'conv-1', …(1) } to deeply equal …` and `expected { role: 'user', …(4) } to deeply equal { role: 'user', …(5) }`. ("sends no attachmentIds for a message without files" already passes: 2a's body names the text alone.)

- [ ] **Step 3: The truncation note's text (P6)**

Each locale's `shared_chat` section starts with `stopped_time_limit` and `answer_pending_hint`; the new key goes after the second.

`locales/en/translation.json`, find:

```json
		"answer_pending_hint": "Answer the agent above to continue.",
```

Replace with:

```json
		"answer_pending_hint": "Answer the agent above to continue.",
		"attachment_truncated": "Only the first 100,000 characters are sent",
```

`locales/zh/translation.json`, find:

```json
		"answer_pending_hint": "请先回应上方的智能体，然后继续。",
```

Replace with:

```json
		"answer_pending_hint": "请先回应上方的智能体，然后继续。",
		"attachment_truncated": "仅发送前 100,000 个字符",
```

`locales/ar/translation.json` (Modern Standard Arabic, ADR-0005), find:

```json
		"answer_pending_hint": "أجب الوكيل أعلاه للمتابعة.",
```

Replace with:

```json
		"answer_pending_hint": "أجب الوكيل أعلاه للمتابعة.",
		"attachment_truncated": "يُرسَل أول 100,000 حرف فقط",
```

The other texts the composer shows are keys that exist: the Dify chat's `sender.attach`, `sender.upload_file`, `sender.upload_hint`, `sender.drop_hint`, `sender.supported_types`, `sender.uploading`, `sender.too_many_files`, `sender.wait_for_uploads`, `sender.remove_failed_uploads` and `common.unsupported_file_type`, and Task 7's `shared_chat.error.<code>` for a refused upload, through `requestFailureText` (`shared_chat.error.attachment_too_large` also words the browser's own refusal of a file over 5 MB). No e2e text changes.

- [ ] **Step 4: The composer's rules**

Create `components/shared-chat/attachment-items.ts`:

```ts
import {
	ATTACHMENT_MAX_BYTES,
	ATTACHMENTS_PER_MESSAGE,
	allowedKinds,
	claimedKind,
	type AttachmentKindsAllowed,
	type TurnFile,
	type UploadedAttachment,
} from '@/lib/chat/attachment-rules'

/*
 * The composer's files as pure rules (Part 2 spec §7.1; plan call P13), which useSharedAttachments applies to X
 * Attachments' items (antd UploadFile: `status` `uploading | done | error | removed`, the answer in `response`). A
 * refusal from the routes is worded by run-error.ts's requestFailureText, as a refused run is.
 */

/** A file the browser can refuse before it uploads it; the server checks the same again (P3, P8). */
export type PreCheck = 'ok' | 'type' | 'too_large' | 'too_many'

/**
 * The message for a file the browser refuses itself: the Dify chat's texts for a type and for too many files (they
 * take `ext` and `limit`), and the upload route's own text for a file over 5 MB (P4's `attachment_too_large`).
 */
const REFUSAL_KEYS = {
	type: 'common.unsupported_file_type',
	too_large: 'shared_chat.error.attachment_too_large',
	too_many: 'sender.too_many_files',
} as const satisfies Record<Exclude<PreCheck, 'ok'>, string>

export const refusalKey = (check: Exclude<PreCheck, 'ok'>) => REFUSAL_KEYS[check]

/**
 * Whether a picked file may upload (P3, spec §7.1): its name claims a kind the app allows, it is at most
 * ATTACHMENT_MAX_BYTES, and fewer than ATTACHMENTS_PER_MESSAGE files are ahead of it (`count`: the list's, and those
 * before it in its batch that passed).
 */
export const preCheck = (file: File, allowed: AttachmentKindsAllowed, count: number): PreCheck => {
	const kind = claimedKind(file.name)
	if (!kind || !allowedKinds(allowed).includes(kind)) return 'type'
	if (file.size > ATTACHMENT_MAX_BYTES) return 'too_large'
	return count >= ATTACHMENTS_PER_MESSAGE ? 'too_many' : 'ok'
}

/** preCheck over files picked together, in order: each one that passes takes a place (the Dify chat's rule). */
export const preCheckAll = (
	files: readonly File[],
	allowed: AttachmentKindsAllowed,
	count: number,
): PreCheck[] => {
	let ahead = count
	return files.map(file => {
		const check = preCheck(file, allowed, ahead)
		if (check === 'ok') ahead += 1
		return check
	})
}

/** An item the upload route stored: `done`, with the route's answer as its `response`; undefined otherwise. */
export const uploadedOf = (item: {
	status?: string
	response?: unknown
}): UploadedAttachment | undefined => {
	const answer = item.response as Partial<UploadedAttachment> | null | undefined
	return item.status === 'done' && typeof answer?.id === 'string'
		? (answer as UploadedAttachment)
		: undefined
}

/**
 * The text an item's card shows below its name (X Attachments: an item's own `description` first): "Uploading…" while
 * it uploads, since the upload reports no progress (the Dify chat's rule), and P6's note when the file's text was cut.
 * Any other item has none of its own: a failed one then shows its `response` text.
 */
export const itemDescriptionKey = (item: {
	status?: string
	response?: unknown
}): 'sender.uploading' | 'shared_chat.attachment_truncated' | undefined => {
	if (item.status === 'uploading') return 'sender.uploading'
	return uploadedOf(item)?.truncated ? 'shared_chat.attachment_truncated' : undefined
}

/** What the local bubble keeps of an uploaded file (P15): the TurnFile, without the upload's `truncated`. */
export const toTurnFile = ({ id, name, kind, mime, size }: UploadedAttachment): TurnFile => ({
	id,
	name,
	kind,
	mime,
	size,
})
```

- [ ] **Step 5: The attachment routes in the browser client**

Replace the whole of `components/shared-chat/api.ts` with:

```ts
// Client-safe: the type imports below are erased (TypeScript `import type`), so no server module reaches the bundle.
// The browser's way to the shared chat's read, stop and attachment routes (Part 2 spec §4.2, §7.1): every method
// resolves the typed body and rejects with RequestError (lib/http/browser.ts) on a non-OK answer, as the Dify browser
// client does (lib/providers/dify/browser.ts).
import type { UploadedAttachment } from '@/lib/chat/attachment-rules'
import type { HistoryTurn } from '@/lib/chat/turn'
import type { ConversationListItem } from '@/lib/data/conversations'
import { readRequestError } from '@/lib/http/browser'

/** GET /api/apps/[appId]/conversations (spec §4.2; plan call P8). */
export interface ConversationsPage {
	items: ConversationListItem[]
	nextCursor: string | null
}

/** GET /api/apps/[appId]/conversations/[conversationId]: the latest turns, or those before `cursor` (plan call P8). */
export interface ConversationPage {
	id: string
	title: string
	state: unknown
	turns: HistoryTurn[]
	cursor: string | null
}

const segment = (value: string) => encodeURIComponent(value)

export const createSharedChatApi = (appId: string) => {
	const base = `/api/apps/${segment(appId)}`
	const request = async (path: string, init?: RequestInit): Promise<Response> => {
		const response = await fetch(`${base}${path}`, init)
		if (!response.ok) throw await readRequestError(response)
		return response
	}
	return {
		listConversations: () =>
			request('/conversations').then(response => response.json() as Promise<ConversationsPage>),
		getConversation: (conversationId: string, before?: string) =>
			request(
				`/conversations/${segment(conversationId)}${before ? `?before=${segment(before)}` : ''}`,
			).then(response => response.json() as Promise<ConversationPage>),
		/** Spec §4.5: the route answers 204, also for a run that has already ended. */
		stopRun: async (conversationId: string, runId: string): Promise<void> => {
			await request(`/conversations/${segment(conversationId)}/runs/${segment(runId)}/stop`, {
				method: 'POST',
			})
		},
		/**
		 * Spec §7.1, plan calls P8 and P13: one multipart part `file` (the Dify client's `filePart`), and the conversation's
		 * id when it has one, so the route checks its cap early. No Content-Type header: the browser writes the multipart
		 * boundary itself (MDN, "Using FormData objects").
		 */
		uploadAttachment: (file: File, conversationId?: string) => {
			const form = new FormData()
			form.append('file', file, file.name)
			if (conversationId) form.append('conversationId', conversationId)
			return request('/attachments', { method: 'POST', body: form }).then(
				response => response.json() as Promise<UploadedAttachment>,
			)
		},
		/** Plan call P22: deletes the actor's own unsent file; the route answers 204. */
		deleteAttachment: async (attachmentId: string): Promise<void> => {
			await request(`/attachments/${segment(attachmentId)}`, { method: 'DELETE' })
		},
		/** Plan call P14: where a sent file is served back (an image inline, any other file as a download). */
		attachmentUrl: (attachmentId: string) => `${base}/attachments/${segment(attachmentId)}`,
	}
}

export type SharedChatApi = ReturnType<typeof createSharedChatApi>
```

- [ ] **Step 6: The run body's files (P12) and the local bubble's (P15)**

In `components/shared-chat/provider/ag-ui-chat-provider.ts`, find:

```ts
import { withSentAnswers, type SentAnswer } from '@/lib/chat/sent-answers'
```

Replace with:

```ts
import type { TurnFile } from '@/lib/chat/attachment-rules'
import { withSentAnswers, type SentAnswer } from '@/lib/chat/sent-answers'
```

Find:

```ts
/** The run route's body (spec §4.2), plus one client-only field that transformParams never sends. */
export interface SharedChatInput {
	conversationId?: string
	message?: { text: string }
```

Replace with:

```ts
/** The run route's body (spec §4.2), plus client-only fields that transformParams never sends. */
export interface SharedChatInput {
	conversationId?: string
	message?: {
		text: string
		/** Spec §7.1, plan call P12: the uploaded files the message carries, in the order attached. */
		attachmentIds?: string[]
		/** Client-only: the files the local bubble shows (P15); transformParams never sends them. */
		files?: TurnFile[]
	}
```

Find:

```ts
if (answers) body.answers = answers
else body.message = { text: requestParams.message?.text ?? '' }
return body
```

Replace with:

```ts
if (answers) body.answers = answers
else {
	// P12: the files' ids only when there are any (the route takes 1 to 5), never their metadata.
	const { text = '', attachmentIds } = requestParams.message ?? {}
	body.message = attachmentIds?.length ? { text, attachmentIds } : { text }
}
return body
```

Find:

```ts
// The server mints the stored message's id; the page session's bubble has its own X id.
return userTurn('local', requestParams.message?.text ?? '')
```

Replace with:

```ts
// The server mints the stored message's id; the page session's bubble has its own X id. Its files show at once (P15).
return userTurn('local', requestParams.message?.text ?? '', requestParams.message?.files)
```

- [ ] **Step 7: `send` takes the uploaded files**

In `components/shared-chat/hooks/use-shared-chat.ts`, find:

```ts
import { createQueuedSends, type QueuedSends } from '@/components/chat/hooks/queued-sends'
import { emptyAssistantTurn, type HubRunValue, type Turn } from '@/lib/chat/turn'
```

Replace with:

```ts
import { createQueuedSends, type QueuedSends } from '@/components/chat/hooks/queued-sends'
import type { UploadedAttachment } from '@/lib/chat/attachment-rules'
import { emptyAssistantTurn, type HubRunValue, type Turn } from '@/lib/chat/turn'
```

Find:

```ts
import type { SharedChatApi } from '../api'
import { createHubFetch, runsUrl } from '../hub-fetch'
```

Replace with:

```ts
import type { SharedChatApi } from '../api'
import { toTurnFile } from '../attachment-items'
import { createHubFetch, runsUrl } from '../hub-fetch'
```

Find:

```ts
	/** Sends, or queues while the history loads (sendDecision); false when the send was ignored. */
	const send = useCallback(
		(text: string) => {
```

Replace with:

```ts
	/**
	 * Sends, or queues while the history loads (sendDecision); false when the send was ignored. The uploaded `files` go
	 * as their ids, and the local bubble shows them (spec §7.1; plan calls P12, P15).
	 */
	const send = useCallback(
		(text: string, files: readonly UploadedAttachment[] = []) => {
```

Find:

```ts
const request: Partial<SharedChatInput> = { message: { text } }
```

Replace with:

```ts
const request: Partial<SharedChatInput> = {
	message: files.length
		? { text, attachmentIds: files.map(file => file.id), files: files.map(toTurnFile) }
		: { text },
}
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-attachment-items.test.ts __tests__/shared-chat-api.test.ts __tests__/shared-chat-provider.test.ts __tests__/i18n-locales.test.ts`

Expected: PASS, `Test Files  4 passed (4)`, `Tests  49 passed (49)` (15 in `shared-chat-attachment-items.test.ts`, 4 in `shared-chat-api.test.ts`, 20 in `shared-chat-provider.test.ts`, 10 in `i18n-locales.test.ts`).

- [ ] **Step 9: `canSendEmpty` on the shared Sender (P12)**

Replace the whole of `components/chat/chat-view/chat-sender.tsx` with:

```tsx
'use client'

import { Sender, type SenderProps } from '@ant-design/x'
import { Flex, type GetRef } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export type SenderRef = GetRef<typeof Sender>

export interface ChatSenderProps {
	loading: boolean
	disabled?: boolean
	/** Replaces the usual placeholder (`chat.send_placeholder`), e.g. to say why the box is disabled. */
	placeholder?: string
	initialValue?: string
	senderRef: React.RefObject<SenderRef | null>
	/** Resolves false when the message was not taken (the text then stays in the box). */
	onSend: (text: string) => Promise<boolean> | boolean
	onStop: () => void
	header?: SenderProps['header']
	prefix?: SenderProps['prefix']
	allowSpeech?: SenderProps['allowSpeech']
	/** The recorded speech is being transcribed: the speech button waits meanwhile. */
	transcribing?: boolean
	onPasteFile?: SenderProps['onPasteFile']
	/**
	 * Part 2 plan call P12 (decision 69: a message may be files alone): true while files are ready to go, so Send and
	 * Enter take a blank text; false, Send waits for a text that is not blank. Left out (the Dify chat), X's own rule
	 * stands.
	 */
	canSendEmpty?: boolean
}

/** X Sender, controlled: the text is cleared only once the send was taken; cancel stops the reply. */
export default function ChatSender({
	loading,
	disabled,
	placeholder,
	initialValue = '',
	senderRef,
	onSend,
	onStop,
	header,
	prefix,
	allowSpeech,
	transcribing = false,
	onPasteFile,
	canSendEmpty,
}: ChatSenderProps) {
	const { t } = useTranslation()
	const [value, setValue] = useState(initialValue)
	// X names its speech button by the icon alone ("audio"); the documented `suffix` render takes X's own
	// action buttons (`info.components`, ButtonProps) and gives it a name from the locale (ADR-0014), as a
	// toggle (`aria-pressed`) while it records. The send and stop buttons stay X's.
	const recording = typeof allowSpeech === 'object' && Boolean(allowSpeech.recording)
	const speechLabel = transcribing ? t('sender.recognizing') : t('sender.voice_input')
	// X's Sender demo "Disable Ctrl": the SendButton's own `disabled` wins over the Sender's `!value` and reaches Enter
	// too (X 2.9 ActionButton: `disabled ?? rootDisabled ?? onSendDisabled`, reported through `setSubmitDisabled`). It is
	// set only when the chat passes `canSendEmpty`, and then covers the disabled Sender too, which it would override.
	const sendDisabled =
		canSendEmpty === undefined ? undefined : Boolean(disabled) || (!canSendEmpty && !value.trim())
	const suffix: SenderProps['suffix'] =
		allowSpeech || sendDisabled !== undefined
			? (_actions, { components: { SpeechButton, SendButton, LoadingButton } }) => (
					<Flex
						gap="small"
						align="center"
					>
						{allowSpeech && (
							<SpeechButton
								aria-label={speechLabel}
								title={speechLabel}
								aria-pressed={recording}
								loading={transcribing}
							/>
						)}
						{loading ? <LoadingButton /> : <SendButton disabled={sendDisabled} />}
					</Flex>
				)
			: undefined
	return (
		<Sender
			ref={senderRef}
			value={value}
			onChange={setValue}
			placeholder={placeholder ?? t('chat.send_placeholder')}
			loading={loading}
			disabled={disabled}
			header={header}
			prefix={prefix}
			suffix={suffix}
			allowSpeech={allowSpeech}
			onPasteFile={onPasteFile}
			autoSize={{ minRows: 1, maxRows: 8 }}
			onSubmit={async text => {
				if (!text.trim() && !canSendEmpty) return
				if (await onSend(text)) setValue('')
			}}
			onCancel={onStop}
		/>
	)
}
```

The Dify chat never passes `canSendEmpty`: its `sendDisabled` is `undefined`, so with speech on the suffix renders as before (`SendButton` without a `disabled` of its own reads X's `!value`), with speech off there is no suffix (X's own), and `onSubmit` drops a blank text as before.

- [ ] **Step 10: The composer's hook (P13)**

Create `components/shared-chat/hooks/use-shared-attachments.tsx`:

```tsx
'use client'

import { CloudUploadOutlined, LinkOutlined } from '@ant-design/icons'
import { Attachments, Sender, type AttachmentsProps, type SenderProps } from '@ant-design/x'
import { App, Badge, Button, Upload, type GetProp, type GetRef, type UploadProps } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import type { SenderRef } from '@/components/chat/chat-view/chat-sender'
import { formatCount } from '@/components/chat/message/workflow-summary'
import {
	ATTACHMENTS_PER_MESSAGE,
	acceptOf,
	allowedKinds,
	extensionOf,
	KIND_EXTENSIONS,
	type AttachmentKindsAllowed,
	type UploadedAttachment,
} from '@/lib/chat/attachment-rules'

import {
	itemDescriptionKey,
	preCheckAll,
	refusalKey,
	uploadedOf,
	type PreCheck,
} from '../attachment-items'
import { requestFailureText } from '../run-error'
import { toRequestError } from './chat-helpers'

type Item = GetProp<AttachmentsProps, 'items'>[number]
/** A picked file as antd hands it to `beforeUpload` and `customRequest` (RcFile: a File with its list `uid`). */
type PickedFile = Parameters<GetProp<UploadProps, 'beforeUpload'>>[0]

/** One message per kind of refusal, however many files of a batch it refuses (antd message `key`). */
const REFUSAL_KEY = 'shared-attachments-refused'

interface Options {
	/** The kinds the app takes now (the chat DTO, spec §2.2); none: no attachments at all. */
	allowed: AttachmentKindsAllowed
	senderRef: RefObject<SenderRef | null>
	/** POST …/attachments (plan call P13): resolves the stored file, rejects with RequestError. */
	upload: (file: File) => Promise<UploadedAttachment>
	/** P13: called when an uploaded card is removed; its failure is ignored (the purge catches the file). */
	remove: (attachmentId: string) => Promise<void>
}

/**
 * The shared chat's files for the next message (Part 2 spec §7.1; plan calls P6, P12, P13): the Dify chat's pattern
 * (useSenderAttachments, X's Sender demo "paste-image") on the hub's attachment routes. An X `Attachments` list in a
 * `Sender.Header` (`forceRender`, so pasted files reach it while it is closed), the prefix button that opens it with
 * the count on a `Badge`, files pasted into the box, and drops anywhere on the Sender. `beforeUpload` refuses, with a
 * message, a kind the app does not take, a file over 5 MB and a sixth file (`Upload.LIST_IGNORE` keeps it out of the
 * list); any other file uploads when it is picked (antd Upload's default, through `customRequest`). A refused upload
 * keeps its card with its code's text; removing a stored card deletes its file. `files` are the stored ones in the
 * order attached; `ready` is false while one uploads (`uploading`) or one failed; `reset` empties the list after a
 * send.
 */
export const useSharedAttachments = ({ allowed, senderRef, upload, remove }: Options) => {
	const { t, i18n } = useTranslation()
	const { message } = App.useApp()
	const [open, setOpen] = useState(false)
	const [items, setItems] = useState<Item[]>([])
	// A sent list starts afresh as a new instance (React: "resetting state with a key"), the Dify chat's rule: emptied in
	// place, X's FileCard.List would animate its cards out inside the closing header and keep them.
	const [listKey, setListKey] = useState(0)
	const attachmentsRef = useRef<GetRef<typeof Attachments>>(null)
	// Cards removed while their file uploads: antd ignores the answer of a file no longer listed (Upload FAQ, "Why will
	// the fileList that's in control not trigger onChange status update when the file is not in the list?"), so the
	// stored file is deleted when its answer comes.
	const abandoned = useRef(new Set<string>())
	// X's Sender.Header is an rc-motion CSSMotion: the server renders the closed panel (`forceRender`, display none), but
	// in the browser it renders nothing before it has mounted (its appear check), so the hydrated HTML would not match
	// (react.dev "Hydration mismatch"). The panel is rendered once the page has hydrated, as ClientDateTime renders its
	// text (react.dev hydrateRoot, "Handling different client and server content": a second pass in an Effect).
	const [hydrated, setHydrated] = useState(false)
	useEffect(() => {
		setHydrated(true)
	}, [])

	const enabled = allowed.images || allowed.documents
	const extensions = useMemo(
		() => allowedKinds(allowed).flatMap(kind => KIND_EXTENSIONS[kind]),
		[allowed],
	)
	// `filter: 'native'` leaves dropped and pasted files to `beforeUpload`, which says why it refuses one (antd Upload,
	// AcceptObject; the Dify chat's useDifyUpload).
	const accept = useMemo(
		() => ({ format: acceptOf(allowed), filter: 'native' as const }),
		[allowed],
	)

	const count = items.length
	const refuse = useCallback(
		(check: Exclude<PreCheck, 'ok'>, file: File) => {
			message.error({
				key: `${REFUSAL_KEY}-${check}`,
				content: t(refusalKey(check), {
					ext: extensionOf(file.name),
					limit: formatCount(ATTACHMENTS_PER_MESSAGE, i18n.resolvedLanguage),
				}),
			})
		},
		[i18n.resolvedLanguage, message, t],
	)

	// A batch (picked or dropped together) is counted in order, the refused files taking no place (preCheckAll).
	const beforeUpload: NonNullable<UploadProps['beforeUpload']> = (file, batch) => {
		const check = preCheckAll(batch, allowed, count)[batch.indexOf(file)] ?? 'ok'
		if (check === 'ok') return true
		refuse(check, file)
		return Upload.LIST_IGNORE
	}

	const forget = useCallback(
		(attachmentId: string) => void remove(attachmentId).catch(() => undefined),
		[remove],
	)

	const customRequest: NonNullable<UploadProps['customRequest']> = ({
		file,
		onSuccess,
		onError,
	}) => {
		const picked = file as PickedFile
		upload(picked).then(
			answer => {
				onSuccess?.(answer)
				if (abandoned.current.delete(picked.uid)) forget(answer.id)
			},
			(error: unknown) => {
				abandoned.current.delete(picked.uid)
				const failure = toRequestError(error)
				// The list shows a failed item's string `response` as its text (X Attachments FileList): a hub code by its
				// key (run-error.ts words every attachment code, spec §8), anything else the generic text.
				onError?.(failure, requestFailureText(failure, t, t('common.request_failed_retry')))
			},
		)
	}

	// An item's text below its name (itemDescriptionKey): each change replaces the one it had. A file added while the
	// panel is closed (dropped on the Sender) opens it.
	const onChange: NonNullable<AttachmentsProps['onChange']> = ({ fileList }) => {
		if (fileList.length > items.length) setOpen(true)
		setItems(
			(fileList as Item[]).map(({ description: _previous, ...item }) => {
				const key = itemDescriptionKey(item)
				return key ? { ...item, description: t(key) } : item
			}),
		)
	}

	// antd Upload `onRemove`: false, or a promise that resolves false or rejects, keeps the card, so this never fails:
	// the card goes whatever the delete answers (P13).
	const onRemove = (item: Item) => {
		const stored = uploadedOf(item)
		if (stored) forget(stored.id)
		else if (item.status === 'uploading') abandoned.current.add(item.uid)
		return true
	}

	// Pasted files go through the list's own upload (AttachmentsRef.upload), each a batch of one: they are checked here
	// together, as one batch, and only those that pass are handed over.
	const onPasteFile = useCallback(
		(files: FileList) => {
			const pasted = Array.from(files)
			const checks = preCheckAll(pasted, allowed, count)
			setOpen(true)
			pasted.forEach((file, index) => {
				const check = checks[index]
				if (check === 'ok') attachmentsRef.current?.upload(file)
				else if (check) refuse(check, file)
			})
		},
		[allowed, count, refuse],
	)

	const files = useMemo(() => items.flatMap(item => uploadedOf(item) ?? []), [items])
	const uploading = items.some(item => item.status === 'uploading')
	const failed = items.some(item => item.status === 'error')

	const reset = useCallback(() => {
		setItems([])
		setListKey(key => key + 1)
		setOpen(false)
	}, [])

	if (!enabled) {
		return {
			header: undefined,
			prefix: undefined,
			onPasteFile: undefined,
			files,
			ready: true,
			uploading: false,
			reset,
		}
	}

	const label = t('sender.attach')
	const header: SenderProps['header'] = (
		<Sender.Header
			title={t('sender.upload_file')}
			open={open}
			onOpenChange={setOpen}
			forceRender
			// X's own demo: the list's drop area fills the panel.
			styles={{ content: { padding: 0 } }}
		>
			<Attachments
				key={listKey}
				ref={attachmentsRef}
				items={items}
				maxCount={ATTACHMENTS_PER_MESSAGE}
				multiple
				accept={accept}
				beforeUpload={beforeUpload}
				customRequest={customRequest}
				onChange={onChange}
				onRemove={onRemove}
				getDropContainer={() => senderRef.current?.nativeElement}
				placeholder={type =>
					type === 'drop'
						? { title: t('sender.drop_hint') }
						: {
								icon: <CloudUploadOutlined />,
								title: t('sender.upload_hint'),
								description: t('sender.supported_types', { types: extensions.join(', ') }),
							}
				}
			/>
		</Sender.Header>
	)
	const prefix: SenderProps['prefix'] = (
		// The count of attached files while the panel is closed (antd Badge hides a zero count).
		<Badge
			size="small"
			count={open || !count ? 0 : formatCount(count, i18n.resolvedLanguage)}
		>
			<Button
				type="text"
				icon={<LinkOutlined />}
				aria-label={label}
				title={label}
				aria-expanded={open}
				onClick={() => setOpen(current => !current)}
			/>
		</Badge>
	)
	return {
		header: hydrated ? header : undefined,
		prefix,
		onPasteFile,
		files,
		ready: !uploading && !failed,
		uploading,
		reset,
	}
}
```

- [ ] **Step 11: The chat view**

In `components/shared-chat/shared-chat.tsx`, find:

```tsx
import { useExpiryClock } from './hooks/use-expiry-clock'
import { useSharedChat } from './hooks/use-shared-chat'
```

Replace with:

```tsx
import { useExpiryClock } from './hooks/use-expiry-clock'
import { useSharedAttachments } from './hooks/use-shared-attachments'
import { useSharedChat } from './hooks/use-shared-chat'
```

Find:

```tsx
 * loop (spec §6): the turn that waits gets the answers' context for its cards, and above the Sender sit the plan panel,
 * the ask_user card and, while anything is open, a visible hint (decision 50).
 */
```

Replace with:

```tsx
 * loop (spec §6): the turn that waits gets the answers' context for its cards, and above the Sender sit the plan panel,
 * the ask_user card and, while anything is open, a visible hint (decision 50). Attachments (spec §7.1): the Sender's
 * files when the app takes any kind, sent with the message or alone (plan calls P12, P13).
 */
```

Find:

```tsx
		// Spec §6.2, decision 62: a waiting ask_user call is open while the app's switch is on now.
		askUser: app.askUser,
	})
```

Replace with:

```tsx
		// Spec §6.2, decision 62: a waiting ask_user call is open while the app's switch is on now.
		askUser: app.askUser,
	})

	// Spec §7.1, plan call P13: the composer's files, when the app takes any kind. An upload names the conversation once
	// it has an id, so the route checks the conversation's cap early (P8); a new chat's files are checked when sent.
	const uploadAttachment = useCallback(
		(file: File) => api.uploadAttachment(file, getConversationId(activeKey)),
		[api, getConversationId, activeKey],
	)
	const attachments = useSharedAttachments({
		allowed: app.attachments,
		senderRef,
		upload: uploadAttachment,
		remove: api.deleteAttachment,
	})
	const {
		files: attachedFiles,
		ready: attachmentsReady,
		uploading: attachmentsUploading,
		reset: resetAttachments,
	} = attachments
	const sendToChat = chat.send
	/**
	 * False when nothing was sent, so the Sender keeps its text and the files stay (the Dify chat's rule): a file still
	 * uploads or failed (the Dify chat's toasts), or the chat ignored the send. A send that was taken empties the list.
	 */
	const send = useCallback(
		(text: string) => {
			if (!attachmentsReady) {
				toast.error(
					t(attachmentsUploading ? 'sender.wait_for_uploads' : 'sender.remove_failed_uploads'),
				)
				return false
			}
			const sent = sendToChat(text, attachedFiles)
			if (sent) {
				// A sent message brings the reader to it, also from further up (chat-scroll.tsx).
				scrollRef.current?.scrollToBottom()
				resetAttachments()
			}
			return sent
		},
		[attachedFiles, attachmentsReady, attachmentsUploading, resetAttachments, sendToChat, t, toast],
	)
```

Find:

```tsx
									onSend={text => {
										const sent = chat.send(text)
										// A sent message brings the reader to it, also from further up (chat-scroll.tsx).
										if (sent) scrollRef.current?.scrollToBottom()
										return sent
									}}
									onStop={() => void chat.stop()}
								/>
```

Replace with:

```tsx
									onSend={send}
									onStop={() => void chat.stop()}
									header={attachments.header}
									prefix={attachments.prefix}
									onPasteFile={attachments.onPasteFile}
									// Plan call P12 (decision 69): files ready to go may be sent without text.
									canSendEmpty={attachedFiles.length > 0 && attachmentsReady}
								/>
```

`getConversationId` is the list's (`const { getConversationId, markConversation, refresh } = list`, above). The composer's files belong to the page, not to a conversation, as the Sender's text does: a switch keeps both, and the run checks the cap of the conversation they are sent in (P8).

- [ ] **Step 12: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint components/shared-chat/attachment-items.ts components/shared-chat/hooks/use-shared-attachments.tsx components/shared-chat/api.ts components/shared-chat/provider/ag-ui-chat-provider.ts components/shared-chat/hooks/use-shared-chat.ts components/shared-chat/shared-chat.tsx components/chat/chat-view/chat-sender.tsx __tests__/shared-chat-attachment-items.test.ts __tests__/shared-chat-api.test.ts __tests__/shared-chat-provider.test.ts
pnpm exec oxfmt --check components/shared-chat/attachment-items.ts components/shared-chat/hooks/use-shared-attachments.tsx components/shared-chat/api.ts components/shared-chat/provider/ag-ui-chat-provider.ts components/shared-chat/hooks/use-shared-chat.ts components/shared-chat/shared-chat.tsx components/chat/chat-view/chat-sender.tsx locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/shared-chat-attachment-items.test.ts __tests__/shared-chat-api.test.ts __tests__/shared-chat-provider.test.ts
pnpm test
pnpm i18n:lint
npx -y @ant-design/cli lint ./ --format json
grep -c canSendEmpty components/chat/chat-view/chat-view.tsx
```

Expected: tsc exits 0 (`t(refusalKey(check), …)` is checked against the English file's keys); oxlint prints no finding; oxfmt "All matched files use the correct format"; vitest 0 failed; i18n:lint "No issues found"; the antd lint `"summary": { "total": 0, … }`; the grep prints `0`. No `db/` or `lib/data/` file changed, so `pnpm test:db` is not needed.

Then, with `pnpm dev` stopped (one `next dev` per checkout):

```bash
pnpm test:e2e e2e/chat-files.spec.ts e2e/agui-chat.spec.ts e2e/agui-hitl.spec.ts --project desktop-light
rm -rf .next/dev/types && pnpm exec next typegen
```

Expected: every test of the three specs passes on `desktop-light`, and the web server's output holds no `Hydration failed` line (`grep -c "Hydration failed"` on the run's output prints `0`; without the hook's `hydrated` pass every AG-UI chat page logs one): the Dify chat's attachments and speech input behave as before (`ChatSender` without `canSendEmpty`), and the AG-UI chat sends typed messages with Enter as in 2a and 2b (its Send button is X's, disabled only for a blank box or a disabled Sender; the seed's AG-UI apps take documents by Task 2's default, so the prefix button shows). The second line clears the stale route types an e2e run leaves (Global Constraints). The new behaviour is proven by Task 19's `e2e/agui-files.spec.ts`.

- [ ] **Step 13: Commit**

```bash
git add components/shared-chat/attachment-items.ts components/shared-chat/hooks/use-shared-attachments.tsx components/shared-chat/api.ts components/shared-chat/provider/ag-ui-chat-provider.ts components/shared-chat/hooks/use-shared-chat.ts components/shared-chat/shared-chat.tsx components/chat/chat-view/chat-sender.tsx locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/shared-chat-attachment-items.test.ts __tests__/shared-chat-api.test.ts __tests__/shared-chat-provider.test.ts
git commit -m "feat(shared-chat): files in the composer, and messages of files alone

The AG-UI chat's Sender takes files as the Dify chat's does (X Attachments
in a Sender.Header, the prefix button with its count, paste and drop), on
the hub's routes: a file uploads when it is picked, a refusal stays on its
card with its code's text, a removed card deletes its unsent file, and a
send waits while one uploads or failed. The run body names the files by
their ids, and a message may be files alone: ChatSender gains canSendEmpty,
which the Dify chat never passes (Part 2 spec §7.1; decision 69; plan calls
P6, P12, P13, P15).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the 13 files; lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": ["components/shared-chat/attachment-items.ts", "components/shared-chat/hooks/use-shared-attachments.tsx", "components/shared-chat/api.ts", "components/shared-chat/provider/ag-ui-chat-provider.ts", "components/shared-chat/hooks/use-shared-chat.ts", "components/shared-chat/shared-chat.tsx", "components/chat/chat-view/chat-sender.tsx", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/shared-chat-attachment-items.test.ts", "__tests__/shared-chat-api.test.ts", "__tests__/shared-chat-provider.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/shared-chat-attachment-items.test.ts __tests__/shared-chat-api.test.ts __tests__/shared-chat-provider.test.ts __tests__/i18n-locales.test.ts", "acceptanceCriteria": ["a refused upload's card is worded by requestFailureText (Task 7's shared_chat.error.<code> keys, else common.request_failed_retry); refusalKey words type, too_large and too_many by common.unsupported_file_type, shared_chat.error.attachment_too_large and sender.too_many_files, each in en, zh and ar", "preCheck answers type, then too_large above 5 MB, then too_many at count 5, else ok; preCheckAll counts a batch in order with refused files taking no place", "uploadedOf answers a done item's stored attachment; itemDescriptionKey answers sender.uploading while uploading and shared_chat.attachment_truncated for a cut file; toTurnFile drops truncated", "uploadAttachment POSTs FormData with file and an optional conversationId, no Content-Type, and rejects a refusal with RequestError and its code; deleteAttachment DELETEs and resolves on 204; attachmentUrl is the encoded serve route", "transformParams sends attachmentIds only when there are any and never files; transformLocalMessage answers userTurn('local', text, files)", "ChatSender's canSendEmpty sets SendButton disabled to Boolean(disabled) || (!canSendEmpty && !value.trim()) and lets onSubmit pass a blank text when true; left out, behaviour is unchanged; chat-view.tsx never passes it", "SharedChat wires useSharedAttachments (upload with getConversationId(activeKey), remove api.deleteAttachment), passes header, prefix, onPasteFile and canSendEmpty; a send waits with the Dify toasts while a file uploads or failed; the composer resets only when the send was taken", "shared_chat.attachment_truncated exists in en, zh and ar", "tsc exits 0, pnpm test 0 failed, oxlint and oxfmt clean, i18n:lint clean, antd lint total 0, chat-files, agui-chat and agui-hitl e2e specs pass on desktop-light"], "modelTier": "standard"}
```

---

### Task 12: Files in the user bubble

**Goal:** A user turn shows the files sent with it before its text: images as thumbnails three control heights square in an antd `Image.PreviewGroup`, other files as X `FileCard`s that download with a plain link click, all loaded from the serve route of the chat's app, and a message of files alone shows no empty text.

Spec §7.1 ("**UI:** … `FileCard` and image thumbnails in the user bubble, as `message-files.tsx`") and plan calls P15 ("The bubble shows images as thumbnails in an antd `Image.PreviewGroup` and the others as X `FileCard`s that download, as `message-files.tsx` does, through the route of P14; the text, when there is any, follows them"), P14 (the route serves an image `inline` and any other file as `attachment; filename*=…`, `Cache-Control: private, no-store`) and P12 (a file-only message's text is `''`). `Turn.files` is Task 10's (history) and Task 11's (the local bubble); `attachmentUrl` is Task 11's, unit-tested in `__tests__/shared-chat-api.test.ts`. The app's id comes from `useChatAppInfo()` (`components/chat/chat-view/app-info-context.tsx`), which the shared chat provides and Task 16's Logs drawer provides around the same `UserTurn`, so an admin's transcript fetches through the same route, where every fetch by someone other than the uploader writes a `download` row, thumbnails included (decision 69 (4)). Docs checked (Step 1): antd 6.6.5 `Image` (`npx -y @ant-design/cli doc Image --version 6.6.5`: `alt`, `width` and `height`, semantic `classNames`, `Image.PreviewGroup` around several images), sized through its `width`/`height` props as `message-files.tsx` does (its comment: antd's own rule for the `<img>` outranks a class on the `image` slot); X 2.9.0 `FileCard` (`node_modules/@ant-design/x/es/file-card/FileCard.d.ts`: `name`, `byte`, `type` `'file'`, `onClick(info, event)`; `FileCard.js` line 116 passes the other props through `pickAttrs(restProps, { attr, aria, data })`, whose list holds `role`, `tabIndex`, `title` and `onKeyDown`, which `message-files.tsx` relies on for a keyboard-reachable card); MDN `<a>` `download`: "Causes the browser to treat the linked URL as a download", it "only works for same-origin URLs", and "the `filename` parameter of `Content-Disposition` overrides the name in the `download` attribute" (the serve route is same-origin and names the file). There is no logic worth a module of its own: which file is an image is `kind === 'image'` (Task 1's kinds, the one kind the route serves inline), and the URL is `attachmentUrl`; the component is proven in the browser by Task 19 (`e2e/agui-files.spec.ts`: a thumbnail and a card in the bubble after a send and after a reload). No new locale key: `message.files_title` and `message.download_file` are the Dify chat's, which `message-files.tsx` uses for the same group and card.

**Files:**

- Create: `components/shared-chat/turn-files.tsx`
- Create: `components/shared-chat/turn-files.module.css`
- Modify: `components/shared-chat/user-turn.tsx` (the whole file)

**Acceptance Criteria:**

- [ ] `TurnFiles({ files })` renders nothing for no files; otherwise a vertical antd `Flex` with `role="group"` named `t('message.files_title')`, holding the `kind: 'image'` files as antd `Image`s in one `Image.PreviewGroup` (`src` = `createSharedChatApi(useChatAppInfo().id).attachmentUrl(file.id)`, `alt` = the file's name, `width` and `height` = `token.controlHeight * 3`, `classNames={{ image: styles.image }}`), then each other file as an X `FileCard` (`name`, `byte` = `size`, `type="file"`, `role="button"`, `tabIndex={0}`, `title` = `t('message.download_file')`) whose click, Enter or Space downloads through a same-origin `a` with `href` = its `attachmentUrl` and `download` = its name.
- [ ] `turn-files.module.css` holds `.images` (wrapping flex, `gap: var(--ant-margin-xs)`) and `.image` (`object-fit: cover`, `border-radius: var(--ant-border-radius-lg)`): no hex, rgb or pixel literal (`grep -cE '#[0-9a-fA-F]{3}|rgb|[0-9]px' components/shared-chat/turn-files.module.css` prints `0`).
- [ ] `UserTurn` renders a vertical `Flex` (gap `small`, the Dify chat's `UserContent`): `TurnFiles` when `turn.files` has any, then the text in `Typography.Text` with the `user-content.module.css` class when `turnText(turn).trim()` is not `''`.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the changed files; `pnpm i18n:lint` passes; `npx -y @ant-design/cli lint ./ --format json` reports `"total": 0`; `pnpm test:e2e e2e/agui-chat.spec.ts --project desktop-light` passes (2a's user bubbles read as before).

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && npx -y @ant-design/cli lint ./ --format json` → tsc exits 0, `"summary": { "total": 0, … }`

**Steps:**

- [ ] **Step 1: Check the APIs**

Run:

```bash
npx -y @ant-design/cli info Image --version 6.6.5 --format json
grep -n "onClick\|byte?:\|name: string\|type?:" node_modules/@ant-design/x/es/file-card/FileCard.d.ts
grep -n "pickAttrs(restProps" node_modules/@ant-design/x/es/file-card/FileCard.js
```

Expected: `Image` lists `alt`, `classNames`, `height`, `preview`, `src` and `width`, and its sub-component `PreviewGroup`; `FileCardProps` has `name: string`, `byte?: number`, `type?` (`file | image | audio | video`) and `onClick?: (info: CardInfo, event: React.MouseEvent<HTMLDivElement>) => void`, and extends the div's HTML attributes; `FileCard.js` line 116 picks the root's attributes with `pickAttrs`. If any of these differ, stop and report: the component below relies on them.

- [ ] **Step 2: The thumbnails' styles**

Create `components/shared-chat/turn-files.module.css`:

```css
/* A user turn's thumbnails (turn-files.tsx), as the Dify chat's message-files.module.css lays them out. */
.images {
	display: flex;
	flex-wrap: wrap;
	gap: var(--ant-margin-xs);
}
/* The size comes from Image's width/height props (turn-files.tsx). */
.image {
	object-fit: cover;
	border-radius: var(--ant-border-radius-lg);
}
```

- [ ] **Step 3: The files of a user turn**

Create `components/shared-chat/turn-files.tsx`:

```tsx
'use client'

import { FileCard } from '@ant-design/x'
import { Flex, Image, theme } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useChatAppInfo } from '@/components/chat/chat-view/app-info-context'
import type { TurnFile } from '@/lib/chat/attachment-rules'

import { createSharedChatApi } from './api'
import styles from './turn-files.module.css'

const IMAGE_CLASS_NAMES = { image: styles.image }

/**
 * A plain link click, as message-files.tsx saves a blob: an `a` with `download` on the same-origin serve route, which
 * answers a file that is not an image as `Content-Disposition: attachment` with its name (plan call P14), so the
 * browser saves it and the page stays (MDN `<a>`: `download` "only works for same-origin URLs").
 */
const download = (url: string, name: string) => {
	const link = document.createElement('a')
	link.href = url
	link.download = name
	document.body.append(link)
	link.click()
	link.remove()
}

/**
 * A user turn's files (Part 2 spec §7.1; plan call P15), as the Dify chat's MessageFiles shows a message's: images as
 * thumbnails in an antd Image.PreviewGroup, the other files as X FileCards that download. Both load from the serve
 * route (P14) of the app the chat provides (ChatAppInfoContext), the user's chat and the admin's transcript alike.
 * Names are text (spec §6.4: an image's `alt`, a card's `name`).
 */
export default function TurnFiles({ files }: { files: readonly TurnFile[] }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { id: appId } = useChatAppInfo()
	const api = useMemo(() => createSharedChatApi(appId), [appId])
	// Thumbnails three control heights square. antd sizes an Image through its width/height props: its own rule for the
	// <img> outranks a class on the `image` slot (message-files.tsx).
	const thumbnail = token.controlHeight * 3
	const images = files.filter(file => file.kind === 'image')
	const others = files.filter(file => file.kind !== 'image')

	if (!files.length) return null

	return (
		<Flex
			vertical
			gap="small"
			role="group"
			aria-label={t('message.files_title')}
		>
			{images.length > 0 && (
				<Image.PreviewGroup>
					<div className={styles.images}>
						{images.map(image => (
							<Image
								key={image.id}
								src={api.attachmentUrl(image.id)}
								alt={image.name}
								width={thumbnail}
								height={thumbnail}
								classNames={IMAGE_CLASS_NAMES}
							/>
						))}
					</div>
				</Image.PreviewGroup>
			)}
			{others.map(file => {
				const save = () => download(api.attachmentUrl(file.id), file.name)
				// A file card is a button that downloads: FileCard renders a plain div, so it gets the button role, focus and
				// keys through its HTML attributes (message-files.tsx).
				return (
					<FileCard
						key={file.id}
						name={file.name}
						byte={file.size}
						type="file"
						onClick={save}
						role="button"
						tabIndex={0}
						title={t('message.download_file')}
						onKeyDown={event => {
							if (event.key !== 'Enter' && event.key !== ' ') return
							event.preventDefault()
							save()
						}}
					/>
				)
			})}
		</Flex>
	)
}
```

- [ ] **Step 4: The user bubble**

Replace the whole of `components/shared-chat/user-turn.tsx` with:

```tsx
'use client'

import { Flex, Typography } from 'antd'

import styles from '@/components/chat/chat-view/user-content.module.css'
import { turnText, type Turn } from '@/lib/chat/turn'

import TurnFiles from './turn-files'

/**
 * A user bubble (spec §5.3, §7.1): the files sent with the message, then the text as typed, line breaks kept (the Dify
 * chat's UserContent). A message may be files alone (plan call P12), so a blank text shows nothing.
 */
export default function UserTurn({ turn }: { turn: Turn }) {
	const text = turnText(turn)
	return (
		<Flex
			vertical
			gap="small"
		>
			{turn.files?.length ? <TurnFiles files={turn.files} /> : null}
			{text.trim() && <Typography.Text className={styles.text}>{text}</Typography.Text>}
		</Flex>
	)
}
```

A turn without files renders its text as 2a did, inside the `Flex` the Dify chat's `UserContent` uses; a user turn's text was never blank before 2c (2a's run schema refused it), so `.trim()` changes nothing for them.

- [ ] **Step 5: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint components/shared-chat/turn-files.tsx components/shared-chat/user-turn.tsx
pnpm exec oxfmt --check components/shared-chat/turn-files.tsx components/shared-chat/turn-files.module.css components/shared-chat/user-turn.tsx
pnpm test
pnpm i18n:lint
npx -y @ant-design/cli lint ./ --format json
grep -cE '#[0-9a-fA-F]{3}|rgb|[0-9]px' components/shared-chat/turn-files.module.css
```

Expected: tsc exits 0; oxlint prints no finding; oxfmt "All matched files use the correct format"; vitest 0 failed (no test changes: the rules are Task 1's and Task 11's); i18n:lint "No issues found"; the antd lint `"summary": { "total": 0, … }`; the grep prints `0`.

Then, with `pnpm dev` stopped:

```bash
pnpm test:e2e e2e/agui-chat.spec.ts --project desktop-light
rm -rf .next/dev/types && pnpm exec next typegen
```

Expected: every test of `e2e/agui-chat.spec.ts` passes on `desktop-light` (its user bubbles, `.ant-bubble-end`, read their text as before); the second line clears the stale route types an e2e run leaves (Global Constraints).

- [ ] **Step 6: Commit**

```bash
git add components/shared-chat/turn-files.tsx components/shared-chat/turn-files.module.css components/shared-chat/user-turn.tsx
git commit -m "feat(shared-chat): a user turn's files in its bubble

A user bubble shows the files sent with the message before its text, as the
Dify chat's MessageFiles does: images as thumbnails in an antd
Image.PreviewGroup, other files as X FileCards that download with a plain
link click, keyboard-reachable, all from the serve route of the chat's app.
A message of files alone shows no empty text (Part 2 spec §7.1; plan calls
P12, P14, P15).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the 3 files; lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": ["components/shared-chat/turn-files.tsx", "components/shared-chat/turn-files.module.css", "components/shared-chat/user-turn.tsx"], "verifyCommand": "pnpm exec next typegen && pnpm exec tsc --noEmit && npx -y @ant-design/cli lint ./ --format json", "acceptanceCriteria": ["TurnFiles renders nothing for no files; images as antd Images in one Image.PreviewGroup from attachmentUrl, alt the name, three control heights square; other files as X FileCards (name, byte, type file, role button, tabIndex 0, title message.download_file) that download on click, Enter or Space through a same-origin a with download; the group named message.files_title", "turn-files.module.css holds .images and .image with var(--ant-*) values only", "UserTurn renders TurnFiles when the turn has files, then the text when it is not blank, in a vertical Flex", "tsc exits 0, pnpm test 0 failed, oxlint and oxfmt clean, i18n:lint clean, antd lint total 0, agui-chat e2e spec passes on desktop-light"], "modelTier": "mechanical"}
```

---

### Task 13: The Logs' data layer

**Goal:** `lib/data/logs.ts` answers the admin's Logs from the store (one numbered page of an app's conversations with its total, each row's messages, tokens and status tags; the accounts for the user filter; one transcript page of any conversation of the app, which writes its `view` row; the owner's access log), on `readThreadPageOf`, the page reader split out of `readThreadPage`, and `lib/chat/log-view.ts` answers a run's tokens and its timeline entry, client-safe.

Spec §7.2 ("an antd `Table`: user (name and email), title, messages, last activity, tokens (summed from the runs), status tags (failed, stopped, waiting for an answer, and "Deleted by the user, purged on <date>")"; "Filters in the URL: a date range on the last activity, the user, the status, "include deleted""; the drawer "fetches `GET /api/apps/[appId]/logs/[conversationId]` … owner and admin, checked in the handler and the data layer"; "opening a transcript … writes a `conversation_access_log` row"; "Access log tab: on the Logs page, for the owner role only"), decision 69 (5) (numbered pages, offset paging in place of the spec's keyset), plan calls P16 (the order `updated_at DESC, id DESC`, `LIMIT`/`OFFSET` and a total with the same filters), P17 (a row's figures and tags), P18 (the view row on the first page only), P19 (the owner-only access log with its left joins) and the Shared contracts' block "The access log and the Logs' data layer". Docs checked: Drizzle (orm.drizzle.team, read 2026-10-15; Context7 `/drizzle-team/drizzle-orm-docs`): the guide "Limit/Offset pagination" (`.limit(pageSize).offset((page - 1) * pageSize)`, "ensure ordering by a unique column"), "Select" (`$count`: "`db.$count()` is a utility wrapper of `count(*)` … works with filters"; "Aggregations helpers", `count()`), the guide "Count rows", "Filters" (`exists(query)` and `inArray(column, query)` take a subquery), "Goodies", Standalone Query Builder (`new QueryBuilder()` from `drizzle-orm/pg-core`, the way `lib/data/apps.ts` builds `visibleTo`), "Joins" (`leftJoin`; `alias()` for a second read of a table) and "Magical sql operator" (`sql<T>`, `.mapWith()`); PostgreSQL 18: §7.6 "LIMIT and OFFSET" ("use an ORDER BY clause that constrains the result rows into a unique order"), 9.24.1 EXISTS (true or false, never NULL), 9.24.2 IN (no row is no match), 4.2.11 "Scalar Subqueries", Table 9.47 (`->`, `->>`), Table 9.48 (`@>`), 8.14.3 "jsonb Containment and Existence" ("the order of array elements is not significant … duplicate array elements are effectively considered only once"), Table 9.51 (`jsonb_path_query_array(target, path, vars)`), 9.16.2.2 "Strict and Lax Modes" (lax: "structural errors … are suppressed, producing no match"), Table 9.62 (`jsonb_agg`); AG-UI 1.0 `TokenUsage` (`node_modules/@ag-ui/core/dist/version-DEKfpZNa.d.ts` lines 1729–1791: "inputTokens and outputTokens are the totals … totalTokens is the two totals summed", and `RunFinishedEvent.usage`: "A consumer that only wants totals sums across the entries"; `dist/schemas.mjs` line 675, `TokenUsageSchema` as a `z.looseObject` of non-negative integers); zod 4 (zod.dev/api: `z.looseObject` lets unknown keys pass; `z.int()` "restricts to safe integer range"). The status tags are SQL over the outer `conversations` row, so the filter, the total and the row tags read one definition: "waiting" follows 2b's `continuedRun` rule (the newest run the agent started; a run refused before its stream is passed over) and reads an `ask_user` call as unanswered when the continued run's assistant messages call `ask_user` with ids that no tool message of the conversation answers (`answered @> asked` on jsonb arrays). Tokens are summed in TypeScript for the page's rows only, by `tokensOf`, the function the drawer's timeline uses too. `readThreadPage` becomes `findConversation` plus `readThreadPageOf`, so the user's read answers exactly what it did (Task 10's `files` included) and the admin's read pages the same way; `ThreadRun` gains `usage` for the timeline's tokens. `interruptsOf` (lib/chat/turn.ts) and `hasIcon` (lib/data/apps.ts) are exported, so the timeline counts interrupts and the Logs page names the app with the one definition each. Task 14's route answers `LogConversationPage` from `readLogThread` and `logRunView`; Task 15's page calls `findLogsApp`, `listAppLogs`, `listLogUsers` and `listAccessLog`; Task 16's drawer reads `LogConversationPage`.

**Files:**

- Create: `lib/chat/log-view.ts`
- Create: `lib/data/logs.ts`
- Modify: `lib/data/conversations.ts` (`ThreadRun.usage`; `readThreadPageOf` split out of `readThreadPage`; the runs' `usage` read; as of Task 10)
- Modify: `lib/chat/turn.ts` (`interruptsOf` exported; as of Task 10)
- Modify: `lib/data/apps.ts` (`hasIcon` exported)
- Test: `__tests__/chat-log-view.test.ts` (the whole file, below)
- Test: `__tests__/db/logs.db.test.ts` (the whole file, below)

**Acceptance Criteria:**

- [ ] `tokensOf` answers `totalTokens` when an entry has it, else `inputTokens + outputTokens` (either alone counts), sums the entries (`[{ inputTokens: 100, outputTokens: 20 }, { totalTokens: 30 }, { outputTokens: 5 }]` → 155), and answers null for null, undefined, `[]`, entries without a count, a non-array, a non-object entry, a negative, fractional, string or unsafe count; `logRunView` answers ISO times, `finishedAt: null` while running, the tokens, the error without `beforeStream`, its outcome's interrupt count and its `resume` answer count.
- [ ] `listAppLogs` answers rows in `updated_at DESC, id DESC` order, `pageSize` per page, the total of the same filters on every page (an empty page past the end keeps it); `from`/`to` include both bounds; `userId` and `includeDeleted` filter; each row carries `{ id, title, user: { id, name, email }, messages (user and assistant rows), tokens (summed, null when no run reported usage), updatedAt, statuses, deletedAt }`.
- [ ] The tags: newest run failed → `failed`; newest cancelled or truncated → `stopped`; continued run interrupted, or its `ask_user` call without a tool result → `waiting` (an interrupted run followed by a run refused before its stream → `['failed', 'waiting']`; a call answered later, a call answered by a stop's tool message, and a call of an older run → not waiting); the status filter answers exactly the rows with that tag and their count.
- [ ] `findLogsApp` names an AG-UI app (`{ id, name, description, hasIcon }`) and answers null for a Dify app, an unknown id and a malformed one; `listLogUsers` lists the accounts with a conversation in the app (deleted conversations included), by email, with `active`.
- [ ] `readLogThread` reads any conversation of the app (deleted ones included) with its user, `createdAt` and `deletedAt`, answers the page `readThreadPage` answers the user, writes one `view` row (`actor_id` the admin, `attachment_id` null) for the first page only, none for `before`, and none and null for another app's, an unknown or a malformed conversation.
- [ ] `listAccessLog` answers the owner the app's rows newest first with the total and numbered pages, `actor`, `conversation` and `attachment.name` null once each is gone; an admin and a user get AuthError `forbidden`; every Logs function refuses a user before reading or writing.
- [ ] `readThreadPage` answers what `readThreadPageOf` answers for the user's own conversation, null for another's or a deleted one, and its runs carry `usage`.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; `pnpm test:db` reports 0 failed; oxlint and oxfmt clean on the changed files.

**Verify:** `pnpm exec vitest run --project db __tests__/db/logs.db.test.ts && pnpm exec vitest run --project unit __tests__/chat-log-view.test.ts` → `Test Files  1 passed (1)`, `Tests  14 passed (14)`, then `Test Files  1 passed (1)`, `Tests  26 passed (26)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `__tests__/chat-log-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { logRunView, tokensOf } from '@/lib/chat/log-view'
import type { ThreadRun } from '@/lib/data/conversations'

// AG-UI 1.0 `TokenUsage`: inputTokens and outputTokens are the totals, totalTokens "is the two totals summed"; a run's
// `usage` is one entry per provider and model, and "A consumer that only wants totals sums across the entries".
describe('tokensOf (2c plan call P17)', () => {
	it.each([
		['totalTokens alone', [{ totalTokens: 42 }], 42],
		['inputTokens and outputTokens', [{ inputTokens: 30, outputTokens: 12 }], 42],
		[
			'totalTokens over the two counts beside it',
			[{ inputTokens: 30, outputTokens: 12, totalTokens: 50 }],
			50,
		],
		['inputTokens alone', [{ inputTokens: 30 }], 30],
		['outputTokens alone', [{ outputTokens: 12 }], 12],
		[
			'the parts beside the totals, which are never added',
			[{ inputTokens: 30, outputTokens: 12, reasoningTokens: 5, cachedInputTokens: 20 }],
			42,
		],
		['zero', [{ totalTokens: 0 }], 0],
		[
			'an entry with its provider and model',
			[{ provider: 'openai', model: 'gpt-5', totalTokens: 7 }],
			7,
		],
	])('reads %s', (_label, usage, tokens) => {
		expect(tokensOf(usage)).toBe(tokens)
	})

	it('sums the entries of several models', () => {
		expect(
			tokensOf([
				{ provider: 'anthropic', model: 'claude', inputTokens: 100, outputTokens: 20 },
				{ provider: 'openai', model: 'gpt-5', totalTokens: 30 },
				{ provider: 'google', model: 'gemini', outputTokens: 5 },
			]),
		).toBe(155)
	})

	it('counts nothing for an entry without a count, beside entries with one', () => {
		expect(tokensOf([{ provider: 'openai' }, { totalTokens: 9 }])).toBe(9)
	})

	it.each([
		['no usage (null)', null],
		['undefined', undefined],
		['an empty list', []],
		['entries without a count', [{ provider: 'openai', model: 'gpt-5' }]],
		['an object, not a list', { totalTokens: 42 }],
		['a number', 42],
		['a list with a non-object entry', [{ totalTokens: 1 }, 'x']],
		['a negative count', [{ totalTokens: -1 }]],
		['a fractional count', [{ inputTokens: 1.5 }]],
		['a count as a string', [{ totalTokens: '42' }]],
		['a count past the safe integers', [{ totalTokens: Number.MAX_SAFE_INTEGER + 1 }]],
	])('answers null for %s', (_label, usage) => {
		expect(tokensOf(usage)).toBeNull()
	})
})

const run = (over: Partial<ThreadRun> = {}): ThreadRun => ({
	id: 'run-1',
	status: 'succeeded',
	outcome: null,
	error: null,
	custom: [],
	startedAt: new Date('2026-10-15T09:00:00.000Z'),
	finishedAt: new Date('2026-10-15T09:00:04.500Z'),
	resume: null,
	usage: null,
	...over,
})

// 2c plan call P18: the drawer's timeline entry (status, start, duration, tokens, the error, interrupts, answers).
describe('logRunView', () => {
	it('shows a finished run with its times as ISO 8601 and nothing else to tell', () => {
		expect(logRunView(run())).toEqual({
			id: 'run-1',
			status: 'succeeded',
			startedAt: '2026-10-15T09:00:00.000Z',
			finishedAt: '2026-10-15T09:00:04.500Z',
			tokens: null,
			error: null,
			interrupts: 0,
			answers: 0,
		})
	})

	it('shows a running run without its end', () => {
		expect(logRunView(run({ status: 'running', finishedAt: null }))).toMatchObject({
			status: 'running',
			finishedAt: null,
		})
	})

	it('counts its tokens, the interrupts its outcome named and the answers it was started with', () => {
		const view = logRunView(
			run({
				status: 'interrupted',
				usage: [{ inputTokens: 10, outputTokens: 5 }],
				outcome: {
					type: 'interrupt',
					interrupts: [
						{ id: 'int-1', reason: 'tool_call' },
						{ id: 'int-2', reason: 'input_required' },
					],
				},
				resume: [
					{ interruptId: 'int-0', status: 'resolved', payload: { approved: true } },
					{ interruptId: 'int-9', status: 'cancelled' },
				],
			}),
		)
		expect(view).toMatchObject({ status: 'interrupted', tokens: 15, interrupts: 2, answers: 2 })
	})

	it('reads an outcome or a resume list of another shape as none', () => {
		expect(
			logRunView(run({ outcome: { type: 'success' }, resume: [{ interruptId: 1 }] })),
		).toMatchObject({ interrupts: 0, answers: 0 })
	})

	it('keeps the error’s code and message and drops the store’s refusal flag', () => {
		expect(
			logRunView(
				run({
					status: 'failed',
					error: { code: 'agent_not_found', message: 'No agent', beforeStream: true },
				}),
			).error,
		).toEqual({ code: 'agent_not_found', message: 'No agent' })
		expect(logRunView(run({ status: 'failed', error: { message: 'Boom' } })).error).toEqual({
			message: 'Boom',
		})
	})
})
```

Create `__tests__/db/logs.db.test.ts`. It isolates each test by fresh app ids, so it needs nothing from `resetTables` for the access log (a table without foreign keys, which `TRUNCATE … CASCADE` does not reach):

```ts
import type { Message } from '@ag-ui/core'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', async () => {
	const { testDb } = await import('./database')
	return { getDb: () => testDb }
})
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import {
	apps,
	conversationAccessLog,
	conversationAttachments,
	conversationMessages,
	conversationRuns,
	conversations,
	users,
} from '@/db/schema'
import { readThreadPage, readThreadPageOf } from '@/lib/data/conversations'
import {
	findLogsApp,
	listAccessLog,
	listAppLogs,
	listLogUsers,
	readLogThread,
	type LogFilters,
} from '@/lib/data/logs'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterAll(() => pool.end())

const ALL: LogFilters = { includeDeleted: false }
const FIRST_PAGE = { page: 1, pageSize: 10 }

type Role = 'owner' | 'admin' | 'user'

/** A session user with its account row (the joins read the row); the email starts with the name, so emails sort by it. */
const account = async (role: Role = 'user', name: string | null = null) => {
	const actor = {
		id: crypto.randomUUID(),
		email: `${(name ?? role).toLowerCase()}-${crypto.randomUUID()}@example.com`,
		name,
		role,
		source: 'local' as const,
	}
	await testDb
		.insert(users)
		.values({ id: actor.id, email: actor.email, name, password: 'hash', role })
	return actor
}
type Actor = Awaited<ReturnType<typeof account>>

const insertApp = async (provider: 'agui' | 'dify' = 'agui') => {
	const id = crypto.randomUUID()
	await testDb.insert(apps).values({ id, provider, name: 'Tea', settings: {}, secrets: {} })
	return id
}

const insertConversation = async (
	user: Actor,
	appId: string,
	over: Partial<typeof conversations.$inferInsert> = {},
) => {
	const id = over.id ?? crypto.randomUUID()
	await testDb
		.insert(conversations)
		.values({ id, appId, userId: user.id, title: 'Chat', updatedAt: new Date(), ...over })
	return id
}

const insertRun = async (
	conversationId: string,
	startedAt: Date,
	over: Partial<typeof conversationRuns.$inferInsert> = {},
) => {
	const id = crypto.randomUUID()
	await testDb.insert(conversationRuns).values({
		id,
		conversationId,
		status: 'succeeded',
		startedAt,
		finishedAt: startedAt,
		...over,
	})
	return id
}

const insertMessage = async (conversationId: string, runId: string, body: Message) => {
	await testDb.insert(conversationMessages).values({
		conversationId,
		runId,
		messageId: body.id,
		role: body.role,
		body,
		status: 'complete',
	})
}

const userMessage = (text: string): Message => ({
	id: crypto.randomUUID(),
	role: 'user',
	content: text,
})
const reply = (text: string): Message => ({
	id: crypto.randomUUID(),
	role: 'assistant',
	content: text,
})
const askUserCall = (callId: string): Message => ({
	id: crypto.randomUUID(),
	role: 'assistant',
	toolCalls: [
		{
			id: callId,
			type: 'function',
			function: { name: 'ask_user', arguments: '{"questions":[{"question":"Tea?"}]}' },
		},
	],
})
const toolResult = (callId: string): Message => ({
	id: crypto.randomUUID(),
	role: 'tool',
	toolCallId: callId,
	content: 'Q: Tea?\nA: Yes',
})

/** One turn: a run, its user message and the assistant's answer. */
const insertTurn = async (conversationId: string, startedAt: Date, text: string) => {
	const runId = await insertRun(conversationId, startedAt)
	await insertMessage(conversationId, runId, userMessage(text))
	await insertMessage(conversationId, runId, reply(`Re: ${text}`))
	return runId
}

const viewRows = (conversationId: string) =>
	testDb
		.select({
			actorId: conversationAccessLog.actorId,
			appId: conversationAccessLog.appId,
			action: conversationAccessLog.action,
			attachmentId: conversationAccessLog.attachmentId,
		})
		.from(conversationAccessLog)
		.where(eq(conversationAccessLog.conversationId, conversationId))

const ids = (rows: { id: string }[]) => rows.map(row => row.id)

describe('findLogsApp (2c plan call P20)', () => {
	it('names an app whose provider keeps the hub’s history, and nothing else', async () => {
		const admin = await account('admin')
		const agui = await insertApp('agui')
		expect(await findLogsApp(admin, agui)).toEqual({
			id: agui,
			name: 'Tea',
			description: '',
			hasIcon: false,
		})
		expect(await findLogsApp(admin, await insertApp('dify'))).toBeNull()
		expect(await findLogsApp(admin, crypto.randomUUID())).toBeNull()
		expect(await findLogsApp(admin, 'not-a-uuid')).toBeNull()
	})
})

describe('listAppLogs (2c plan calls P16, P17)', () => {
	it('pages by updated_at then id, newest first, with the total of the same filters', async () => {
		const admin = await account('admin')
		const user = await account()
		const appId = await insertApp()
		const now = Date.now()
		const tie = new Date(now - 2000)
		const newest = await insertConversation(user, appId, { updatedAt: new Date(now - 1000) })
		const tied = [
			await insertConversation(user, appId, { updatedAt: tie }),
			await insertConversation(user, appId, { updatedAt: tie }),
		].sort()
		const older = await insertConversation(user, appId, { updatedAt: new Date(now - 3000) })
		const oldest = await insertConversation(user, appId, { updatedAt: new Date(now - 4000) })
		await insertConversation(user, appId, { deletedAt: new Date() })
		await insertConversation(user, await insertApp())
		const page = (number: number) => listAppLogs(admin, appId, ALL, { page: number, pageSize: 2 })
		expect(await page(1)).toMatchObject({ total: 5 })
		expect(ids((await page(1)).rows)).toEqual([newest, tied[1]])
		expect(ids((await page(2)).rows)).toEqual([tied[0], older])
		expect(ids((await page(3)).rows)).toEqual([oldest])
		expect(await page(4)).toEqual({ rows: [], total: 5 })
	})

	it('answers each row’s user, title, dates, messages and tokens', async () => {
		const admin = await account('admin')
		const user = await account('user', 'Jane')
		const appId = await insertApp()
		const updatedAt = new Date('2026-10-14T10:00:00.000Z')
		const deletedAt = new Date('2026-10-14T11:00:00.000Z')
		const id = await insertConversation(user, appId, { title: 'Trip', updatedAt, deletedAt })
		const base = Date.now() - 60_000
		const first = await insertRun(id, new Date(base), {
			usage: [{ inputTokens: 10, outputTokens: 5 }],
		})
		await insertMessage(id, first, userMessage('one'))
		await insertMessage(id, first, askUserCall('call-1'))
		const second = await insertRun(id, new Date(base + 1000), {
			usage: [{ totalTokens: 7 }, { provider: 'openai', totalTokens: 3 }],
		})
		await insertMessage(id, second, toolResult('call-1'))
		await insertMessage(id, second, reply('done'))
		await insertRun(id, new Date(base + 2000))
		const quiet = await insertConversation(user, appId, { updatedAt: new Date(0) })
		const { rows } = await listAppLogs(admin, appId, { includeDeleted: true }, FIRST_PAGE)
		expect(rows).toEqual([
			{
				id,
				title: 'Trip',
				user: { id: user.id, name: 'Jane', email: user.email },
				messages: 3,
				tokens: 25,
				updatedAt: '2026-10-14T10:00:00.000Z',
				statuses: [],
				deletedAt: '2026-10-14T11:00:00.000Z',
			},
			expect.objectContaining({ id: quiet, messages: 0, tokens: null, deletedAt: null }),
		])
	})

	it('filters by the last activity, both bounds included, and by the user', async () => {
		const admin = await account('admin')
		const jane = await account()
		const omar = await account()
		const appId = await insertApp()
		const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12))
		const tenth = await insertConversation(jane, appId, { updatedAt: day(10) })
		const eleventh = await insertConversation(omar, appId, { updatedAt: day(11) })
		const twelfth = await insertConversation(jane, appId, { updatedAt: day(12) })
		const range = await listAppLogs(
			admin,
			appId,
			{ ...ALL, from: day(11), to: day(12) },
			FIRST_PAGE,
		)
		expect(range).toMatchObject({ total: 2 })
		expect(ids(range.rows)).toEqual([twelfth, eleventh])
		expect(
			ids((await listAppLogs(admin, appId, { ...ALL, from: day(12) }, FIRST_PAGE)).rows),
		).toEqual([twelfth])
		expect(
			ids((await listAppLogs(admin, appId, { ...ALL, to: day(10) }, FIRST_PAGE)).rows),
		).toEqual([tenth])
		const janes = await listAppLogs(admin, appId, { ...ALL, userId: jane.id }, FIRST_PAGE)
		expect(janes).toMatchObject({ total: 2 })
		expect(ids(janes.rows)).toEqual([twelfth, tenth])
	})

	it('leaves deleted conversations out unless asked, and tags none of them by their deletion', async () => {
		const admin = await account('admin')
		const user = await account()
		const appId = await insertApp()
		const live = await insertConversation(user, appId, { updatedAt: new Date(Date.now() - 1000) })
		const deleted = await insertConversation(user, appId, {
			deletedAt: new Date(),
			updatedAt: new Date(Date.now() - 2000),
		})
		expect(await listAppLogs(admin, appId, ALL, FIRST_PAGE)).toMatchObject({
			total: 1,
			rows: [{ id: live, deletedAt: null }],
		})
		const withDeleted = await listAppLogs(admin, appId, { includeDeleted: true }, FIRST_PAGE)
		expect(withDeleted.total).toBe(2)
		expect(ids(withDeleted.rows)).toEqual([live, deleted])
		expect(withDeleted.rows[1]!.deletedAt).not.toBeNull()
		expect(withDeleted.rows[1]!.statuses).toEqual([])
	})

	// P17: failed and stopped read the newest run; waiting reads the run the conversation continues (continuedRun).
	it('tags each conversation by its runs, and the status filter matches a tag', async () => {
		const admin = await account('admin')
		const user = await account()
		const appId = await insertApp()
		const base = Date.now() - 600_000
		let minute = 0
		/** A conversation whose runs end as listed, oldest first; each later conversation sorts lower. */
		const withRuns = async (
			statuses: (typeof conversationRuns.$inferInsert)['status'][],
			extra?: (conversationId: string, runIds: string[]) => Promise<void>,
		) => {
			minute += 1
			const id = await insertConversation(user, appId, {
				updatedAt: new Date(base + 100_000 - minute * 1000),
			})
			const runIds: string[] = []
			for (const [index, status] of statuses.entries())
				runIds.push(
					await insertRun(id, new Date(base + minute * 10_000 + index * 1000), { status }),
				)
			await extra?.(id, runIds)
			return id
		}
		const failedLast = await withRuns(['succeeded', 'failed'])
		const failedBefore = await withRuns(['failed', 'succeeded'])
		const cancelled = await withRuns(['cancelled'])
		const truncated = await withRuns(['truncated'])
		const interrupted = await withRuns(['interrupted'])
		// The answers' run was refused before its stream: it is the newest run (failed), and the interrupted one is still
		// the run the conversation continues.
		const refusedAnswers = await withRuns(['interrupted'], async (id, [asked]) => {
			await insertRun(id, new Date(base + 99_000), {
				status: 'failed',
				error: { code: 'agent_not_found', message: 'No agent', beforeStream: true },
			})
			await insertMessage(id, asked!, userMessage('Delete it'))
		})
		const asking = await withRuns(['succeeded'], async (id, [run]) => {
			await insertMessage(id, run!, userMessage('Plan a trip'))
			await insertMessage(id, run!, askUserCall('call-open'))
		})
		const answered = await withRuns(['succeeded', 'succeeded'], async (id, [asked, next]) => {
			await insertMessage(id, asked!, askUserCall('call-done'))
			await insertMessage(id, next!, toolResult('call-done'))
			await insertMessage(id, next!, reply('Booked'))
		})
		// A stop answers the run's own open calls (spec §3.2 step 4): the call has its result in the continued run.
		const stoppedAsking = await withRuns(['cancelled'], async (id, [run]) => {
			await insertMessage(id, run!, askUserCall('call-stopped'))
			await insertMessage(id, run!, toolResult('call-stopped'))
		})
		// A call of an older run left without a result is not the continued run's: it waits for nothing (P17).
		const olderCall = await withRuns(['succeeded', 'succeeded'], async (id, [asked]) => {
			await insertMessage(id, asked!, askUserCall('call-old'))
		})
		const noRuns = await withRuns([])

		const { rows } = await listAppLogs(admin, appId, ALL, { page: 1, pageSize: 20 })
		const tags = Object.fromEntries(rows.map(row => [row.id, row.statuses]))
		expect(tags).toEqual({
			[failedLast]: ['failed'],
			[failedBefore]: [],
			[cancelled]: ['stopped'],
			[truncated]: ['stopped'],
			[interrupted]: ['waiting'],
			[refusedAnswers]: ['failed', 'waiting'],
			[asking]: ['waiting'],
			[answered]: [],
			[stoppedAsking]: ['stopped'],
			[olderCall]: [],
			[noRuns]: [],
		})
		const filtered = async (status: 'failed' | 'stopped' | 'waiting') => {
			const page = await listAppLogs(admin, appId, { ...ALL, status }, FIRST_PAGE)
			expect(page.total).toBe(page.rows.length)
			return ids(page.rows)
		}
		expect(await filtered('failed')).toEqual([failedLast, refusedAnswers])
		expect(await filtered('stopped')).toEqual([cancelled, truncated, stoppedAsking])
		expect(await filtered('waiting')).toEqual([interrupted, refusedAnswers, asking])
	})
})

describe('listLogUsers (2c plan call P16)', () => {
	it('lists the accounts with a conversation in this app, deleted ones included, by email', async () => {
		const admin = await account('admin')
		const appId = await insertApp()
		const zed = await account('user', 'Zed')
		const amy = await account('user', 'Amy')
		const elsewhere = await account()
		await testDb.update(users).set({ adminDeactivatedAt: new Date() }).where(eq(users.id, amy.id))
		await insertConversation(zed, appId)
		await insertConversation(zed, appId)
		await insertConversation(amy, appId, { deletedAt: new Date() })
		await insertConversation(elsewhere, await insertApp())
		const options = await listLogUsers(admin, appId)
		expect(options).toEqual([
			{ id: amy.id, name: 'Amy', email: amy.email, active: false },
			{ id: zed.id, name: 'Zed', email: zed.email, active: true },
		])
	})
})

describe('readLogThread (2c plan call P18)', () => {
	it('reads any conversation of the app, deleted ones too, with its user and dates', async () => {
		const admin = await account('admin')
		const user = await account('user', 'Jane')
		const appId = await insertApp()
		const createdAt = new Date('2026-10-01T08:00:00.000Z')
		const deletedAt = new Date('2026-10-02T08:00:00.000Z')
		const id = await insertConversation(user, appId, { createdAt, deletedAt, state: { a: 1 } })
		await insertTurn(id, new Date(Date.now() - 1000), 'hello')
		const thread = await readLogThread(admin, appId, id, { turns: 20 })
		expect(thread).toMatchObject({
			user: { id: user.id, name: 'Jane', email: user.email },
			createdAt,
			deletedAt,
			conversation: { id, appId, title: 'Chat', state: { a: 1 } },
			cursor: null,
			files: [],
		})
		expect(thread!.rows.map(row => row.body.role)).toEqual(['user', 'assistant'])
		expect(thread!.runs).toHaveLength(1)
	})

	it('answers the page the user’s own read answers', async () => {
		const admin = await account('admin')
		const user = await account()
		const appId = await insertApp()
		const id = await insertConversation(user, appId)
		const base = Date.now() - 60_000
		for (const [index, text] of ['one', 'two', 'three'].entries())
			await insertTurn(id, new Date(base + index * 1000), text)
		const own = await readThreadPage(user, appId, id, { turns: 2 })
		expect(await readLogThread(admin, appId, id, { turns: 2 })).toEqual({
			...own,
			user: { id: user.id, name: null, email: user.email },
			createdAt: expect.any(Date),
			deletedAt: null,
		})
		const older = await readLogThread(admin, appId, id, { before: Number(own!.cursor), turns: 2 })
		expect(older?.rows.map(row => row.body.role)).toEqual(['user', 'assistant'])
		expect(older?.cursor).toBeNull()
	})

	// Spec §7.2: opening a transcript is one view row; "load earlier" in the same drawer writes none.
	it('writes one view row for the first page only, and none when there is no such conversation', async () => {
		const admin = await account('admin')
		const user = await account()
		const appId = await insertApp()
		const id = await insertConversation(user, appId)
		const base = Date.now() - 60_000
		for (const [index, text] of ['one', 'two', 'three'].entries())
			await insertTurn(id, new Date(base + index * 1000), text)
		const first = await readLogThread(admin, appId, id, { turns: 2 })
		expect(await viewRows(id)).toEqual([
			{ actorId: admin.id, appId, action: 'view', attachmentId: null },
		])
		await readLogThread(admin, appId, id, { before: Number(first!.cursor), turns: 2 })
		expect(await viewRows(id)).toHaveLength(1)
		const otherApp = await insertApp()
		expect(await readLogThread(admin, otherApp, id, { turns: 20 })).toBeNull()
		const missing = crypto.randomUUID()
		expect(await readLogThread(admin, appId, missing, { turns: 20 })).toBeNull()
		expect(await readLogThread(admin, appId, 'not-a-uuid', { turns: 20 })).toBeNull()
		expect(await viewRows(id)).toHaveLength(1)
		expect(await viewRows(missing)).toEqual([])
	})
})

describe('listAccessLog (2c plan call P19)', () => {
	it('answers the owner the app’s rows newest first, each part null once it is gone, and the total', async () => {
		const owner = await account('owner', 'Owner')
		const admin = await account('admin', 'Ada')
		const user = await account('user', 'Jane')
		const appId = await insertApp()
		const id = await insertConversation(user, appId, { title: 'Trip' })
		const runId = await insertTurn(id, new Date(Date.now() - 1000), 'hello')
		const [message] = await testDb
			.select({ messageId: conversationMessages.messageId })
			.from(conversationMessages)
			.where(eq(conversationMessages.runId, runId))
			.limit(1)
		const attachmentId = crypto.randomUUID()
		await testDb.insert(conversationAttachments).values({
			id: attachmentId,
			userId: user.id,
			appId,
			conversationId: id,
			messageId: message!.messageId,
			position: 0,
			kind: 'image',
			mime: 'image/png',
			name: 'cat.png',
			size: 3,
			sha256: 'abc',
			data: Buffer.from('abc'),
		})
		const at = (minutes: number) => new Date(Date.UTC(2026, 9, 15, 9, minutes))
		const row = (over: Partial<typeof conversationAccessLog.$inferInsert>) => ({
			id: crypto.randomUUID(),
			actorId: admin.id,
			conversationId: id,
			appId,
			action: 'view' as const,
			...over,
		})
		const removedFile = crypto.randomUUID()
		const goneActor = crypto.randomUUID()
		const purged = crypto.randomUUID()
		const rows = [
			row({ at: at(1) }),
			row({ at: at(2), action: 'download', attachmentId }),
			row({ at: at(3), action: 'download', attachmentId: removedFile }),
			row({ at: at(4), actorId: goneActor }),
			row({ at: at(5), conversationId: purged }),
			row({ at: at(6), appId: await insertApp() }),
		]
		await testDb.insert(conversationAccessLog).values(rows)

		const page = await listAccessLog(owner, appId, FIRST_PAGE)
		expect(page.total).toBe(5)
		expect(page.rows).toEqual([
			{
				id: rows[4]!.id,
				at: at(5).toISOString(),
				action: 'view',
				actor: { id: admin.id, name: 'Ada', email: admin.email },
				conversation: null,
				attachment: null,
			},
			{
				id: rows[3]!.id,
				at: at(4).toISOString(),
				action: 'view',
				actor: null,
				conversation: { id, title: 'Trip', userEmail: user.email },
				attachment: null,
			},
			expect.objectContaining({
				id: rows[2]!.id,
				action: 'download',
				attachment: { id: removedFile, name: null },
			}),
			expect.objectContaining({
				id: rows[1]!.id,
				action: 'download',
				attachment: { id: attachmentId, name: 'cat.png' },
			}),
			expect.objectContaining({ id: rows[0]!.id, action: 'view', attachment: null }),
		])
		const second = await listAccessLog(owner, appId, { page: 2, pageSize: 2 })
		expect(second.total).toBe(5)
		expect(ids(second.rows)).toEqual([rows[2]!.id, rows[1]!.id])
	})

	it('refuses an admin', async () => {
		const admin = await account('admin')
		await expect(listAccessLog(admin, await insertApp(), FIRST_PAGE)).rejects.toMatchObject({
			code: 'forbidden',
		})
	})
})

// ADR-0024: every Logs read checks the role itself, whoever called it.
describe('the Logs data layer refuses an account without admin rights', () => {
	it('refuses a user everywhere, before reading or writing anything', async () => {
		const user = await account()
		const appId = await insertApp()
		const id = await insertConversation(user, appId)
		const refused = { code: 'forbidden' }
		await expect(findLogsApp(user, appId)).rejects.toMatchObject(refused)
		await expect(listAppLogs(user, appId, ALL, FIRST_PAGE)).rejects.toMatchObject(refused)
		await expect(listLogUsers(user, appId)).rejects.toMatchObject(refused)
		await expect(readLogThread(user, appId, id, { turns: 20 })).rejects.toMatchObject(refused)
		await expect(listAccessLog(user, appId, FIRST_PAGE)).rejects.toMatchObject(refused)
		expect(await viewRows(id)).toEqual([])
	})
})

// readThreadPage is now findConversation plus readThreadPageOf: what it answers does not change.
describe('readThreadPage after the split', () => {
	it('answers readThreadPageOf’s page for the user’s own conversation, and null for one the user may not read', async () => {
		const user = await account()
		const stranger = await account()
		const appId = await insertApp()
		const id = await insertConversation(user, appId)
		const runId = await insertTurn(id, new Date(Date.now() - 1000), 'hello')
		await testDb
			.update(conversationRuns)
			.set({ usage: [{ totalTokens: 12 }] })
			.where(eq(conversationRuns.id, runId))
		const page = await readThreadPage(user, appId, id, { turns: 20 })
		expect(page).toEqual(await readThreadPageOf(page!.conversation, { turns: 20 }))
		expect(page!.runs.map(run => [run.id, run.usage])).toEqual([[runId, [{ totalTokens: 12 }]]])
		expect(await readThreadPage(stranger, appId, id, { turns: 20 })).toBeNull()
		const deleted = await insertConversation(user, appId, { deletedAt: new Date() })
		expect(await readThreadPage(user, appId, deleted, { turns: 20 })).toBeNull()
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-log-view.test.ts`

Expected: FAIL, `Error: Cannot find package '@/lib/chat/log-view' imported from …/__tests__/chat-log-view.test.ts`, `Test Files  1 failed (1)`.

Run: `pnpm exec vitest run --project db __tests__/db/logs.db.test.ts`

Expected: FAIL, `Error: Cannot find package '@/lib/data/logs' imported from …/__tests__/db/logs.db.test.ts`, `Test Files  1 failed (1)`; the global setup starts the e2e PostgreSQL first and stops it after.

- [ ] **Step 3: Split the page reader and read the runs' usage**

In `lib/data/conversations.ts` (as of Task 10), find:

```ts
/** A run as a history page answers it: with the answers it was started with, which `turnsFromMessages` records. */
export interface ThreadRun extends StoredRun {
	/** The `resume` list startRun stored, as stored (null for a run that answered nothing); `readResume` reads it. */
	resume: unknown
}
```

Replace with:

```ts
/**
 * A run as a history page answers it: with the answers it was started with, which `turnsFromMessages` records, and the
 * usage its terminal event reported, which the Logs' run timeline reads (2c's plan call P18; lib/chat/log-view.ts).
 */
export interface ThreadRun extends StoredRun {
	/** The `resume` list startRun stored, as stored (null for a run that answered nothing); `readResume` reads it. */
	resume: unknown
	/** RUN_FINISHED's or RUN_ERROR's `usage` as stored (null when the agent reported none); `tokensOf` reads it. */
	usage: unknown
}
```

Find (the first lines of `readThreadPage`'s body, as Task 10 leaves them):

```ts
const conversation = await findConversation(actor, appId, conversationId)
if (!conversation) return null
const db = getDb()
const inConversation = eq(conversationMessages.conversationId, conversationId)
```

Replace with:

```ts
	const conversation = await findConversation(actor, appId, conversationId)
	return conversation ? readThreadPageOf(conversation, page) : null
}

/**
 * The page readThreadPage answers, of a conversation its caller has already found and may read: the user's own, found
 * by readThreadPage, or any conversation of the app, deleted ones included, which the admin's Logs find
 * (lib/data/logs.ts `readLogThread`, 2c's plan call P18). One reader, so both see the same turns.
 */
export async function readThreadPageOf(
	conversation: ConversationRecord,
	page: { before?: number; turns: number },
): Promise<ThreadPage> {
	const conversationId = conversation.id
	const db = getDb()
	const inConversation = eq(conversationMessages.conversationId, conversationId)
```

The rest of the former body is now `readThreadPageOf`'s, unchanged: it reads `conversationId`, `page` and `conversation` as before, and every `return` in it answers a page (the only `null` was the line replaced above), so its type is `Promise<ThreadPage>`. Then find:

```ts
		.select({ ...runColumns, resume: conversationRuns.resume })
```

Replace with:

```ts
		.select({ ...runColumns, resume: conversationRuns.resume, usage: conversationRuns.usage })
```

And find:

```ts
		runs: runs.map(({ resume, ...run }) => ({ ...toStoredRun(run), resume })),
```

Replace with:

```ts
		runs: runs.map(({ resume, usage, ...run }) => ({ ...toStoredRun(run), resume, usage })),
```

- [ ] **Step 4: Export `interruptsOf` and `hasIcon`**

In `lib/chat/turn.ts` (as of Task 10, which leaves this line as it is), find:

```ts
const interruptsOf = (outcome: unknown): Interrupt[] =>
```

Replace with:

```ts
/** A stored outcome's interrupts (AG-UI 1.0 interrupt-resume: RUN_FINISHED's interrupt outcome), or none. */
export const interruptsOf = (outcome: unknown): Interrupt[] =>
```

In `lib/data/apps.ts`, find:

```ts
/** Whether an image is stored, computed by the database: no read selects the bytes (getAppIcon serves them). */
const hasIcon = sql<boolean>`${apps.iconImage} IS NOT NULL`.mapWith(Boolean)
```

Replace with:

```ts
/**
 * Whether an image is stored, computed by the database: no read selects the bytes (getAppIcon serves them). The Logs page
 * names the app with it too (lib/data/logs.ts).
 */
export const hasIcon = sql<boolean>`${apps.iconImage} IS NOT NULL`.mapWith(Boolean)
```

- [ ] **Step 5: Create `lib/chat/log-view.ts`**

```ts
import * as z from 'zod'

// Client-safe: the type import below is erased (TypeScript `import type`), so the server-only data layer never reaches
// the bundle, as components/shared-chat/api.ts imports its types.
import type { ThreadRun } from '@/lib/data/conversations'

import { readResume } from './sent-answers'
import type { RunStatus } from './statuses'
import { interruptsOf, type HistoryTurn } from './turn'

/*
 * What the admin's Logs read of a conversation (Part 2 spec §7.2; 2c's plan calls P17, P18): a run as the transcript
 * drawer's timeline shows it, and the tokens a run's stored `usage` reports, which the Logs list sums per conversation
 * (lib/data/logs.ts). Client-safe and pure: the logs route (app/api/apps/[appId]/logs/[conversationId]) answers
 * `LogConversationPage`, which the drawer reads; `@ag-ui/core` is not imported (spec §9), so its `TokenUsage` is read
 * with zod below.
 */

/** P18: a stored run as the drawer's timeline shows it. */
export interface LogRunView {
	id: string
	status: RunStatus
	/** ISO 8601. */
	startedAt: string
	/** ISO 8601; null while the run runs. */
	finishedAt: string | null
	tokens: number | null
	error: { code?: string; message: string } | null
	/** The interrupts its outcome named. */
	interrupts: number
	/** The answers it was started with (its `resume` entries). */
	answers: number
}

/** GET /api/apps/[appId]/logs/[conversationId] (P18): the user's history page shape, the page's runs and the facts. */
export interface LogConversationPage {
	conversation: {
		id: string
		title: string
		user: { id: string; name: string | null; email: string }
		/** ISO 8601. */
		createdAt: string
		/** ISO 8601: the last activity. */
		updatedAt: string
		/** ISO 8601, or null; purged PURGE_AFTER_DAYS later. */
		deletedAt: string | null
		state: unknown
	}
	turns: HistoryTurn[]
	runs: LogRunView[]
	cursor: string | null
}

/**
 * A count as `@ag-ui/core` 1.0.2's `TokenUsageSchema` checks one (`dist/schemas.mjs`): a non-negative integer within the
 * safe integers ("a count above the JSON safe-integer range does not survive a round trip"), which zod 4's `z.int()`
 * restricts to ("Integers").
 */
const tokenCount = z.int().min(0).optional()

/**
 * AG-UI 1.0 `RunFinishedEvent.usage` and `RunErrorEvent.usage`: `TokenUsage[]`, one entry per provider and model. Only
 * the three counts are read; the entry's other fields are kept as `TokenUsageSchema` keeps them (zod 4 `z.looseObject`).
 */
const tokenUsageSchema = z.array(
	z.looseObject({ inputTokens: tokenCount, outputTokens: tokenCount, totalTokens: tokenCount }),
)

/**
 * P17: a run's tokens from its stored `usage`. Each entry counts its `totalTokens`, else its `inputTokens` plus its
 * `outputTokens` (AG-UI 1.0 `TokenUsage`: "totalTokens is the two totals summed"; "A consumer that only wants totals
 * sums across the entries"); an entry with none of the three counts nothing. Null when no entry has a count, and for a
 * value that is not a `TokenUsage[]` (nothing reported, or a malformed record), so a wrong number is never shown.
 */
export const tokensOf = (usage: unknown): number | null => {
	const parsed = tokenUsageSchema.safeParse(usage)
	if (!parsed.success) return null
	const counts = parsed.data.flatMap(({ inputTokens, outputTokens, totalTokens }) => {
		if (totalTokens !== undefined) return [totalTokens]
		if (inputTokens === undefined && outputTokens === undefined) return []
		return [(inputTokens ?? 0) + (outputTokens ?? 0)]
	})
	return counts.length ? counts.reduce((sum, count) => sum + count, 0) : null
}

/**
 * P18: a stored run as the drawer's timeline shows it. The error keeps RUN_ERROR's two fields (the store's refusal flag
 * is the hub's own); the interrupts are its outcome's (lib/chat/turn.ts `interruptsOf`), the answers its `resume` list
 * (lib/chat/sent-answers.ts `readResume`), each read with the tolerance the turn reads them with.
 */
export const logRunView = (run: ThreadRun): LogRunView => ({
	id: run.id,
	status: run.status,
	startedAt: run.startedAt.toISOString(),
	finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
	tokens: tokensOf(run.usage),
	error: run.error
		? run.error.code === undefined
			? { message: run.error.message }
			: { code: run.error.code, message: run.error.message }
		: null,
	interrupts: interruptsOf(run.outcome).length,
	answers: readResume(run.resume).length,
})
```

- [ ] **Step 6: Create `lib/data/logs.ts`**

```ts
import 'server-only'

import {
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	sql,
	type SQL,
} from 'drizzle-orm'
import { alias, QueryBuilder } from 'drizzle-orm/pg-core'

import { getDb } from '@/db'
import {
	apps,
	conversationAccessLog,
	conversationAttachments,
	conversationMessages,
	conversationRuns,
	conversations,
	users,
} from '@/db/schema'
import { isActive } from '@/lib/auth/account-status'
import { assertAdmin, AuthError, type SessionUser } from '@/lib/auth/session'
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import { tokensOf } from '@/lib/chat/log-view'
import {
	LOG_STATUSES,
	type AccessAction,
	type LogStatus,
	type RunStatus,
} from '@/lib/chat/statuses'
import { isId } from '@/lib/ids'
import { isProviderId } from '@/lib/providers/ids'
import { providerDefinition } from '@/lib/providers/registry'

import { recordAccess } from './access-log'
import { hasIcon } from './apps'
import { readThreadPageOf, type ThreadPage } from './conversations'
import type { UserOption } from './users'

/*
 * The admin's Logs (Part 2 spec §7.2; ADR-0024; 2c's plan calls P16–P19): every conversation of an app whose provider
 * keeps the hub's history, read-only. Every function takes the verified actor first and refuses anyone without admin
 * rights (assertAdmin), whoever called it; the access log is the owner's alone. Opening a transcript writes its `view`
 * row (lib/data/access-log.ts) before anything of it is read; nothing here writes in a user's conversation (an admin
 * never does, not even the stale-run truncation the user's own read runs).
 */

export interface LogFilters {
	from?: Date
	to?: Date
	userId?: string
	status?: LogStatus
	includeDeleted: boolean
}

export interface LogPageQuery {
	page: number
	pageSize: number
}

export interface LogListRow {
	id: string
	title: string
	user: { id: string; name: string | null; email: string }
	messages: number
	/** P17: null when no run reported usage. */
	tokens: number | null
	/** ISO 8601. */
	updatedAt: string
	statuses: LogStatus[]
	/** ISO 8601, or null; the purge date is deletedAt + PURGE_AFTER_DAYS. */
	deletedAt: string | null
}

export interface LogThread extends ThreadPage {
	user: { id: string; name: string | null; email: string }
	createdAt: Date
	deletedAt: Date | null
}

export interface AccessLogRow {
	id: string
	/** ISO 8601. */
	at: string
	action: AccessAction
	/** null when the account is gone (the log has no foreign keys). */
	actor: { id: string; name: string | null; email: string } | null
	/** null when the conversation was purged. */
	conversation: { id: string; title: string; userEmail: string } | null
	/** P19: a download's file; `name` null once the file is gone (the log has no foreign keys); null for a view. */
	attachment: { id: string; name: string | null } | null
}

/** P16: the largest page the Logs' tables ask for (antd Pagination's `pageSizeOptions` end at 100). */
const LOG_PAGE_SIZE_MAX = 100

/** A page's LIMIT and OFFSET, as Drizzle's guide "Limit/Offset pagination" computes them, within the bounds. */
const pageWindow = ({ page, pageSize }: LogPageQuery) => {
	const limit = Math.min(Math.max(Math.trunc(pageSize), 1), LOG_PAGE_SIZE_MAX)
	return { limit, offset: (Math.max(Math.trunc(page), 1) - 1) * limit }
}

/*
 * P17's tags as SQL over the outer query's `conversations` row, so the list's filter, its total and its row tags read one
 * definition. The subqueries are built with Drizzle's standalone query builder (Drizzle "Goodies", Standalone Query
 * Builder: `new QueryBuilder()`, as lib/data/apps.ts builds `visibleTo`) on table aliases (Drizzle "Aliases", `alias()`),
 * correlated on `conversations.id`, and used as Drizzle's filters take a subquery: `exists(query)` and
 * `inArray(column, query)` (Drizzle "Filters").
 */
const qb = new QueryBuilder()

/**
 * The id of the conversation's newest run, and of the run it continues by lib/data/conversations.ts `continuedRun`'s rule
 * (2b's plan call P10, decision 62: its newest run the agent started, a run refused before its stream passed over): one
 * row, or none before the first run, which `IN` reads as no match (PostgreSQL 18 "Subquery Expressions", 9.24.2 IN).
 */
const latestRun = alias(conversationRuns, 'latest_run')
const newestRunId = qb
	.select({ id: latestRun.id })
	.from(latestRun)
	.where(eq(latestRun.conversationId, conversations.id))
	.orderBy(desc(latestRun.startedAt), desc(latestRun.id))
	.limit(1)
const continuedRunId = qb
	.select({ id: latestRun.id })
	.from(latestRun)
	.where(
		and(
			eq(latestRun.conversationId, conversations.id),
			sql`coalesce(${latestRun.error} ->> 'beforeStream', 'false') <> 'true'`,
		),
	)
	.orderBy(desc(latestRun.startedAt), desc(latestRun.id))
	.limit(1)

/** Whether the run the subquery names ended in one of the statuses: EXISTS is true or false, never NULL (9.24.1). */
const endedRun = alias(conversationRuns, 'ended_run')
const runEnded = (runId: typeof newestRunId, statuses: RunStatus[]) =>
	exists(
		qb
			.select({ one: sql`1` })
			.from(endedRun)
			.where(and(inArray(endedRun.id, runId), inArray(endedRun.status, statuses))),
	)

/**
 * The conversation's tool results' call ids as one jsonb array (`[]` when it has none): each tool message's
 * `toolCallId` (AG-UI 1.0 `ToolMessage`), collected by `jsonb_agg` (PostgreSQL 18 "Aggregate Functions", Table 9.62).
 */
const toolResult = alias(conversationMessages, 'tool_result')
const answeredCallIds = qb
	.select({ ids: sql`coalesce(jsonb_agg(${toolResult.body} -> 'toolCallId'), '[]'::jsonb)` })
	.from(toolResult)
	.where(and(eq(toolResult.conversationId, conversations.id), eq(toolResult.role, 'tool')))

/**
 * An assistant message's calls to the hub's `ask_user` tool, their ids as one jsonb array: `jsonb_path_query_array` with
 * the tool's name in `vars` (PostgreSQL 18 "JSON Functions and Operators", Table 9.51), in lax mode, where a message
 * without `toolCalls` finds nothing rather than failing (9.16.2.2 "Strict and Lax Modes").
 */
const ASK_USER_CALL_IDS = '$.toolCalls[*] ? (@.function.name == $name).id'
const ASK_USER_VARS = JSON.stringify({ name: ASK_USER_TOOL_NAME })
const asking = alias(conversationMessages, 'asking_message')
const askedCallIds = sql`jsonb_path_query_array(${asking.body}, ${ASK_USER_CALL_IDS}::jsonpath, ${ASK_USER_VARS}::jsonb)`

/**
 * P17's "a call to ask_user without a result": an assistant message of the continued run whose `ask_user` calls are not
 * all answered. `@>` is containment (Table 9.48), for arrays regardless of order and duplicates, so `answered @> asked`
 * holds when every asked id has a result and when nothing was asked (8.14.3 "jsonb Containment and Existence"). The
 * answered ids are a scalar subquery, its one row's value (PostgreSQL 18 4.2.11 "Scalar Subqueries").
 */
const unansweredAskUser = exists(
	qb
		.select({ one: sql`1` })
		.from(asking)
		.where(
			and(
				eq(asking.conversationId, conversations.id),
				inArray(asking.runId, continuedRunId),
				eq(asking.role, 'assistant'),
				sql`NOT (${answeredCallIds} @> ${askedCallIds})`,
			),
		),
)

/**
 * P17: failed (the newest run failed), stopped (the newest run was cancelled or truncated), waiting (the continued run
 * ended interrupted, or left an `ask_user` call without a result). The status filter matches one of them.
 */
const STATUS_CONDITIONS: Record<LogStatus, SQL> = {
	failed: runEnded(newestRunId, ['failed']),
	stopped: runEnded(newestRunId, ['cancelled', 'truncated']),
	waiting: sql`(${runEnded(continuedRunId, ['interrupted'])} OR ${unansweredAskUser})`,
}

/** A tag as a selected boolean (Drizzle "Magical sql operator": `sql<T>` types it, `.mapWith()` maps it). */
const tagged = (condition: SQL) => sql<boolean>`${condition}`.mapWith(Boolean)

/** P16's filters on the `(app_id, updated_at)` index; `from` and `to` bound the last activity, both included. */
const logFilters = (appId: string, filters: LogFilters): SQL | undefined =>
	and(
		eq(conversations.appId, appId),
		filters.includeDeleted ? undefined : isNull(conversations.deletedAt),
		filters.from ? gte(conversations.updatedAt, filters.from) : undefined,
		filters.to ? lte(conversations.updatedAt, filters.to) : undefined,
		filters.userId ? eq(conversations.userId, filters.userId) : undefined,
		filters.status ? STATUS_CONDITIONS[filters.status] : undefined,
	)

/**
 * The app as the Logs page names it (P20): null when it is missing, malformed (lib/ids.ts: answered as an unknown one),
 * or of a provider whose conversations the hub does not keep (the registry's `hubHistory`, spec §4.1). A disabled app's
 * Logs stay readable.
 */
export async function findLogsApp(
	actor: SessionUser,
	appId: string,
): Promise<{ id: string; name: string; description: string; hasIcon: boolean } | null> {
	assertAdmin(actor)
	if (!isId(appId)) return null
	const [row] = await getDb()
		.select({
			id: apps.id,
			name: apps.name,
			description: apps.description,
			hasIcon,
			provider: apps.provider,
		})
		.from(apps)
		.where(eq(apps.id, appId))
		.limit(1)
	if (!row || !isProviderId(row.provider) || !providerDefinition(row.provider).hubHistory)
		return null
	return { id: row.id, name: row.name, description: row.description, hasIcon: row.hasIcon }
}

/**
 * P16, P17: one numbered page of the app's conversations and the total with the same filters (antd Table's server-side
 * `pagination`; Dify, Langfuse and agenticos page their admin lists with offset and an exact count, research R3 §2). The
 * order is `updated_at DESC, id DESC`: the id makes it unique (PostgreSQL 18 §7.6 "LIMIT and OFFSET": "use an ORDER BY
 * clause that constrains the result rows into a unique order"), so a conversation that moves while an admin pages may
 * repeat or be skipped once (Drizzle guide "Limit/Offset pagination"), never at random. The total is Drizzle's `$count`
 * (`select count(*) … where …`) over the same filters; each row's messages (its `user` and `assistant` rows) and tokens
 * (its runs' usage, `tokensOf`) are read for the page's rows only.
 */
export async function listAppLogs(
	actor: SessionUser,
	appId: string,
	filters: LogFilters,
	page: LogPageQuery,
): Promise<{ rows: LogListRow[]; total: number }> {
	assertAdmin(actor)
	const db = getDb()
	const where = logFilters(appId, filters)
	const { limit, offset } = pageWindow(page)
	const [rows, total] = await Promise.all([
		db
			.select({
				id: conversations.id,
				title: conversations.title,
				userId: users.id,
				userName: users.name,
				userEmail: users.email,
				updatedAt: conversations.updatedAt,
				deletedAt: conversations.deletedAt,
				failed: tagged(STATUS_CONDITIONS.failed),
				stopped: tagged(STATUS_CONDITIONS.stopped),
				waiting: tagged(STATUS_CONDITIONS.waiting),
			})
			.from(conversations)
			.innerJoin(users, eq(users.id, conversations.userId))
			.where(where)
			.orderBy(desc(conversations.updatedAt), desc(conversations.id))
			.limit(limit)
			.offset(offset),
		db.$count(conversations, where),
	])
	if (!rows.length) return { rows: [], total }
	const ids = rows.map(row => row.id)
	const [messageCounts, runUsage] = await Promise.all([
		db
			.select({ conversationId: conversationMessages.conversationId, messages: count() })
			.from(conversationMessages)
			.where(
				and(
					inArray(conversationMessages.conversationId, ids),
					inArray(conversationMessages.role, ['user', 'assistant']),
				),
			)
			.groupBy(conversationMessages.conversationId),
		db
			.select({ conversationId: conversationRuns.conversationId, usage: conversationRuns.usage })
			.from(conversationRuns)
			.where(and(inArray(conversationRuns.conversationId, ids), isNotNull(conversationRuns.usage))),
	])
	const messagesOf = new Map(messageCounts.map(row => [row.conversationId, row.messages]))
	const tokensOfConversation = new Map<string, number>()
	for (const run of runUsage) {
		const tokens = tokensOf(run.usage)
		if (tokens !== null)
			tokensOfConversation.set(
				run.conversationId,
				(tokensOfConversation.get(run.conversationId) ?? 0) + tokens,
			)
	}
	return {
		rows: rows.map(row => ({
			id: row.id,
			title: row.title,
			user: { id: row.userId, name: row.userName, email: row.userEmail },
			messages: messagesOf.get(row.id) ?? 0,
			tokens: tokensOfConversation.get(row.id) ?? null,
			updatedAt: row.updatedAt.toISOString(),
			statuses: LOG_STATUSES.filter(status => row[status]),
			deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
		})),
		total,
	}
}

/**
 * P16: the accounts with a conversation in this app, deleted conversations included, for the user filter; by email, each
 * tagged active or not as the app pickers' options are (lib/data/users.ts `listUserOptions`).
 */
export async function listLogUsers(actor: SessionUser, appId: string): Promise<UserOption[]> {
	assertAdmin(actor)
	const rows = await getDb()
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			adminDeactivatedAt: users.adminDeactivatedAt,
			directoryDeactivatedAt: users.directoryDeactivatedAt,
		})
		.from(users)
		.where(
			exists(
				qb
					.select({ one: sql`1` })
					.from(conversations)
					.where(and(eq(conversations.appId, appId), eq(conversations.userId, users.id))),
			),
		)
		.orderBy(asc(users.email))
	return rows.map(row => ({ id: row.id, name: row.name, email: row.email, active: isActive(row) }))
}

/**
 * P18: a page of any conversation of the app, deleted ones included until the purge, with its user and dates; null when
 * there is none (a malformed id is never read, lib/ids.ts). The first page (no `before`) writes the `view` row before
 * anything of the transcript is read (spec §7.2), so "load earlier" in the same drawer is one view, and nothing else is
 * written: an admin's read leaves a stale run as it finds it.
 */
export async function readLogThread(
	actor: SessionUser,
	appId: string,
	conversationId: string,
	page: { before?: number; turns: number },
): Promise<LogThread | null> {
	assertAdmin(actor)
	if (!isId(appId) || !isId(conversationId)) return null
	const [row] = await getDb()
		.select({
			id: conversations.id,
			appId: conversations.appId,
			title: conversations.title,
			state: conversations.state,
			activeRunId: conversations.activeRunId,
			updatedAt: conversations.updatedAt,
			createdAt: conversations.createdAt,
			deletedAt: conversations.deletedAt,
			userId: users.id,
			userName: users.name,
			userEmail: users.email,
		})
		.from(conversations)
		.innerJoin(users, eq(users.id, conversations.userId))
		.where(and(eq(conversations.id, conversationId), eq(conversations.appId, appId)))
		.limit(1)
	if (!row) return null
	if (page.before === undefined)
		await recordAccess(actor, { conversationId: row.id, appId: row.appId, action: 'view' })
	const { createdAt, deletedAt, userId, userName, userEmail, ...conversation } = row
	const thread = await readThreadPageOf(conversation, page)
	return {
		...thread,
		user: { id: userId, name: userName, email: userEmail },
		createdAt,
		deletedAt,
	}
}

/**
 * P19: the app's access log, newest first on the `(app_id, at)` index, a numbered page and the total, for the owner only
 * (spec §7.2; anyone else, an admin included, is refused with AuthError('forbidden')). The log has no foreign keys
 * (spec §7.2), so the actor, the conversation with its user, and a download's file are left joins (Drizzle "Joins",
 * `leftJoin`, with `alias()` for the second read of `users`): each is null once it is gone.
 */
export async function listAccessLog(
	actor: SessionUser,
	appId: string,
	page: LogPageQuery,
): Promise<{ rows: AccessLogRow[]; total: number }> {
	assertAdmin(actor)
	if (actor.role !== 'owner') throw new AuthError('forbidden')
	const db = getDb()
	const { limit, offset } = pageWindow(page)
	const accessor = alias(users, 'accessor')
	const conversationUser = alias(users, 'conversation_user')
	const where = eq(conversationAccessLog.appId, appId)
	const [rows, total] = await Promise.all([
		db
			.select({
				id: conversationAccessLog.id,
				at: conversationAccessLog.at,
				action: conversationAccessLog.action,
				actorId: accessor.id,
				actorName: accessor.name,
				actorEmail: accessor.email,
				conversationId: conversations.id,
				conversationTitle: conversations.title,
				conversationUserEmail: conversationUser.email,
				attachmentId: conversationAccessLog.attachmentId,
				attachmentName: conversationAttachments.name,
			})
			.from(conversationAccessLog)
			.leftJoin(accessor, eq(accessor.id, conversationAccessLog.actorId))
			.leftJoin(conversations, eq(conversations.id, conversationAccessLog.conversationId))
			.leftJoin(conversationUser, eq(conversationUser.id, conversations.userId))
			.leftJoin(
				conversationAttachments,
				eq(conversationAttachments.id, conversationAccessLog.attachmentId),
			)
			.where(where)
			.orderBy(desc(conversationAccessLog.at), desc(conversationAccessLog.id))
			.limit(limit)
			.offset(offset),
		db.$count(conversationAccessLog, where),
	])
	return {
		rows: rows.map(row => ({
			id: row.id,
			at: row.at.toISOString(),
			action: row.action,
			actor:
				row.actorId !== null && row.actorEmail !== null
					? { id: row.actorId, name: row.actorName, email: row.actorEmail }
					: null,
			conversation:
				row.conversationId !== null &&
				row.conversationTitle !== null &&
				row.conversationUserEmail !== null
					? {
							id: row.conversationId,
							title: row.conversationTitle,
							userEmail: row.conversationUserEmail,
						}
					: null,
			attachment:
				row.attachmentId === null ? null : { id: row.attachmentId, name: row.attachmentName },
		})),
		total,
	}
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm exec vitest run --project db __tests__/db/logs.db.test.ts && pnpm exec vitest run --project unit __tests__/chat-log-view.test.ts`

Expected: PASS, `Test Files  1 passed (1)`, `Tests  14 passed (14)` (the db file), then `Test Files  1 passed (1)`, `Tests  26 passed (26)`.

- [ ] **Step 8: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/log-view.ts lib/data/logs.ts lib/data/conversations.ts lib/chat/turn.ts lib/data/apps.ts __tests__/chat-log-view.test.ts __tests__/db/logs.db.test.ts
pnpm exec oxfmt --check lib/chat/log-view.ts lib/data/logs.ts lib/data/conversations.ts lib/chat/turn.ts lib/data/apps.ts __tests__/chat-log-view.test.ts __tests__/db/logs.db.test.ts
pnpm test
pnpm test:db
```

Expected: tsc exits 0; oxlint prints no finding; oxfmt "All matched files use the correct format."; `pnpm test` 0 failed; `pnpm test:db` 0 failed (`conversations-read.db.test.ts` and `conversations-run.db.test.ts` pass unchanged: `readThreadPage` answers what it did).

- [ ] **Step 9: Commit**

```bash
git add lib/chat/log-view.ts lib/data/logs.ts lib/data/conversations.ts lib/chat/turn.ts lib/data/apps.ts __tests__/chat-log-view.test.ts __tests__/db/logs.db.test.ts
git commit -m "feat(logs): the Logs' data layer: pages, tags, transcripts and the access log

lib/data/logs.ts answers the admin's Logs (Part 2 spec §7.2; plan calls
P16-P19): one numbered page of an app's conversations in updated_at, id
order with the total of the same filters, each row's messages, tokens and
tags (failed, stopped, waiting, by the newest and the continued run, in SQL
the filter shares), the accounts for the user filter, a transcript page of
any conversation of the app that writes its view row on the first page
only, and the access log for the owner alone. Every function checks the
role itself (ADR-0024). readThreadPage becomes findConversation plus
readThreadPageOf, so the admin's read pages the user's way, and runs carry
their usage; lib/chat/log-view.ts reads AG-UI TokenUsage and a run's
timeline entry, client-safe.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the 7 files; lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": ["lib/chat/log-view.ts", "lib/data/logs.ts", "lib/data/conversations.ts", "lib/chat/turn.ts", "lib/data/apps.ts", "__tests__/chat-log-view.test.ts", "__tests__/db/logs.db.test.ts"], "verifyCommand": "pnpm exec vitest run --project db __tests__/db/logs.db.test.ts && pnpm exec vitest run --project unit __tests__/chat-log-view.test.ts", "acceptanceCriteria": ["tokensOf reads totalTokens, else inputTokens + outputTokens, sums the entries, and answers null for no usage, an empty list, entries without counts and malformed input; logRunView answers ISO times, tokens, the error without beforeStream, the interrupt and answer counts", "listAppLogs pages in updated_at DESC, id DESC order with the total of the same filters; from/to inclusive, userId and includeDeleted filter; rows carry user, title, messages, tokens, updatedAt, statuses, deletedAt", "failed and stopped read the newest run, waiting the continued run (interrupted, or an ask_user call without a tool result); the status filter matches a tag", "findLogsApp names an AG-UI app and answers null for Dify, unknown and malformed ids; listLogUsers lists the app's accounts by email with active", "readLogThread reads any conversation of the app with its user and dates, answers readThreadPage's page, writes one view row on the first page only and none when not found", "listAccessLog is the owner's: newest first, total, pages, null actor/conversation/attachment name once gone; admins and users get forbidden; every Logs function refuses a user", "readThreadPage answers readThreadPageOf's page and null as before; runs carry usage", "tsc exits 0, pnpm test 0 failed, pnpm test:db 0 failed, oxlint and oxfmt clean"], "modelTier": "standard"}
```

---

### Task 14: The Logs route and the row action

**Goal:** `GET /api/apps/[appId]/logs/[conversationId]` answers an owner or admin one page of any conversation of an AG-UI app as `LogConversationPage` (and writes the `view` row through the data layer), `components/admin/logs/logs-api.ts` is the browser's way to it, and the apps table's "more" menu offers "Logs" on the apps whose provider keeps the hub's history.

Spec §7.2 ("Entry: a "Logs" row action in the apps table on apps whose provider has `hubHistory` (§4.1) … the flag hides the action where the hub holds no history"; "Detail: a large antd `Drawer` that fetches `GET /api/apps/[appId]/logs/[conversationId]` when opened (a Route Handler, so a prefetch never writes an audit row; owner and admin, checked in the handler and the data layer)"), spec §4.1 (`hubHistory`: AG-UI true, Dify false until Part 3), ADR-0024 (the role checked by the entry point and again by the DAL), plan calls P18 (the user's history page shape, 20 turns and "load earlier"; the page's runs as timeline entries; the conversation's facts) and P20 (`AdminAppDto.hubHistory` read from the server registry, since the client registry `PROVIDER_UI` holds no behaviour; "Logs" after "User view", a link to `/app-management/<id>/logs` in the same tab), and the Shared contracts' routes table and `createLogsApi`. Docs checked: Next 16.3 bundled docs, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` ("You can type the Route Handler context using `RouteContext` … After type generation, the `RouteContext` helper is globally available"), `01-app/02-guides/backend-for-frontend.md` line 827 ("Always verify credentials before granting access. Do not rely on proxy alone for authentication and authorization"; the directory group search route checks the session and the role the same way), `01-app/03-api-reference/02-components/link.md` ("Linking to dynamic route segments": a template literal `href`; "Prefetching is only enabled in production", and the Logs page itself writes nothing, so a prefetch of it writes no row); antd 6.6.5 `npx -y @ant-design/cli doc Menu --version 6.6.5` (`ItemType`, `MenuItemType.label`: "Menu label", `ReactNode`) and `npx -y @ant-design/cli demo Dropdown basic --version 6.6.5` (menu items whose `label` is an `<a>`, as the existing "User view" item is). **A repository fix this task needs first:** `.gitignore` line 48 is `logs/`, and a pattern with no slash at its beginning or middle "may also match at any level below the .gitignore level" (gitignore(5), "PATTERN FORMAT": "frotz/ matches frotz and a/frotz that is a directory"), so every folder named `logs` is ignored, `app/api/apps/[appId]/logs/` and `components/admin/logs/` here and `app/(admin)/app-management/[appId]/logs/` in Task 15 included, and `git add` refuses their files ("The following paths are ignored by one of your .gitignore files"). The task anchors it to the root, `/logs/`, which keeps ignoring the root folder of runtime logs it was written for. `.dockerignore`'s `logs` needs no change: Docker matches its patterns from the root of the context ("Leading and trailing slashes in ignore patterns are disregarded", docs.docker.com/build/concepts/context, ".dockerignore files"), so it never reached these folders. The route checks the session, then the role (403 `forbidden` for a user, the one definition `forbiddenResponse`), then the app (a malformed id is never read, lib/ids.ts; `findLogsApp` null for a missing app or one whose provider keeps no history: 404 `app_not_found`), then `before` with the user's read's own `threadQuerySchema`, then the conversation (404 `conversation_not_found`, the envelope `lib/chat/route.ts` defines); it never reconciles a stale run (an admin writes nothing in a user's conversation). The turns are `turnsFromMessages(rows, runs, files)` (Task 10), the runs `logRunView` (Task 13). Task 16's drawer calls `createLogsApi`; Task 19's e2e opens "Logs" from the menu (`getByRole('menuitem', { name: 'Logs' })`).

**Files:**

- Modify: `.gitignore` (`logs/` anchored to the root)
- Create: `app/api/apps/[appId]/logs/[conversationId]/route.ts`
- Create: `components/admin/logs/logs-api.ts`
- Modify: `lib/data/apps.ts` (`AdminAppCommon.hubHistory`, set in `toAdminAppDto`; as of Task 13)
- Modify: `components/admin/apps/app-actions.tsx` (the "Logs" item)
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (`admin_apps.logs`)
- Test: `__tests__/admin-logs-route.test.ts` (the whole file, below)
- Test: `__tests__/api-routes.test.ts` (the route pinned; as of Task 8)
- Test: `__tests__/data-apps.test.ts` (the Dify admin DTO gains `hubHistory: false`; a new case; as of Task 2)
- Test: `__tests__/app-form-values.test.ts`, `__tests__/provider-ui.test.ts` (typed `AdminAppDto` fixtures gain `hubHistory: false`; `provider-ui.test.ts` as of Task 2)

**Acceptance Criteria:**

- [ ] `git check-ignore components/admin/logs/logs-api.ts 'app/api/apps/[appId]/logs/[conversationId]/route.ts'` prints nothing (exit 1); `git check-ignore logs/x.log` still prints `logs/x.log`.
- [ ] `GET /api/apps/<id>/logs/<conversationId>`: signed out → 401 `unauthorized`; a `user` → 403 `forbidden` with no DAL call; a malformed app id, or `findLogsApp` null → 404 `app_not_found`; `?before=0` → 400 `invalid_param` (`Invalid request: before`); a malformed conversation id, or `readLogThread` null → 404 `conversation_not_found`; otherwise `readLogThread(actor, appId, conversationId, { before, turns: 20 })` (`before` a number or undefined) and 200 `LogConversationPage` (ISO dates, `deletedAt` null or ISO, `turns` from `turnsFromMessages`, `runs` from `logRunView`, `cursor`) with `cache-control: private, no-store`; an AuthError from the DAL → its 403 envelope.
- [ ] `createLogsApi(appId).getConversation(id, before?)` fetches `/api/apps/<appId>/logs/<id>` (`?before=<before>` when given) and rejects a non-OK answer with `RequestError` carrying its status and code.
- [ ] `toAdminAppDto` answers `hubHistory: true` for an AG-UI row and `false` for a Dify row, an invalid row included; the apps table's "more" menu shows "Logs" after "User view" only when `hubHistory`, a Next `Link` to `/app-management/<id>/logs`; `admin_apps.logs` is "Logs", "日志" and "السجلات".
- [ ] `__tests__/api-routes.test.ts` admits and lists `apps/[appId]/logs/[conversationId]/route.ts`, and its header comment and second test's title name §7.2.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; `pnpm test:db` reports 0 failed (lib/data/apps.ts changed); oxlint and oxfmt clean on the changed files; `npx -y @ant-design/cli lint ./ --format json` `"total": 0`.

**Verify:** `pnpm exec vitest run --project unit __tests__/admin-logs-route.test.ts __tests__/api-routes.test.ts` → `Test Files  2 passed (2)`, `Tests  11 passed (11)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `__tests__/admin-logs-route.test.ts`:

```ts
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
	verifySession: vi.fn(),
	findLogsApp: vi.fn(),
	readLogThread: vi.fn(),
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession: m.verifySession,
	AuthError: class AuthError extends Error {
		constructor(public readonly code: string) {
			super(code)
		}
	},
}))
vi.mock('@/lib/data/logs', () => ({
	findLogsApp: m.findLogsApp,
	readLogThread: m.readLogThread,
}))

import { GET } from '@/app/api/apps/[appId]/logs/[conversationId]/route'
import { createLogsApi } from '@/components/admin/logs/logs-api'
import { AuthError } from '@/lib/auth/session'
import { RequestError } from '@/lib/http/browser'

const APP_ID = '0b1c2d3e-4f50-4a61-8b72-9c8dae0f1a2b'
const CONVERSATION_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const RUN_ID = '9c8dae0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f'
const admin = { id: 'a1', email: 'ada@example.com', name: 'Ada', role: 'admin', source: 'local' }
const app = { id: APP_ID, name: 'Tea', description: '', hasIcon: false }
const startedAt = new Date('2026-10-15T09:00:00.000Z')

/** A page as lib/data/logs.ts `readLogThread` answers it: one turn, its run, a deleted conversation. */
const thread = {
	conversation: {
		id: CONVERSATION_ID,
		appId: APP_ID,
		title: 'Trip',
		state: { steps: [] },
		activeRunId: null,
		updatedAt: new Date('2026-10-15T09:00:05.000Z'),
	},
	rows: [
		{
			seq: 1,
			messageId: 'm-user',
			runId: RUN_ID,
			role: 'user',
			body: { id: 'm-user', role: 'user', content: 'Plan a trip' },
			status: 'complete',
		},
		{
			seq: 2,
			messageId: 'm-reply',
			runId: RUN_ID,
			role: 'assistant',
			body: { id: 'm-reply', role: 'assistant', content: 'Where to?' },
			status: 'complete',
		},
	],
	runs: [
		{
			id: RUN_ID,
			status: 'succeeded',
			outcome: null,
			error: null,
			custom: [],
			startedAt,
			finishedAt: new Date('2026-10-15T09:00:04.000Z'),
			resume: null,
			usage: [{ inputTokens: 20, outputTokens: 4 }],
		},
	],
	files: [],
	cursor: '1',
	user: { id: 'u1', name: 'Jane', email: 'jane@example.com' },
	createdAt: new Date('2026-10-14T08:00:00.000Z'),
	deletedAt: new Date('2026-10-15T10:00:00.000Z'),
}

const ctx = (appId = APP_ID, conversationId = CONVERSATION_ID) => ({
	params: Promise.resolve({ appId, conversationId }),
})
const get = (query = '') =>
	new NextRequest(`http://hub/api/apps/${APP_ID}/logs/${CONVERSATION_ID}${query}`)
const read = async (response: Response) => ({
	status: response.status,
	body: await response.json(),
})

beforeEach(() => {
	for (const fn of [m.verifySession, m.findLogsApp, m.readLogThread]) fn.mockReset()
	m.verifySession.mockResolvedValue(admin)
	m.findLogsApp.mockResolvedValue(app)
	m.readLogThread.mockResolvedValue(thread)
})

describe('GET logs/[conversationId] (2c plan call P18)', () => {
	it('answers 401 signed out and 403 forbidden for a user, reading nothing', async () => {
		m.verifySession.mockResolvedValue(null)
		expect(await read(await GET(get(), ctx()))).toEqual({
			status: 401,
			body: { code: 'unauthorized', message: 'Sign in required.', status: 401 },
		})
		m.verifySession.mockResolvedValue({ ...admin, role: 'user' })
		expect(await read(await GET(get(), ctx()))).toEqual({
			status: 403,
			body: { code: 'forbidden', message: 'Not allowed.', status: 403 },
		})
		expect(m.findLogsApp).not.toHaveBeenCalled()
		expect(m.readLogThread).not.toHaveBeenCalled()
	})

	it('answers 404 app_not_found for a malformed id and for an app without the hub’s history', async () => {
		const notFound = { code: 'app_not_found', message: 'No such app.', status: 404 }
		expect(await read(await GET(get(), ctx('not-a-uuid')))).toEqual({
			status: 404,
			body: notFound,
		})
		expect(m.findLogsApp).not.toHaveBeenCalled()
		m.findLogsApp.mockResolvedValue(null)
		expect(await read(await GET(get(), ctx()))).toEqual({ status: 404, body: notFound })
		expect(m.findLogsApp).toHaveBeenCalledWith(admin, APP_ID)
		expect(m.readLogThread).not.toHaveBeenCalled()
	})

	it('answers 404 conversation_not_found for a malformed id and a conversation it cannot find', async () => {
		const notFound = {
			code: 'conversation_not_found',
			message: 'No such conversation.',
			status: 404,
		}
		expect(await read(await GET(get(), ctx(APP_ID, 'nope')))).toEqual({
			status: 404,
			body: notFound,
		})
		expect(m.readLogThread).not.toHaveBeenCalled()
		m.readLogThread.mockResolvedValue(null)
		expect(await read(await GET(get(), ctx()))).toEqual({ status: 404, body: notFound })
	})

	it('refuses a malformed `before` with 400 invalid_param before reading the conversation', async () => {
		expect(await read(await GET(get('?before=0'), ctx()))).toEqual({
			status: 400,
			body: { code: 'invalid_param', message: 'Invalid request: before', status: 400 },
		})
		expect(m.readLogThread).not.toHaveBeenCalled()
	})

	it('reads the first page, or the page before `before`, of 20 turns', async () => {
		await GET(get(), ctx())
		expect(m.readLogThread).toHaveBeenLastCalledWith(admin, APP_ID, CONVERSATION_ID, {
			before: undefined,
			turns: 20,
		})
		await GET(get('?before=17'), ctx())
		expect(m.readLogThread).toHaveBeenLastCalledWith(admin, APP_ID, CONVERSATION_ID, {
			before: 17,
			turns: 20,
		})
	})

	it('answers the page as LogConversationPage, never stored', async () => {
		const response = await GET(get(), ctx())
		expect(response.headers.get('cache-control')).toBe('private, no-store')
		expect(await read(response)).toEqual({
			status: 200,
			body: {
				conversation: {
					id: CONVERSATION_ID,
					title: 'Trip',
					user: { id: 'u1', name: 'Jane', email: 'jane@example.com' },
					createdAt: '2026-10-14T08:00:00.000Z',
					updatedAt: '2026-10-15T09:00:05.000Z',
					deletedAt: '2026-10-15T10:00:00.000Z',
					state: { steps: [] },
				},
				turns: [
					{ id: 'm-user', turn: expect.objectContaining({ role: 'user' }) },
					{ id: `turn-${RUN_ID}`, turn: expect.objectContaining({ role: 'assistant' }) },
				],
				runs: [
					{
						id: RUN_ID,
						status: 'succeeded',
						startedAt: '2026-10-15T09:00:00.000Z',
						finishedAt: '2026-10-15T09:00:04.000Z',
						tokens: 24,
						error: null,
						interrupts: 0,
						answers: 0,
					},
				],
				cursor: '1',
			},
		})
	})

	it('answers the data layer’s refusal as its envelope', async () => {
		m.readLogThread.mockRejectedValue(new AuthError('forbidden'))
		expect(await read(await GET(get(), ctx()))).toEqual({
			status: 403,
			body: { code: 'forbidden', message: 'Not allowed.', status: 403 },
		})
	})
})

describe('createLogsApi', () => {
	const fetchMock = vi.fn()
	beforeEach(() => {
		fetchMock.mockReset()
		vi.stubGlobal('fetch', fetchMock)
	})
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('reads a conversation’s first page, and the page before a cursor', async () => {
		fetchMock.mockImplementation(async () => Response.json({ cursor: null }))
		const api = createLogsApi(APP_ID)
		expect(await api.getConversation(CONVERSATION_ID)).toEqual({ cursor: null })
		expect(fetchMock).toHaveBeenLastCalledWith(`/api/apps/${APP_ID}/logs/${CONVERSATION_ID}`)
		await api.getConversation(CONVERSATION_ID, '17')
		expect(fetchMock).toHaveBeenLastCalledWith(
			`/api/apps/${APP_ID}/logs/${CONVERSATION_ID}?before=17`,
		)
	})

	it('rejects with the envelope as a RequestError', async () => {
		fetchMock.mockResolvedValue(
			Response.json(
				{ code: 'conversation_not_found', message: 'No such conversation.', status: 404 },
				{ status: 404 },
			),
		)
		const error = await createLogsApi(APP_ID)
			.getConversation(CONVERSATION_ID)
			.catch((caught: unknown) => caught)
		expect(error).toBeInstanceOf(RequestError)
		expect(error).toMatchObject({ status: 404, code: 'conversation_not_found' })
	})
})
```

In `__tests__/api-routes.test.ts` (as of Task 8), find:

```ts
// conversation list, one conversation, a run's stop) and §7.1 the attachment upload and one attachment's read and
// delete. The forgot and reset password handlers stay as inherited (plan deviation 6, ADR-0024); they are named here so a
// new handler under auth/ still fails the test.
```

Replace with:

```ts
// conversation list, one conversation, a run's stop), §7.1 the attachment upload and one attachment's read and delete,
// and §7.2 the Logs' transcript read. The forgot and reset password handlers stay as inherited (plan deviation 6,
// ADR-0024); they are named here so a new handler under auth/ still fails the test.
```

Then find the end of the `apps/[appId]/` group in the first test's pattern (Tasks 7 and 8 changed its start):

```text
(\/runs\/\[runId\]\/stop)?)?
```

Replace with:

```text
(\/runs\/\[runId\]\/stop)?)?|logs\/\[conversationId\]
```

Then find:

```ts
	it('holds exactly the shared chat routes of spec §4.2 and §7.1 under apps/[appId]/', () => {
```

Replace with:

```ts
	it('holds exactly the routes of spec §4.2, §7.1 and §7.2 under apps/[appId]/', () => {
```

And find:

```ts
			'apps/[appId]/conversations/route.ts',
```

Replace with:

```ts
			'apps/[appId]/conversations/route.ts',
			// 2c's plan call P18: the Logs' transcript read (spec §7.2).
			'apps/[appId]/logs/[conversationId]/route.ts',
```

The list is sorted (`.sort()`), and `logs/` falls between `conversations/` and `runs/`.

In `__tests__/data-apps.test.ts` (as of Task 2, whose AG-UI settings changes leave these fragments as they are), find:

```ts
			enabled: true,
			hasIcon: false,
			access: { mode: 'restricted', groupIds: ['g1'], userIds: ['u1'] },
```

Replace with:

```ts
			enabled: true,
			hasIcon: false,
			hubHistory: false,
			access: { mode: 'restricted', groupIds: ['g1'], userIds: ['u1'] },
```

Then find:

```ts
// DV 11: the CHECK allows no other provider; a row that has one anyway is left out of the list, logged.
```

Replace with:

```ts
// Part 2 spec §4.1, §7.2 (2c's plan call P20): the table offers Logs where the hub keeps the conversations.
it('carries whether the hub keeps the app’s conversations, from the provider registry', () => {
	const agui = {
		...row,
		provider: 'agui',
		settings: { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' },
		secrets: { jwtSecret: 'an-app-secret-of-at-least-32-chars!' },
	}
	expect(toAdminAppDto(agui, [], [])).toMatchObject({ provider: 'agui', hubHistory: true })
	expect(toAdminAppDto(row, [], [])).toMatchObject({ provider: 'dify', hubHistory: false })
	// An invalid row keeps the flag: it is the provider's, not the documents'.
	vi.spyOn(console, 'error').mockImplementation(() => {})
	expect(toAdminAppDto({ ...agui, secrets: {} }, [], [])).toMatchObject({
		invalid: true,
		hubHistory: true,
	})
})
// DV 11: the CHECK allows no other provider; a row that has one anyway is left out of the list, logged.
```

In `__tests__/app-form-values.test.ts`, find:

```ts
	hasIcon: false,
	access,
	createdAt: '',
```

Replace with:

```ts
	hasIcon: false,
	hubHistory: false,
	access,
	createdAt: '',
```

In `__tests__/provider-ui.test.ts` (as of Task 2, which changes the AG-UI fixture's settings below this object, not the object), find:

```ts
			enabled: true,
			hasIcon: false,
			access: { mode: 'everyone' as const, groupIds: [], userIds: [] },
```

Replace with:

```ts
			enabled: true,
			hasIcon: false,
			hubHistory: false,
			access: { mode: 'everyone' as const, groupIds: [], userIds: [] },
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/admin-logs-route.test.ts __tests__/api-routes.test.ts __tests__/data-apps.test.ts`

Expected: FAIL, `Test Files  3 failed (3)`: `admin-logs-route.test.ts` with `Error: Cannot find package '@/app/api/apps/[appId]/logs/[conversationId]/route'`; `api-routes.test.ts` "holds exactly the routes of spec §4.2, §7.1 and §7.2 …" (`expected [ …(6) ] to deeply equal [ …(7) ]`); `data-apps.test.ts` "carries the settings and which secrets are set …" and "carries whether the hub keeps the app’s conversations …" (no `hubHistory`).

- [ ] **Step 3: Track the `logs` folders**

In `.gitignore`, find:

```gitignore
.omo/
logs/
```

Replace with:

```gitignore
.omo/
# Runtime logs at the root only: a pattern with no leading or middle slash matches at any level (gitignore,
# "PATTERN FORMAT"), which would hide the Logs page's `logs` folders under app/ and components/.
/logs/
```

Run: `git check-ignore -v components/admin/logs/logs-api.ts; git check-ignore -v logs/x.log`

Expected: the first prints nothing (the file does not exist yet, and no pattern matches its path any more); the second prints `.gitignore:50:/logs/	logs/x.log`.

- [ ] **Step 4: The admin DTO's `hubHistory`**

In `lib/data/apps.ts` (as of Task 13), find:

```ts
	enabled: boolean
	hasIcon: boolean
	access: AppAccessSettings
	createdAt: string
	updatedAt: string
}
```

Replace with:

```ts
	enabled: boolean
	hasIcon: boolean
	/**
	 * Whether the hub keeps the app's conversations (spec §4.1 `hubHistory`, read from the server registry: the client
	 * registry holds no behaviour), so the table offers its Logs (spec §7.2; 2c's plan call P20).
	 */
	hubHistory: boolean
	access: AppAccessSettings
	createdAt: string
	updatedAt: string
}
```

Then find:

```ts
		enabled: row.isEnabled,
		hasIcon: row.hasIcon,
		access: {
```

Replace with:

```ts
		enabled: row.isEnabled,
		hasIcon: row.hasIcon,
		hubHistory: providerDefinition(row.provider).hubHistory,
		access: {
```

`row.provider` is a `ProviderId` there (the `isProviderId` check above it returns first), and an invalid row's DTO spreads `common` too, so it keeps the flag. `AdminAppRow` (`components/admin/apps/admin-app-row.ts`) is this DTO, so the table's rows carry it with no other change.

- [ ] **Step 5: Create the route**

Create `app/api/apps/[appId]/logs/[conversationId]/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { hasAdminRights } from '@/lib/auth/roles'
import { verifySession } from '@/lib/auth/session'
import { logRunView, type LogConversationPage } from '@/lib/chat/log-view'
import { conversationNotFound } from '@/lib/chat/route'
import { threadQuerySchema } from '@/lib/chat/schemas'
import { turnsFromMessages } from '@/lib/chat/turn'
import { THREAD_PAGE_TURNS } from '@/lib/data/conversations'
import { findLogsApp, readLogThread } from '@/lib/data/logs'
import { errorResponse, errorResponseFrom, forbiddenResponse } from '@/lib/http/errors'
import { parseQuery } from '@/lib/http/parse'
import { jsonNoStore } from '@/lib/http/response'
import { isId } from '@/lib/ids'

/**
 * GET logs/[conversationId] (Part 2 spec §7.2; 2c's plan call P18): one page of any conversation of the app for the Logs'
 * transcript drawer, deleted ones included until the purge, in the user's history page shape (20 turns and a "load
 * earlier" cursor, `before` as the user's read takes it), with the page's runs as timeline entries and the
 * conversation's facts. A Route Handler, not the page, reads it, so a prefetch never writes an audit row (spec §7.2);
 * the first page writes the `view` row (lib/data/logs.ts `readLogThread`). The handler verifies the session and the
 * role itself (Next `02-guides/backend-for-frontend.md`: "Do not rely on proxy alone"), as the directory group search
 * does, and the data layer checks the role again (ADR-0024). A malformed id is never read (lib/ids.ts) and answers as an
 * unknown one; an app whose provider keeps no history answers as a missing app (P20).
 */
export async function GET(
	request: NextRequest,
	ctx: RouteContext<'/api/apps/[appId]/logs/[conversationId]'>,
) {
	try {
		const actor = await verifySession()
		if (!actor) return errorResponse('unauthorized', 'Sign in required.', 401)
		if (!hasAdminRights(actor)) return forbiddenResponse()
		const { appId, conversationId } = await ctx.params
		const app = isId(appId) ? await findLogsApp(actor, appId) : null
		if (!app) return errorResponse('app_not_found', 'No such app.', 404)
		const query = parseQuery(request.nextUrl.searchParams, threadQuerySchema)
		if (!query.ok) return query.response
		const thread = isId(conversationId)
			? await readLogThread(actor, app.id, conversationId, {
					before: query.data.before,
					turns: THREAD_PAGE_TURNS,
				})
			: null
		if (!thread) return conversationNotFound()
		const body: LogConversationPage = {
			conversation: {
				id: thread.conversation.id,
				title: thread.conversation.title,
				user: thread.user,
				createdAt: thread.createdAt.toISOString(),
				updatedAt: thread.conversation.updatedAt.toISOString(),
				deletedAt: thread.deletedAt ? thread.deletedAt.toISOString() : null,
				state: thread.conversation.state,
			},
			turns: turnsFromMessages(thread.rows, thread.runs, thread.files),
			runs: thread.runs.map(logRunView),
			cursor: thread.cursor,
		}
		return jsonNoStore(body)
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/apps/[appId]/logs/[conversationId]')
	}
}
```

- [ ] **Step 6: Create the browser's client**

Create `components/admin/logs/logs-api.ts`:

```ts
// Client-safe: the type import below is erased (TypeScript `import type`). The Logs drawer's way to its Route Handler
// (Part 2 spec §7.2; 2c's plan call P18): the method resolves the typed body and rejects with RequestError
// (lib/http/browser.ts) on a non-OK answer, as the shared chat's client does (components/shared-chat/api.ts).
import type { LogConversationPage } from '@/lib/chat/log-view'
import { readRequestError } from '@/lib/http/browser'

const segment = (value: string) => encodeURIComponent(value)

export const createLogsApi = (appId: string) => {
	const base = `/api/apps/${segment(appId)}/logs`
	return {
		/** GET logs/[conversationId]: the latest turns, or those before `before` (the cursor the last page answered). */
		getConversation: async (
			conversationId: string,
			before?: string,
		): Promise<LogConversationPage> => {
			const response = await fetch(
				`${base}/${segment(conversationId)}${before ? `?before=${segment(before)}` : ''}`,
			)
			if (!response.ok) throw await readRequestError(response)
			return response.json() as Promise<LogConversationPage>
		},
	}
}
```

- [ ] **Step 7: The "Logs" row action**

In `components/admin/apps/app-actions.tsx`, find:

```tsx
import { App, Button, Dropdown, Flex, type MenuProps } from 'antd'
import { useTranslation } from 'react-i18next'
```

Replace with:

```tsx
import { App, Button, Dropdown, Flex, type MenuProps } from 'antd'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
```

Then find:

```tsx
					{t('admin_apps.user_view')}
				</a>
			),
		},
		{ type: 'divider' },
```

Replace with:

```tsx
					{t('admin_apps.user_view')}
				</a>
			),
		},
		// Spec §7.2, 2c's plan call P20: the Logs of an app whose conversations the hub keeps, in the same tab. A menu
		// item's `label` is a ReactNode (antd 6.6.5 Menu, MenuItemType), a link in Dropdown's "Basic" demo; Next's Link
		// navigates on the client to the dynamic segment (Next `link.md`, "Linking to dynamic route segments").
		...(app.hubHistory
			? [
					{
						key: 'logs',
						label: <Link href={`/app-management/${app.id}/logs`}>{t('admin_apps.logs')}</Link>,
					},
				]
			: []),
		{ type: 'divider' },
```

The item has no `onClick` branch: the link navigates, and `onClick` acts only on `delete`.

- [ ] **Step 8: The locale key**

In each locale file, add `logs` after `user_view` in `admin_apps`.

`locales/en/translation.json`, find:

```json
		"user_view": "User view",
```

Replace with:

```json
		"user_view": "User view",
		"logs": "Logs",
```

`locales/zh/translation.json`, find:

```json
		"user_view": "用户端",
```

Replace with:

```json
		"user_view": "用户端",
		"logs": "日志",
```

`locales/ar/translation.json` (Modern Standard Arabic, ADR-0005), find:

```json
		"user_view": "عرض المستخدم",
```

Replace with:

```json
		"user_view": "عرض المستخدم",
		"logs": "السجلات",
```

"日志" and "السجلات" are the words the locale files already use for logs (`sync_error_internal_error`: "服务器日志", "سجل الخادم"). No e2e text changes: `e2e/` names no "Logs" menu item yet (Task 19 adds it).

- [ ] **Step 9: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/admin-logs-route.test.ts __tests__/api-routes.test.ts`

Expected: PASS, `Test Files  2 passed (2)`, `Tests  11 passed (11)`.

Run: `pnpm exec vitest run --project unit __tests__/data-apps.test.ts __tests__/app-form-values.test.ts __tests__/provider-ui.test.ts __tests__/i18n-locales.test.ts`

Expected: PASS, `Test Files  4 passed (4)`, 0 failed.

- [ ] **Step 10: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint 'app/api/apps/[appId]/logs/[conversationId]/route.ts' components/admin/logs/logs-api.ts lib/data/apps.ts components/admin/apps/app-actions.tsx __tests__/admin-logs-route.test.ts __tests__/api-routes.test.ts __tests__/data-apps.test.ts __tests__/app-form-values.test.ts __tests__/provider-ui.test.ts
pnpm exec oxfmt --check 'app/api/apps/[appId]/logs/[conversationId]/route.ts' components/admin/logs/logs-api.ts lib/data/apps.ts components/admin/apps/app-actions.tsx locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/admin-logs-route.test.ts __tests__/api-routes.test.ts __tests__/data-apps.test.ts __tests__/app-form-values.test.ts __tests__/provider-ui.test.ts
pnpm test
pnpm test:db
npx -y @ant-design/cli lint ./ --format json
```

Expected: tsc exits 0 (without Step 1's fixture lines it reports `Property 'hubHistory' is missing` in `app-form-values.test.ts` and `provider-ui.test.ts`); oxlint prints no finding; oxfmt "All matched files use the correct format."; `pnpm test` and `pnpm test:db` 0 failed; the antd lint `"summary": { "total": 0, … }`.

- [ ] **Step 11: Commit**

```bash
git add .gitignore 'app/api/apps/[appId]/logs/[conversationId]/route.ts' components/admin/logs/logs-api.ts lib/data/apps.ts components/admin/apps/app-actions.tsx locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/admin-logs-route.test.ts __tests__/api-routes.test.ts __tests__/data-apps.test.ts __tests__/app-form-values.test.ts __tests__/provider-ui.test.ts
git commit -m "feat(logs): the Logs transcript route and the apps table's Logs action

GET /api/apps/[appId]/logs/[conversationId] answers an owner or admin one
page of any conversation of an app that keeps the hub's history, as the
user's history page plus the runs' timeline entries and the conversation's
facts; the data layer writes the view row on the first page (Part 2 spec
§7.2; plan call P18). The handler checks the session and the role itself
(ADR-0024). The admin DTO carries hubHistory from the server registry, and
the apps table offers Logs after User view on those apps (P20). The
.gitignore rule for runtime logs is anchored to the root: unanchored, it
hid every folder named logs, these routes' and components' included.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the 13 files; lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": [".gitignore", "app/api/apps/[appId]/logs/[conversationId]/route.ts", "components/admin/logs/logs-api.ts", "lib/data/apps.ts", "components/admin/apps/app-actions.tsx", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/admin-logs-route.test.ts", "__tests__/api-routes.test.ts", "__tests__/data-apps.test.ts", "__tests__/app-form-values.test.ts", "__tests__/provider-ui.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/admin-logs-route.test.ts __tests__/api-routes.test.ts", "acceptanceCriteria": [".gitignore anchors logs/ to the root: the new logs folders are not ignored, the root logs folder still is", "the route answers 401 signed out, 403 forbidden for a user, 404 app_not_found for a malformed id or an app without hub history, 400 invalid_param for a bad before, 404 conversation_not_found, and 200 LogConversationPage with private, no-store, passing before and 20 turns to readLogThread", "createLogsApi fetches /api/apps/<appId>/logs/<id> with ?before= when given and rejects with RequestError", "AdminAppDto.hubHistory is true for AG-UI and false for Dify, invalid rows included; the more menu shows Logs after User view only for those rows, a Next Link to /app-management/<id>/logs; admin_apps.logs exists in en, zh and ar", "api-routes pins apps/[appId]/logs/[conversationId]/route.ts", "tsc exits 0, pnpm test and pnpm test:db 0 failed, oxlint and oxfmt clean, antd lint total 0"], "modelTier": "standard"}
```

---

### Task 15: The Logs page: the list and its filters

**Goal:** `/app-management/<id>/logs` is a server page that reads an AG-UI app's conversations one numbered page at a time, its tab, page, page size and filters taken from the URL, and shows them in an antd Table under the app's name with a breadcrumb back to the apps; every change of page, size or filter is a navigation to the new URL.

Spec §7.2 ("**Page** `app/(admin)/app-management/[appId]/logs/page.tsx`: a server page with trimmed props for a client table (ADR-0020), owner and admin. An antd `Table`: user (name and email), title, messages, last activity, tokens (summed from the runs), status tags (failed, stopped, waiting for an answer, and "Deleted by the user, purged on <date>"). Filters in the URL: a date range on the last activity, the user, the status, "include deleted""), with decision 69 (5) in place of its keyset paging (numbered pages, a page-size changer, a quick jumper and the total, like the other admin tables), and plan calls P16 (the query, its defaults, a dropped value, a filter change going back to page 1, the open conversation never in the URL), P17 (the figures and the tags) and P20 (Next's `notFound()` for an app the Logs cannot show). The Shared contracts' `LOG_PAGE_SIZES`, `LogsQuery`, `parseLogsQuery`, `logsSearch` and `AppLogsProps` are written here as they stand there; the page reads Task 13's `findLogsApp`, `listAppLogs` and `listLogUsers` (`lib/data/logs.ts`) and types its rows with `LogListRow`, `AccessLogRow` and Task 3's `LOG_STATUSES` (`lib/chat/statuses.ts`). Docs checked: Next 16.3.4's bundled docs: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` (`searchParams` is "a promise that resolves to an object", "a plain JavaScript object, not a `URLSearchParams` instance", `?a=1&a=2` gives an array, and "Handling filtering with `searchParams`" covers "filtering, pagination, or sorting"; the `PageProps<'/route'>` helper after `next typegen`, as `app/(user)/chat/[appId]/page.tsx` uses it), `04-functions/not-found.md` ("call it in the render path"), `04-functions/redirect.md` (in a Server Component, a 307 or a client-side replace), `04-functions/use-router.md` (`router.push` "Adds a new entry into the browser's history stack", `router.replace` does not, `{ scroll: false }`, and "You must not send untrusted or unsanitized URLs to `router.push`"), `04-functions/use-pathname.md`, `04-functions/use-search-params.md` "Updating `searchParams`" ("After a navigation is performed, the current page.js will receive an updated searchParams prop"), `02-guides/interactive-apps.md` Step 3 "Filter with pending feedback" (`router.push` in `startTransition`, and `useOptimistic` for the control's value while the server renders), `02-components/link.md`; react.dev `useTransition` ("Building a Suspense-enabled router": a navigation in a Transition, its `isPending` for the pending state) and `useOptimistic` (`@types/react` 19: `useOptimistic(passthrough)` with a setter that takes the next state); antd 6.6.5 (`npx -y @ant-design/cli doc|demo <Component> --version 6.6.5`): Table (`pagination` "Config of pagination", `loading`, `locale.emptyText`, `scroll`; the "Ajax" demo keeps `current` and `pageSize` and sets `total` from the server, and drops its rows "since `pageSize` changed"; FAQ "Table will return to first page when filter data"; `es/table/InternalTable.js` shows a `dataSource` shorter than `total` as the page itself), Pagination (`current`, `pageSize`, `total`, `pageSizeOptions` default `[10, 20, 50, 100]`, `onChange(page, pageSize)`), Tabs (`activeKey`, `items`), DatePicker.RangePicker (`value`, `onChange(dates)`, `allowClear` true by default; its placeholders come from antd's locale), Select (`showSearch: { optionFilterProp: 'label' }`, as the group and app drawers use it; `allowClear`; rendered with react-dom/server in the copy, its `aria-label` lands on the `role="combobox"` input), Switch (`checked`, `onChange`, an `id` its `<label htmlFor>` names), Tag (the "status" demo's preset colours `success`, `processing`, `error`, `default`, `warning`), Typography (Paragraph `ellipsis={{ rows, tooltip }}`), Breadcrumb ("When the user may need to navigate back to a higher level"; `items` with a ReactNode `title`, a Next `Link` here), Empty (`PRESENTED_IMAGE_SIMPLE`); zod 4.6.5: `z.iso.datetime({ offset: true })` (Context7 `/colinhacks/zod/v4.6.5`, api.mdx: offsets and `Z`, and since 4.5 seconds are required), `z.literal` with several values (`node_modules/zod/v4/classic/schemas.d.ts`: `literal<const T extends ReadonlyArray<util.Literal>>`), `z.int()` (safe integers). Choices the docs leave open, from R3 (`part2c-files-logs.md`): `router.push` for every change, as Next's interactive-apps guide filters with it, so the browser's Back returns to the previous page of results (Dify replaces only `?page=`; Langfuse keeps page and size in the URL); a page past the end redirects to the last page, as Langfuse's pager snaps back (R3 §2); the user and status Selects take a width of control heights from the theme token, the measure `chat-view.module.css` `.popoverList` takes; the "View" button and the drawer it opens are Task 16's, so this task leaves no button without an action. The access log tab is Task 17's: until then the page shows the conversations only, and a `?tab=access` reads as the conversations. The `logs` folders are tracked: Task 14 anchored `.gitignore`'s `logs/` rule to the root (`/logs/`), which otherwise ignores every folder named `logs`. Task 16 adds the "View" column and the drawer to `app-logs.tsx`, and Task 17 the access log tab to it and to the page; Task 19's e2e spec reads the page through the locators listed at the end of this task.

**Files:**

- Create: `app/(admin)/app-management/[appId]/logs/schemas.ts`
- Create: `app/(admin)/app-management/[appId]/logs/page.tsx`
- Create: `components/admin/logs/use-logs-navigation.ts`
- Create: `components/admin/logs/log-columns.ts`
- Create: `components/admin/logs/logs-filters.tsx`
- Create: `components/admin/logs/app-logs.tsx`
- Create: `components/admin/logs/logs.module.css`
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (the `admin_logs` block, before `app_setting`)
- Test: `__tests__/admin-logs-query.test.ts` (the whole file, below)
- Test: `__tests__/admin-log-columns.test.ts` (the whole file, below)
- Test: `__tests__/admin-logs-page.test.ts` (the whole file, below)

**Acceptance Criteria:**

- [ ] `parseLogsQuery({})` is `{ tab: 'conversations', page: 1, pageSize: 10, deleted: false }`; it reads `tab=access`, `page=3`, `pageSize=50`, ISO instants with `Z` or an offset, an account UUID, `status=waiting` and `deleted=1`, the first of a repeated value, and drops on its own (its default standing) each of `tab=runs`, `page` `0`, `-1`, `1.5`, `02`, ` 2`, `abc`, `''` and `99999999999999999999`, `pageSize` `15` and `010`, a `from` of `yesterday` or `2026-10-01`, a `to` without seconds, a malformed `user`, `status=running`, `deleted` `true` or `0`.
- [ ] `logsSearch` of the defaults is `''`, of a full query `?tab=access&page=3&pageSize=50&from=…&to=…&user=…&status=waiting&deleted=1`, and `parseLogsQuery` reads it back to the same query; `withFilters` goes back to page 1 keeping the tab, the size and the other filters (an undefined value removes one); `withPage` keeps the page for the same size and goes to page 1 for another; `withTab` opens page 1 with the filters kept; `lastPage(0, 10)` is 1, `(11, 10)` 2, `(101, 50)` 3; `logFiltersOf` maps `user` to `userId` and `deleted` to `includeDeleted`.
- [ ] `purgeAt('2026-10-01T10:15:30.123Z')` is `'2026-10-31T10:15:30.123Z'`; `logTags` lists a row's statuses in `LOG_STATUSES` order and then `{ kind: 'deleted', purgeAt }`; every tag view has an antd preset status colour and an English text.
- [ ] The page checks the session before any read, answers `notFound()` for a malformed id (no read) and for an app `findLogsApp` does not find, reads `listAppLogs` (the URL's page, size and filters) and `listLogUsers` in parallel, hands `AppLogs` `{ app, query, list, users }` with `query.tab` `'conversations'` and no `access`, and redirects a page past the end to the last page, filters kept (`?page=3&status=failed` for page 9 of 25 rows).
- [ ] The page renders antd Breadcrumb (App configuration → Logs), the shared PageHeader (the app's name, `admin_logs.subtitle`), antd Tabs with "Conversations", the filters (a RangePicker, a "User" Select with search, a "Status" Select, an "Include deleted" Switch) and the Table (User, Title, Messages, Tokens, Last activity, Tags) with numbered pages; `admin_logs.*` exists in en, zh and ar.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the changed files; `npx -y @ant-design/cli lint ./ --format json` reports `"total": 0`.

**Verify:** `pnpm exec vitest run --project unit __tests__/admin-logs-query.test.ts __tests__/admin-log-columns.test.ts __tests__/admin-logs-page.test.ts __tests__/i18n-locales.test.ts` → `Test Files  4 passed (4)`, `Tests  67 passed (67)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `__tests__/admin-logs-query.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	hasFilters,
	lastPage,
	LOG_PAGE_SIZES,
	logFiltersOf,
	logsSearch,
	parseLogsQuery,
	withFilters,
	withPage,
	withTab,
	type LogsQuery,
} from '@/app/(admin)/app-management/[appId]/logs/schemas'

const USER_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const DEFAULTS: LogsQuery = { tab: 'conversations', page: 1, pageSize: 10, deleted: false }
const FULL: LogsQuery = {
	tab: 'access',
	page: 3,
	pageSize: 50,
	from: new Date('2026-10-01T00:00:00.000Z'),
	to: new Date('2026-10-15T23:59:59.999Z'),
	user: USER_ID,
	status: 'waiting',
	deleted: true,
}

// Plan call P16: the Logs page's query from Next's searchParams, each value on its own.
describe('parseLogsQuery', () => {
	it('answers the defaults for an empty query', () => {
		expect(parseLogsQuery({})).toEqual(DEFAULTS)
	})
	it('reads every value', () => {
		expect(
			parseLogsQuery({
				tab: 'access',
				page: '3',
				pageSize: '50',
				from: '2026-10-01T00:00:00.000Z',
				to: '2026-10-15T23:59:59.999Z',
				user: USER_ID,
				status: 'waiting',
				deleted: '1',
			}),
		).toEqual(FULL)
	})
	it('takes an instant with an offset', () => {
		expect(parseLogsQuery({ from: '2026-10-01T00:00:00+03:00' }).from).toEqual(
			new Date('2026-09-30T21:00:00.000Z'),
		)
	})
	it('takes each page size the pager offers', () => {
		expect(LOG_PAGE_SIZES.map(size => parseLogsQuery({ pageSize: String(size) }).pageSize)).toEqual(
			[10, 20, 50, 100],
		)
	})
	it('reads the first of a repeated value (page.md: `?a=1&a=2` is an array)', () => {
		expect(parseLogsQuery({ page: ['2', '5'], status: ['failed', 'stopped'] })).toEqual({
			...DEFAULTS,
			page: 2,
			status: 'failed',
		})
	})
	it.each([
		['tab', 'runs'],
		['page', '0'],
		['page', '-1'],
		['page', '1.5'],
		['page', '02'],
		['page', ' 2'],
		['page', 'abc'],
		['page', ''],
		['page', '99999999999999999999'],
		['pageSize', '15'],
		['pageSize', '010'],
		['from', 'yesterday'],
		['from', '2026-10-01'],
		['to', '2026-10-15T23:59'],
		['user', 'not-a-uuid'],
		['status', 'running'],
		['deleted', 'true'],
		['deleted', '0'],
	])('drops %s=%j and keeps its default', (key, value) => {
		expect(parseLogsQuery({ [key]: value })).toEqual(DEFAULTS)
	})
	it('keeps the values that parse beside one that does not', () => {
		expect(parseLogsQuery({ page: 'x', status: 'stopped', deleted: '1' })).toEqual({
			...DEFAULTS,
			status: 'stopped',
			deleted: true,
		})
	})
})

describe('logsSearch', () => {
	it('is empty for the defaults', () => {
		expect(logsSearch(DEFAULTS)).toBe('')
	})
	it('writes each value that is not a default, with its "?"', () => {
		expect(logsSearch(FULL)).toBe(
			`?tab=access&page=3&pageSize=50&from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-15T23%3A59%3A59.999Z&user=${USER_ID}&status=waiting&deleted=1`,
		)
		expect(logsSearch({ ...DEFAULTS, page: 2 })).toBe('?page=2')
	})
	it('reads back to the same query', () => {
		for (const query of [DEFAULTS, FULL, { ...DEFAULTS, status: 'failed' as const }])
			expect(parseLogsQuery(Object.fromEntries(new URLSearchParams(logsSearch(query))))).toEqual(
				query,
			)
	})
})

describe("the query's changes", () => {
	it('a filter goes back to page 1 and keeps the tab, the size and the other filters', () => {
		expect(withFilters(FULL, { status: 'failed' })).toEqual({ ...FULL, page: 1, status: 'failed' })
	})
	it('an undefined filter removes it from the URL', () => {
		const next = withFilters(FULL, { user: undefined, from: undefined, to: undefined })
		expect(logsSearch(next)).toBe('?tab=access&pageSize=50&status=waiting&deleted=1')
	})
	it('the pager keeps the filters; a new page size goes back to page 1', () => {
		expect(withPage(FULL, 4, 50)).toEqual({ ...FULL, page: 4 })
		expect(withPage(FULL, 4, 20)).toEqual({ ...FULL, page: 1, pageSize: 20 })
	})
	it('another tab opens at its first page with the filters kept', () => {
		expect(withTab(FULL, 'conversations')).toEqual({ ...FULL, tab: 'conversations', page: 1 })
	})
})

describe('hasFilters', () => {
	it('is false for the defaults and for the tab, page and size alone', () => {
		expect(hasFilters(DEFAULTS)).toBe(false)
		expect(hasFilters({ ...DEFAULTS, tab: 'access', page: 4, pageSize: 100 })).toBe(false)
	})
	it.each([
		['from', { from: new Date(0) }],
		['to', { to: new Date(0) }],
		['user', { user: USER_ID }],
		['status', { status: 'failed' as const }],
		['deleted', { deleted: true }],
	])('is true with %s', (_label, over) => {
		expect(hasFilters({ ...DEFAULTS, ...over })).toBe(true)
	})
})

describe('lastPage', () => {
	it.each([
		[0, 10, 1],
		[1, 10, 1],
		[10, 10, 1],
		[11, 10, 2],
		[101, 50, 3],
	])('of %i rows by %i is %i', (total, pageSize, last) => {
		expect(lastPage(total, pageSize)).toBe(last)
	})
})

describe('logFiltersOf', () => {
	it("maps the query to the data layer's filters", () => {
		expect(logFiltersOf(FULL)).toEqual({
			from: FULL.from,
			to: FULL.to,
			userId: USER_ID,
			status: 'waiting',
			includeDeleted: true,
		})
		expect(logFiltersOf(DEFAULTS)).toEqual({ includeDeleted: false })
	})
})
```

Create `__tests__/admin-log-columns.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { LOG_TAG_VIEWS, logTags, purgeAt } from '@/components/admin/logs/log-columns'
import { LOG_STATUSES } from '@/lib/chat/statuses'
import en from '@/locales/en/translation.json'

// Spec §3.4: a deleted conversation is purged PURGE_AFTER_DAYS (30) days after its deletion.
describe('purgeAt', () => {
	it('is 30 days after the deletion, to the millisecond', () => {
		expect(purgeAt('2026-10-01T10:15:30.123Z')).toBe('2026-10-31T10:15:30.123Z')
	})
	it('crosses a month and a year', () => {
		expect(purgeAt('2026-12-15T00:00:00.000Z')).toBe('2027-01-14T00:00:00.000Z')
	})
})

// Plan call P17: a row's tags.
describe('logTags', () => {
	it('has none for a conversation that is fine', () => {
		expect(logTags({ statuses: [], deletedAt: null })).toEqual([])
	})
	it('lists the statuses in LOG_STATUSES order, then the deletion with its purge date', () => {
		expect(
			logTags({ statuses: ['waiting', 'failed'], deletedAt: '2026-10-01T10:00:00.000Z' }),
		).toEqual([
			{ kind: 'failed' },
			{ kind: 'waiting' },
			{ kind: 'deleted', purgeAt: '2026-10-31T10:00:00.000Z' },
		])
	})
	it('shows a deleted conversation with no status as deleted alone', () => {
		expect(logTags({ statuses: [], deletedAt: '2026-10-01T10:00:00.000Z' })).toEqual([
			{ kind: 'deleted', purgeAt: '2026-10-31T10:00:00.000Z' },
		])
	})
})

describe('LOG_TAG_VIEWS', () => {
	it('gives every status and the deletion an antd preset status colour and an English text', () => {
		const presets = ['success', 'processing', 'error', 'default', 'warning']
		for (const kind of [...LOG_STATUSES, 'deleted' as const]) {
			const view = LOG_TAG_VIEWS[kind]
			expect(presets).toContain(view.color)
			const [namespace, key] = view.labelKey.split('.') as ['admin_logs', string]
			expect(en[namespace]).toHaveProperty(key)
		}
	})
})
```

Create `__tests__/admin-logs-page.test.ts` (the page tests of `__tests__/app-management-page.test.ts` and `__tests__/chat-page.test.ts`, with `notFound` and `redirect` mocked as the throws they are):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
	requireAdminUser,
	findLogsApp,
	listAppLogs,
	listLogUsers,
	notFound,
	redirect,
	AppLogs,
	redirectSignal,
	notFoundSignal,
} = vi.hoisted(() => {
	const redirectSignal = new Error('NEXT_REDIRECT')
	const notFoundSignal = new Error('NEXT_HTTP_ERROR_FALLBACK;404')
	return {
		requireAdminUser: vi.fn(),
		findLogsApp: vi.fn(),
		listAppLogs: vi.fn(),
		listLogUsers: vi.fn(),
		// Both work by throwing (functions/not-found.md, functions/redirect.md).
		notFound: vi.fn(() => {
			throw notFoundSignal
		}),
		redirect: vi.fn(() => {
			throw redirectSignal
		}),
		AppLogs: () => null,
		redirectSignal,
		notFoundSignal,
	}
})
vi.mock('@/lib/auth/session', () => ({ requireAdminUser }))
vi.mock('@/lib/data/logs', () => ({ findLogsApp, listAppLogs, listLogUsers }))
vi.mock('next/navigation', () => ({ notFound, redirect }))
vi.mock('@/components/admin/logs/app-logs', () => ({ default: AppLogs }))

import AppLogsPage from '@/app/(admin)/app-management/[appId]/logs/page'

const APP_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const USER_ID = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f'
const admin = { id: 'a1', email: 'admin@example.com', name: null, role: 'admin' }
const app = { id: APP_ID, name: 'Tea', description: '', hasIcon: false }
const rows = [{ id: 'c1' }]
const users = [{ id: USER_ID, name: null, email: 'joe@example.com', active: true }]
const props = (query: Record<string, string> = {}, appId = APP_ID) =>
	({ params: Promise.resolve({ appId }), searchParams: Promise.resolve(query) }) as never

beforeEach(() => {
	for (const fn of [requireAdminUser, findLogsApp, listAppLogs, listLogUsers, notFound, redirect])
		fn.mockClear()
	requireAdminUser.mockResolvedValue(admin)
	findLogsApp.mockResolvedValue(app)
	listAppLogs.mockResolvedValue({ rows, total: 1 })
	listLogUsers.mockResolvedValue(users)
})

describe('/app-management/[appId]/logs page', () => {
	it('checks the session before it reads anything', async () => {
		requireAdminUser.mockRejectedValueOnce(redirectSignal)
		await expect(AppLogsPage(props())).rejects.toBe(redirectSignal)
		expect(findLogsApp).not.toHaveBeenCalled()
		expect(listAppLogs).not.toHaveBeenCalled()
	})
	// Plan call P20: a missing app, or one whose provider keeps no history, is a 404; a malformed id reaches no query.
	it('answers notFound() for an app the logs cannot show', async () => {
		findLogsApp.mockResolvedValueOnce(null)
		await expect(AppLogsPage(props())).rejects.toBe(notFoundSignal)
		expect(findLogsApp).toHaveBeenCalledWith(admin, APP_ID)
		expect(listAppLogs).not.toHaveBeenCalled()
	})
	it('answers notFound() for a malformed id without reading the app', async () => {
		await expect(AppLogsPage(props({}, 'not-a-uuid'))).rejects.toBe(notFoundSignal)
		expect(findLogsApp).not.toHaveBeenCalled()
	})
	it("reads the URL's page and filters and hands the trimmed props to AppLogs", async () => {
		const page = await AppLogsPage(
			props({ page: '1', pageSize: '20', user: USER_ID, status: 'failed', deleted: '1' }),
		)
		expect(listAppLogs).toHaveBeenCalledWith(
			admin,
			APP_ID,
			{
				from: undefined,
				to: undefined,
				userId: USER_ID,
				status: 'failed',
				includeDeleted: true,
			},
			{ page: 1, pageSize: 20 },
		)
		expect(listLogUsers).toHaveBeenCalledWith(admin, APP_ID)
		expect(page).toMatchObject({
			type: AppLogs,
			props: {
				app,
				query: {
					tab: 'conversations',
					page: 1,
					pageSize: 20,
					user: USER_ID,
					status: 'failed',
					deleted: true,
				},
				list: { rows, total: 1 },
				users,
			},
		})
		expect(page.props.access).toBeUndefined()
	})
	it('reads the page and the accounts in parallel', async () => {
		let resolveList: (value: unknown) => void = () => {}
		listAppLogs.mockReturnValueOnce(new Promise(resolve => (resolveList = resolve)))
		const rendering = AppLogsPage(props())
		await vi.waitFor(() => expect(listLogUsers).toHaveBeenCalled())
		resolveList({ rows, total: 1 })
		await rendering
	})
	it('shows the conversations when the URL asks for another tab', async () => {
		const page = await AppLogsPage(props({ tab: 'access' }))
		expect(page.props.query.tab).toBe('conversations')
	})
	// R3 §2: a page past the end goes to the last page, filters kept.
	it('redirects a page past the end to the last page', async () => {
		listAppLogs.mockResolvedValueOnce({ rows: [], total: 25 })
		await expect(AppLogsPage(props({ page: '9', status: 'failed' }))).rejects.toBe(redirectSignal)
		expect(redirect).toHaveBeenCalledWith(`/app-management/${APP_ID}/logs?page=3&status=failed`)
	})
	it('keeps page 1 of an app without conversations', async () => {
		listAppLogs.mockResolvedValueOnce({ rows: [], total: 0 })
		await AppLogsPage(props())
		expect(redirect).not.toHaveBeenCalled()
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/admin-logs-query.test.ts __tests__/admin-log-columns.test.ts __tests__/admin-logs-page.test.ts` Expected: FAIL, `Test Files  3 failed (3)`, `Tests  no tests`: each file stops at its import (`Cannot find package '@/app/(admin)/app-management/[appId]/logs/schemas'`, `'@/components/admin/logs/log-columns'`, `'@/app/(admin)/app-management/[appId]/logs/page'`).

- [ ] **Step 3: The query**

Create `app/(admin)/app-management/[appId]/logs/schemas.ts`:

```ts
import * as z from 'zod'

import { LOG_STATUSES, type LogStatus } from '@/lib/chat/statuses'
import type { LogFilters } from '@/lib/data/logs'
import { idSchema } from '@/lib/ids'
import { firstParam } from '@/lib/search-params'

// Client-safe: the Logs page reads its query with these on the server, and the table, the pager and the filters
// build their links with them in the browser (plan call P16). The type import from the data layer is erased (TypeScript
// `import type`), as components/shared-chat/api.ts imports the conversations' types.

/** P16: the pager's page sizes, antd Pagination's own `pageSizeOptions` default; the first is the default size. */
export const LOG_PAGE_SIZES = [10, 20, 50, 100] as const

/** The Logs page's URL state (P16, P19): the tab, the page and its size, and the conversations' filters. */
export interface LogsQuery {
	tab: 'conversations' | 'access'
	page: number
	pageSize: (typeof LOG_PAGE_SIZES)[number]
	/** The start of the first day picked, in the browser's zone. */
	from?: Date
	/** The end of the last day picked, in the browser's zone. */
	to?: Date
	/** An account id. */
	user?: string
	status?: LogStatus
	/** Conversations the user deleted are listed too (until the purge). */
	deleted: boolean
}

const DEFAULT_QUERY: LogsQuery = { tab: 'conversations', page: 1, pageSize: 10, deleted: false }

/** A whole number from 1, written plainly ("2", never "02", "2.0" or " 2"); a safe integer (zod 4 `z.int()`). */
const positiveInt = z
	.string()
	.regex(/^[1-9][0-9]*$/)
	.transform(Number)
	.pipe(z.int())

/** An ISO 8601 instant with `Z` or an offset (zod 4 `z.iso.datetime({ offset: true })`), as a valid Date. */
const instant = z.iso
	.datetime({ offset: true })
	.transform(value => new Date(value))
	.pipe(z.date())

/** Each query value on its own (ADR-0025: zod at the boundary). */
const QUERY_FIELDS = {
	tab: z.enum(['conversations', 'access']),
	page: positiveInt,
	// zod 4 `z.literal` takes several values (`node_modules/zod/v4/classic/schemas.d.ts`).
	pageSize: positiveInt.pipe(z.literal(LOG_PAGE_SIZES)),
	from: instant,
	to: instant,
	user: idSchema,
	status: z.enum(LOG_STATUSES),
	deleted: z.literal('1'),
}

/** The query value's first string when it parses, else undefined (firstParam: a missing or empty value is undefined). */
const read = <S extends z.ZodType>(
	schema: S,
	value: string | string[] | undefined,
): z.output<S> | undefined => {
	const first = firstParam(value)
	if (first === undefined) return undefined
	const parsed = schema.safeParse(first)
	return parsed.success ? parsed.data : undefined
}

/**
 * P16: Next's `searchParams` (page.md: a plain object of `string | string[] | undefined`), each value read on its own;
 * one that does not parse is dropped and its default stands, so a hand-edited URL shows the unfiltered first page rather
 * than an error.
 */
export const parseLogsQuery = (
	params: Record<string, string | string[] | undefined>,
): LogsQuery => {
	const query: LogsQuery = {
		tab: read(QUERY_FIELDS.tab, params.tab) ?? DEFAULT_QUERY.tab,
		page: read(QUERY_FIELDS.page, params.page) ?? DEFAULT_QUERY.page,
		pageSize: read(QUERY_FIELDS.pageSize, params.pageSize) ?? DEFAULT_QUERY.pageSize,
		deleted: read(QUERY_FIELDS.deleted, params.deleted) !== undefined,
	}
	const from = read(QUERY_FIELDS.from, params.from)
	const to = read(QUERY_FIELDS.to, params.to)
	const user = read(QUERY_FIELDS.user, params.user)
	const status = read(QUERY_FIELDS.status, params.status)
	if (from) query.from = from
	if (to) query.to = to
	if (user) query.user = user
	if (status) query.status = status
	return query
}

/**
 * The URL's query for a LogsQuery, defaults left out, with its `?` (as `URL.search`), or '' when every value is the
 * default; parseLogsQuery reads it back to the same query.
 */
export const logsSearch = (query: LogsQuery): string => {
	const params = new URLSearchParams()
	if (query.tab !== DEFAULT_QUERY.tab) params.set('tab', query.tab)
	if (query.page !== DEFAULT_QUERY.page) params.set('page', String(query.page))
	if (query.pageSize !== DEFAULT_QUERY.pageSize) params.set('pageSize', String(query.pageSize))
	if (query.from) params.set('from', query.from.toISOString())
	if (query.to) params.set('to', query.to.toISOString())
	if (query.user) params.set('user', query.user)
	if (query.status) params.set('status', query.status)
	if (query.deleted) params.set('deleted', '1')
	const search = params.toString()
	return search ? `?${search}` : ''
}

export type LogsFilterValues = Pick<LogsQuery, 'from' | 'to' | 'user' | 'status' | 'deleted'>

/**
 * P16: a filter change goes back to page 1 (antd Table FAQ: "we by default return to first page in case of current page
 * is out of filtered results"); the tab, the page size and the other filters stay. An undefined value removes a filter.
 */
export const withFilters = (query: LogsQuery, filters: Partial<LogsFilterValues>): LogsQuery => ({
	...query,
	...filters,
	page: 1,
})

/**
 * The pager's change (antd Pagination `onChange(page, pageSize)`): the page asked for, or page 1 when the size changed,
 * since the rows of another size start over (antd Table's "Ajax" demo: "`dataSource` is useless since `pageSize`
 * changed"). The filters stay.
 */
export const withPage = (query: LogsQuery, page: number, pageSize: number): LogsQuery => {
	const size = LOG_PAGE_SIZES.find(value => value === pageSize) ?? query.pageSize
	return { ...query, page: size === query.pageSize ? page : 1, pageSize: size }
}

/** Another tab opens at its first page; the conversations' filters stay for the way back. */
export const withTab = (query: LogsQuery, tab: LogsQuery['tab']): LogsQuery => ({
	...query,
	tab,
	page: 1,
})

/** Any of the conversations' filters is set (the empty table says "no match" rather than "none yet"). */
export const hasFilters = (query: LogsQuery): boolean =>
	Boolean(query.from || query.to || query.user || query.status || query.deleted)

/** The last page of `total` rows, 1 when there are none. */
export const lastPage = (total: number, pageSize: number): number =>
	Math.max(1, Math.ceil(total / pageSize))

/** The data layer's filters for a query (Task 13's LogFilters). */
export const logFiltersOf = (query: LogsQuery): LogFilters => ({
	from: query.from,
	to: query.to,
	userId: query.user,
	status: query.status,
	includeDeleted: query.deleted,
})
```

- [ ] **Step 4: The tags and the purge date**

Create `components/admin/logs/log-columns.ts`:

```ts
import type { TagProps } from 'antd'

import { LOG_STATUSES, PURGE_AFTER_DAYS, type LogStatus } from '@/lib/chat/statuses'
import type { LogListRow } from '@/lib/data/logs'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Spec §3.4: when a conversation the user deleted is purged, as an ISO 8601 instant. The daily job deletes a
 * conversation once its `deleted_at` is more than PURGE_AFTER_DAYS days old (lib/data/conversations.ts
 * `purgeDeletedConversations`: `now - PURGE_AFTER_DAYS * DAY_MS`), so it goes with the first run after this instant.
 */
export const purgeAt = (deletedAt: string): string =>
	new Date(Date.parse(deletedAt) + PURGE_AFTER_DAYS * DAY_MS).toISOString()

/** A Logs row's tag (plan call P17): its run status, or the deletion with its purge date. */
export type LogTag = { kind: LogStatus } | { kind: 'deleted'; purgeAt: string }

/** P17: the row's tags, its statuses in LOG_STATUSES order, then the deletion. */
export const logTags = (row: Pick<LogListRow, 'statuses' | 'deletedAt'>): LogTag[] => [
	...LOG_STATUSES.filter(status => row.statuses.includes(status)).map(kind => ({ kind })),
	...(row.deletedAt ? [{ kind: 'deleted' as const, purgeAt: purgeAt(row.deletedAt) }] : []),
]

/** Each tag's antd Tag preset status colour (antd Tag "status" demo) and text key. */
export const LOG_TAG_VIEWS = {
	failed: { color: 'error', labelKey: 'admin_logs.tag_failed' },
	stopped: { color: 'default', labelKey: 'admin_logs.tag_stopped' },
	waiting: { color: 'processing', labelKey: 'admin_logs.tag_waiting' },
	deleted: { color: 'warning', labelKey: 'admin_logs.tag_deleted' },
} as const satisfies Record<LogTag['kind'], { color: TagProps['color']; labelKey: string }>

/** What an empty figure shows (a conversation whose runs reported no usage). */
export const NO_FIGURE = '—'
```

- [ ] **Step 5: The navigation**

Create `components/admin/logs/use-logs-navigation.ts` (Task 17's access log table uses it too):

```ts
import { usePathname, useRouter } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'

import { logsSearch, type LogsQuery } from '@/app/(admin)/app-management/[appId]/logs/schemas'

/**
 * The Logs page's URL is its state (plan call P16): every change of tab, page, size or filter navigates to the new URL,
 * and the server page reads it again (Next `use-search-params.md`, "Updating searchParams": "After a navigation is
 * performed, the current page.js will receive an updated searchParams prop"). `router.push`, so the browser's Back
 * returns to the previous page of results (Next `use-router.md`: push "Adds a new entry into the browser's history
 * stack"; `scroll: false` keeps the scroll position), in a transition whose `pending` covers the server's render (Next
 * `02-guides/interactive-apps.md`, Step 3 "Filter with pending feedback"; react.dev `useTransition`, "Building a
 * Suspense-enabled router"), and `shown` is the query the controls show: the next one at once, while its page loads
 * (the same guide's `useOptimistic`). The URL is built from the current path and a parsed query only (Next warns against
 * sending untrusted URLs to `router.push`).
 */
export const useLogsNavigation = (query: LogsQuery) => {
	const router = useRouter()
	const pathname = usePathname()
	const [pending, startTransition] = useTransition()
	const [shown, setShown] = useOptimistic(query)
	const navigate = (next: LogsQuery) =>
		startTransition(() => {
			setShown(next)
			router.push(`${pathname}${logsSearch(next)}`, { scroll: false })
		})
	return { shown, pending, navigate }
}
```

- [ ] **Step 6: The filters**

Create `components/admin/logs/logs-filters.tsx`:

```tsx
'use client'

import { DatePicker, Flex, Select, Switch, theme, type GetProps } from 'antd'
import dayjs from 'dayjs'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { withFilters, type LogsQuery } from '@/app/(admin)/app-management/[appId]/logs/schemas'
import { accountOptionLabel } from '@/components/admin/account-option'
import { LOG_STATUSES } from '@/lib/chat/statuses'
import type { UserOption } from '@/lib/data/users'

import { LOG_TAG_VIEWS } from './log-columns'

type RangeValue = GetProps<typeof DatePicker.RangePicker>['value']

/**
 * The conversations' filters (plan call P16), each a controlled antd control over the URL's query: the days of last
 * activity (antd `DatePicker.RangePicker`, `value` and `onChange(dates)`; the start of the first day and the end of the
 * last in the browser's zone, dayjs `startOf`/`endOf('day')`), the user (antd Select with `showSearch.optionFilterProp`
 * 'label', the account pickers' labels, `components/admin/account-option.ts`), the status (the tags, P17) and "Include
 * deleted" (antd Switch, named by its `<label>`). A change goes back to page 1 (withFilters); a cleared control removes
 * its filter.
 */
export default function LogsFilters({
	query,
	users,
	onChange,
}: {
	query: LogsQuery
	users: UserOption[]
	onChange: (next: LogsQuery) => void
}) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const deletedId = useId()
	const range: RangeValue =
		query.from || query.to
			? [query.from ? dayjs(query.from) : null, query.to ? dayjs(query.to) : null]
			: null
	// A Select keeps one width whatever it shows: a number of control heights (the measure chat-view.module.css
	// `.popoverList` takes), from the theme's token (charter §4.3 rule 3: runtime values through theme.useToken() and
	// `style`), never wider than a phone's row.
	const selectStyle = (heights: number): React.CSSProperties => ({
		width: token.controlHeightLG * heights,
		maxWidth: '100%',
	})
	return (
		<Flex
			wrap
			align="center"
			gap="small"
		>
			<DatePicker.RangePicker
				value={range}
				onChange={dates =>
					onChange(
						withFilters(query, {
							from: dates?.[0]?.startOf('day').toDate(),
							to: dates?.[1]?.endOf('day').toDate(),
						}),
					)
				}
			/>
			<Select
				allowClear
				showSearch={{ optionFilterProp: 'label' }}
				aria-label={t('admin_logs.column_user')}
				placeholder={t('admin_logs.filter_user')}
				style={selectStyle(6)}
				value={query.user}
				options={users.map(user => ({
					value: user.id,
					label: accountOptionLabel(user, t('admin_users.status_deactivated')),
				}))}
				onChange={user => onChange(withFilters(query, { user }))}
			/>
			<Select
				allowClear
				aria-label={t('common.status')}
				placeholder={t('admin_logs.filter_status')}
				style={selectStyle(4)}
				value={query.status}
				options={LOG_STATUSES.map(status => ({
					value: status,
					label: t(LOG_TAG_VIEWS[status].labelKey),
				}))}
				onChange={status => onChange(withFilters(query, { status }))}
			/>
			<Flex
				align="center"
				gap="small"
			>
				<Switch
					id={deletedId}
					checked={query.deleted}
					onChange={deleted => onChange(withFilters(query, { deleted }))}
				/>
				<label htmlFor={deletedId}>{t('admin_logs.filter_deleted')}</label>
			</Flex>
		</Flex>
	)
}
```

- [ ] **Step 7: The page's client component**

Create `components/admin/logs/logs.module.css`:

```css
/* A reading measure, not a pixel size (app-management.module.css's precedent): Typography's two-line ellipsis needs a
   bounded width, and the table sizes its columns from their content (scroll.x: 'max-content'). The paragraph's bottom
   margin is zeroed inline: antd's selector for it outranks a single class. */
.title {
	max-width: 40ch;
}
```

Create `components/admin/logs/app-logs.tsx`:

```tsx
'use client'

import { Breadcrumb, Empty, Flex, Table, type TableProps, Tabs, Tag, Typography, theme } from 'antd'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

import {
	hasFilters,
	LOG_PAGE_SIZES,
	withPage,
	type LogsQuery,
} from '@/app/(admin)/app-management/[appId]/logs/schemas'
import ClientDateTime from '@/components/admin/client-date-time'
import { tablePagination } from '@/components/admin/table-pagination'
import { formatCount } from '@/components/chat/message/workflow-summary'
import PageHeader from '@/components/shell/page-header'
import type { AccessLogRow, LogListRow } from '@/lib/data/logs'
import type { UserOption } from '@/lib/data/users'

import { LOG_TAG_VIEWS, logTags, NO_FIGURE } from './log-columns'
import styles from './logs.module.css'
import LogsFilters from './logs-filters'
import { useLogsNavigation } from './use-logs-navigation'

export interface AppLogsProps {
	app: { id: string; name: string; description: string; hasIcon: boolean }
	query: LogsQuery
	list: { rows: LogListRow[]; total: number }
	users: UserOption[]
	/** P19: present for the owner only. */
	access?: { rows: AccessLogRow[]; total: number }
}

/**
 * An AG-UI app's Logs page (spec §7.2; plan calls P16, P17): a breadcrumb back to the apps over the shared page header
 * (the app's name), then antd Tabs over the conversations: the filters and an antd Table with numbered pages read on the
 * server (antd Table `pagination` with `current`, `pageSize` and `total`, the "Ajax" demo's controlled pager, in the
 * admin tables' look, tablePagination), whose every change is a navigation to the new URL (useLogsNavigation). Each
 * text the conversations carry renders as text (spec §6.4).
 */
export default function AppLogs({ app, query, list, users }: AppLogsProps) {
	const { t, i18n } = useTranslation()
	const { token } = theme.useToken()
	const { shown, pending, navigate } = useLogsNavigation(query)
	// Digits follow the UI language (ADR-0005), as the chat's figures (workflow-summary.ts).
	const language = i18n.resolvedLanguage

	const columns: TableProps<LogListRow>['columns'] = [
		{
			title: t('admin_logs.column_user'),
			key: 'user',
			render: (_, row) => (
				<div>
					<div>{row.user.name || t('admin_users.name_not_set')}</div>
					<Typography.Text type="secondary">{row.user.email}</Typography.Text>
				</div>
			),
		},
		{
			// Spec §3.1: a conversation without a title (a file-only first message) reads "New conversation", as the user's list.
			title: t('admin_logs.column_title'),
			key: 'title',
			render: (_, row) => {
				const title = row.title || t('chat.default_conversation_name')
				return (
					<Typography.Paragraph
						className={styles.title}
						style={{ marginBottom: 0 }}
						ellipsis={{ rows: 2, tooltip: title }}
					>
						{title}
					</Typography.Paragraph>
				)
			},
		},
		{
			title: t('admin_logs.column_messages'),
			key: 'messages',
			render: (_, row) => formatCount(row.messages, language),
		},
		{
			// P17: no figure when no run reported usage.
			title: t('admin_logs.column_tokens'),
			key: 'tokens',
			render: (_, row) => (row.tokens === null ? NO_FIGURE : formatCount(row.tokens, language)),
		},
		{
			title: t('admin_logs.column_updated'),
			key: 'updatedAt',
			render: (_, row) => <ClientDateTime value={row.updatedAt} />,
		},
		{
			title: t('admin_logs.column_tags'),
			key: 'tags',
			render: (_, row) => {
				const tags = logTags(row)
				return tags.length > 0 ? (
					<Flex
						wrap
						gap="small"
					>
						{tags.map(tag => (
							<Tag
								key={tag.kind}
								color={LOG_TAG_VIEWS[tag.kind].color}
							>
								{t(LOG_TAG_VIEWS[tag.kind].labelKey)}
								{tag.kind === 'deleted' && (
									<>
										{' '}
										<ClientDateTime value={tag.purgeAt} />
									</>
								)}
							</Tag>
						))}
					</Flex>
				) : null
			},
		},
	]

	const conversations = (
		<Flex
			vertical
			gap={token.margin}
		>
			<LogsFilters
				query={shown}
				users={users}
				onChange={navigate}
			/>
			<Table<LogListRow>
				rowKey="id"
				columns={columns}
				dataSource={list.rows}
				loading={pending}
				scroll={{ x: 'max-content' }}
				pagination={{
					...tablePagination(total => t('admin_logs.total', { total })),
					current: shown.page,
					pageSize: shown.pageSize,
					total: list.total,
					pageSizeOptions: [...LOG_PAGE_SIZES],
					onChange: (page, pageSize) => navigate(withPage(shown, page, pageSize)),
				}}
				locale={{
					emptyText: (
						<Empty
							image={Empty.PRESENTED_IMAGE_SIMPLE}
							description={t(hasFilters(shown) ? 'admin_logs.no_match' : 'admin_logs.empty')}
						/>
					),
				}}
			/>
		</Flex>
	)

	return (
		<Flex
			vertical
			gap={token.margin}
		>
			<Flex
				vertical
				gap="small"
			>
				{/* antd Breadcrumb "When the user may need to navigate back to a higher level"; the link is Next's Link. */}
				<Breadcrumb
					items={[
						{ title: <Link href="/app-management">{t('admin_apps.title')}</Link> },
						{ title: t('admin_logs.title') },
					]}
				/>
				<PageHeader
					title={app.name}
					subtitle={t('admin_logs.subtitle')}
				/>
			</Flex>
			<Tabs
				activeKey={shown.tab}
				items={[
					{
						key: 'conversations',
						label: t('admin_logs.tab_conversations'),
						children: conversations,
					},
				]}
			/>
		</Flex>
	)
}
```

- [ ] **Step 8: The server page**

Create `app/(admin)/app-management/[appId]/logs/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation'

import AppLogs from '@/components/admin/logs/app-logs'
import { requireAdminUser } from '@/lib/auth/session'
import { findLogsApp, listAppLogs, listLogUsers } from '@/lib/data/logs'
import { isId } from '@/lib/ids'

import { lastPage, logFiltersOf, logsSearch, parseLogsQuery, type LogsQuery } from './schemas'

/**
 * An AG-UI app's Logs (spec §7.2; plan calls P16, P20). The (admin) layout gates the page and the page checks again
 * where it reads (ADR-0024); an app that is missing, whose id is malformed (it reaches no query, spec §3.2) or whose
 * provider keeps no history is Next's 404 (`notFound()`, functions/not-found.md: "call it in the render path"). The URL's
 * query decides the page and the filters (page.md: `searchParams` "to handle filtering, pagination, or sorting"); the
 * page of conversations and the user filter's accounts are read in parallel, and one client component gets the trimmed
 * props (ADR-0020).
 */
export default async function AppLogsPage({
	params,
	searchParams,
}: PageProps<'/app-management/[appId]/logs'>) {
	const actor = await requireAdminUser()
	const { appId } = await params
	const app = isId(appId) ? await findLogsApp(actor, appId) : null
	if (!app) notFound()
	// The conversations are the page's one tab.
	const query: LogsQuery = { ...parseLogsQuery(await searchParams), tab: 'conversations' }
	const [list, users] = await Promise.all([
		listAppLogs(actor, app.id, logFiltersOf(query), { page: query.page, pageSize: query.pageSize }),
		listLogUsers(actor, app.id),
	])
	// A page past the end (rows gone since the link was made, a hand-edited URL) shows the last one, as Langfuse's pager
	// snaps back (R3 §2); `redirect` in a Server Component (functions/redirect.md).
	const last = lastPage(list.total, query.pageSize)
	if (query.page > last)
		redirect(`/app-management/${app.id}/logs${logsSearch({ ...query, page: last })}`)
	return (
		<AppLogs
			app={app}
			query={query}
			list={list}
			users={users}
		/>
	)
}
```

- [ ] **Step 9: The texts**

Every text of the page is an `admin_logs` key; the page also reads existing keys: `admin_apps.title` (the breadcrumb), `admin_users.name_not_set` and `admin_users.status_deactivated` (as the users table and the account pickers word them), `chat.default_conversation_name` (spec §3.1: an untitled conversation reads "New conversation", as the user's list) and `common.status`. The keys are typed (`types/i18next.d.ts`), so tsc fails on a key missing from the English file. The block goes before `app_setting`, a line no other task of this plan changes.

`locales/en/translation.json`, find:

```json
	"app_setting": {
```

Replace it with:

```json
	"admin_logs": {
		"title": "Logs",
		"subtitle": "Every conversation in this app, read-only. Each conversation or file you open is recorded in the access log.",
		"tab_conversations": "Conversations",
		"column_user": "User",
		"column_title": "Title",
		"column_messages": "Messages",
		"column_tokens": "Tokens",
		"column_updated": "Last activity",
		"column_tags": "Tags",
		"tag_failed": "Failed",
		"tag_stopped": "Stopped",
		"tag_waiting": "Waiting for an answer",
		"tag_deleted": "Deleted by the user, purged on",
		"filter_user": "All users",
		"filter_status": "Any status",
		"filter_deleted": "Include deleted",
		"total": "Total conversations: {{total}}",
		"empty": "No conversations yet",
		"no_match": "No conversations match these filters"
	},
	"app_setting": {
```

`locales/zh/translation.json`, find:

```json
	"app_setting": {
```

Replace it with:

```json
	"admin_logs": {
		"title": "日志",
		"subtitle": "此应用的全部对话，只读。您打开的每个对话或文件都会记录在访问日志中。",
		"tab_conversations": "对话",
		"column_user": "用户",
		"column_title": "标题",
		"column_messages": "消息",
		"column_tokens": "Tokens",
		"column_updated": "最后活动",
		"column_tags": "标签",
		"tag_failed": "失败",
		"tag_stopped": "已停止",
		"tag_waiting": "等待回答",
		"tag_deleted": "用户已删除，清除时间：",
		"filter_user": "全部用户",
		"filter_status": "任意状态",
		"filter_deleted": "包括已删除",
		"total": "共 {{total}} 个对话",
		"empty": "暂无对话",
		"no_match": "没有符合筛选条件的对话"
	},
	"app_setting": {
```

`locales/ar/translation.json` (Modern Standard Arabic, ADR-0005), find:

```json
	"app_setting": {
```

Replace it with:

```json
	"admin_logs": {
		"title": "السجلات",
		"subtitle": "جميع محادثات هذا التطبيق للقراءة فقط. تُسجَّل كل محادثة أو ملف تفتحه في سجل الوصول.",
		"tab_conversations": "المحادثات",
		"column_user": "المستخدم",
		"column_title": "العنوان",
		"column_messages": "الرسائل",
		"column_tokens": "الرموز",
		"column_updated": "آخر نشاط",
		"column_tags": "الوسوم",
		"tag_failed": "فشل",
		"tag_stopped": "تم الإيقاف",
		"tag_waiting": "بانتظار إجابة",
		"tag_deleted": "حذفها المستخدم، وتُحذف نهائيًا في",
		"filter_user": "جميع المستخدمين",
		"filter_status": "أي حالة",
		"filter_deleted": "تضمين المحذوفة",
		"total": "إجمالي المحادثات: {{total}}",
		"empty": "لا توجد محادثات بعد",
		"no_match": "لا توجد محادثات تطابق عوامل التصفية هذه"
	},
	"app_setting": {
```

"Tokens" stays in Latin script in Chinese, as `workflow.tokens` writes it ("Tokens：{{value}}"); the Arabic and Chinese words for conversation, user, status and tags are the neighbouring keys' (محادثة, المستخدم, الحالة, الوسوم; 对话, 用户, 状态, 标签). The "Deleted by the user, purged on" tag is followed by the date (ClientDateTime, formatted after hydration in the browser's zone and language), so each text ends where the date begins. No e2e text changes: `e2e/` has none of these strings.

- [ ] **Step 10: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/admin-logs-query.test.ts __tests__/admin-log-columns.test.ts __tests__/admin-logs-page.test.ts __tests__/i18n-locales.test.ts` Expected: PASS, `Test Files  4 passed (4)`, `Tests  67 passed (67)` (43, 6, 8 and the locale file's 10).

- [ ] **Step 11: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint 'app/(admin)/app-management/[appId]/logs/schemas.ts' 'app/(admin)/app-management/[appId]/logs/page.tsx' components/admin/logs/use-logs-navigation.ts components/admin/logs/log-columns.ts components/admin/logs/logs-filters.tsx components/admin/logs/app-logs.tsx __tests__/admin-logs-query.test.ts __tests__/admin-log-columns.test.ts __tests__/admin-logs-page.test.ts
pnpm exec oxfmt --check 'app/(admin)/app-management/[appId]/logs/schemas.ts' 'app/(admin)/app-management/[appId]/logs/page.tsx' components/admin/logs/use-logs-navigation.ts components/admin/logs/log-columns.ts components/admin/logs/logs-filters.tsx components/admin/logs/app-logs.tsx components/admin/logs/logs.module.css __tests__/admin-logs-query.test.ts __tests__/admin-log-columns.test.ts __tests__/admin-logs-page.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
pnpm test
npx -y @ant-design/cli lint ./ --format json
```

Expected: typegen writes the route's `PageProps<'/app-management/[appId]/logs'>` and tsc exits 0; no oxlint finding; oxfmt "All matched files use the correct format."; vitest 0 failed; the antd lint `"summary": { "total": 0, … }`.

- [ ] **Step 12: Commit**

```bash
git add 'app/(admin)/app-management/[appId]/logs/schemas.ts' 'app/(admin)/app-management/[appId]/logs/page.tsx' components/admin/logs/use-logs-navigation.ts components/admin/logs/log-columns.ts components/admin/logs/logs-filters.tsx components/admin/logs/app-logs.tsx components/admin/logs/logs.module.css locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/admin-logs-query.test.ts __tests__/admin-log-columns.test.ts __tests__/admin-logs-page.test.ts
git commit -m "feat(admin): the Logs page with numbered pages and its filters in the URL

An AG-UI app's conversations on a server page, one numbered page at a
time with the page size, the quick jumper and the total, filtered by the
days of last activity, the user, the status and the deleted ones, all
read from the URL; every change navigates to the new URL, and a page
past the end shows the last one. Tags show failed, stopped, waiting for
an answer and the purge date of a deleted conversation (spec §7.2;
decision 69 (5); plan calls P16, P17, P20).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the thirteen files; lint-staged changes nothing.

The page's locators for Task 19's spec: the level-4 heading is the app's name; the breadcrumb link "App configuration"; the tab "Conversations"; the comboboxes "User" and "Status" (placeholders "All users", "Any status"), the switch "Include deleted", the RangePicker's inputs by antd's placeholders "Start date" and "End date"; the column headers User, Title, Messages, Tokens, Last activity, Tags; the tags "Failed", "Stopped", "Waiting for an answer" and "Deleted by the user, purged on …"; the pager's total "Total conversations: N"; the empty table "No conversations yet", or "No conversations match these filters" while a filter is set.

```json:metadata
{"files": ["app/(admin)/app-management/[appId]/logs/schemas.ts", "app/(admin)/app-management/[appId]/logs/page.tsx", "components/admin/logs/use-logs-navigation.ts", "components/admin/logs/log-columns.ts", "components/admin/logs/logs-filters.tsx", "components/admin/logs/app-logs.tsx", "components/admin/logs/logs.module.css", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/admin-logs-query.test.ts", "__tests__/admin-log-columns.test.ts", "__tests__/admin-logs-page.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/admin-logs-query.test.ts __tests__/admin-log-columns.test.ts __tests__/admin-logs-page.test.ts __tests__/i18n-locales.test.ts", "acceptanceCriteria": ["parseLogsQuery answers the defaults for an empty query, reads every value (the first of a repeated one), and drops each value that does not parse on its own, its default standing", "logsSearch leaves defaults out and reads back to the same query; withFilters goes to page 1, withPage goes to page 1 only for a new size, withTab opens page 1 with the filters kept; lastPage and logFiltersOf as tested", "purgeAt is deletedAt + 30 days; logTags lists the statuses in LOG_STATUSES order then the deletion; each tag view has a preset status colour and an English text", "the page checks the session first, answers notFound() for a malformed or unknown app, reads the page and the accounts in parallel, hands AppLogs app, query (tab conversations), list and users, and redirects a page past the end to the last page with the filters kept", "the page shows the breadcrumb, the app's name as the level-4 heading, the Conversations tab, the four filters and the table with numbered pages; admin_logs keys in en, zh and ar", "tsc, oxlint, oxfmt clean; pnpm test 0 failed; antd lint total 0"], "modelTier": "standard"}
```

---

### Task 16: The transcript drawer

**Goal:** "View" on a Logs row opens a large antd Drawer that reads the conversation through the logs route and shows, read-only, its facts, its transcript (with "load earlier"), its runs as an antd Timeline and its state as JSON, with an Alert and a retry when the read fails.

Spec §7.2 ("**Detail:** a large antd `Drawer` that fetches `GET /api/apps/[appId]/logs/[conversationId]` when opened … It shows the transcript rendered read-only by the shared chat components (no composer, no buttons), a run timeline (antd `Timeline`: status, duration, tokens, error, interrupts and the user's answers) and the final state as collapsed JSON") and plan call P18 (the drawer's shape: `size="large"`, `destroyOnHidden`, keyed by the conversation; 2a's `TurnList` with `AssistantTurn`, no `TurnAnswersContext`, so every card is read-only and ADR-0035's receipts show the answers; no footer, no composer; the `view` row for the first page only, so "load earlier" is one view; above the tabs, antd `Descriptions` with the user, created, last activity, deleted and purged on). It reads Task 14's `createLogsApi` (`components/admin/logs/logs-api.ts`) and Task 13's `LogConversationPage` and `LogRunView` (`lib/chat/log-view.ts`), and provides `ChatAppInfoContext` around the transcript (the Shared contracts' `LogDrawer`), so Task 12's `TurnFiles` in a user turn builds its links from the app's id as in the user's chat. Docs checked: antd 6.6.5 (`npx -y @ant-design/cli doc <Component> --version 6.6.5`): Drawer (`size` "'default' | 'large' | number | string", large 736px, `es/drawer/style/index.js` caps it at `100vw`; `destroyOnHidden` 5.25.0; `loading` "Show the Skeleton", a boolean since 5.18.0; `title`, `onClose`), Descriptions (`items` with `label`, `children` and `span: 'filled'` (5.22.0); `column` by breakpoint; `size`), Tabs (`items`), Timeline (`items` with `color` one of `blue`, `red`, `green`, `gray` (`es/timeline/useItems.js` gives those four their classes), `loading` (the pending dot; `pending` is deprecated for it), `content`; the "Basic" demo's content-only items), Alert (`title`, `description`, `action`, as the shared chat's history Alert), Empty, Typography (`type` `secondary` and `danger`); Ant Design X `CodeHighlighter` through the shared chat's `CodeSection` (`components/shared-chat/code-section.tsx`: X's header with the language and copy, Prism's one-dark in the dark theme, the JSON as text); react.dev: "You Might Not Need an Effect" ("Adjusting some state when a prop changes": the previous prop kept in state and compared while rendering; "Fetching data": an Effect with an `ignore` flag so an earlier answer is dropped), `useEffect` (Strict Mode "will run one extra development-only setup+cleanup cycle before the first real setup", so a drawer mounted closed with the page reads each opening once, in development too, and writes no second `view` row), `createContext` (React 19 renders a context as its provider, as `shared-chat.tsx` provides `ChatAppInfoContext`). How the shared chat feeds `TurnList`, followed here: the route's `turns` (`HistoryTurn[]`) become `MessageInfo<Turn>` with status `success` through `toMessageInfo` (`components/shared-chat/hooks/chat-helpers.ts`), an older page goes above with `prependOlder` (`components/chat/hooks/history-paging.ts`, which drops ids already shown), `loadEarlier` rejects on a failed page (TurnList says so with `common.request_failed_retry` and keeps the reader's place), `isDefaultMessagesRequesting` is false (the Drawer's `loading` covers the first page), the reading width is `'none'` (the drawer is narrower than the chat's width) and `renderAssistant` is a module-level function, so the role map stays the same. In the drawer the body scrolls, not `ChatScroll`'s box: `.list` and `.scrollBox` (`components/chat/chat-view/chat-view.module.css`) are flex items in a box of no fixed height, so they take their content's height, and Bubble.List's `scrollTo` after "load earlier" (`scrollIntoView`) scrolls the drawer's body. The open conversation is `app-logs.tsx`'s state, never the URL's (P16, Task 15). Figures are worded as the workflow logs word theirs (`formatSeconds`, `formatCount` from `components/chat/message/workflow-summary.ts`: the UI language's digits, ADR-0005), and a run's error as the chat words it (`runErrorView`, `components/shared-chat/run-error.ts`). A run's dot: green for a run that succeeded, red for one that failed, blue while it runs or waits for the user, gray for one stopped or cut off. Task 17 changes `app-logs.tsx` again.

**Files:**

- Create: `components/admin/logs/log-run-items.ts`
- Create: `components/admin/logs/log-runs.tsx`
- Create: `components/admin/logs/log-drawer.tsx`
- Modify: `components/admin/logs/app-logs.tsx` (the open conversation's state, the "View" column, the drawer; as of Task 15)
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (the drawer's keys at the end of `admin_logs`, as of Task 15)
- Test: `__tests__/admin-log-runs.test.ts` (the whole file, below)

**Acceptance Criteria:**

- [ ] `runItems` maps a succeeded run to `{ color: 'green', labelKey: 'admin_logs.run_status.succeeded', loading: false, seconds: 2.5, … }` (2.5 s between its start and its end), a running run to `{ color: 'blue', loading: true, seconds: null }`, a failed run to `red` with its error kept, a finish before the start to `seconds: 0`, keeps the order it is given, and every run status has its colour and an English text.
- [ ] Each Logs row has a "View" link button; it opens the drawer (`size="large"`, `destroyOnHidden`), whose Skeleton shows until the first page arrives; the title is the conversation's title ("New conversation" when it has none); Descriptions show the user, created and last activity, and for a deleted conversation "Deleted by the user" and "Purged on"; the tabs are "Transcript", "Runs" and "State".
- [ ] The transcript is TurnList with read-only AssistantTurns and no footer; "Load earlier messages" shows while the route answers a cursor and puts the older page above; a failed first read shows an Alert ("Could not load this conversation") with "Try again"; every opening reads the conversation again; `admin_logs` gains the drawer's keys in en, zh and ar.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the changed files; `npx -y @ant-design/cli lint ./ --format json` reports `"total": 0`.

**Verify:** `pnpm exec vitest run --project unit __tests__/admin-log-runs.test.ts __tests__/i18n-locales.test.ts` → `Test Files  2 passed (2)`, `Tests  22 passed (22)`

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `__tests__/admin-log-runs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { RUN_STATUS_VIEWS, runItems } from '@/components/admin/logs/log-run-items'
import type { LogRunView } from '@/lib/chat/log-view'
import { RUN_STATUSES } from '@/lib/chat/statuses'
import en from '@/locales/en/translation.json'

const run = (over: Partial<LogRunView> = {}): LogRunView => ({
	id: 'r1',
	status: 'succeeded',
	startedAt: '2026-10-15T10:00:00.000Z',
	finishedAt: '2026-10-15T10:00:02.500Z',
	tokens: 1234,
	error: null,
	interrupts: 0,
	answers: 0,
	...over,
})

// Plan call P18: the drawer's "Runs" tab.
describe('runItems', () => {
	it("maps a run to its item: the status's view, its duration in seconds and its figures", () => {
		expect(runItems([run({ interrupts: 2, answers: 1 })])).toEqual([
			{
				id: 'r1',
				color: 'green',
				labelKey: 'admin_logs.run_status.succeeded',
				loading: false,
				startedAt: '2026-10-15T10:00:00.000Z',
				seconds: 2.5,
				tokens: 1234,
				error: null,
				interrupts: 2,
				answers: 1,
			},
		])
	})
	it('has no duration, and the loading icon, while the run runs', () => {
		const [item] = runItems([run({ status: 'running', finishedAt: null, tokens: null })])
		expect(item).toMatchObject({ color: 'blue', loading: true, seconds: null, tokens: null })
	})
	it("keeps a failed run's error for the chat's wording", () => {
		const error = { code: 'agent_error', message: 'The model refused.' }
		expect(runItems([run({ status: 'failed', error })])[0]).toMatchObject({ color: 'red', error })
	})
	it('never answers a negative duration', () => {
		expect(runItems([run({ finishedAt: '2026-10-15T09:59:59.000Z' })])[0]!.seconds).toBe(0)
	})
	it('keeps the order it is given', () => {
		expect(runItems([run({ id: 'a' }), run({ id: 'b' })]).map(item => item.id)).toEqual(['a', 'b'])
	})
})

describe('RUN_STATUS_VIEWS', () => {
	it.each([
		['running', 'blue'],
		['succeeded', 'green'],
		['interrupted', 'blue'],
		['cancelled', 'gray'],
		['failed', 'red'],
		['truncated', 'gray'],
	] as const)('shows %s in %s', (status, color) => {
		expect(RUN_STATUS_VIEWS[status].color).toBe(color)
	})
	it('words every run status in English', () => {
		for (const status of RUN_STATUSES)
			expect(en.admin_logs.run_status).toHaveProperty(
				RUN_STATUS_VIEWS[status].labelKey.split('.')[2]!,
			)
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/admin-log-runs.test.ts` Expected: FAIL, `Test Files  1 failed (1)`, `Tests  no tests`: `Cannot find package '@/components/admin/logs/log-run-items'`.

- [ ] **Step 3: The runs' items**

Create `components/admin/logs/log-run-items.ts`:

```ts
import type { LogRunView } from '@/lib/chat/log-view'
import type { RunStatus } from '@/lib/chat/statuses'

/**
 * A run's dot and status text (spec §7.2: the timeline's "status"): antd Timeline item `color`, one of its four preset
 * colours (`blue`, `red`, `green`, `gray`: `antd doc Timeline --version 6.6.5`, Items), green for a run that succeeded,
 * red for one that failed, blue while it runs or waits for the user, gray for one stopped or cut off.
 */
export const RUN_STATUS_VIEWS = {
	running: { color: 'blue', labelKey: 'admin_logs.run_status.running' },
	succeeded: { color: 'green', labelKey: 'admin_logs.run_status.succeeded' },
	interrupted: { color: 'blue', labelKey: 'admin_logs.run_status.interrupted' },
	cancelled: { color: 'gray', labelKey: 'admin_logs.run_status.cancelled' },
	failed: { color: 'red', labelKey: 'admin_logs.run_status.failed' },
	truncated: { color: 'gray', labelKey: 'admin_logs.run_status.truncated' },
} as const satisfies Record<
	RunStatus,
	{ color: 'blue' | 'green' | 'red' | 'gray'; labelKey: string }
>

/** A run as the drawer's "Runs" tab shows it (plan call P18). */
export interface RunItem {
	id: string
	color: (typeof RUN_STATUS_VIEWS)[RunStatus]['color']
	labelKey: (typeof RUN_STATUS_VIEWS)[RunStatus]['labelKey']
	/** Still running: the item shows antd Timeline's loading icon (item `loading`). */
	loading: boolean
	startedAt: string
	/** From its start to its end; null while it runs. */
	seconds: number | null
	tokens: number | null
	error: LogRunView['error']
	interrupts: number
	answers: number
}

/** The page's runs in the order the route gives them (oldest first), each with its status's view and its duration. */
export const runItems = (runs: readonly LogRunView[]): RunItem[] =>
	runs.map(run => ({
		id: run.id,
		...RUN_STATUS_VIEWS[run.status],
		loading: run.status === 'running',
		startedAt: run.startedAt,
		seconds:
			run.finishedAt === null
				? null
				: Math.max(0, (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000),
		tokens: run.tokens,
		error: run.error,
		interrupts: run.interrupts,
		answers: run.answers,
	}))
```

- [ ] **Step 4: The "Runs" tab**

Create `components/admin/logs/log-runs.tsx`:

```tsx
'use client'

import { Empty, Flex, Timeline, Typography, theme } from 'antd'
import { useTranslation } from 'react-i18next'

import ClientDateTime from '@/components/admin/client-date-time'
import { formatCount, formatSeconds } from '@/components/chat/message/workflow-summary'
import { runErrorView } from '@/components/shared-chat/run-error'
import type { LogRunView } from '@/lib/chat/log-view'

import { runItems } from './log-run-items'

/**
 * The drawer's "Runs" tab (spec §7.2; plan call P18): an antd Timeline, one item per run (`items` with `color`,
 * `loading` and `content`: the "Basic" demo's content-only items), its status, its start, then its duration, tokens,
 * interrupts and answers sent on one line (the workflow logs' "N s · Tokens: N" line), and its error as the chat
 * words it (runErrorView: a hub code by its key, the agent's message as sent). Digits follow the UI language
 * (ADR-0005). Every text renders as text (spec §6.4).
 */
export default function LogRuns({ runs }: { runs: readonly LogRunView[] }) {
	const { t, i18n } = useTranslation()
	const { token } = theme.useToken()
	const language = i18n.resolvedLanguage
	const items = runItems(runs)
	if (items.length === 0)
		return (
			<Empty
				image={Empty.PRESENTED_IMAGE_SIMPLE}
				description={t('admin_logs.no_runs')}
			/>
		)
	return (
		<Timeline
			items={items.map(item => {
				const facts = [
					item.seconds === null
						? ''
						: t('admin_logs.run_duration', { value: formatSeconds(item.seconds, language, 1) }),
					item.tokens === null
						? ''
						: t('admin_logs.run_tokens', { value: formatCount(item.tokens, language) }),
					item.interrupts > 0
						? t('admin_logs.run_interrupts', { value: formatCount(item.interrupts, language) })
						: '',
					item.answers > 0
						? t('admin_logs.run_answers', { value: formatCount(item.answers, language) })
						: '',
				]
					.filter(Boolean)
					.join(' · ')
				const error = item.error ? runErrorView(item.error) : null
				return {
					key: item.id,
					color: item.color,
					loading: item.loading,
					content: (
						<Flex
							vertical
							gap={token.marginXXS}
						>
							<Typography.Text strong>{t(item.labelKey)}</Typography.Text>
							<Typography.Text type="secondary">
								<ClientDateTime value={item.startedAt} />
							</Typography.Text>
							{facts && <Typography.Text type="secondary">{facts}</Typography.Text>}
							{error && <Typography.Text type="danger">{t(error.titleKey)}</Typography.Text>}
							{error?.description && (
								<Typography.Text type="secondary">{error.description}</Typography.Text>
							)}
						</Flex>
					),
				}
			})}
		/>
	)
}
```

- [ ] **Step 5: The drawer**

Create `components/admin/logs/log-drawer.tsx`:

```tsx
'use client'

import type { MessageInfo } from '@ant-design/x-sdk'
import {
	Alert,
	Button,
	Descriptions,
	type DescriptionsProps,
	Drawer,
	Empty,
	Flex,
	Tabs,
	theme,
} from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ClientDateTime from '@/components/admin/client-date-time'
import { ChatAppInfoContext } from '@/components/chat/chat-view/app-info-context'
import type { ChatScrollHandle } from '@/components/chat/chat-view/chat-scroll'
import { prependOlder } from '@/components/chat/hooks/history-paging'
import AssistantTurn from '@/components/shared-chat/assistant-turn'
import CodeSection from '@/components/shared-chat/code-section'
import { toMessageInfo } from '@/components/shared-chat/hooks/chat-helpers'
import { requestFailureText } from '@/components/shared-chat/run-error'
import TurnList from '@/components/shared-chat/turn-list'
import type { LogConversationPage, LogRunView } from '@/lib/chat/log-view'
import type { Turn } from '@/lib/chat/turn'

import type { AppLogsProps } from './app-logs'
import { purgeAt } from './log-columns'
import LogRuns from './log-runs'
import { createLogsApi } from './logs-api'

/** What the drawer holds of a conversation: the first page's facts, the turns and runs of every page so far, the cursor. */
interface Transcript {
	conversation: LogConversationPage['conversation']
	turns: MessageInfo<Turn>[]
	runs: LogRunView[]
	cursor: string | null
}

/** One opening of the drawer: the conversation, and a number that changes with every opening and every retry. */
interface Opening {
	id: string
	n: number
}

type Load =
	| { n: number; status: 'ready'; transcript: Transcript }
	| { n: number; status: 'failed'; error: unknown }

/**
 * A finished answer, read-only: no TurnAnswersContext reaches it, so every card shows its receipt (ADR-0035) and none
 * offers an answer; X's message status `success`. At module level, so TurnList's role map stays the same.
 */
const renderAssistant = (turn: Turn) => (
	<AssistantTurn
		turn={turn}
		status="success"
	/>
)

/**
 * The transcript drawer (spec §7.2; plan call P18): "View" opens an antd Drawer (`size="large"`, `destroyOnHidden`, its
 * `loading` Skeleton while the first page loads: `antd doc Drawer --version 6.6.5`) that reads the conversation through
 * the logs route (createLogsApi; the route writes the `view` row for the first page only, so "load earlier" in the same
 * drawer is one view). Every opening reads the conversation again (each one is a view) and keys the body afresh (React:
 * "Adjusting some state when a prop changes", the previous prop kept in state); an answer for an earlier opening is
 * ignored (React: "Fetching data" with an `ignore` flag). Above the tabs, antd Descriptions with the user and the
 * dates; then "Transcript" (2a's TurnList with the user turns and AssistantTurn, the app in ChatAppInfoContext as the
 * user's chat provides it, no footer and no composer), "Runs" (LogRuns) and "State" (indented JSON in the shared
 * chat's CodeSection, X CodeHighlighter). A failed first read shows an antd Alert with its retry.
 */
export default function LogDrawer({
	app,
	conversationId,
	onClose,
}: {
	app: AppLogsProps['app']
	conversationId: string | null
	onClose: () => void
}) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const api = useMemo(() => createLogsApi(app.id), [app.id])
	const scrollRef = useRef<ChatScrollHandle>(null)
	// Each opening (the prop turning to a conversation) counts; the last one stays while the drawer slides out, so its
	// content does not vanish before the motion ends, and destroyOnHidden removes it after.
	const [previousId, setPreviousId] = useState<string | null>(null)
	const [opening, setOpening] = useState<Opening | null>(null)
	if (conversationId !== previousId) {
		setPreviousId(conversationId)
		if (conversationId !== null) setOpening({ id: conversationId, n: (opening?.n ?? 0) + 1 })
	}
	const [load, setLoad] = useState<Load | null>(null)
	const open = conversationId !== null

	// One read per opening. The drawer is mounted with the page, closed, so an opening is a change of this Effect's
	// dependencies and never its first setup: Strict Mode's extra development-only cycle runs "before the first real
	// setup" (react.dev useEffect), so it never reads a transcript twice (nor writes a second `view` row). Only while
	// open: the last opening stays for the slide-out, and a run of the Effect after the close reads nothing.
	useEffect(() => {
		if (!open || opening === null) return
		let ignore = false
		api.getConversation(opening.id).then(
			page => {
				if (ignore) return
				setLoad({
					n: opening.n,
					status: 'ready',
					transcript: {
						conversation: page.conversation,
						turns: page.turns.map(toMessageInfo),
						runs: page.runs,
						cursor: page.cursor,
					},
				})
			},
			(error: unknown) => {
				if (!ignore) setLoad({ n: opening.n, status: 'failed', error })
			},
		)
		return () => {
			ignore = true
		}
	}, [api, open, opening])

	const current = opening !== null && load?.n === opening.n ? load : null
	const transcript = current?.status === 'ready' ? current.transcript : null

	/** "Load earlier": the page before the cursor goes above; rejects when it fails (TurnList says so). */
	const loadEarlier = async () => {
		if (!opening || !transcript?.cursor) return
		const page = await api.getConversation(opening.id, transcript.cursor)
		setLoad(previous =>
			previous?.n === opening.n && previous.status === 'ready'
				? {
						...previous,
						transcript: {
							...previous.transcript,
							turns: prependOlder(previous.transcript.turns, page.turns.map(toMessageInfo)),
							runs: prependOlder(previous.transcript.runs, page.runs),
							cursor: page.cursor,
						},
					}
				: previous,
		)
	}
	const retry = () => setOpening(previous => previous && { ...previous, n: previous.n + 1 })

	const facts = (conversation: Transcript['conversation']): DescriptionsProps['items'] => [
		{
			key: 'user',
			label: t('admin_logs.column_user'),
			children: conversation.user.name
				? `${conversation.user.name} (${conversation.user.email})`
				: conversation.user.email,
			span: 'filled',
		},
		{
			key: 'created',
			label: t('common.created_at'),
			children: <ClientDateTime value={conversation.createdAt} />,
		},
		{
			key: 'updated',
			label: t('admin_logs.column_updated'),
			children: <ClientDateTime value={conversation.updatedAt} />,
		},
		...(conversation.deletedAt
			? [
					{
						key: 'deleted',
						label: t('admin_logs.field_deleted'),
						children: <ClientDateTime value={conversation.deletedAt} />,
					},
					{
						key: 'purge',
						label: t('admin_logs.field_purge'),
						children: <ClientDateTime value={purgeAt(conversation.deletedAt)} />,
					},
				]
			: []),
	]

	return (
		<Drawer
			open={open}
			onClose={onClose}
			size="large"
			destroyOnHidden
			loading={opening !== null && current === null}
			title={
				transcript
					? transcript.conversation.title || t('chat.default_conversation_name')
					: t('admin_logs.drawer_title')
			}
		>
			{current?.status === 'failed' && (
				<Alert
					type="error"
					showIcon
					title={t('admin_logs.load_failed')}
					description={requestFailureText(current.error, t, t('common.request_failed_retry'))}
					action={
						<Button
							size="small"
							onClick={retry}
						>
							{t('common.retry')}
						</Button>
					}
				/>
			)}
			{opening && transcript && (
				<Flex
					key={opening.n}
					vertical
					gap={token.margin}
				>
					<Descriptions
						size="small"
						column={{ xs: 1, sm: 2 }}
						items={facts(transcript.conversation)}
					/>
					<Tabs
						items={[
							{
								key: 'transcript',
								label: t('admin_logs.tab_transcript'),
								children: (
									<ChatAppInfoContext value={app}>
										<TurnList
											messages={transcript.turns}
											conversationKey={opening.id}
											isDefaultMessagesRequesting={false}
											hasMore={transcript.cursor !== null}
											loadEarlier={loadEarlier}
											maxWidth="none"
											renderAssistant={renderAssistant}
											scrollRef={scrollRef}
										/>
									</ChatAppInfoContext>
								),
							},
							{
								key: 'runs',
								label: t('admin_logs.tab_runs'),
								children: <LogRuns runs={transcript.runs} />,
							},
							{
								key: 'state',
								label: t('admin_logs.tab_state'),
								children:
									transcript.conversation.state == null ? (
										<Empty
											image={Empty.PRESENTED_IMAGE_SIMPLE}
											description={t('admin_logs.no_state')}
										/>
									) : (
										<CodeSection
											detail={{
												kind: 'code',
												lang: 'json',
												code: JSON.stringify(transcript.conversation.state, null, 2),
											}}
										/>
									),
							},
						]}
					/>
				</Flex>
			)}
		</Drawer>
	)
}
```

- [ ] **Step 6: "View" on each row**

`components/admin/logs/app-logs.tsx` as of Task 15.

In `components/admin/logs/app-logs.tsx`, find:

```tsx
'use client'

import { Breadcrumb, Empty, Flex, Table, type TableProps, Tabs, Tag, Typography, theme } from 'antd'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
```

Replace it with:

```tsx
'use client'

import {
	Breadcrumb,
	Button,
	Empty,
	Flex,
	Table,
	type TableProps,
	Tabs,
	Tag,
	Typography,
	theme,
} from 'antd'
import Link from 'next/link'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
```

Then find:

```tsx
import { LOG_TAG_VIEWS, logTags, NO_FIGURE } from './log-columns'
import styles from './logs.module.css'
```

Replace it with:

```tsx
import { LOG_TAG_VIEWS, logTags, NO_FIGURE } from './log-columns'
import LogDrawer from './log-drawer'
import styles from './logs.module.css'
```

Then find:

```tsx
 * server (antd Table `pagination` with `current`, `pageSize` and `total`, the "Ajax" demo's controlled pager, in the
 * admin tables' look, tablePagination), whose every change is a navigation to the new URL (useLogsNavigation). Each
 * text the conversations carry renders as text (spec §6.4).
 */
```

Replace it with:

```tsx
 * server (antd Table `pagination` with `current`, `pageSize` and `total`, the "Ajax" demo's controlled pager, in the
 * admin tables' look, tablePagination), whose every change is a navigation to the new URL (useLogsNavigation), and
 * each row's "View", which opens its transcript in LogDrawer (P18). Each text the conversations carry renders as text
 * (spec §6.4).
 */
```

Then find:

```tsx
export default function AppLogs({ app, query, list, users }: AppLogsProps) {
	const { t, i18n } = useTranslation()
	const { token } = theme.useToken()
	const { shown, pending, navigate } = useLogsNavigation(query)
	// Digits follow the UI language (ADR-0005), as the chat's figures (workflow-summary.ts).
	const language = i18n.resolvedLanguage

	const columns: TableProps<LogListRow>['columns'] = [
```

Replace it with:

```tsx
export default function AppLogs({ app, query, list, users }: AppLogsProps) {
	const { t, i18n } = useTranslation()
	const { token } = theme.useToken()
	const { shown, pending, navigate } = useLogsNavigation(query)
	// P16: the open conversation is the page's state, never the URL's, so a reload writes no second view row (R3 §4).
	const [openId, setOpenId] = useState<string | null>(null)
	// Digits follow the UI language (ADR-0005), as the chat's figures (workflow-summary.ts).
	const language = i18n.resolvedLanguage

	const columns: TableProps<LogListRow>['columns'] = [
```

Then find:

```tsx
				) : null
			},
		},
	]

	const conversations = (
```

Replace it with:

```tsx
				) : null
			},
		},
		{
			title: t('common.actions'),
			key: 'actions',
			render: (_, row) => (
				<Button
					type="link"
					onClick={() => setOpenId(row.id)}
				>
					{t('admin_logs.view')}
				</Button>
			),
		},
	]

	const conversations = (
```

Then find:

```tsx
						children: conversations,
					},
				]}
			/>
		</Flex>
	)
}
```

Replace it with:

```tsx
						children: conversations,
					},
				]}
			/>
			<LogDrawer
				app={app}
				conversationId={openId}
				onClose={() => setOpenId(null)}
			/>
		</Flex>
	)
}
```

- [ ] **Step 7: The texts**

The drawer also reads `common.created_at`, `common.retry`, `common.actions`, `admin_logs.column_user`, `admin_logs.column_updated` and `chat.default_conversation_name`. The keys go at the end of the `admin_logs` block as of Task 15; `run_status` is nested, as `workflow.status` is.

In `locales/en/translation.json`, find:

```json
		"empty": "No conversations yet",
		"no_match": "No conversations match these filters"
	},
```

Replace it with:

```json
		"empty": "No conversations yet",
		"no_match": "No conversations match these filters",
		"view": "View",
		"drawer_title": "Conversation",
		"load_failed": "Could not load this conversation",
		"field_deleted": "Deleted by the user",
		"field_purge": "Purged on",
		"tab_transcript": "Transcript",
		"tab_runs": "Runs",
		"tab_state": "State",
		"no_runs": "No runs",
		"no_state": "The agent has set no state",
		"run_status": {
			"running": "Running",
			"succeeded": "Succeeded",
			"interrupted": "Paused for input",
			"cancelled": "Stopped",
			"failed": "Failed",
			"truncated": "Cut off"
		},
		"run_duration": "{{value}} s",
		"run_tokens": "Tokens: {{value}}",
		"run_interrupts": "Interrupts: {{value}}",
		"run_answers": "Answers sent: {{value}}"
	},
```

In `locales/zh/translation.json`, find:

```json
		"empty": "暂无对话",
		"no_match": "没有符合筛选条件的对话"
	},
```

Replace it with:

```json
		"empty": "暂无对话",
		"no_match": "没有符合筛选条件的对话",
		"view": "查看",
		"drawer_title": "对话",
		"load_failed": "无法加载此对话",
		"field_deleted": "用户删除于",
		"field_purge": "清除时间",
		"tab_transcript": "对话记录",
		"tab_runs": "运行",
		"tab_state": "状态",
		"no_runs": "暂无运行",
		"no_state": "智能体未设置任何状态",
		"run_status": {
			"running": "运行中",
			"succeeded": "成功",
			"interrupted": "已暂停，等待输入",
			"cancelled": "已停止",
			"failed": "失败",
			"truncated": "已截断"
		},
		"run_duration": "{{value}} 秒",
		"run_tokens": "Tokens：{{value}}",
		"run_interrupts": "中断：{{value}}",
		"run_answers": "已发送回答：{{value}}"
	},
```

In `locales/ar/translation.json`, find:

```json
		"empty": "لا توجد محادثات بعد",
		"no_match": "لا توجد محادثات تطابق عوامل التصفية هذه"
	},
```

Replace it with:

```json
		"empty": "لا توجد محادثات بعد",
		"no_match": "لا توجد محادثات تطابق عوامل التصفية هذه",
		"view": "عرض",
		"drawer_title": "المحادثة",
		"load_failed": "تعذّر تحميل هذه المحادثة",
		"field_deleted": "حذفها المستخدم في",
		"field_purge": "تُحذف نهائيًا في",
		"tab_transcript": "نص المحادثة",
		"tab_runs": "عمليات التشغيل",
		"tab_state": "الحالة",
		"no_runs": "لا توجد عمليات تشغيل",
		"no_state": "لم يحدّد الوكيل أي حالة",
		"run_status": {
			"running": "قيد التشغيل",
			"succeeded": "تم بنجاح",
			"interrupted": "متوقف مؤقتًا بانتظار إدخال",
			"cancelled": "تم الإيقاف",
			"failed": "فشل",
			"truncated": "مقطوع"
		},
		"run_duration": "{{value}} ث",
		"run_tokens": "الرموز: {{value}}",
		"run_interrupts": "المقاطعات: {{value}}",
		"run_answers": "الإجابات المرسلة: {{value}}"
	},
```

The units and digits follow `workflow.seconds` ("{{value}} 秒", "{{value}} ث") and `workflow.tokens`; "Transcript" is نص المحادثة and 对话记录, "Runs" عمليات التشغيل and 运行, as the run statuses' neighbours word them. No e2e text changes: `e2e/` has none of these strings.

- [ ] **Step 8: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/admin-log-runs.test.ts __tests__/i18n-locales.test.ts` Expected: PASS, `Test Files  2 passed (2)`, `Tests  22 passed (22)` (12 and the locale file's 10).

- [ ] **Step 9: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint components/admin/logs/log-run-items.ts components/admin/logs/log-runs.tsx components/admin/logs/log-drawer.tsx components/admin/logs/app-logs.tsx __tests__/admin-log-runs.test.ts
pnpm exec oxfmt --check components/admin/logs/log-run-items.ts components/admin/logs/log-runs.tsx components/admin/logs/log-drawer.tsx components/admin/logs/app-logs.tsx __tests__/admin-log-runs.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
pnpm test
npx -y @ant-design/cli lint ./ --format json
```

Expected: tsc exits 0; no oxlint finding; oxfmt "All matched files use the correct format."; vitest 0 failed; the antd lint `"total": 0`.

- [ ] **Step 10: Commit**

```bash
git add components/admin/logs/log-run-items.ts components/admin/logs/log-runs.tsx components/admin/logs/log-drawer.tsx components/admin/logs/app-logs.tsx locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/admin-log-runs.test.ts
git commit -m "feat(admin): the Logs transcript drawer with its runs and state

View on a Logs row opens a large drawer that reads the conversation
through the logs route on every opening: the user and the dates, the
transcript in the shared chat's turn list with read-only cards and
load earlier, the runs as a timeline (status, start, duration, tokens,
interrupts, answers sent, the error) and the state as JSON; a failed
read shows an alert with a retry (spec §7.2; plan call P18).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the eight files; lint-staged changes nothing.

The drawer's locators for Task 19's spec: the row's button "View"; the drawer (`getByRole('dialog')`) titled by the conversation's title; the Descriptions labels "User", "Created", "Last activity", "Deleted by the user", "Purged on"; the tabs "Transcript", "Runs", "State"; "Load earlier messages"; a run's status ("Succeeded", "Paused for input", "Stopped", "Failed", "Cut off", "Running") and its line ("2.5 s · Tokens: 1,234 · Answers sent: 1"); "The agent has set no state" for a conversation without state; the failed read "Could not load this conversation" with "Try again".

```json:metadata
{"files": ["components/admin/logs/log-run-items.ts", "components/admin/logs/log-runs.tsx", "components/admin/logs/log-drawer.tsx", "components/admin/logs/app-logs.tsx", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/admin-log-runs.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/admin-log-runs.test.ts __tests__/i18n-locales.test.ts", "acceptanceCriteria": ["runItems maps each run to its status's colour and text key, loading while it runs, its duration in seconds (null while running, never negative), its tokens, error, interrupts and answers, in the order given", "View on a row opens the large destroyOnHidden drawer with its Skeleton until the first page arrives, titled by the conversation, with Descriptions (user, created, last activity, deleted and purged on for a deleted one) and the Transcript, Runs and State tabs", "the transcript is TurnList with read-only AssistantTurns, no footer, load earlier through the cursor; a failed first read shows an Alert with Try again; every opening reads again; the drawer's keys in en, zh and ar", "tsc, oxlint, oxfmt clean; pnpm test 0 failed; antd lint total 0"], "modelTier": "standard"}
```

---

### Task 17: The access log tab

**Goal:** The owner's Logs page has an "Access log" tab: who opened which conversation or fetched which file of this app, and when, newest first, on numbered pages like the conversations; an admin's page has no such tab and never reads the log.

Spec §7.2 ("**Access log tab:** on the Logs page, for the owner role only, the rows for this app (who, which conversation, when)") and plan call P19 (`?tab=access` on the same page with its own numbered pages, the same `page` and `pageSize`; the tab not rendered for an admin; the columns: when, who or "Deleted account", the action (View, Download), the conversation with its user or "Purged conversation", and for a download the file or "Removed file"), with decision 70 (5) (a `download` row names its attachment). It reads Task 13's `listAccessLog` and `AccessLogRow` (`lib/data/logs.ts`; the data layer refuses anyone but the owner and orders the rows newest first) and writes the Shared contracts' `AccessLogTable`. Docs checked: antd 6.6.5 Table and Pagination as in Task 15 (`npx -y @ant-design/cli doc Table --version 6.6.5`, the "Ajax" demo), Tabs (`activeKey`, `onChange(activeKey)`, `items`), Tag (a preset colour, `blue`, for a download; a view is the plain tag), Typography and Empty; Next's `page.md` and `use-router.md` as in Task 15. The URL's `page` is the shown tab's; the other tab's table is read at its first page, which is where a tab switch opens it (`withTab`), so the owner's page reads the access log's first page beside the conversations and the "Access log" tab exists on both tabs (an `access` prop present only on the access tab would leave the owner no tab to click). A tab click navigates like a page click (Task 15's `useLogsNavigation`), and while the next page renders, the optimistic query shows the other tab at once with the rows already read for it. A `?tab=access` from an admin reads as the conversations, and the access log is never read for one. The log has no foreign keys, so a row outlives what it names: its names come from Task 13's joins, null when gone, and render as text (spec §6.4).

**Files:**

- Create: `components/admin/logs/access-log-table.tsx`
- Modify: `components/admin/logs/app-logs.tsx` (the owner's tab and the tab switch; as of Task 16)
- Modify: `app/(admin)/app-management/[appId]/logs/page.tsx` (the owner's read; as of Task 15)
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (the tab's keys at the end of `admin_logs`, as of Task 16)
- Test: `__tests__/admin-logs-page.test.ts` (the whole file, below: the owner's cases)

**Acceptance Criteria:**

- [ ] For the owner, the page reads `listAccessLog(owner, appId, { page: 1, pageSize })` beside the conversations and hands `access` to AppLogs; with `?tab=access&page=3` it reads the access log's page 3 and the conversations' page 1 and keeps `tab: 'access'`; a page past the access log's end redirects to `?tab=access&page=<last>`; for an admin it never calls `listAccessLog`, `access` is undefined and the tab reads `conversations`.
- [ ] The owner sees the tabs "Conversations" and "Access log"; a tab click navigates to the tab's first page with the filters kept; the access log's table shows When, Who ("Deleted account" when the account is gone), Action ("View" or "Download"), Conversation (its title, "New conversation" when it has none, and its user's email, or "Purged conversation") and File (its name, "Removed file" once gone, empty for a view), with numbered pages and "Total entries: N"; an admin's page shows no "Access log" tab.
- [ ] `admin_logs` gains the tab's keys in en, zh and ar.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the changed files; `npx -y @ant-design/cli lint ./ --format json` reports `"total": 0`.

**Verify:** `pnpm exec vitest run --project unit __tests__/admin-logs-page.test.ts __tests__/i18n-locales.test.ts` → `Test Files  2 passed (2)`, `Tests  21 passed (21)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Replace the whole of `__tests__/admin-logs-page.test.ts` (as of Task 15) with (the data layer's mock gains `listAccessLog`, the admin case checks it is never read, and three owner cases follow):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
	requireAdminUser,
	findLogsApp,
	listAppLogs,
	listLogUsers,
	listAccessLog,
	notFound,
	redirect,
	AppLogs,
	redirectSignal,
	notFoundSignal,
} = vi.hoisted(() => {
	const redirectSignal = new Error('NEXT_REDIRECT')
	const notFoundSignal = new Error('NEXT_HTTP_ERROR_FALLBACK;404')
	return {
		requireAdminUser: vi.fn(),
		findLogsApp: vi.fn(),
		listAppLogs: vi.fn(),
		listLogUsers: vi.fn(),
		listAccessLog: vi.fn(),
		// Both work by throwing (functions/not-found.md, functions/redirect.md).
		notFound: vi.fn(() => {
			throw notFoundSignal
		}),
		redirect: vi.fn(() => {
			throw redirectSignal
		}),
		AppLogs: () => null,
		redirectSignal,
		notFoundSignal,
	}
})
vi.mock('@/lib/auth/session', () => ({ requireAdminUser }))
vi.mock('@/lib/data/logs', () => ({ findLogsApp, listAppLogs, listLogUsers, listAccessLog }))
vi.mock('next/navigation', () => ({ notFound, redirect }))
vi.mock('@/components/admin/logs/app-logs', () => ({ default: AppLogs }))

import AppLogsPage from '@/app/(admin)/app-management/[appId]/logs/page'

const APP_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const USER_ID = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f'
const admin = { id: 'a1', email: 'admin@example.com', name: null, role: 'admin' }
const owner = { id: 'o1', email: 'owner@example.com', name: null, role: 'owner' }
const app = { id: APP_ID, name: 'Tea', description: '', hasIcon: false }
const rows = [{ id: 'c1' }]
const users = [{ id: USER_ID, name: null, email: 'joe@example.com', active: true }]
const props = (query: Record<string, string> = {}, appId = APP_ID) =>
	({ params: Promise.resolve({ appId }), searchParams: Promise.resolve(query) }) as never

beforeEach(() => {
	for (const fn of [
		requireAdminUser,
		findLogsApp,
		listAppLogs,
		listLogUsers,
		listAccessLog,
		notFound,
		redirect,
	])
		fn.mockClear()
	requireAdminUser.mockResolvedValue(admin)
	findLogsApp.mockResolvedValue(app)
	listAppLogs.mockResolvedValue({ rows, total: 1 })
	listLogUsers.mockResolvedValue(users)
	listAccessLog.mockResolvedValue({ rows: [{ id: 'l1' }], total: 1 })
})

describe('/app-management/[appId]/logs page', () => {
	it('checks the session before it reads anything', async () => {
		requireAdminUser.mockRejectedValueOnce(redirectSignal)
		await expect(AppLogsPage(props())).rejects.toBe(redirectSignal)
		expect(findLogsApp).not.toHaveBeenCalled()
		expect(listAppLogs).not.toHaveBeenCalled()
	})
	// Plan call P20: a missing app, or one whose provider keeps no history, is a 404; a malformed id reaches no query.
	it('answers notFound() for an app the logs cannot show', async () => {
		findLogsApp.mockResolvedValueOnce(null)
		await expect(AppLogsPage(props())).rejects.toBe(notFoundSignal)
		expect(findLogsApp).toHaveBeenCalledWith(admin, APP_ID)
		expect(listAppLogs).not.toHaveBeenCalled()
	})
	it('answers notFound() for a malformed id without reading the app', async () => {
		await expect(AppLogsPage(props({}, 'not-a-uuid'))).rejects.toBe(notFoundSignal)
		expect(findLogsApp).not.toHaveBeenCalled()
	})
	it("reads the URL's page and filters and hands the trimmed props to AppLogs", async () => {
		const page = await AppLogsPage(
			props({ page: '1', pageSize: '20', user: USER_ID, status: 'failed', deleted: '1' }),
		)
		expect(listAppLogs).toHaveBeenCalledWith(
			admin,
			APP_ID,
			{
				from: undefined,
				to: undefined,
				userId: USER_ID,
				status: 'failed',
				includeDeleted: true,
			},
			{ page: 1, pageSize: 20 },
		)
		expect(listLogUsers).toHaveBeenCalledWith(admin, APP_ID)
		expect(page).toMatchObject({
			type: AppLogs,
			props: {
				app,
				query: {
					tab: 'conversations',
					page: 1,
					pageSize: 20,
					user: USER_ID,
					status: 'failed',
					deleted: true,
				},
				list: { rows, total: 1 },
				users,
			},
		})
		expect(page.props.access).toBeUndefined()
	})
	it('reads the page and the accounts in parallel', async () => {
		let resolveList: (value: unknown) => void = () => {}
		listAppLogs.mockReturnValueOnce(new Promise(resolve => (resolveList = resolve)))
		const rendering = AppLogsPage(props())
		await vi.waitFor(() => expect(listLogUsers).toHaveBeenCalled())
		resolveList({ rows, total: 1 })
		await rendering
	})
	it("shows an admin the conversations and never reads the access log, whatever the URL's tab", async () => {
		const page = await AppLogsPage(props({ tab: 'access' }))
		expect(page.props.query.tab).toBe('conversations')
		expect(listAccessLog).not.toHaveBeenCalled()
	})
	// R3 §2: a page past the end goes to the last page, filters kept.
	it('redirects a page past the end to the last page', async () => {
		listAppLogs.mockResolvedValueOnce({ rows: [], total: 25 })
		await expect(AppLogsPage(props({ page: '9', status: 'failed' }))).rejects.toBe(redirectSignal)
		expect(redirect).toHaveBeenCalledWith(`/app-management/${APP_ID}/logs?page=3&status=failed`)
	})
	it('keeps page 1 of an app without conversations', async () => {
		listAppLogs.mockResolvedValueOnce({ rows: [], total: 0 })
		await AppLogsPage(props())
		expect(redirect).not.toHaveBeenCalled()
	})

	// Plan call P19: the owner's tab, with its own numbered pages.
	it("reads the owner's access log at its first page beside the conversations", async () => {
		requireAdminUser.mockResolvedValueOnce(owner)
		listAppLogs.mockResolvedValueOnce({ rows, total: 30 })
		const page = await AppLogsPage(props({ page: '2', pageSize: '20' }))
		expect(listAppLogs.mock.calls[0]![3]).toEqual({ page: 2, pageSize: 20 })
		expect(listAccessLog).toHaveBeenCalledWith(owner, APP_ID, { page: 1, pageSize: 20 })
		expect(page.props.access).toEqual({ rows: [{ id: 'l1' }], total: 1 })
	})
	it("gives the URL's page to the access log on its tab and reads the conversations at page 1", async () => {
		requireAdminUser.mockResolvedValueOnce(owner)
		listAccessLog.mockResolvedValueOnce({ rows: [{ id: 'l1' }], total: 45 })
		const page = await AppLogsPage(props({ tab: 'access', page: '3', status: 'failed' }))
		expect(listAccessLog).toHaveBeenCalledWith(owner, APP_ID, { page: 3, pageSize: 10 })
		expect(listAppLogs.mock.calls[0]![3]).toEqual({ page: 1, pageSize: 10 })
		expect(page.props.query).toMatchObject({ tab: 'access', page: 3, status: 'failed' })
	})
	it("redirects a page past the access log's end to its last page", async () => {
		requireAdminUser.mockResolvedValueOnce(owner)
		listAccessLog.mockResolvedValueOnce({ rows: [], total: 12 })
		await expect(AppLogsPage(props({ tab: 'access', page: '5' }))).rejects.toBe(redirectSignal)
		expect(redirect).toHaveBeenCalledWith(`/app-management/${APP_ID}/logs?tab=access&page=2`)
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/admin-logs-page.test.ts` Expected: FAIL, `Test Files  1 failed (1)`, `Tests  3 failed | 8 passed (11)`: the three owner cases (the page as of Task 15 never calls `listAccessLog`, and it reads `?tab=access` as the conversations, whose one row puts page 5 past the end, so it redirects to `/app-management/<id>/logs`).

- [ ] **Step 3: The access log's table**

Create `components/admin/logs/access-log-table.tsx`:

```tsx
'use client'

import { Empty, Table, type TableProps, Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

import {
	LOG_PAGE_SIZES,
	withPage,
	type LogsQuery,
} from '@/app/(admin)/app-management/[appId]/logs/schemas'
import ClientDateTime from '@/components/admin/client-date-time'
import { tablePagination } from '@/components/admin/table-pagination'
import type { AccessLogRow } from '@/lib/data/logs'

import styles from './logs.module.css'
import { useLogsNavigation } from './use-logs-navigation'

/** Each action's antd Tag colour (a preset colour; a view is the plain tag) and text key. */
const ACTION_VIEWS = {
	view: { color: undefined, labelKey: 'admin_logs.action_view' },
	download: { color: 'blue', labelKey: 'admin_logs.action_download' },
} as const

/**
 * The owner's access log (spec §7.2; plan call P19): who opened which conversation or fetched which file of this app,
 * newest first, in an antd Table with the conversations' numbered pages (the same `page` and `pageSize` in the URL,
 * useLogsNavigation). The log has no foreign keys, so a row outlives what it names: a gone account reads "Deleted
 * account", a purged conversation "Purged conversation", a removed file "Removed file"; a view has no file. Every
 * name renders as text (spec §6.4).
 */
export default function AccessLogTable({
	rows,
	total,
	query,
}: {
	rows: AccessLogRow[]
	total: number
	query: LogsQuery
}) {
	const { t } = useTranslation()
	const { shown, pending, navigate } = useLogsNavigation(query)

	const columns: TableProps<AccessLogRow>['columns'] = [
		{
			title: t('admin_logs.access_at'),
			key: 'at',
			render: (_, row) => <ClientDateTime value={row.at} />,
		},
		{
			title: t('admin_logs.access_actor'),
			key: 'actor',
			render: (_, row) =>
				row.actor ? (
					<div>
						<div>{row.actor.name || t('admin_users.name_not_set')}</div>
						<Typography.Text type="secondary">{row.actor.email}</Typography.Text>
					</div>
				) : (
					<Typography.Text type="secondary">{t('admin_logs.deleted_account')}</Typography.Text>
				),
		},
		{
			title: t('admin_logs.access_action'),
			key: 'action',
			render: (_, row) => (
				<Tag color={ACTION_VIEWS[row.action].color}>{t(ACTION_VIEWS[row.action].labelKey)}</Tag>
			),
		},
		{
			title: t('admin_logs.access_conversation'),
			key: 'conversation',
			render: (_, row) => {
				if (!row.conversation)
					return (
						<Typography.Text type="secondary">
							{t('admin_logs.purged_conversation')}
						</Typography.Text>
					)
				const title = row.conversation.title || t('chat.default_conversation_name')
				return (
					<div>
						<Typography.Paragraph
							className={styles.title}
							style={{ marginBottom: 0 }}
							ellipsis={{ rows: 2, tooltip: title }}
						>
							{title}
						</Typography.Paragraph>
						<Typography.Text type="secondary">{row.conversation.userEmail}</Typography.Text>
					</div>
				)
			},
		},
		{
			title: t('admin_logs.access_file'),
			key: 'file',
			render: (_, row) =>
				row.attachment === null ? null : row.attachment.name === null ? (
					<Typography.Text type="secondary">{t('admin_logs.removed_file')}</Typography.Text>
				) : (
					row.attachment.name
				),
		},
	]

	return (
		<Table<AccessLogRow>
			rowKey="id"
			columns={columns}
			dataSource={rows}
			loading={pending}
			scroll={{ x: 'max-content' }}
			pagination={{
				...tablePagination(count => t('admin_logs.access_total', { total: count })),
				current: shown.page,
				pageSize: shown.pageSize,
				total,
				pageSizeOptions: [...LOG_PAGE_SIZES],
				onChange: (page, pageSize) => navigate(withPage(shown, page, pageSize)),
			}}
			locale={{
				emptyText: (
					<Empty
						image={Empty.PRESENTED_IMAGE_SIMPLE}
						description={t('admin_logs.access_empty')}
					/>
				),
			}}
		/>
	)
}
```

- [ ] **Step 4: The owner's tab**

`components/admin/logs/app-logs.tsx` as of Task 16.

In `components/admin/logs/app-logs.tsx`, find:

```tsx
	LOG_PAGE_SIZES,
	withPage,
	type LogsQuery,
} from '@/app/(admin)/app-management/[appId]/logs/schemas'
```

Replace it with:

```tsx
	LOG_PAGE_SIZES,
	withPage,
	withTab,
	type LogsQuery,
} from '@/app/(admin)/app-management/[appId]/logs/schemas'
```

Then find:

```tsx
import type { UserOption } from '@/lib/data/users'

import { LOG_TAG_VIEWS, logTags, NO_FIGURE } from './log-columns'
```

Replace it with:

```tsx
import type { UserOption } from '@/lib/data/users'

import AccessLogTable from './access-log-table'
import { LOG_TAG_VIEWS, logTags, NO_FIGURE } from './log-columns'
```

Then find:

```tsx
/**
 * An AG-UI app's Logs page (spec §7.2; plan calls P16, P17): a breadcrumb back to the apps over the shared page header
 * (the app's name), then antd Tabs over the conversations: the filters and an antd Table with numbered pages read on the
 * server (antd Table `pagination` with `current`, `pageSize` and `total`, the "Ajax" demo's controlled pager, in the
 * admin tables' look, tablePagination), whose every change is a navigation to the new URL (useLogsNavigation), and
 * each row's "View", which opens its transcript in LogDrawer (P18). Each text the conversations carry renders as text
 * (spec §6.4).
 */
export default function AppLogs({ app, query, list, users }: AppLogsProps) {
	const { t, i18n } = useTranslation()
```

Replace it with:

```tsx
/**
 * An AG-UI app's Logs page (spec §7.2; plan calls P16, P17, P19): a breadcrumb back to the apps over the shared page
 * header (the app's name), then antd Tabs over the conversations and, for the owner, the access log (AccessLogTable).
 * The conversations: the filters and an antd Table with numbered pages read on the server (antd Table `pagination`
 * with `current`, `pageSize` and `total`, the "Ajax" demo's controlled pager, in the admin tables' look,
 * tablePagination), whose every change is a navigation to the new URL (useLogsNavigation), and each row's "View",
 * which opens its transcript in LogDrawer (P18). Each text the conversations carry renders as text (spec §6.4).
 */
export default function AppLogs({ app, query, list, users, access }: AppLogsProps) {
	const { t, i18n } = useTranslation()
```

Then find:

```tsx
			</Flex>
			<Tabs
				activeKey={shown.tab}
				items={[
```

Replace it with:

```tsx
			</Flex>
			{/* antd Tabs, controlled: the tab is the URL's (P19), so a click navigates and the page answers with that tab. */}
			<Tabs
				activeKey={shown.tab}
				onChange={key => navigate(withTab(shown, key === 'access' ? 'access' : 'conversations'))}
				items={[
```

Then find:

```tsx
						children: conversations,
					},
				]}
```

Replace it with:

```tsx
						children: conversations,
					},
					// P19: the owner's tab; an admin's page has no `access`.
					...(access
						? [
								{
									key: 'access',
									label: t('admin_logs.tab_access'),
									children: (
										<AccessLogTable
											rows={access.rows}
											total={access.total}
											query={shown}
										/>
									),
								},
							]
						: []),
				]}
```

- [ ] **Step 5: The owner's read**

Replace the whole of `app/(admin)/app-management/[appId]/logs/page.tsx` (as of Task 15) with:

```tsx
import { notFound, redirect } from 'next/navigation'

import AppLogs from '@/components/admin/logs/app-logs'
import { requireAdminUser } from '@/lib/auth/session'
import { findLogsApp, listAccessLog, listAppLogs, listLogUsers } from '@/lib/data/logs'
import { isId } from '@/lib/ids'

import { lastPage, logFiltersOf, logsSearch, parseLogsQuery, type LogsQuery } from './schemas'

/**
 * An AG-UI app's Logs (spec §7.2; plan calls P16, P19, P20). The (admin) layout gates the page and the page checks again
 * where it reads (ADR-0024); an app that is missing, whose id is malformed (it reaches no query, spec §3.2) or whose
 * provider keeps no history is Next's 404 (`notFound()`, functions/not-found.md: "call it in the render path"). The URL's
 * query decides the tab, the page and the filters (page.md: `searchParams` "to handle filtering, pagination, or
 * sorting"); the page of conversations, the user filter's accounts and, for the owner, the access log are read in
 * parallel, and one client component gets the trimmed props (ADR-0020).
 */
export default async function AppLogsPage({
	params,
	searchParams,
}: PageProps<'/app-management/[appId]/logs'>) {
	const actor = await requireAdminUser()
	const { appId } = await params
	const app = isId(appId) ? await findLogsApp(actor, appId) : null
	if (!app) notFound()
	// P19: the access log is the owner's (the data layer refuses anyone else); an admin's page has the conversations only.
	const owner = actor.role === 'owner'
	const parsed = parseLogsQuery(await searchParams)
	const query: LogsQuery = owner ? parsed : { ...parsed, tab: 'conversations' }
	// The URL's page is the shown tab's; the other tab's table is read at its first page, where a switch opens it.
	const pageOf = (tab: LogsQuery['tab']) => ({
		page: query.tab === tab ? query.page : 1,
		pageSize: query.pageSize,
	})
	const [list, users, access] = await Promise.all([
		listAppLogs(actor, app.id, logFiltersOf(query), pageOf('conversations')),
		listLogUsers(actor, app.id),
		owner ? listAccessLog(actor, app.id, pageOf('access')) : undefined,
	])
	// A page past the end (rows gone since the link was made, a hand-edited URL) shows the last one, as Langfuse's pager
	// snaps back (R3 §2); `redirect` in a Server Component (functions/redirect.md).
	const last = lastPage(
		query.tab === 'access' && access ? access.total : list.total,
		query.pageSize,
	)
	if (query.page > last)
		redirect(`/app-management/${app.id}/logs${logsSearch({ ...query, page: last })}`)
	return (
		<AppLogs
			app={app}
			query={query}
			list={list}
			users={users}
			access={access}
		/>
	)
}
```

- [ ] **Step 6: The texts**

The table also reads `admin_users.name_not_set` and `chat.default_conversation_name`. The keys go at the end of the `admin_logs` block as of Task 16.

In `locales/en/translation.json`, find:

```json
		"run_interrupts": "Interrupts: {{value}}",
		"run_answers": "Answers sent: {{value}}"
	},
```

Replace it with:

```json
		"run_interrupts": "Interrupts: {{value}}",
		"run_answers": "Answers sent: {{value}}",
		"tab_access": "Access log",
		"access_at": "When",
		"access_actor": "Who",
		"access_action": "Action",
		"access_conversation": "Conversation",
		"access_file": "File",
		"action_view": "View",
		"action_download": "Download",
		"deleted_account": "Deleted account",
		"purged_conversation": "Purged conversation",
		"removed_file": "Removed file",
		"access_total": "Total entries: {{total}}",
		"access_empty": "No one has opened a conversation or a file of this app yet"
	},
```

In `locales/zh/translation.json`, find:

```json
		"run_interrupts": "中断：{{value}}",
		"run_answers": "已发送回答：{{value}}"
	},
```

Replace it with:

```json
		"run_interrupts": "中断：{{value}}",
		"run_answers": "已发送回答：{{value}}",
		"tab_access": "访问日志",
		"access_at": "时间",
		"access_actor": "访问者",
		"access_action": "操作",
		"access_conversation": "对话",
		"access_file": "文件",
		"action_view": "查看",
		"action_download": "下载",
		"deleted_account": "已删除的账户",
		"purged_conversation": "已清除的对话",
		"removed_file": "已移除的文件",
		"access_total": "共 {{total}} 条记录",
		"access_empty": "尚无人打开此应用的对话或文件"
	},
```

In `locales/ar/translation.json`, find:

```json
		"run_interrupts": "المقاطعات: {{value}}",
		"run_answers": "الإجابات المرسلة: {{value}}"
	},
```

Replace it with:

```json
		"run_interrupts": "المقاطعات: {{value}}",
		"run_answers": "الإجابات المرسلة: {{value}}",
		"tab_access": "سجل الوصول",
		"access_at": "الوقت",
		"access_actor": "الشخص",
		"access_action": "الإجراء",
		"access_conversation": "المحادثة",
		"access_file": "الملف",
		"action_view": "عرض",
		"action_download": "تنزيل",
		"deleted_account": "حساب محذوف",
		"purged_conversation": "محادثة محذوفة نهائيًا",
		"removed_file": "ملف مُزال",
		"access_total": "إجمالي السجلات: {{total}}",
		"access_empty": "لم يفتح أحد بعدُ أي محادثة أو ملف في هذا التطبيق"
	},
```

"Account" is 账户 and حساب, as the users table words it; "Download" is 下载 and تنزيل, as `message.download_file`. No e2e text changes: `e2e/` has none of these strings.

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/admin-logs-page.test.ts __tests__/i18n-locales.test.ts` Expected: PASS, `Test Files  2 passed (2)`, `Tests  21 passed (21)` (11 and the locale file's 10).

- [ ] **Step 8: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint components/admin/logs/access-log-table.tsx components/admin/logs/app-logs.tsx 'app/(admin)/app-management/[appId]/logs/page.tsx' __tests__/admin-logs-page.test.ts
pnpm exec oxfmt --check components/admin/logs/access-log-table.tsx components/admin/logs/app-logs.tsx 'app/(admin)/app-management/[appId]/logs/page.tsx' __tests__/admin-logs-page.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
pnpm test
npx -y @ant-design/cli lint ./ --format json
```

Expected: tsc exits 0; no oxlint finding; oxfmt "All matched files use the correct format."; vitest 0 failed; the antd lint `"total": 0`.

- [ ] **Step 9: Commit**

```bash
git add components/admin/logs/access-log-table.tsx components/admin/logs/app-logs.tsx 'app/(admin)/app-management/[appId]/logs/page.tsx' locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/admin-logs-page.test.ts
git commit -m "feat(admin): the owner's access log tab on the Logs page

The owner's Logs page reads the app's access log beside its
conversations and shows it in its own tab with numbered pages: when,
who, the action, the conversation with its user and the file of a
download, with the names of what is gone worded as such; an admin's
page has no such tab and never reads the log (spec §7.2; plan call
P19).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the seven files; lint-staged changes nothing.

The tab's locators for Task 19's spec: the tab "Access log" (absent for an admin); the column headers When, Who, Action, Conversation, File; the tags "View" and "Download"; "Deleted account", "Purged conversation", "Removed file"; the pager's total "Total entries: N"; the empty table "No one has opened a conversation or a file of this app yet".

```json:metadata
{"files": ["components/admin/logs/access-log-table.tsx", "components/admin/logs/app-logs.tsx", "app/(admin)/app-management/[appId]/logs/page.tsx", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/admin-logs-page.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/admin-logs-page.test.ts __tests__/i18n-locales.test.ts", "acceptanceCriteria": ["for the owner the page reads the access log at page 1 beside the conversations, at the URL's page on the access tab (the conversations at page 1), and redirects a page past its end; for an admin it never reads it and the tab is conversations", "the owner sees the Access log tab; a tab click navigates to its first page with the filters kept; the table shows when, who or Deleted account, View or Download, the conversation and its user or Purged conversation, the file or Removed file, with numbered pages and its total", "the tab's admin_logs keys in en, zh and ar", "tsc, oxlint, oxfmt clean; pnpm test 0 failed; antd lint total 0"], "modelTier": "mechanical"}
```

---

### Task 18: The e2e stub's files scenario and the seed

**Goal:** The stub AG-UI producer on 5399 answers a message that carries attachments with one line per content part it received (its type, MIME and decoded byte count, or a text part's first and last lines), the e2e seed gives the AG-UI apps their `attachments` settings and adds `AGUI_NATIVE_APP` (images off, PDFs as `document` parts), and `e2e/fixtures/files.ts` builds every file Task 19's specs pick at run time.

Spec §7.1 (the parts: "`{ type: 'image', source: { type: 'data', value: <base64>, mimeType } }`; in `native` mode `{ type: 'document', … }`; in `text` mode a text part `[file report.pdf]` followed by the extracted text"), §10 (e2e, 2c: "an attachment echo, the caps, the Logs list and transcript, the access log"; "The seed adds an AG-UI app"), plan calls P11 (the parts and their order; a blank text part left out) and P23 (the `files` scenario, the seed and `AGUI_NATIVE_APP`), decisions 69 (2) (a file-only message) and 70 (3) (UTF-16 with a byte-order mark read, other encodings refused), ADR-0010 (the stub is the suite's fake backend; scenarios by the query text). The scenario grows 2b's `e2e/fixtures/stub/agui.ts` the way 2b grew 2a's (2b plan Task 16): 2a's and 2b's scenarios stay exactly as they are, and the new one is tried first. **The rule that picks it:** the hub sends a user message's `content` as an array only when the message has attachments, and as a string otherwise (spec §7.1, P11), so the echo answers every input whose last message is a user message with array content, a file-only message included (it has no text part at all, P11, and in `text` mode a file-only message of a text file holds no non-text part either, so "any non-text part" would miss it), and any input whose last user text holds the whole word `files` (the Dify stub's `hasWord`, `e2e/fixtures/stub/scenarios.ts`). Tried before 2b's and 2a's, it keeps an attached file's own text from picking another scenario (2a matches `tool`, `slow`, `nested`, `invalid` and `timeout` anywhere in the text). No 2a or 2b prompt holds the word `files` (2a's: `hello <project>`, `tool`, `use a tool`, `nested`, `error <code>`, `timeout`, `slow`, `remember me <project>`, `rename me <project> …`, `invalid please`, `please answer invalid`, `hello`, `hello after the edit`; 2b's keywords: `gated`, `double`, `fragile`, `badquestion`, `question`, `form`, `confirm`, `expired`, `finish`, `plan`, `activity`; `grep -rn "files" e2e/agui-*.spec.ts e2e/screenshots.spec.ts` finds no AG-UI prompt). **The echo:** one Markdown paragraph per part, in the order the parts came: `image <mimeType> <decoded bytes>` and `document <mimeType> <decoded bytes>` for inline data, `text <first line>` for a one-line text part, and `text <first line> … <last line>` for a longer one (blank lines and surrounding spaces dropped, CRLF read as one break), so a spec sees a PDF's last extracted line and a cut file's truncation note (P6) at the agent. Decoded bytes are the base64 value's length after decoding: the stored bytes, which Task 19 compares with the upload's `size` (P8: an image's `size` is after re-encoding). **The seed:** `StubAguiApp` gains `attachments` (Task 1's `AttachmentPolicy`, imported type-only and by a relative path, as `e2e/fixtures/users.ts` imports `Role`, so the fixture loads none of the app's modules); `AGUI_APP` turns images on and reads PDFs to text (`{ images: true, documents: 'text', maxImageEdge: null }`, every kind reaches the echo), `AGUI_MISSING_APP` keeps the defaults, and `AGUI_NATIVE_APP` (`…00a3`, agent `assistant`, `askUser` off) sends PDFs as `document` parts with images off; the seed writes `attachments` into each document, and empties the stub AG-UI apps' attachments before their conversations, so a file an earlier run left unsent never counts against the 25 a user may have waiting (P8; the e2e database outlives a run). **The files** (`e2e/fixtures/files.ts`, nothing binary committed, as `e2e/fixtures/branding.ts`'s `pngOf`): a 64 × 48 PNG and JPEG (sharp's `create`), a two-line text PDF and a PDF with no text written byte by byte as ISO 32000-1:2008 §7.5 lays a file out (header, objects, a cross-reference table of 20-byte entries, trailer, `startxref`; Helvetica, a standard 14 font, so nothing is embedded), a PNG named `scan.pdf`, a short `notes.txt`, a `long.txt` of about 123,000 characters, the same Arabic CSV as UTF-16LE with its BOM and in Windows-1256, 3.5 MB of text (two of which overfill a conversation's 6 MB, P8), 6 MB of text, and an SVG. Docs checked: `@ag-ui/core` 1.0.2 `dist/schemas.mjs` L145–236 (`TextPartSchema` `{ type: 'text', text }`; `DataSourceSchema` `{ type: 'data', value, mimeType }`, `value` "The bytes, base64-encoded" and `mimeType` required, `dist/version-*.d.ts` L459–478; `UrlSourceSchema` and `FileSourceSchema` with an optional `mimeType`; `ContentPartSchema` the union of text, image, audio, video and document; `UserMessageSchema.content` a string or an array of them); `@ag-ui/client` re-exports `@ag-ui/core` (`dist/index.d.ts` L3), so the test imports `ContentPart` from it; Playwright 1.63 (Context7 `/microsoft/playwright/v1.63.0`, "Upload files" and `APIRequestContext` `multipart`): a file is `{ name, mimeType, buffer }` for `setInputFiles`/`setFiles` and for a multipart field (Playwright exports no name for that shape, so the fixture declares `TestFile`); sharp 0.35.4 `dist/index.d.mts` (`export interface Sharp`, so `import sharp, { type Sharp } from 'sharp'`; the constructor's `create`); WHATWG Encoding (`FF FE` is UTF-16LE's byte-order mark, which `TextDecoder` drops with `ignoreBOM` false; index windows-1256: ا C7, ل E1, ق DE, ه E5, ر D1, ة C9, checked against Python's `cp1256` codec) and Node 22's `TextDecoder`, which reads `windows-1256` with its full ICU (Node docs, "WHATWG supported encodings"). The PDFs were read with `pdfjs-dist` 6.4.299 as P5 reads them (`getDocument` with the CMaps and standard fonts, `getTextContent`, `str` plus `\n` where `hasEOL`): the text PDF gives `"Quarterly report\nRevenue grew by four percent."`, the blank one `""`. Nothing in the browser reads this task's work yet: Task 19's specs do. Depends on Task 1 (`AttachmentPolicy`, `ATTACHMENT_MAX_BYTES`, `ATTACHMENT_TEXT_MAX`, `CONVERSATION_ATTACHMENTS_MAX_BYTES`, `TRUNCATED_NOTE`, `fileMarker`), Task 2 (`aguiSettingsSchema` reads `attachments`) and Task 3 (the `conversation_attachments` table the seed empties).

**The echo for Task 19's files** (`AGUI_APP`, `text` documents; each line one paragraph of the answer):

| Part sent by the hub | Echo line |
| --- | --- |
| the message's text `files please` | `text files please` |
| `photo.jpg` / `photo.png` | `image image/jpeg <size>` / `image image/png <size>` (`size` from the upload's answer) |
| `report.pdf` in `text` mode | `text [file report.pdf] … Revenue grew by four percent.` |
| `report.pdf` in `native` mode (`AGUI_NATIVE_APP`) | `document application/pdf <the file's length>` |
| `notes.txt` | `text [file notes.txt] … Ship the attachments on Friday.` |
| `cities-utf16.csv` | `text [file cities-utf16.csv] … Nour,القاهرة` |
| `long.txt` | `text [file long.txt] … [truncated: only the first 100,000 characters of this file are included]` |

**Files:**

- Create: `e2e/fixtures/files.ts`
- Modify: `e2e/fixtures/stub/agui.ts` (the `files` scenario, tried first)
- Modify: `e2e/fixtures/stub/agui-apps.ts` (`StubAguiApp.attachments`, `AGUI_NATIVE_APP`)
- Modify: `e2e/fixtures/constants.ts` (re-exports `AGUI_NATIVE_APP`)
- Modify: `e2e/auth.setup.ts` (the seed writes `attachments`, empties the stub apps' attachments)
- Test: `__tests__/stub-agui.test.ts` (nine new cases)

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/stub-agui.test.ts` reports 31 passed (the 22 there now and 9 new).
- [ ] A message `[text "files please", a PNG, a PDF, notes.txt's text part, a CRLF CSV's text part, a cut text part]` streams `RUN_STARTED`, one text message and `RUN_FINISHED` `{ type: 'success' }`, whose text is the paragraphs `text files please`, `image image/png <bytes>`, `document application/pdf <bytes>`, `text [file notes.txt] … Ship the attachments on Friday.`, `text [file cities.csv] … Nour,القاهرة` and `text [file long.txt] … <TRUNCATED_NOTE>`, joined by blank lines.
- [ ] A message of one image part alone answers `image image/png <bytes>`; a text part `[file plan.txt]\nUse a tool, then go slow.` answers the echo, not 2b's `plan` or 2a's `tool` or `slow`; a plain `files again` after an earlier message with an image answers only `text files again`; `hello profiles` still gets 2a's default scenario (reasoning first).
- [ ] `@ag-ui/client`'s `HttpAgent` reads the echo of a content array without a protocol error: one assistant message, `text files please` and `document application/pdf <bytes>`.
- [ ] `AGUI_APP.attachments` is `{ images: true, documents: 'text', maxImageEdge: null }`, `AGUI_NATIVE_APP.attachments` `{ images: false, documents: 'native', maxImageEdge: null }`, and each stub app's seeded document parses with `aguiSettingsSchema` to its own `attachments`; the seed writes them and deletes the stub AG-UI apps' `conversation_attachments` rows before their conversations.
- [ ] The files are what their names say: the PNG and JPEG decode as `png` and `jpeg`, `scan.pdf` is a PNG with no `%PDF-` in its first 1,024 bytes; both PDFs start `%PDF-1.4` and every cross-reference entry points at its `n 0 obj`; `notes.txt` and `long.txt` are UTF-8, `long.txt` over 100,000 code points; `cities-utf16.csv` starts `FF FE` and decodes as UTF-16LE to the CSV; `cities-1256.csv` throws in a fatal UTF-8 decoder and decodes as windows-1256 to the same CSV; `big.txt` is over 5 MB and under 10 MB; `bulky.txt` is at most 5 MB and two of it are over 6 MB.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the six files; `pnpm test:e2e e2e/agui-chat.spec.ts e2e/agui-hitl.spec.ts e2e/admin-apps.spec.ts --project desktop-light` passes (2a's and 2b's scenarios untouched; ten seeded apps still fit the apps table's first page).

**Verify:** `pnpm exec vitest run --project unit __tests__/stub-agui.test.ts` → `Test Files  1 passed (1)`, `Tests  31 passed (31)`

**Steps:**

- [ ] **Step 1: Read the stub as it is and check the APIs**

Read `e2e/fixtures/stub/agui.ts` (`lastUserText`, `textMessage`, `hitlRun`, `hitlPlanFor`, `handleAgui`), `e2e/fixtures/stub/agui-apps.ts`, `e2e/fixtures/stub/scenarios.ts` (`hasWord`, a case-insensitive RegExp with `\b`), `e2e/fixtures/constants.ts`, `e2e/auth.setup.ts`, `e2e/fixtures/branding.ts` (`pngOf`, the run-time PNG) and `__tests__/stub-agui.test.ts` (`input`, `post`, `token`, `runFrames`, `framesOf`, `typesOf`, `textOf`, `outcomeOf`, `TEXT`). Check this task's docs paragraph against `node_modules/@ag-ui/core/dist/schemas.mjs` (`ContentPartSchema`, `DataSourceSchema`, `UserMessageSchema`) and Task 1's `lib/chat/attachment-rules.ts` (`AttachmentPolicy`, `fileMarker`, `TRUNCATED_NOTE`, `ATTACHMENT_MAX_BYTES`, `ATTACHMENT_TEXT_MAX`) and Task 2's `aguiSettingsSchema` (its `attachments` field).

- [ ] **Step 2: The files the specs pick**

Create `e2e/fixtures/files.ts`:

```ts
import sharp, { type Sharp } from 'sharp'

/*
 * The files the attachment specs pick (Part 2 spec §7.1 and §10; plan call P23), made at run time so the repository
 * holds no binary fixture (e2e/fixtures/branding.ts's `pngOf` does the same). Each is the payload Playwright's file
 * chooser and request context take (`{ name, mimeType, buffer }`: Playwright "Upload files", `fileChooser.setFiles`;
 * APIRequestContext `multipart`). The `mimeType` is what a browser claims from the extension (MDN `Blob.type`: "It is
 * assumed based on the file extension"); the hub never reads it (plan call P3), so `scan.pdf` claims a PDF and is not one.
 */

export interface TestFile {
	name: string
	mimeType: string
	buffer: Buffer
}

/** A small image in sharp's own colour (sharp constructor, `create`), encoded by `encode`. */
const imageOf = (width: number, height: number, encode: (image: Sharp) => Sharp) =>
	encode(sharp({ create: { width, height, channels: 3, background: '#1677ff' } })).toBuffer()

/** A 64 × 48 PNG. */
export const pngFile = async (name = 'photo.png'): Promise<TestFile> => ({
	name,
	mimeType: 'image/png',
	buffer: await imageOf(64, 48, image => image.png()),
})

/** A 64 × 48 JPEG. */
export const jpegFile = async (name = 'photo.jpg'): Promise<TestFile> => ({
	name,
	mimeType: 'image/jpeg',
	buffer: await imageOf(64, 48, image => image.jpeg()),
})

/**
 * A one-page PDF 1.4 whose page draws `content` (a content stream), with Helvetica as /F1 (one of the standard 14 fonts,
 * so the file embeds none). The structure is ISO 32000-1:2008 §7.5: the `%PDF-1.4` header, the numbered objects, a
 * cross-reference table of 20-byte entries ("nnnnnnnnnn ggggg n" and a two-character end of line, §7.5.4) giving each
 * object's byte offset, the trailer naming the catalog, and `startxref` with the table's offset.
 */
const pdfOf = (content: string): Buffer => {
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
		`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
	]
	let file = '%PDF-1.4\n'
	const offsets: number[] = []
	objects.forEach((object, index) => {
		offsets.push(Buffer.byteLength(file, 'latin1'))
		file += `${index + 1} 0 obj\n${object}\nendobj\n`
	})
	const table = Buffer.byteLength(file, 'latin1')
	file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
	file += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
	file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${table}\n%%EOF\n`
	return Buffer.from(file, 'latin1')
}

/** The text PDF's two lines, top to bottom (each its own text-showing operator, the second one line lower). */
export const PDF_LINES = ['Quarterly report', 'Revenue grew by four percent.'] as const

/** A PDF with two lines of text, which pdf.js reads (plan call P5). */
export const textPdf = (name = 'report.pdf'): TestFile => ({
	name,
	mimeType: 'application/pdf',
	buffer: pdfOf(`BT /F1 18 Tf 72 720 Td (${PDF_LINES[0]}) Tj 0 -28 Td (${PDF_LINES[1]}) Tj ET`),
})

/** A PDF whose page is a filled rectangle and no text: a scan, as `text` mode sees it (decision 69 (3)). */
export const blankPdf = (name = 'blank.pdf'): TestFile => ({
	name,
	mimeType: 'application/pdf',
	buffer: pdfOf('0.09 0.47 1 rg 72 72 200 200 re f'),
})

/** A PNG named and claimed as a PDF: no `%PDF-` in its first 1,024 bytes (plan call P3). */
export const pngAsPdf = async (name = 'scan.pdf'): Promise<TestFile> => ({
	...(await pngFile(name)),
	mimeType: 'application/pdf',
})

/** A short UTF-8 text file. */
export const NOTES_LINES = ['Meeting notes', 'Ship the attachments on Friday.'] as const
export const notesText = (name = 'notes.txt'): TestFile => ({
	name,
	mimeType: 'text/plain',
	buffer: Buffer.from(`${NOTES_LINES.join('\n')}\n`, 'utf8'),
})

/** Lines enough for well over ATTACHMENT_TEXT_MAX (100,000) characters: about 124,000. */
const LONG_LINES = 4000
/** A UTF-8 text file the hub cuts at 100,000 characters (plan call P6). */
export const longText = (name = 'long.txt'): TestFile => ({
	name,
	mimeType: 'text/plain',
	buffer: Buffer.from(
		Array.from({ length: LONG_LINES }, (_, index) => `Line ${index + 1} of a long text file.`).join(
			'\n',
		),
		'utf8',
	),
})

/** The CSV's rows, as Excel writes them (CRLF); the city is Arabic, the case legacy code pages break. */
export const CSV_ROWS = ['name,city', 'Nour,القاهرة'] as const

/**
 * The CSV as UTF-16LE with its byte-order mark, Excel's "Unicode Text" (WHATWG Encoding: `FF FE` is UTF-16LE's BOM);
 * the hub reads it (decision 70 (3)).
 */
export const utf16Csv = (name = 'cities-utf16.csv'): TestFile => ({
	name,
	mimeType: 'text/csv',
	buffer: Buffer.concat([
		Buffer.from([0xff, 0xfe]),
		Buffer.from(`${CSV_ROWS.join('\r\n')}\r\n`, 'utf16le'),
	]),
})

/**
 * The CSV in Windows-1256, Excel's plain "CSV (Comma delimited)" on an Arabic Windows: القاهرة is C7 E1 DE C7 E5 D1 C9
 * there (WHATWG Encoding, index windows-1256), bytes that are not UTF-8, so the hub refuses the file (decision 70 (3)).
 */
export const windows1256Csv = (name = 'cities-1256.csv'): TestFile => ({
	name,
	mimeType: 'text/csv',
	buffer: Buffer.concat([
		Buffer.from(`${CSV_ROWS[0]}\r\nNour,`, 'latin1'),
		Buffer.from([0xc7, 0xe1, 0xde, 0xc7, 0xe5, 0xd1, 0xc9]),
		Buffer.from('\r\n', 'latin1'),
	]),
})

/**
 * 3.5 MB of text: under the 5 MB a file may have and over half the 6 MB a conversation's sent files may hold, so the
 * second one in a conversation is refused (spec §7.1, plan call P8). Text files are stored as uploaded.
 */
export const bulkyText = (name = 'bulky.txt'): TestFile => ({
	name,
	mimeType: 'text/plain',
	buffer: Buffer.alloc(3.5 * 1024 * 1024, 'b'),
})

/** 6 MB of text: over ATTACHMENT_MAX_BYTES (5 MB) and under Next's 10 MB proxy limit, so the route itself answers. */
export const oversizedFile = (name = 'big.txt'): TestFile => ({
	name,
	mimeType: 'text/plain',
	buffer: Buffer.alloc(6 * 1024 * 1024, 'a'),
})

/** An SVG: a kind no app takes (spec §7.1: "SVG and anything else refused"). */
export const svgFile = (name = 'icon.svg'): TestFile => ({
	name,
	mimeType: 'image/svg+xml',
	buffer: Buffer.from(
		'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#1677ff"/></svg>',
		'utf8',
	),
})
```

- [ ] **Step 3: Write the failing tests**

In `__tests__/stub-agui.test.ts`, replace the imports

```ts
import { buildResumeArray, HttpAgent, type Message } from '@ag-ui/client'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { e2eEnv } from '@/e2e/fixtures/env'
import { handle } from '@/e2e/fixtures/stub/router'
```

with

```ts
import { buildResumeArray, HttpAgent, type ContentPart, type Message } from '@ag-ui/client'
import { SignJWT } from 'jose'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { e2eEnv } from '@/e2e/fixtures/env'
import {
	blankPdf,
	bulkyText,
	CSV_ROWS,
	jpegFile,
	longText,
	NOTES_LINES,
	notesText,
	oversizedFile,
	PDF_LINES,
	pngAsPdf,
	pngFile,
	svgFile,
	textPdf,
	utf16Csv,
	windows1256Csv,
} from '@/e2e/fixtures/files'
import {
	AGUI_APP,
	AGUI_NATIVE_APP,
	aguiAgentUrl,
	STUB_AGUI_APPS,
	STUB_AGUI_AUDIENCE,
} from '@/e2e/fixtures/stub/agui-apps'
import { handle } from '@/e2e/fixtures/stub/router'
import {
	ATTACHMENT_MAX_BYTES,
	ATTACHMENT_TEXT_MAX,
	CONVERSATION_ATTACHMENTS_MAX_BYTES,
	fileMarker,
	TRUNCATED_NOTE,
} from '@/lib/chat/attachment-rules'
import { aguiSettingsSchema } from '@/lib/providers/agui/schema'
```

Then append to the end of the file, after the closing `})` of `describe('the AG-UI stub agent’s human-in-the-loop scenarios (Part 2 spec §10, plan call P18)', …)`:

```ts
/** A RunAgentInput that ends with the user's message holding `content` (a string, or AG-UI 1.0 content parts). */
const userInput = (content: string | ContentPart[], before: unknown[] = []) => ({
	...input(''),
	messages: [...before, { id: 'user-files', role: 'user', content }],
})
/** An inline media part as the hub builds one (spec §7.1: a data source, never a URL). */
const dataPart = (type: 'image' | 'document', mimeType: string, bytes: Buffer): ContentPart => ({
	type,
	source: { type: 'data', value: bytes.toString('base64'), mimeType },
})
/** A file's text part as the hub builds one (plan call P11): its marker line, then the text. */
const filePart = (name: string, text: string): ContentPart => ({
	type: 'text',
	text: `${fileMarker(name)}\n${text}`,
})
/** The echo's paragraphs, one per part. */
const echoOf = (frames: Frame[]) => textOf(frames).split('\n\n')

describe('the AG-UI stub agent’s files scenario (Part 2 spec §7.1, §10; plan call P23)', () => {
	it('echoes each part of the message: type, MIME and decoded bytes, or a text’s first and last lines', async () => {
		const png = (await pngFile()).buffer
		const pdf = textPdf().buffer
		const frames = await runFrames(
			userInput([
				{ type: 'text', text: 'files please' },
				dataPart('image', 'image/png', png),
				dataPart('document', 'application/pdf', pdf),
				filePart('notes.txt', `${NOTES_LINES.join('\n')}\n`),
				filePart('cities.csv', `${CSV_ROWS.join('\r\n')}\r\n`),
				filePart('long.txt', `Line 1 of a long text file.\n\n${TRUNCATED_NOTE}`),
			]),
		)
		expect(typesOf(frames)).toEqual(['RUN_STARTED', ...TEXT, 'RUN_FINISHED'])
		expect(outcomeOf(frames)).toEqual({ type: 'success' })
		expect(echoOf(frames)).toEqual([
			'text files please',
			`image image/png ${png.length}`,
			`document application/pdf ${pdf.length}`,
			`text [file notes.txt] … ${NOTES_LINES[1]}`,
			`text [file cities.csv] … ${CSV_ROWS[1]}`,
			`text [file long.txt] … ${TRUNCATED_NOTE}`,
		])
	})

	it('answers a message of files alone, and keeps an attached text from picking another scenario', async () => {
		const png = (await pngFile()).buffer
		const alone = await runFrames(userInput([dataPart('image', 'image/png', png)]))
		expect(echoOf(alone)).toEqual([`image image/png ${png.length}`])
		// The file's name and text hold 2b's `plan` and 2a's `tool` and `slow`: the echo still answers.
		const named = await runFrames(userInput([filePart('plan.txt', 'Use a tool, then go slow.')]))
		expect(typesOf(named)).toEqual(['RUN_STARTED', ...TEXT, 'RUN_FINISHED'])
		expect(echoOf(named)).toEqual(['text [file plan.txt] … Use a tool, then go slow.'])
	})

	it('answers the keyword in a plain text, echoes only the last message, and leaves other texts alone', async () => {
		const earlier = [
			{ id: 'user-0', role: 'user', content: [dataPart('image', 'image/png', Buffer.from('png'))] },
			{ id: 'assistant-0', role: 'assistant', content: 'image image/png 3' },
		]
		expect(echoOf(await runFrames(userInput('files again', earlier)))).toEqual(['text files again'])
		// Without the word and without parts, 2a's default scenario (reasoning first) answers as before.
		const hello = await runFrames(userInput('hello profiles'))
		expect(typesOf(hello)[1]).toBe('REASONING_START')
	})

	it('is read by @ag-ui/client without a protocol error', async () => {
		const auth = await token()
		const agent = new HttpAgent({
			url: `${base}${AGENT}`,
			headers: { Authorization: `Bearer ${auth}` },
			threadId: 'thread-client-files',
			initialMessages: [
				{
					id: 'user-files',
					role: 'user',
					content: [
						{ type: 'text', text: 'files please' },
						dataPart('document', 'application/pdf', textPdf().buffer),
					],
				},
			],
		})
		const { newMessages } = await agent.runAgent({ runId: 'run-files' })
		expect(newMessages.map((message: Message) => message.role)).toEqual(['assistant'])
		expect(newMessages[0]?.content).toBe(
			`text files please\n\ndocument application/pdf ${textPdf().buffer.length}`,
		)
	})

	it('the seed gives each stub app its attachments settings, which the AG-UI schema reads back', () => {
		expect(AGUI_APP.attachments).toEqual({ images: true, documents: 'text', maxImageEdge: null })
		expect(AGUI_NATIVE_APP.attachments).toEqual({
			images: false,
			documents: 'native',
			maxImageEdge: null,
		})
		for (const app of STUB_AGUI_APPS) {
			// The document e2e/auth.setup.ts writes.
			const settings = aguiSettingsSchema.parse({
				agentUrl: aguiAgentUrl(5399, app.agent),
				audience: STUB_AGUI_AUDIENCE,
				askUser: app.askUser,
				attachments: app.attachments,
			})
			expect(settings.attachments).toEqual(app.attachments)
		}
	})
})

describe('the attachment specs’ files (e2e/fixtures/files.ts)', () => {
	/** The objects a PDF's cross-reference table points at, and the table `startxref` points at (ISO 32000-1 §7.5). */
	const pdfStructure = (pdf: Buffer) => {
		const text = pdf.toString('latin1')
		const table = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1])
		const offsets = [...text.slice(table).matchAll(/^(\d{10}) 00000 n $/gm)].map(match =>
			Number(match[1]),
		)
		return {
			table: text.slice(table, table + 4),
			objects: offsets.map(offset => /^\d+ 0 obj/.exec(text.slice(offset))?.[0]),
		}
	}

	it('the images decode as what their names say', async () => {
		expect((await sharp((await pngFile()).buffer).metadata()).format).toBe('png')
		expect((await sharp((await jpegFile()).buffer).metadata()).format).toBe('jpeg')
		// `scan.pdf` is a PNG: no `%PDF-` in its first 1,024 bytes (plan call P3).
		const scan = (await pngAsPdf()).buffer
		expect(scan.subarray(0, 1024).includes('%PDF-')).toBe(false)
		expect((await sharp(scan).metadata()).format).toBe('png')
	})

	it('the PDFs are well formed: a header, and a table that points at each object', () => {
		for (const pdf of [textPdf().buffer, blankPdf().buffer]) {
			expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
			expect(pdfStructure(pdf)).toEqual({
				table: 'xref',
				objects: ['1 0 obj', '2 0 obj', '3 0 obj', '4 0 obj', '5 0 obj'],
			})
		}
		for (const line of PDF_LINES) expect(textPdf().buffer.includes(`(${line}) Tj`)).toBe(true)
		expect(blankPdf().buffer.includes(' Tj')).toBe(false)
	})

	it('the text files decode as the hub’s rules expect', () => {
		const utf8 = new TextDecoder('utf-8', { fatal: true })
		expect(utf8.decode(notesText().buffer)).toBe(`${NOTES_LINES.join('\n')}\n`)
		// Over the 100,000 code points the hub keeps (plan call P6).
		expect([...utf8.decode(longText().buffer)].length).toBeGreaterThan(ATTACHMENT_TEXT_MAX)
		const csv = `${CSV_ROWS.join('\r\n')}\r\n`
		// UTF-16LE with its byte-order mark, which the decoder drops (WHATWG Encoding: ignoreBOM false).
		const utf16 = utf16Csv().buffer
		expect([...utf16.subarray(0, 2)]).toEqual([0xff, 0xfe])
		expect(new TextDecoder('utf-16le', { fatal: true }).decode(utf16)).toBe(csv)
		// Windows-1256: not UTF-8, the CSV in its own code page.
		const legacy = windows1256Csv().buffer
		expect(() => utf8.decode(legacy)).toThrow(TypeError)
		expect(new TextDecoder('windows-1256').decode(legacy)).toBe(csv)
	})

	it('the sizes fall where the caps are, and the SVG is an SVG', () => {
		// Over 5 MB and under Next's 10 MB proxy limit, so the route itself answers.
		const big = oversizedFile().buffer.length
		expect(big).toBeGreaterThan(ATTACHMENT_MAX_BYTES)
		expect(big).toBeLessThan(10 * 1024 * 1024)
		// A file the route takes, two of which fill a conversation's 6 MB (plan call P8).
		const bulky = bulkyText().buffer.length
		expect(bulky).toBeLessThanOrEqual(ATTACHMENT_MAX_BYTES)
		expect(2 * bulky).toBeGreaterThan(CONVERSATION_ATTACHMENTS_MAX_BYTES)
		expect(svgFile().buffer.toString('utf8')).toMatch(/^<svg /)
	})
})
```

- [ ] **Step 4: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/stub-agui.test.ts` Expected: FAIL, `Tests  5 failed | 26 passed (31)`: the four scenario cases get 2a's default scenario (e.g. `expected [ 'RUN_STARTED', …(9) ] to deeply equal [ 'RUN_STARTED', …(4) ]`; the client case `expected [ 'reasoning', 'assistant' ] to deeply equal [ 'assistant' ]`), and the seed case reads `AGUI_APP.attachments` as `undefined`. The four cases of `e2e/fixtures/files.ts` pass already (Step 2 made the files). tsc fails meanwhile on the missing `attachments` and `AGUI_NATIVE_APP`.

- [ ] **Step 5: Give each stub app its attachments, add the native app, and seed them**

Replace the whole of `e2e/fixtures/stub/agui-apps.ts` with:

```ts
// Type-only and relative: erased at runtime, so the fixture loads none of the app's modules (e2e/fixtures/users.ts).
import type { AttachmentPolicy } from '../../../lib/chat/attachment-rules'

/**
 * The AG-UI apps the e2e seed adds (Part 2 spec §10; plan call P14): one whose agent answers, one whose agent the stub
 * does not know (404 before any stream: agent_not_found), and one that takes PDFs as `document` parts (2c's plan call
 * P23). Pure constants, so the specs import them without the stub's server code.
 */
export interface StubAguiApp {
	id: string
	name: string
	/** The last path segment of the agent URL, as the owner's service names agents (`<base>/agents/<name>`). */
	agent: string
	/** The app's `askUser` switch (Part 2 spec §6.2; plan call P18): while it is on, its runs advertise ask_user. */
	askUser: boolean
	/** The app's `attachments` settings (spec §2.2, §7.1; 2c's plan call P2), the seed's document. */
	attachments: AttachmentPolicy
}

export const AGUI_APP: StubAguiApp = {
	id: 'e2e00000-0000-4000-8000-0000000000a1',
	name: 'Stub AG-UI agent',
	agent: 'assistant',
	askUser: true,
	// Images on and PDFs read to text: every kind reaches the stub's echo (plan call P23).
	attachments: { images: true, documents: 'text', maxImageEdge: null },
}

export const AGUI_MISSING_APP: StubAguiApp = {
	id: 'e2e00000-0000-4000-8000-0000000000a2',
	name: 'Stub AG-UI missing',
	agent: 'missing',
	askUser: false,
	// The defaults (spec §2.2).
	attachments: { images: false, documents: 'text', maxImageEdge: null },
}

/** Plan call P23: PDFs go to the agent as `document` parts, and images are off, so the spec sees one refused. */
export const AGUI_NATIVE_APP: StubAguiApp = {
	id: 'e2e00000-0000-4000-8000-0000000000a3',
	name: 'Stub AG-UI native files',
	agent: 'assistant',
	askUser: false,
	attachments: { images: false, documents: 'native', maxImageEdge: null },
}

export const STUB_AGUI_APPS: StubAguiApp[] = [AGUI_APP, AGUI_MISSING_APP, AGUI_NATIVE_APP]

/** The one agent the stub serves; any other name answers 404. */
export const STUB_AGUI_AGENT = 'assistant'

/** The JWT audience the stub checks (the owner's AGENT_JWT_AUDIENCE) and the seeded apps' `audience`. */
export const STUB_AGUI_AUDIENCE = 'assistant'

/** An agent's URL on the stub server. */
export const aguiAgentUrl = (port: number, agent: string) =>
	`http://127.0.0.1:${port}/agui/agents/${agent}`
```

In `e2e/fixtures/constants.ts`, replace

```ts
	AGUI_MISSING_APP,
	aguiAgentUrl,
```

with

```ts
	AGUI_MISSING_APP,
	AGUI_NATIVE_APP,
	aguiAgentUrl,
```

In `e2e/auth.setup.ts`, replace

```ts
// Part 2 spec §10: two AG-UI apps on the stub agent (plan call P14), open to everyone like the stub apps. The
// documents are the AG-UI provider's (spec §2.2): the agent's URL, the JWT audience, the `askUser` switch (2b's
// plan call P18: on for the agent that answers) and the shared secret.
```

with

```ts
// Part 2 spec §10: three AG-UI apps on the stub agent (plan call P14; 2c's P23), open to everyone like the stub
// apps. The documents are the AG-UI provider's (spec §2.2): the agent's URL, the JWT audience, the `askUser`
// switch (2b's plan call P18: on for the agent that answers), the `attachments` settings (2c's plan call P2) and
// the shared secret.
```

then, in the same loop, replace

```ts
							askUser: app.askUser,
						}),
```

with

```ts
							askUser: app.askUser,
							attachments: app.attachments,
						}),
```

and replace

```ts
// The e2e database outlives a run (e2e/global-setup.ts reuses the container): the AG-UI apps' conversations of an
// earlier run are removed, so each run's sidebar starts empty. Runs and messages go with them (ON DELETE CASCADE,
// spec §3.1).
await db.query('DELETE FROM conversations WHERE app_id = ANY($1::uuid[])', [
	STUB_AGUI_APPS.map(app => app.id),
])
```

with

```ts
// The e2e database outlives a run (e2e/global-setup.ts reuses the container): the AG-UI apps' attachments and
// conversations of an earlier run are removed, so each run's sidebar starts empty and no file an earlier run left
// unsent counts against the 25 a user may have waiting (2c's plan call P8). Runs and messages go with the
// conversations (ON DELETE CASCADE, spec §3.1).
const aguiAppIds = STUB_AGUI_APPS.map(app => app.id)
await db.query('DELETE FROM conversation_attachments WHERE app_id = ANY($1::uuid[])', [aguiAppIds])
await db.query('DELETE FROM conversations WHERE app_id = ANY($1::uuid[])', [aguiAppIds])
```

The `ON CONFLICT … DO UPDATE SET settings = EXCLUDED.settings` already in the insert rewrites the documents on a database that survives between runs. The seed now holds ten apps (five Dify apps, two extra Dify apps, three AG-UI apps): exactly the apps table's first page at antd's default 10 rows, newest first (`lib/data/apps.ts` orders by `created_at DESC`), so the oldest seeded app moves to page 2 only while a spec has an app of its own, and every spec that reaches a seeded row then reaches its own app's row instead (Step 8 runs `admin-apps.spec.ts` to prove the first page).

- [ ] **Step 6: The scenario**

In `e2e/fixtures/stub/agui.ts`, in the header comment, replace

```ts
 * text), `tool`, `nested`, `error <code>`, `timeout`, `slow` and `invalid`; 2b's human-in-the-loop scenarios (HITL_KEYWORDS) are
 * checked first.
 */
```

with

```ts
 * text), `tool`, `nested`, `error <code>`, `timeout`, `slow` and `invalid`; 2b's human-in-the-loop scenarios (HITL_KEYWORDS) are
 * checked before them, and 2c's `files` echo before those.
 */
```

Insert this block after `hitlPlanFor`'s closing `}`, which ends with

```ts
	const keyword = HITL_KEYWORDS.find(word => hasWord(text, word))
	if (!keyword) return null
	return input.resume?.length ? resumedRun(input, keyword) : FIRST_RUNS[keyword](input)
}
```

and before the doc comment above `streamEvents` (it begins "Writes the events one by one with `EventEncoder.encodeSSE`"):

```ts
/*
 * Part 2c's scenario (spec §7.1, §10: "an attachment echo"; plan call P23): the agent answers with one paragraph per
 * content part of the message it was sent, so a spec reads what reached the agent. The hub sends a user message's
 * `content` as an array only when the message has attachments, and as a string otherwise (spec §7.1), so the echo
 * answers every input that ends with a user message whose content is an array, a file-only message included (it has no
 * text part, P11), and any that holds the whole word FILES_KEYWORD; it is tried first, so an attached file's text never
 * picks another scenario. No 2a or 2b prompt holds the word.
 */
const FILES_KEYWORD = 'files'

type UserContent = Extract<Messages[number], { role: 'user' }>['content']
type ContentPart = Exclude<UserContent, string>[number]

/** A text part's lines without the blank ones; CRLF counts as one break (a CSV from Excel). */
const linesOf = (text: string) =>
	text
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(Boolean)

/**
 * One part as the echo names it: `image <mimeType> <decoded bytes>` and `document <mimeType> <decoded bytes>` for inline
 * data (AG-UI 1.0 DataSource: `value` is base64, `mimeType` required), the source's type for any other source, and
 * `text <first line>`, with ` … <last line>` when it has more than one, so the end of a file's text (the truncation note
 * of plan call P6, the last line a PDF gave) shows too.
 */
const partLine = (part: ContentPart): string => {
	if (part.type === 'text') {
		const lines = linesOf(part.text)
		if (lines.length === 0) return 'text (blank)'
		return lines.length === 1 ? `text ${lines[0]}` : `text ${lines[0]} … ${lines.at(-1)}`
	}
	const { source } = part
	if (source.type !== 'data') return `${part.type} ${source.mimeType ?? 'unknown'} ${source.type}`
	return `${part.type} ${source.mimeType} ${Buffer.from(source.value, 'base64').length}`
}

/** The echo for an input that ends with a message carrying attachments or the keyword, else null. */
const filesPlanFor = (input: RunInput): Plan | null => {
	const last = input.messages.at(-1)
	if (last?.role !== 'user') return null
	if (typeof last.content === 'string' && !hasWord(last.content, FILES_KEYWORD)) return null
	const parts: ContentPart[] =
		typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content
	// Paragraphs, so the Markdown answer shows one line per part.
	return hitlRun(input, textMessage(parts.map(partLine).join('\n\n')))
}
```

In `handleAgui`, replace

```ts
const plan = hitlPlanFor(parsed.data) ?? planFor(threadId, runId, lastUserText(messages))
```

with

```ts
const plan =
	filesPlanFor(parsed.data) ??
	hitlPlanFor(parsed.data) ??
	planFor(threadId, runId, lastUserText(messages))
```

`filesPlanFor` answers null for every 2a and 2b prompt (a string without the word `files`), and for every run that answers a 2b card (an answering run carries no user message, spec §4.2, so its input ends with the agent's message or a tool message), so their scenarios, refusals and order are untouched. It reuses 2b's `hitlRun` (RUN_STARTED, the events, RUN_FINISHED success).

- [ ] **Step 7: Run them to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/stub-agui.test.ts` Expected: PASS, `Test Files  1 passed (1)`, `Tests  31 passed (31)`, and no `[ag-ui]` warning in the output.

- [ ] **Step 8: Gates, and 2a's and 2b's AG-UI specs on the new seed**

Run:

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint e2e/fixtures/files.ts e2e/fixtures/stub/agui.ts e2e/fixtures/stub/agui-apps.ts e2e/fixtures/constants.ts e2e/auth.setup.ts __tests__/stub-agui.test.ts
pnpm exec oxfmt --check e2e/fixtures/files.ts e2e/fixtures/stub/agui.ts e2e/fixtures/stub/agui-apps.ts e2e/fixtures/constants.ts e2e/auth.setup.ts __tests__/stub-agui.test.ts
pnpm test
```

Expected: tsc exits 0; oxlint reports nothing; oxfmt "All matched files use the correct format."; vitest 0 failed. Then, with no `pnpm dev` running and `pnpm test:db` not running (both use 127.0.0.1:5433):

```bash
pnpm test:e2e e2e/agui-chat.spec.ts e2e/agui-hitl.spec.ts e2e/admin-apps.spec.ts --project desktop-light
rm -rf .next/dev/types && pnpm exec next typegen
```

Expected: every test passes on `desktop-light`: the seed now writes `attachments` and the third app, the stub tries the echo first, and 2a's and 2b's prompts never take it; `admin-apps.spec.ts` finds its seeded rows on the first page of ten. The second line clears the stale route types an e2e run leaves (Global Constraints).

- [ ] **Step 9: Commit**

```bash
git add e2e/fixtures/files.ts e2e/fixtures/stub/agui.ts e2e/fixtures/stub/agui-apps.ts e2e/fixtures/constants.ts e2e/auth.setup.ts __tests__/stub-agui.test.ts
git commit -m "test(e2e): the AG-UI stub's files echo, the attachment seed and the test files

Part 2 spec §7.1 and §10 (2c) and plan call P23: the stub answers a
message with attachments (array content, file-only included) or the
word files with one line per content part: its type, MIME and decoded
bytes, or a text part's first and last lines, tried before 2a's and
2b's scenarios. The seed gives the AG-UI apps their attachments
settings, adds a native-PDF app with images off, and empties the stub
apps' attachments between runs. e2e/fixtures/files.ts builds the
images, PDFs, text files and refusals the specs pick at run time.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["e2e/fixtures/files.ts", "e2e/fixtures/stub/agui.ts", "e2e/fixtures/stub/agui-apps.ts", "e2e/fixtures/constants.ts", "e2e/auth.setup.ts", "__tests__/stub-agui.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/stub-agui.test.ts", "acceptanceCriteria": ["pnpm exec vitest run --project unit __tests__/stub-agui.test.ts reports 31 passed (22 existing, 9 new)", "A message of text, a PNG, a PDF and text parts streams one text message whose paragraphs are text files please, image image/png <bytes>, document application/pdf <bytes>, text [file notes.txt] … Ship the attachments on Friday., text [file cities.csv] … Nour,القاهرة and text [file long.txt] … <TRUNCATED_NOTE>, ending RUN_FINISHED success", "An image alone answers image image/png <bytes>; a text part naming plan, tool and slow still gets the echo; files again after an earlier image echoes only text files again; hello profiles still gets 2a's default scenario", "HttpAgent reads the echo of a content array without a protocol error: one assistant message", "AGUI_APP.attachments is { images: true, documents: 'text', maxImageEdge: null }, AGUI_NATIVE_APP.attachments { images: false, documents: 'native', maxImageEdge: null }; every seeded document parses with aguiSettingsSchema to its attachments; the seed writes them and deletes the stub AG-UI apps' conversation_attachments before their conversations", "The test files are what their names say: PNG and JPEG decode, scan.pdf is a PNG without %PDF- in 1,024 bytes, both PDFs have a valid header and cross-reference table, long.txt is over 100,000 code points, the UTF-16 CSV starts FF FE and decodes, the Windows-1256 CSV is not UTF-8 and decodes as windows-1256, big.txt is between 5 and 10 MB, bulky.txt is at most 5 MB and two of it exceed 6 MB", "tsc exits 0, pnpm test 0 failed, oxlint and oxfmt clean on the six files; pnpm test:e2e e2e/agui-chat.spec.ts e2e/agui-hitl.spec.ts e2e/admin-apps.spec.ts --project desktop-light passes"], "modelTier": "standard"}
```

---

### Task 19: The e2e specs for attachments and the Logs

**Goal:** The Playwright suite proves 2c's "done when" (spec §12) against Task 18's `files` echo on `desktop-light`, `desktop-dark` and `mobile-light`: images, PDFs and text files reach the agent as the app's settings say (a file-only message, a cut text, the caps, each refusal, a removed file, a reload, the native app), the admin's Attachments section saves and the chat follows it, and an admin reads an AG-UI app's conversations in its Logs (the row action, the list with its filters and numbered pages in the URL, the read-only transcript, the owner's access log, the admin and user gates), with screenshots of the composer with files, the Logs page and its drawer.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

Spec §7.1, §7.2 and §12 (2c: "images, PDFs and text files reach the agent per the app's settings; the caps hold; admins read conversations in the Logs, every view is in the access log"; the notice is struck by decision 69 (8), P24), §10 (the e2e list: "an attachment echo, the caps, the Logs list and transcript, the access log"), decisions 69 and 70, plan calls P1–P4, P6–P8, P11–P20 and P22, ADR-0010 (Playwright against `next dev` and the stub; web-first assertions; locators by role, label, placeholder and text) and ADR-0024 (the admin gates). The idioms are 2a's and 2b's: `e2e/agui-chat.spec.ts` (`senderBox`, `answers`, `questions`, a new conversation per test through `?isNewCvst=1`, `/chat/<id>` reopening the newest one), `e2e/chat-files.spec.ts` (the Dify chat's files: the file chooser opened from the panel's drop area, `setFiles` with buffers, the image preview closed once its fade-in ended, `naturalWidth` for a loaded image), `e2e/agui-admin.spec.ts` (`ownId`, `seedAguiApp`, `openDrawer`, `rowById`, `dropApp`), `e2e/admin-apps.spec.ts` (`expectGalleryShows`: a fresh context signed in as a seeded account; the search box; the size changer hidden below screenSM), `e2e/roles.spec.ts` (accounts seeded with the project's name and deleted after), `e2e/fixtures/branding.ts` (`chooseFile`'s retried chooser), `e2e/fixtures/hydration.ts` (`waitForHydration` on a ClientDateTime before the first click) and 2b's `e2e/agui-hitl.spec.ts` (`top` for order, `activate`). Playwright 1.63 (Context7 `/microsoft/playwright/v1.63.0`): "Upload files" (`fileChooser.setFiles` with `{ name, mimeType, buffer }`), `APIRequestContext.post` with `multipart` (a file field as `{ name, mimeType, buffer }`) and `data` (JSON), `page.waitForResponse`/`waitForRequest` and `request.postDataJSON()`, `page.waitForEvent('download')` and `download.suggestedFilename()`, `locator.or()` and `filter({ has })`, `getByAltText`, `toHaveURL` with a RegExp, `test.beforeAll`/`afterAll` with the worker's `browser` (a context made there takes the project's `use` options, as `admin-apps.spec.ts` relies on), `test.info()` in a hook. The markup the specs rely on, from the tasks that build it (Step 1 checks each against the code as built): Task 11's composer is the Dify chat's (`sender.*` texts, X `Attachments` in the Sender's header rendered while closed, `FileCard.List` items `.ant-file-card-list-item` whose remove control is X's CloseCircleFilled icon, an image card showing only the image with the name as its `alt`, X FileCard 2.9 `FileCard.js` L166–177), refuses a wrong kind, a file over 5 MB and a sixth file in `beforeUpload` with a message and no card (`Upload.LIST_IGNORE`), keeps a server refusal on its card with `shared_chat.error.<code>`, sends with the Dify chat's toasts while a file uploads or failed, and gives X's `SendButton` (named by its icon, `arrow-up`) `disabled` from `canSendEmpty`; Task 12's `TurnFiles` (a `Files` group, images by their name as `alt`, cards that download through an `a` with `download`); Tasks 14–17's Logs (the "Logs" menu item, the page, its filters, table, drawer, timeline and access log tab: the texts in the table below). **Two notes for the reader of the results:** under `next dev` React's Strict Mode runs one extra development-only setup and cleanup of an effect "before the first real setup" (react.dev `useEffect`; Next's `reactStrictMode` "is `true` by default with `app` router", `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/reactStrictMode.md`), and Task 16's drawer is mounted closed with the page, so that extra cycle runs before any opening and one opening is one `view` row in development too (the pre-flight saw exactly one `view` and one `download` row after the spec's opening); the spec asserts at least one of each, since the thumbnail, served `Cache-Control: private, no-store` (P14), may be fetched again. And the seed now holds ten apps, exactly the apps table's first page (Task 18), so the row action test reaches its two rows through the table's search, never by page.

**Texts this task asserts, and where they come from** (if a task changed one, change it here; the e2e rule of spec §8):

| Text | Key / source |
| --- | --- |
| `Type a message`, `Attach files`, `Click or drag a file here to upload`, `Uploading...`, `Remove the files that could not be uploaded`, `Unsupported file type: svg` / `png`, `At most 5 files` | `chat.send_placeholder`, `sender.attach`, `sender.upload_hint`, `sender.uploading`, `sender.remove_failed_uploads`, `common.unsupported_file_type`, `sender.too_many_files` (the Dify chat's keys, which Task 11 reuses) |
| `Only the first 100,000 characters are sent` | `shared_chat.attachment_truncated` (Task 11) |
| `This file is larger than 5 MB`, `This conversation already holds 6 MB of files`, `This file could not be read`, `Save the file as UTF-8 text, in Excel: CSV UTF-8`, `This PDF has no text the agent can read` | `shared_chat.error.attachment_too_large`, `.conversation_attachments_full`, `.attachment_invalid`, `.attachment_encoding`, `.attachment_no_text` (Task 7) |
| `arrow-up`, `close-circle` | the antd icons' `aria-label` in X's `SendButton` and in X FileCard.List's remove control |
| `Images`, `As text`, `As PDF`, `Largest image edge`, `Keep the size` | `app_setting.attachments_images`, `.attachments_documents_text`, `.attachments_documents_native`, `.attachments_max_image_edge`, `.attachments_max_image_edge_placeholder` (Task 2) |
| `Edit app configuration`, `Update`, `Edit`, `More actions`, `User view`, `Search apps` | `admin_apps.*`, `common.*` (Part 1) |
| `Logs` | `admin_apps.logs` (Task 14) |
| `Total conversations: N`, `Messages`, `User`, `Failed`, `Include deleted`, `Deleted by the user, purged on`, `View`, `Runs`, `Succeeded`, `State`, `Transcript`, `Conversations`, `Access log`, `Download` | `admin_logs.total`, `.column_messages`, `.column_user`, `.tag_failed`, `.filter_deleted`, `.tag_deleted`, `.view`, `.tab_runs`, `.run_status.succeeded`, `.tab_state`, `.tab_transcript`, `.tab_conversations`, `.tab_access`, `.action_download`, and `common.status` (`Status`) (Tasks 15–17) |
| `Start date`, `20 / page` | antd 6.6.5's `en_US` locale (RangePicker's placeholder, Pagination's size option) |
| `text files please`, `image image/jpeg <size>`, `text [file report.pdf] … Revenue grew by four percent.`, `document application/pdf <bytes>`, `text [file long.txt] … [truncated: only the first 100,000 characters of this file are included]`, … | Task 18's `files` echo (its table) |

**Depends on:** Tasks 1–18.

**Files:**

- Create: `e2e/agui-files.spec.ts`
- Create: `e2e/agui-logs.spec.ts`
- Modify: `e2e/agui-admin.spec.ts` (one test: the Attachments section)
- Modify: `e2e/screenshots.spec.ts` (three page entries: `chat-agui-files`, `admin-logs`, `admin-logs-drawer`)

**Acceptance Criteria:**

- [ ] `pnpm test:e2e e2e/agui-files.spec.ts e2e/agui-logs.spec.ts e2e/agui-admin.spec.ts` passes on `desktop-light`, `desktop-dark` and `mobile-light`: `58 passed` (the `setup` project's one, and per project 10 of `agui-files.spec.ts`, 5 of `agui-logs.spec.ts` and 4 of `agui-admin.spec.ts`), 0 failed.
- [ ] Files reach the agent: a JPEG, a text PDF, `notes.txt` and a UTF-16 CSV attached together are stored (`image/jpeg`, `application/pdf`, `text/csv; charset=utf-16le`), the run body names their ids in the order attached, and the echo reads `text files please`, `image image/jpeg <stored size>`, `text [file report.pdf] … Revenue grew by four percent.`, `text [file notes.txt] … Ship the attachments on Friday.` and `text [file cities-utf16.csv] … Nour,القاهرة`, top to bottom; the composer empties and the user's turn shows the image and the three cards with its text.
- [ ] A file alone: Send is disabled with nothing attached and enabled with an image; Enter sends `message: { text: '', attachmentIds: [id] }`, the echo is only `image image/png <size>` (no text part), and the conversation's title is `''`.
- [ ] A cut file: `long.txt` is answered `truncated: true`, its card reads "Only the first 100,000 characters are sent", and the echo ends with the truncation note.
- [ ] The caps: six text files picked at once leave five cards and "At most 5 files", and the five reach the agent; in the same conversation a 3.5 MB file goes, and a second one's card reads "This conversation already holds 6 MB of files".
- [ ] Refusals: `scan.pdf`, `cities-1256.csv` and `blank.pdf` keep their cards with "This file could not be read", "Save the file as UTF-8 text, in Excel: CSV UTF-8" and "This PDF has no text the agent can read"; a send shows "Remove the files that could not be uploaded", keeps the text and makes no run; once the cards are removed it goes; `icon.svg` and `big.txt` are refused in the browser ("Unsupported file type: svg", "This file is larger than 5 MB") with no card and no upload; the route answers 413 `attachment_too_large`, 415 `attachment_type_not_allowed`, 400 `attachment_invalid`, 400 `attachment_encoding` and 400 `attachment_no_text` for the five, storing none; the native app answers 415 to a PNG and 201 to `blank.pdf`.
- [ ] Removing an uploaded card calls `DELETE …/attachments/<id>`, answered 204, and the row is gone.
- [ ] After a reload the user's turn shows its text, the image from `/api/apps/<app>/attachments/<id>` (loaded), which opens and closes in the preview, and a card that downloads `notes.txt`.
- [ ] The native app's picker accepts `.pdf,.txt,.md,.csv`, its PDF reaches the agent as `document application/pdf <the file's bytes>`, and a PNG is refused with "Unsupported file type: png".
- [ ] The admin's Attachments section opens on images off, "As text" and an empty "Largest image edge" ("Keep the size"), saves images on, "As PDF" and 1024 into `apps.settings.attachments`, reopens on them, and the chat's picker goes from `.pdf,.txt,.md,.csv` to `.png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv`.
- [ ] The Logs: a Dify app's menu has no "Logs" and the AG-UI app's opens `/app-management/<id>/logs` in the same tab; the list shows the user's conversation (name, email, 2 messages) and the total; the user, status (`failed`), deleted and date filters put `user=`, `status=failed`, `deleted=1`, `from=` and `to=` in the URL and narrow the rows; page 2 is `page=2` and, on the desktops, a size of 20 is `pageSize=20` back at page 1; "View" opens the drawer with the user's email, the image (loaded), the echo and no Sender, the Runs tab's "Succeeded" and the State tab's `{}`; the database holds at least one `view` row and one `download` row naming the file for the owner, and the "Access log" tab (`tab=access`) lists both; an admin sees the conversations and no "Access log" tab, even at `?tab=access`; a user is sent to `/apps` and the logs route answers 403 `forbidden`.
- [ ] `pnpm exec playwright test e2e/screenshots.spec.ts -g "chat-agui-files|admin-logs"` writes `chat-agui-files-*.png`, `admin-logs-*.png` and `admin-logs-drawer-*.png` for the three projects.
- [ ] tsc (which checks `e2e/`), oxlint and oxfmt are clean on the four files; every Dify spec and 2a's and 2b's AG-UI specs are untouched (`git diff --stat` lists only the four files).

**Verify:** `pnpm test:e2e e2e/agui-files.spec.ts e2e/agui-logs.spec.ts e2e/agui-admin.spec.ts` → the list reporter ends with `58 passed` and no `failed` line; the whole suite runs in Task 21.

**Steps:**

- [ ] **Step 1: Read the markup as built and check the locators**

Read `components/shared-chat/hooks/use-shared-attachments.tsx`, `attachment-items.ts` and `shared-chat.tsx` (Task 11), `components/chat/chat-view/chat-sender.tsx` (`canSendEmpty`), `components/shared-chat/turn-files.tsx` and `user-turn.tsx` (Task 12), `components/provider-ui/agui/form-section.tsx` (Task 2), `components/admin/apps/app-actions.tsx` (Task 14), `components/admin/logs/*.tsx` and `app/(admin)/app-management/[appId]/logs/page.tsx` (Tasks 15–17), and the `sender`, `shared_chat`, `app_setting`, `admin_apps` and `admin_logs` areas of `locales/en/translation.json`. Check each row of the table above against them: the English values, which control carries which text, that a server refusal keeps its card and a browser refusal does not, that the Sender's header is rendered while closed (its file input's `accept`), the drawer's title, its tabs and its Descriptions, the access log's columns, and the filters' names (the user and status Selects' `aria-label`, the switch's `<label>`). Where the code as built differs, adjust the matching helper or locator in Steps 2–5 and say so in the task's close note; never loosen an assertion.

- [ ] **Step 2: Write the attachments spec**

Create `e2e/agui-files.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from '@playwright/test'

// Type-only and relative: erased at runtime, so the spec loads none of the app's modules (e2e/fixtures/users.ts).
import type { UploadedAttachment } from '../lib/chat/attachment-rules'

import { AGUI_APP, AGUI_NATIVE_APP, STUB_AGUI_APPS } from './fixtures/constants'
import { withDb } from './fixtures/db'
import {
	blankPdf,
	bulkyText,
	CSV_ROWS,
	jpegFile,
	longText,
	NOTES_LINES,
	notesText,
	oversizedFile,
	PDF_LINES,
	pngAsPdf,
	pngFile,
	svgFile,
	textPdf,
	utf16Csv,
	windows1256Csv,
	type TestFile,
} from './fixtures/files'

/*
 * Part 2 spec §7.1 and §12 (2c "done when": "images, PDFs and text files reach the agent per the app's settings; the
 * caps hold") against Task 18's `files` echo of the stub AG-UI producer (ADR-0010; plan call P23): the agent answers one
 * line per content part it received, so each test reads what reached it. AGUI_APP takes images and reads PDFs to text;
 * AGUI_NATIVE_APP sends PDFs as `document` parts and takes no image. `workers: 1` keeps one test on the stub at a time,
 * so `/chat/<id>` reopens the conversation the test made last (e2e/agui-chat.spec.ts).
 */

/** The Sender's box by its placeholder (`chat.send_placeholder`). */
const senderBox = (page: Page) => page.getByPlaceholder('Type a message')
/** The answers and the user's turns: Bubble.List's start- and end-placed bubbles, as the 2a specs find them. */
const answers = (page: Page) => page.locator('.ant-bubble-start')
const questions = (page: Page) => page.locator('.ant-bubble-end')
/** The prefix button that opens the files panel (`sender.attach`) and the panel's drop area (`sender.upload_hint`). */
const attachButton = (page: Page) => page.getByRole('button', { name: 'Attach files', exact: true })
const uploadHint = (page: Page) => page.getByText('Click or drag a file here to upload')
/** X Sender's own send button, named by its icon (X 2.9 SendButton: ArrowUpOutlined). */
const sendButton = (page: Page) =>
	page.locator('.ant-sender').getByRole('button', { name: 'arrow-up' })
/**
 * The composer's cards (X Attachments renders its list as FileCard.List items), one by its file's name: a file card shows
 * the name, an image card only the image, which the name labels (X 2.9 FileCard: `alt: name`). Visible ones only: once
 * the last card is removed, X Attachments hides the whole list (`display: none`, `es/attachments/index.js`) before the
 * removed card's leave motion ends, so that card stays in the DOM, hidden, until the list shows again.
 */
const composerCards = (page: Page) =>
	page.locator('.ant-sender .ant-file-card-list-item').filter({ visible: true })
const composerCard = (page: Page, name: string) =>
	composerCards(page).filter({
		has: page.getByText(name, { exact: true }).or(page.getByAltText(name, { exact: true })),
	})
const UPLOAD_PATH = /^\/api\/apps\/[^/]+\/attachments$/
const RUNS_PATH = /^\/api\/apps\/[^/]+\/runs$/

const send = async (page: Page, text: string) => {
	await senderBox(page).fill(text)
	await page.keyboard.press('Enter')
}

/**
 * Picks files through the panel's drop area, which opens the browser's file chooser (Playwright "Upload files": the
 * `filechooser` event, `setFiles` with buffers; e2e/chat-files.spec.ts). A click before hydration opens nothing, so the
 * pair is retried with its outcome (Playwright `expect.toPass`, given a timeout as it has none; e2e/fixtures/branding.ts).
 */
const attach = async (page: Page, files: TestFile[]) => {
	await expect(async () => {
		if (!(await uploadHint(page).isVisible())) await attachButton(page).click({ timeout: 2_000 })
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser', { timeout: 2_000 }),
			uploadHint(page).click({ timeout: 2_000 }),
		])
		await chooser.setFiles(files)
	}).toPass({ timeout: 30_000 })
}

/** The upload route's answers from now on (plan call P13: a file uploads when it is picked), in the order they come. */
const uploadAnswers = (page: Page) => {
	const answered: Promise<{ status: number; body: unknown }>[] = []
	page.on('response', response => {
		if (
			response.request().method() === 'POST' &&
			UPLOAD_PATH.test(new URL(response.url()).pathname)
		)
			answered.push(response.json().then(body => ({ status: response.status(), body })))
	})
	return answered
}
/**
 * Waits for `count` stored files (201) and for their cards to finish (`sender.uploading` gone: the page reads the answer
 * after the test does), and answers them by name.
 */
const storedFiles = async (
	page: Page,
	answered: Promise<{ status: number; body: unknown }>[],
	count: number,
) => {
	await expect.poll(() => answered.length).toBe(count)
	const all = await Promise.all(answered)
	expect(all.map(answer => answer.status)).toEqual(all.map(() => 201))
	await expect(page.getByText('Uploading...', { exact: true })).toHaveCount(0)
	return new Map(
		all.map(({ body }) => [(body as UploadedAttachment).name, body as UploadedAttachment]),
	)
}

/** The next POST /runs (spec §4.2), for the body the page sent. */
const nextRun = (page: Page) =>
	page.waitForRequest(
		request => request.method() === 'POST' && RUNS_PATH.test(new URL(request.url()).pathname),
	)

/** A vertical position on the page, for the order of the echo's lines (P11: the parts in the order attached). */
const top = async (locator: Locator) => (await locator.boundingBox())!.y
/** Each line of the echo is a paragraph of the answer, shown once and in this order. */
const expectEcho = async (answer: Locator, lines: string[]) => {
	const shown = lines.map(line => answer.getByText(line, { exact: true }))
	for (const line of shown) await expect(line).toBeVisible()
	const tops = await Promise.all(shown.map(top))
	expect(tops).toEqual([...tops].sort((a, b) => a - b))
}

const STUB_AGUI_APP_IDS = STUB_AGUI_APPS.map(app => app.id)
/** The stub apps' files that were stored and never sent (plan call P8 counts them per user). */
const unsentCount = () =>
	withDb(async db => {
		const { rows } = await db.query<{ count: string }>(
			'SELECT count(*) FROM conversation_attachments WHERE conversation_id IS NULL AND app_id = ANY($1::uuid[])',
			[STUB_AGUI_APP_IDS],
		)
		// count(*) is a bigint, which node-postgres returns as a string (e2e/admin-apps.spec.ts).
		return Number(rows[0]?.count)
	})

test.describe('attachments in the AG-UI chat', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
		await expect(senderBox(page)).toBeEnabled()
	})

	// A user may have 25 files waiting (plan call P8): what a test left unsent goes, so the next tests start under it.
	test.afterEach(async () => {
		await withDb(db =>
			db.query(
				'DELETE FROM conversation_attachments WHERE conversation_id IS NULL AND app_id = ANY($1::uuid[])',
				[STUB_AGUI_APP_IDS],
			),
		)
	})

	test('an image, a PDF and two text files reach the agent as the parts of one message', async ({
		page,
	}) => {
		const uploads = uploadAnswers(page)
		const photo = await jpegFile()
		const picked = [photo, textPdf(), notesText(), utf16Csv()]
		await attach(page, picked)
		for (const file of picked) await expect(composerCard(page, file.name)).toBeVisible()
		const stored = await storedFiles(page, uploads, picked.length)
		// Plan calls P3 and P7: the bytes decide the stored type; the image is re-encoded in its own format, and the UTF-16
		// file keeps the charset it was read in.
		expect(stored.get(photo.name)).toMatchObject({ kind: 'image', mime: 'image/jpeg' })
		expect(stored.get('report.pdf')).toMatchObject({ kind: 'document', mime: 'application/pdf' })
		expect(stored.get('cities-utf16.csv')).toMatchObject({
			kind: 'text',
			mime: 'text/csv; charset=utf-16le',
			truncated: false,
		})
		const run = nextRun(page)
		await send(page, 'files please')
		// P11: the message names its files in the order they were attached.
		expect((await run).postDataJSON()).toMatchObject({
			message: {
				text: 'files please',
				attachmentIds: picked.map(file => stored.get(file.name)!.id),
			},
		})
		// Spec §7.1: the text part, then one part per file: the image inline, the PDF and the text files as text.
		await expectEcho(answers(page).last(), [
			'text files please',
			`image image/jpeg ${stored.get(photo.name)!.size}`,
			`text [file report.pdf] … ${PDF_LINES[1]}`,
			`text [file notes.txt] … ${NOTES_LINES[1]}`,
			`text [file cities-utf16.csv] … ${CSV_ROWS[1]}`,
		])
		// The composer starts afresh after a send, and the user's turn shows the files with its text (P15).
		await expect(composerCards(page)).toHaveCount(0)
		const question = questions(page).last()
		await expect(question.getByRole('img', { name: photo.name })).toBeVisible()
		for (const name of ['report.pdf', 'notes.txt', 'cities-utf16.csv'])
			await expect(question.getByText(name, { exact: true })).toBeVisible()
		await expect(question.getByText('files please', { exact: true })).toBeVisible()
	})

	test('a message of files alone is sent without a text part', async ({ page }) => {
		const uploads = uploadAnswers(page)
		// 2a's rule: Send waits for a text while nothing is attached.
		await expect(sendButton(page)).toBeDisabled()
		const photo = await pngFile()
		await attach(page, [photo])
		const stored = await storedFiles(page, uploads, 1)
		// Decision 69 (2), plan call P12: an attached file is enough, from the button and from Enter.
		await expect(sendButton(page)).toBeEnabled()
		const run = nextRun(page)
		await senderBox(page).press('Enter')
		expect((await run).postDataJSON()).toMatchObject({
			message: { text: '', attachmentIds: [stored.get(photo.name)!.id] },
		})
		// P11: no text part reached the agent, only the image.
		const answer = answers(page).last()
		await expectEcho(answer, [`image image/png ${stored.get(photo.name)!.size}`])
		await expect(answer.getByText(/^text /)).toHaveCount(0)
		await expect(questions(page).last().getByRole('img', { name: photo.name })).toBeVisible()
		// Spec §3.1: a message without text leaves the conversation untitled ('', shown as "New conversation").
		const title = await withDb(async db => {
			const { rows } = await db.query<{ title: string }>(
				'SELECT c.title FROM conversations c JOIN conversation_attachments a ON a.conversation_id = c.id WHERE a.id = $1',
				[stored.get(photo.name)!.id],
			)
			return rows[0]?.title
		})
		expect(title).toBe('')
	})

	test('a long text file is cut: its card says so, and the agent reads the note', async ({
		page,
	}) => {
		const uploads = uploadAnswers(page)
		await attach(page, [longText()])
		const stored = await storedFiles(page, uploads, 1)
		expect(stored.get('long.txt')).toMatchObject({ kind: 'text', truncated: true })
		// Plan call P6: the card's description says what the agent gets (`shared_chat.attachment_truncated`).
		await expect(composerCard(page, 'long.txt')).toContainText(
			'Only the first 100,000 characters are sent',
		)
		await send(page, 'files long')
		await expectEcho(answers(page).last(), [
			'text files long',
			'text [file long.txt] … [truncated: only the first 100,000 characters of this file are included]',
		])
	})

	test('a file the server refuses keeps its card with the reason, and Send waits until it is removed', async ({
		page,
	}) => {
		const runs: string[] = []
		page.on('request', request => {
			if (request.method() === 'POST' && RUNS_PATH.test(new URL(request.url()).pathname))
				runs.push(request.url())
		})
		// Plan calls P3, P4 and P6: bytes that are not a PDF, a text in another encoding, a PDF with no text (text mode).
		const refused = [
			{ file: await pngAsPdf(), reason: 'This file could not be read' },
			{ file: windows1256Csv(), reason: 'Save the file as UTF-8 text, in Excel: CSV UTF-8' },
			{ file: blankPdf(), reason: 'This PDF has no text the agent can read' },
		]
		await attach(
			page,
			refused.map(({ file }) => file),
		)
		for (const { file, reason } of refused)
			await expect(composerCard(page, file.name)).toContainText(reason)
		// A send while a card failed is refused with the Dify chat's toast, and keeps the text and the cards.
		await send(page, 'files after the refusals')
		await expect(
			page.getByText('Remove the files that could not be uploaded', { exact: true }),
		).toBeVisible()
		await expect(senderBox(page)).toHaveValue('files after the refusals')
		expect(runs).toEqual([])
		// Removing the refused cards (X's remove control on each, an icon) lets the message go; nothing was stored.
		for (const { file } of refused) {
			await composerCard(page, file.name).getByRole('img', { name: 'close-circle' }).click()
			await expect(composerCard(page, file.name)).toHaveCount(0)
		}
		expect(await unsentCount()).toBe(0)
		await senderBox(page).press('Enter')
		await expectEcho(answers(page).last(), ['text files after the refusals'])
		expect(runs).toHaveLength(1)
	})

	test('a file of a kind the app does not take, or over 5 MB, is refused before it uploads', async ({
		page,
	}) => {
		const uploads = uploadAnswers(page)
		// Task 11's pre-check (beforeUpload): a message says why, and the file never reaches the list or the route.
		await attach(page, [svgFile()])
		await expect(page.getByText('Unsupported file type: svg', { exact: true })).toBeVisible()
		await attach(page, [oversizedFile()])
		await expect(page.getByText('This file is larger than 5 MB', { exact: true })).toBeVisible()
		await expect(composerCards(page)).toHaveCount(0)
		expect(uploads).toHaveLength(0)
	})

	test('the caps: five files a message, and 6 MB of files a conversation', async ({ page }) => {
		let uploads = uploadAnswers(page)
		// Spec §7.1: at most 5 files a message; the browser keeps a sixth out with a message (Task 11's pre-check).
		const notes = Array.from({ length: 6 }, (_, index) => notesText(`notes-${index + 1}.txt`))
		await attach(page, notes)
		await expect(page.getByText('At most 5 files', { exact: true })).toBeVisible()
		await storedFiles(page, uploads, 5)
		await expect(composerCards(page)).toHaveCount(5)
		await expect(composerCard(page, 'notes-6.txt')).toHaveCount(0)
		await send(page, 'files five')
		const five = answers(page).last()
		await expect(five.getByText('text files five', { exact: true })).toBeVisible()
		await expect(five.getByText(/^text \[file notes-\d\.txt\] … /)).toHaveCount(5)

		// P8: the conversation's sent files plus a new one may hold 6 MB: 3.5 MB goes, a second 3.5 MB is refused at upload,
		// since the composer names the conversation once it has one.
		uploads = uploadAnswers(page)
		await attach(page, [bulkyText('bulky-1.txt')])
		await storedFiles(page, uploads, 1)
		await send(page, 'files bulky')
		await expect(answers(page).last().getByText('text files bulky', { exact: true })).toBeVisible()
		await attach(page, [bulkyText('bulky-2.txt')])
		await expect(composerCard(page, 'bulky-2.txt')).toContainText(
			'This conversation already holds 6 MB of files',
		)
	})

	test('the upload route refuses each bad file with its code and stores none of them', async ({
		page,
	}) => {
		const upload = (appId: string, file: TestFile) =>
			page.request.post(`/api/apps/${appId}/attachments`, { multipart: { file } })
		// Spec §8 and plan call P4: the envelope's code for each refusal; the browser's pre-check is a convenience only.
		const cases: [TestFile, number, string][] = [
			[oversizedFile(), 413, 'attachment_too_large'],
			[svgFile(), 415, 'attachment_type_not_allowed'],
			[await pngAsPdf(), 400, 'attachment_invalid'],
			[windows1256Csv(), 400, 'attachment_encoding'],
			[blankPdf(), 400, 'attachment_no_text'],
		]
		for (const [file, status, code] of cases) {
			const response = await upload(AGUI_APP.id, file)
			expect(response.status(), file.name).toBe(status)
			expect(await response.json()).toMatchObject({ code, status })
		}
		expect(await unsentCount()).toBe(0)
		// The native app takes no image (415), and stores a PDF without text, whose pages the model reads (P6).
		const image = await upload(AGUI_NATIVE_APP.id, await pngFile())
		expect(image.status()).toBe(415)
		expect(await image.json()).toMatchObject({ code: 'attachment_type_not_allowed' })
		const scan = await upload(AGUI_NATIVE_APP.id, blankPdf())
		expect(scan.status()).toBe(201)
		expect(await scan.json()).toMatchObject({ kind: 'document', name: 'blank.pdf' })
	})

	test('removing an uploaded card deletes its file', async ({ page }) => {
		const uploads = uploadAnswers(page)
		await attach(page, [notesText()])
		const { id } = (await storedFiles(page, uploads, 1)).get('notes.txt')!
		// Plan call P22: the composer calls the delete route for a stored file it drops.
		const deleted = page.waitForResponse(
			response =>
				response.request().method() === 'DELETE' &&
				new URL(response.url()).pathname === `/api/apps/${AGUI_APP.id}/attachments/${id}`,
		)
		await composerCard(page, 'notes.txt').getByRole('img', { name: 'close-circle' }).click()
		expect((await deleted).status()).toBe(204)
		await expect(composerCard(page, 'notes.txt')).toHaveCount(0)
		const left = await withDb(async db => {
			const { rows } = await db.query('SELECT id FROM conversation_attachments WHERE id = $1', [id])
			return rows.length
		})
		expect(left).toBe(0)
	})

	test('after a reload the user’s turn shows its files, the image opens in the preview and a file downloads', async ({
		page,
	}) => {
		const uploads = uploadAnswers(page)
		const photo = await pngFile()
		await attach(page, [photo, notesText()])
		const stored = await storedFiles(page, uploads, 2)
		await send(page, 'files to keep')
		await expect(
			answers(page).last().getByText('text files to keep', { exact: true }),
		).toBeVisible()
		// Without ?isNewCvst the page opens the newest conversation: this one (spec §4.2); history carries the files (P15).
		await page.goto(`/chat/${AGUI_APP.id}`)
		const question = questions(page).last()
		await expect(question.getByText('files to keep', { exact: true })).toBeVisible()
		const image = question.getByRole('img', { name: photo.name })
		// The thumbnail loads from the serve route (P14), never from a URL of the agent's.
		await expect(image).toHaveAttribute(
			'src',
			new RegExp(`/api/apps/${AGUI_APP.id}/attachments/${stored.get(photo.name)!.id}$`),
		)
		await expect
			.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth))
			.toBeGreaterThan(0)
		await image.click()
		const preview = page.locator('.ant-image-preview')
		await expect(preview).toBeVisible()
		// The preview fades in; an Escape during that motion can leave it stuck (e2e/chat-files.spec.ts).
		await expect(preview).not.toHaveClass(/-fade-appear/)
		await page.keyboard.press('Escape')
		await expect(preview).toBeHidden()
		// A file that is not an image is a card that downloads it under its own name.
		const download = page.waitForEvent('download')
		await question.getByText('notes.txt', { exact: true }).click()
		expect((await download).suggestedFilename()).toBe('notes.txt')
	})

	test('an app that takes PDFs natively sends a document part, and refuses an image', async ({
		page,
	}) => {
		await page.goto(`/chat/${AGUI_NATIVE_APP.id}?isNewCvst=1`)
		await expect(senderBox(page)).toBeEnabled()
		// The picker offers the kinds the app takes now (acceptOf): PDFs and text files, no image.
		await expect(page.locator('.ant-sender input[type="file"]').first()).toHaveAttribute(
			'accept',
			'.pdf,.txt,.md,.csv',
		)
		const uploads = uploadAnswers(page)
		const pdf = textPdf()
		await attach(page, [pdf])
		await storedFiles(page, uploads, 1)
		await send(page, 'files native')
		// Spec §7.1: in `native` mode the PDF goes as a `document` part with its own bytes.
		await expectEcho(answers(page).last(), [
			'text files native',
			`document application/pdf ${pdf.buffer.length}`,
		])
		await attach(page, [await pngFile()])
		await expect(page.getByText('Unsupported file type: png', { exact: true })).toBeVisible()
		await expect(composerCards(page)).toHaveCount(0)
	})
})
```

- [ ] **Step 3: Write the Logs spec**

Create `e2e/agui-logs.spec.ts`:

```ts
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

import { ADMIN_STATE, AGUI_APP, APP_IDS } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { e2eEnv } from './fixtures/env'
import { pngFile, type TestFile } from './fixtures/files'
import { waitForHydration } from './fixtures/hydration'
import { deleteUsersLike, seedUser, signInAs } from './fixtures/users'

/*
 * Part 2 spec §7.2 and §12 (2c "done when": "admins read conversations in the Logs, every view is in the access log")
 * against the stub AG-UI producer (ADR-0010): the apps table's "Logs" action, the list of an app's conversations with
 * its filters and numbered pages in the URL (plan calls P16, P17, P20), the read-only transcript drawer and its audit
 * (P18, P14), the owner's access log (P19), and the admin gates (ADR-0024). `beforeAll` makes the data once per
 * project: the owner's conversations through the runs route (spec §4.2) for the pages, the `failed` tag and a soft
 * delete, then a user's conversation with an image, made in the browser as that user (Task 18's `files` echo answers
 * it), the newest, so it leads the first page.
 */

const PASSWORD = 'logs-pass-1'
const LOGS_PATH = `/app-management/${AGUI_APP.id}/logs`
/** More than one page of ten (antd's default size, P16), with the user's and the failed conversation. */
const FILLERS = 11

/** The project's accounts and texts: rows survive between runs, so each carries the project's name. */
const tagOf = (project: string) => `logs-${project}`
const userEmailOf = (project: string) => `${tagOf(project)}-user@e2e.local`
const adminEmailOf = (project: string) => `${tagOf(project)}-admin@e2e.local`
const userTitleOf = (project: string) => `files from ${tagOf(project)}`

/** What beforeAll made, for the tests and for afterAll. */
let made: {
	userId: string
	userConversationId: string
	attachmentId: string
	failedTitle: string
	deletedTitle: string
	ownerConversationIds: string[]
}

/** A fresh context signed in with a seeded account (e2e/admin-apps.spec.ts's expectGalleryShows). */
const signedInPage = async (browser: Browser, email: string) => {
	const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
	const page = await context.newPage()
	await signInAs(page, email, PASSWORD)
	return page
}

/** Picks files in the composer's panel (e2e/agui-files.spec.ts's `attach`). */
const attach = async (page: Page, files: TestFile[]) => {
	const uploadHint = page.getByText('Click or drag a file here to upload')
	await expect(async () => {
		if (!(await uploadHint.isVisible()))
			await page
				.getByRole('button', { name: 'Attach files', exact: true })
				.click({ timeout: 2_000 })
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser', { timeout: 2_000 }),
			uploadHint.click({ timeout: 2_000 }),
		])
		await chooser.setFiles(files)
	}).toPass({ timeout: 30_000 })
}

/** The conversation ids of an account's conversations in the stub app with this title. */
const conversationIdsTitled = (title: string) =>
	withDb(async db => {
		const { rows } = await db.query<{ id: string }>(
			'SELECT id FROM conversations WHERE app_id = $1 AND title = $2',
			[AGUI_APP.id, title],
		)
		return rows.map(row => row.id)
	})

/** A body row of the conversations' table, by its title; the row of the access log, by what it holds. */
const rowTitled = (scope: Page | Locator, title: string) =>
	scope.getByRole('row').filter({ hasText: title })
/** A row's cell under the column whose header reads `header` (antd Table: one header row, then the body rows). */
const cellOf = async (scope: Page | Locator, row: Locator, header: string) => {
	const headers = await scope.getByRole('columnheader').allInnerTexts()
	return row.getByRole('cell').nth(headers.findIndex(text => text.trim() === header))
}
/** The Logs page once its table has hydrated: ClientDateTime's date fills in only then (e2e/fixtures/hydration.ts). */
const openLogs = async (page: Page, search = '') => {
	await page.goto(`${LOGS_PATH}${search}`)
	await waitForHydration(page.locator('main time').first())
}

test.describe('the Logs of an AG-UI app', () => {
	test.beforeAll(async ({ browser }, testInfo) => {
		const project = testInfo.project.name
		const userId = await seedUser({
			email: userEmailOf(project),
			password: PASSWORD,
			name: 'Logs user',
		})
		await seedUser({
			email: adminEmailOf(project),
			password: PASSWORD,
			name: 'Logs admin',
			role: 'admin',
		})

		// The owner's conversations through the runs route (spec §4.2: a message without a conversation starts one). The
		// stub's `error <code>` scenario fails its run (P17's `failed`); one more is deleted by its user (spec §3.4).
		const owner = await browser.newContext({ storageState: ADMIN_STATE })
		const run = async (text: string) => {
			const response = await owner.request.post(`/api/apps/${AGUI_APP.id}/runs`, {
				data: { message: { text } },
			})
			expect(response.status()).toBe(200)
			// The stream ends with the run (spec §4.4).
			await response.body()
			return conversationIdsTitled(text)
		}
		const failedTitle = `error agent_error ${tagOf(project)}`
		const deletedTitle = `logs deleted ${tagOf(project)}`
		const ownerConversationIds: string[] = []
		for (let n = 1; n <= FILLERS; n++)
			ownerConversationIds.push(...(await run(`logs filler ${n} ${tagOf(project)}`)))
		ownerConversationIds.push(...(await run(failedTitle)), ...(await run(deletedTitle)))
		await owner.close()
		await withDb(db =>
			db.query('UPDATE conversations SET deleted_at = now() WHERE app_id = $1 AND title = $2', [
				AGUI_APP.id,
				deletedTitle,
			]),
		)

		// The user's conversation, with an image, in the user's own chat (spec §7.1). Made last, so it is the newest and
		// leads the first page (P16: `updated_at DESC`), above the owner's eleven fillers.
		const userPage = await signedInPage(browser, userEmailOf(project))
		await userPage.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
		await expect(userPage.getByPlaceholder('Type a message')).toBeEnabled()
		const uploaded = userPage.waitForResponse(
			response =>
				response.request().method() === 'POST' &&
				new URL(response.url()).pathname === `/api/apps/${AGUI_APP.id}/attachments`,
		)
		await attach(userPage, [await pngFile()])
		expect((await uploaded).status()).toBe(201)
		// The card has its answer (a send waits while a file uploads, plan call P13).
		await expect(userPage.getByText('Uploading...', { exact: true })).toHaveCount(0)
		await userPage.getByPlaceholder('Type a message').fill(userTitleOf(project))
		await userPage.keyboard.press('Enter')
		await expect(userPage.getByText(`text ${userTitleOf(project)}`, { exact: true })).toBeVisible()
		await userPage.context().close()
		const [userConversation] = await withDb(async db => {
			const { rows } = await db.query<{ id: string; attachment: string }>(
				'SELECT c.id, a.id AS attachment FROM conversations c JOIN conversation_attachments a ON a.conversation_id = c.id WHERE c.user_id = $1',
				[userId],
			)
			return rows
		})
		made = {
			userId,
			userConversationId: userConversation!.id,
			attachmentId: userConversation!.attachment,
			failedTitle,
			deletedTitle,
			ownerConversationIds,
		}
	})

	// The accounts go with their conversations and files (ON DELETE CASCADE); the owner's conversations by id. The access
	// log keeps its rows (spec §7.2: no foreign keys, never purged in Part 2).
	test.afterAll(async () => {
		await deleteUsersLike(`${tagOf(test.info().project.name)}-%`)
		if (made)
			await withDb(db =>
				db.query('DELETE FROM conversations WHERE id = ANY($1::uuid[])', [
					made.ownerConversationIds,
				]),
			)
	})

	test('the apps table offers Logs on an AG-UI app, and not on a Dify app', async ({ page }) => {
		const moreOf = (id: string) =>
			page.locator(`tr[data-row-key="${id}"]`).getByRole('button', { name: 'More actions' })
		/** Opens a row's menu; a click before hydration opens nothing, so it is retried (e2e/agui-admin.spec.ts). */
		const openMenu = async (id: string) => {
			const userView = page.getByRole('menuitem', { name: 'User view' })
			await expect(async () => {
				if (!(await userView.isVisible())) await moreOf(id).click()
				await expect(userView).toBeVisible({ timeout: 2_000 })
			}).toPass()
		}
		const search = page.getByRole('textbox', { name: 'Search apps' })
		// P20: a provider that keeps no history on the hub has no Logs (the search keeps the row on the first page).
		await page.goto('/app-management')
		await search.fill('Stub chatflow')
		await openMenu(APP_IDS['advanced-chat'])
		await expect(page.getByRole('menuitem', { name: 'Logs' })).toHaveCount(0)

		await page.goto('/app-management')
		await search.fill(AGUI_APP.name)
		await openMenu(AGUI_APP.id)
		// The Logs open in the same tab.
		await page.getByRole('menuitem', { name: 'Logs' }).click()
		await expect(page).toHaveURL(new RegExp(`${LOGS_PATH}$`))
		await expect(page.getByRole('heading', { name: AGUI_APP.name })).toBeVisible()
	})

	test('the list shows another user’s conversation with its figures, and its filters and pages are in the URL', async ({
		page,
		isMobile,
	}, testInfo) => {
		const project = testInfo.project.name
		await openLogs(page)
		await expect(page.getByText(/^Total conversations: \d+$/)).toBeVisible()
		const userRow = rowTitled(page, userTitleOf(project))
		await expect(userRow).toContainText('Logs user')
		await expect(userRow).toContainText(userEmailOf(project))
		// P17: its user message and the agent's answer.
		await expect(await cellOf(page, userRow, 'Messages')).toHaveText('2')

		// P16: each filter is a navigation to the URL that holds it, and starts again at page 1.
		await page.getByRole('combobox', { name: 'User' }).fill(userEmailOf(project))
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(new RegExp(`[?&]user=${made.userId}(&|$)`))
		await expect(userRow).toBeVisible()
		await expect(rowTitled(page, `logs filler 1 ${tagOf(project)}`)).toHaveCount(0)

		await openLogs(page)
		await page.getByRole('combobox', { name: 'Status' }).click()
		await page.getByTitle('Failed', { exact: true }).click()
		await expect(page).toHaveURL(/[?&]status=failed(&|$)/)
		const failedRow = rowTitled(page, made.failedTitle)
		await expect(failedRow).toBeVisible()
		await expect(failedRow.getByText('Failed', { exact: true })).toBeVisible()
		await expect(userRow).toHaveCount(0)

		await openLogs(page)
		const deletedRow = rowTitled(page, made.deletedTitle)
		await expect(deletedRow).toHaveCount(0)
		await page.getByRole('switch', { name: 'Include deleted' }).click()
		await expect(page).toHaveURL(/[?&]deleted=1(&|$)/)
		// P17: the tag says when the purge takes it (deleted_at + 30 days).
		await expect(deletedRow).toContainText('Deleted by the user, purged on')

		// The last activity's days: today's cell twice in the RangePicker's panel (antd marks each cell with its date).
		await openLogs(page)
		const now = new Date()
		const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
			.map(part => String(part).padStart(2, '0'))
			.join('-')
		await page.getByPlaceholder('Start date').click()
		const todayCell = page.locator(
			`.ant-picker-dropdown .ant-picker-cell-in-view[title="${today}"]`,
		)
		await todayCell.click()
		await todayCell.click()
		await expect(page).toHaveURL(/[?&]from=[^&]+/)
		await expect(page).toHaveURL(/[?&]to=[^&]+/)
		await expect(userRow).toBeVisible()

		// Numbered pages (decision 69 (5)): page 2 is in the URL, and a new size goes back to page 1.
		await openLogs(page)
		const pager = page.locator('.ant-table-pagination')
		await pager.getByTitle('2', { exact: true }).click()
		await expect(page).toHaveURL(/[?&]page=2(&|$)/)
		await expect(pager.locator('.ant-pagination-item-active')).toHaveText('2')
		// antd hides the size changer below screenSM (e2e/admin-apps.spec.ts).
		if (!isMobile) {
			await pager.locator('.ant-pagination-options-size-changer').click()
			await page.getByTitle('20 / page', { exact: true }).click()
			await expect(page).toHaveURL(/[?&]pageSize=20(&|$)/)
			await expect(page).not.toHaveURL(/[?&]page=/)
		}
	})

	test('View opens the transcript read-only with its image, runs and state, and the owner’s access log lists it', async ({
		page,
	}, testInfo) => {
		const project = testInfo.project.name
		await openLogs(page)
		await rowTitled(page, userTitleOf(project)).getByRole('button', { name: 'View' }).click()
		// P18: an antd Drawer, titled with the conversation's title once it has loaded.
		const drawer = page.getByRole('dialog').filter({ hasText: userTitleOf(project) })
		await expect(drawer).toBeVisible()
		await expect(drawer).toContainText(userEmailOf(project))
		// The transcript: the user's turn with its image from the serve route (P14), and the agent's echo. Read-only: no
		// Sender.
		const image = drawer.getByRole('img', { name: 'photo.png' })
		await expect(image).toBeVisible()
		await expect
			.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth))
			.toBeGreaterThan(0)
		await expect(drawer.getByText(`text ${userTitleOf(project)}`, { exact: true })).toBeVisible()
		await expect(drawer.getByPlaceholder('Type a message')).toHaveCount(0)
		await drawer.getByRole('tab', { name: 'Runs' }).click()
		await expect(drawer.getByText('Succeeded', { exact: true })).toBeVisible()
		await drawer.getByRole('tab', { name: 'State' }).click()
		// The stub set no state: the conversation's `{}` (spec §3.1), as indented JSON.
		await expect(drawer.getByRole('tabpanel', { name: 'State' })).toContainText('{}')

		// Spec §7.2, decision 69 (4) and 70 (5): the view and the thumbnail's fetch are rows naming the owner, the
		// conversation and, for the download, the file. At least one each: the thumbnail is served `no-store` (P14), so
		// the browser may fetch it again, and every fetch is a row.
		const rows = await withDb(async db => {
			const { rows: logged } = await db.query<{ action: string; attachment_id: string | null }>(
				'SELECT l.action, l.attachment_id FROM conversation_access_log l JOIN users u ON u.id = l.actor_id WHERE l.conversation_id = $1 AND lower(u.email) = lower($2)',
				[made.userConversationId, e2eEnv.E2E_ADMIN_EMAIL],
			)
			return logged
		})
		expect(rows.filter(row => row.action === 'view').length).toBeGreaterThanOrEqual(1)
		expect(rows.filter(row => row.action === 'download').length).toBeGreaterThanOrEqual(1)
		expect(
			rows.every(row => row.action === 'view' || row.attachment_id === made.attachmentId),
		).toBe(true)

		await page.keyboard.press('Escape')
		await expect(drawer).toBeHidden()
		await page.getByRole('tab', { name: 'Access log' }).click()
		await expect(page).toHaveURL(/[?&]tab=access(&|$)/)
		// Newest first (P19): this test's rows lead the first page.
		const access = page.getByRole('tabpanel', { name: 'Access log' })
		const logged = access.getByRole('row').filter({ hasText: userTitleOf(project) })
		await expect(
			logged.filter({ has: page.getByText('View', { exact: true }) }).first(),
		).toContainText(e2eEnv.E2E_ADMIN_EMAIL)
		await expect(
			logged.filter({ has: page.getByText('Download', { exact: true }) }).first(),
		).toContainText('photo.png')
	})

	test('an admin reads the conversations, without the access log', async ({
		browser,
	}, testInfo) => {
		const project = testInfo.project.name
		const page = await signedInPage(browser, adminEmailOf(project))
		try {
			await openLogs(page)
			await expect(page.getByRole('tab', { name: 'Conversations' })).toBeVisible()
			await expect(rowTitled(page, userTitleOf(project))).toBeVisible()
			// P19: the tab is the owner's; its URL shows an admin the conversations.
			await expect(page.getByRole('tab', { name: 'Access log' })).toHaveCount(0)
			await openLogs(page, '?tab=access')
			await expect(page.getByRole('tab', { name: 'Access log' })).toHaveCount(0)
			await expect(rowTitled(page, userTitleOf(project))).toBeVisible()
		} finally {
			await page.context().close()
		}
	})

	test('a user is sent to /apps, and the logs route refuses them', async ({
		browser,
	}, testInfo) => {
		const page = await signedInPage(browser, userEmailOf(testInfo.project.name))
		try {
			// ADR-0024: the (admin) layout sends a user away; the route checks the role itself (403 forbidden).
			await page.goto(LOGS_PATH)
			await expect(page).toHaveURL(/\/apps$/)
			const response = await page.request.get(
				`/api/apps/${AGUI_APP.id}/logs/${made.userConversationId}`,
			)
			expect(response.status()).toBe(403)
			expect(await response.json()).toMatchObject({ code: 'forbidden', status: 403 })
		} finally {
			await page.context().close()
		}
	})
})
```

- [ ] **Step 4: The admin's Attachments section**

In `e2e/agui-admin.spec.ts`, find the end of the file (the "Ask the user" test's end and the describe's):

```ts
			await expect(page.getByRole('group', { name: 'Question 1 of 2' })).toBeVisible()
			await expect(stopButton(page)).toHaveCount(0)
		} finally {
			await dropApp(id)
		}
	})
})
```

and replace it with:

```ts
			await expect(page.getByRole('group', { name: 'Question 1 of 2' })).toBeVisible()
			await expect(stopButton(page)).toHaveCount(0)
		} finally {
			await dropApp(id)
		}
	})

	// Part 2 spec §2.2 and §7.1, 2c's plan calls P1 and P2: the Attachments section opens on the defaults, saves into the
	// settings, and the chat's file picker follows the kinds the app takes as it is now.
	test('the Attachments section saves the kinds of file and the largest image edge, and the chat follows them', async ({
		page,
	}, testInfo) => {
		const id = ownId(420, testInfo)
		await seedAguiApp(id, `AG-UI files ${testInfo.project.name}`)
		// The composer's file input (X Attachments in the Sender's header, rendered while closed): its `accept` lists the
		// extensions of the kinds the app takes (Task 1's acceptOf).
		const picker = page.locator('.ant-sender input[type="file"]').first()
		try {
			await page.goto(`/chat/${id}?isNewCvst=1`)
			await expect(senderBox(page)).toBeEnabled()
			await expect(picker).toHaveAttribute('accept', '.pdf,.txt,.md,.csv')

			await page.goto('/app-management')
			const edit = page.getByRole('dialog').filter({ hasText: 'Edit app configuration' })
			await openDrawer(rowById(page, id).getByRole('button', { name: 'Edit' }), edit)
			const images = edit.getByRole('switch', { name: 'Images' })
			const asPdf = edit.getByRole('radio', { name: 'As PDF' })
			const edge = edit.getByLabel('Largest image edge')
			// The seeded document has no `attachments`: spec §2.2's defaults (images off, PDFs as text, the size kept).
			await expect(images).not.toBeChecked()
			await expect(edit.getByRole('radio', { name: 'As text' })).toBeChecked()
			await expect(edge).toHaveValue('')
			await expect(edge).toHaveAttribute('placeholder', 'Keep the size')
			await images.click()
			// antd draws a button-style radio's <input> at 0×0, so the visible label is clicked (e2e/admin-users.spec.ts).
			await edit.getByText('As PDF', { exact: true }).click()
			await expect(asPdf).toBeChecked()
			await edge.fill('1024')
			await edit.getByRole('button', { name: 'Update' }).click()
			await expect(edit).toBeHidden()
			const settings = await withDb(async db => {
				const { rows } = await db.query<{ settings: Record<string, unknown> }>(
					'SELECT settings FROM apps WHERE id = $1',
					[id],
				)
				return rows[0]?.settings
			})
			expect(settings).toMatchObject({
				attachments: { images: true, documents: 'native', maxImageEdge: 1024 },
			})
			// The drawer opens on what was saved.
			await openDrawer(rowById(page, id).getByRole('button', { name: 'Edit' }), edit)
			await expect(images).toBeChecked()
			await expect(asPdf).toBeChecked()
			await expect(edge).toHaveValue('1024')

			// P1: the chat reads the settings as they are now, so its picker offers images too.
			await page.goto(`/chat/${id}?isNewCvst=1`)
			await expect(senderBox(page)).toBeEnabled()
			await expect(picker).toHaveAttribute('accept', '.png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv')
		} finally {
			await dropApp(id)
		}
	})
})
```

`ownId(420, …)` gives ids ending `…421`–`…423`, apart from the edit test's `…401`–`…403` and the ask test's `…411`–`…413`. `seedAguiApp` writes no `attachments`, which Task 2's zod default reads as images off, PDFs as text and no largest edge; the app goes with `dropApp` (its conversations and attachments by ON DELETE CASCADE).

- [ ] **Step 5: The screenshots**

In `e2e/screenshots.spec.ts`, replace

```ts
import { AGUI_APP, APP_ID, APP_IDS } from './fixtures/constants'
import { waitForHydration } from './fixtures/hydration'
```

with

```ts
import { AGUI_APP, APP_ID, APP_IDS } from './fixtures/constants'
import { longText, pngFile, textPdf } from './fixtures/files'
import { waitForHydration } from './fixtures/hydration'
```

After

```ts
/** The run button of the workflow and completion views; antd adds a loading icon to its name while a run streams. */
const runButton = (page: Page) => page.getByRole('button', { name: 'Run' })
```

insert (a blank line before it):

```ts
/** The conversation the Logs shots show: the stub's `files` echo of an image, by its title. */
const LOGS_SHOT_TITLE = 'files for the Logs'
/**
 * Part 2c (spec §7.2): a conversation with an image in the stub AG-UI app, made through the upload and runs routes (spec
 * §4.2, §7.1), so the Logs shots do not depend on what ran before (the seed empties the app's conversations per run).
 */
async function logsConversation(page: Page) {
	const upload = await page.request.post(`/api/apps/${AGUI_APP.id}/attachments`, {
		multipart: { file: await pngFile() },
	})
	expect(upload.status()).toBe(201)
	const { id } = (await upload.json()) as { id: string }
	const run = await page.request.post(`/api/apps/${AGUI_APP.id}/runs`, {
		data: { message: { text: LOGS_SHOT_TITLE, attachmentIds: [id] } },
	})
	expect(run.status()).toBe(200)
	// The stream ends with the run (spec §4.4).
	await run.body()
}

/** The Logs page with that conversation, hydrated: its table's dates fill in only then (e2e/fixtures/hydration.ts). */
async function openLogsShot(page: Page) {
	await logsConversation(page)
	await page.reload()
	await noSpinner(page)
	await expect(header(page)).toBeVisible()
	await waitForHydration(page.locator('main time').first())
	await expect(page.getByRole('row').filter({ hasText: LOGS_SHOT_TITLE }).first()).toBeVisible()
}
```

Then, after the `chat-agui-plan` entry of `signedInPages`, replace

```ts
			await expect(page.getByText('Review the draft', { exact: true })).toBeVisible()
		},
	},
}
```

with

```ts
			await expect(page.getByText('Review the draft', { exact: true })).toBeVisible()
		},
	},
	// Part 2c (spec §7.1): the composer with an image, a PDF and a long text file, whose card says it is cut (plan call P6).
	'chat-agui-files': {
		path: `/chat/${AGUI_APP.id}?isNewCvst=1`,
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await expect(senderBox(page)).toBeEnabled()
			const uploadHint = page.getByText('Click or drag a file here to upload')
			const files = [await pngFile(), textPdf(), longText()]
			// A click before hydration opens nothing, so the chooser and its click are retried (e2e/fixtures/branding.ts).
			await expect(async () => {
				if (!(await uploadHint.isVisible()))
					await page
						.getByRole('button', { name: 'Attach files', exact: true })
						.click({ timeout: 2_000 })
				const [chooser] = await Promise.all([
					page.waitForEvent('filechooser', { timeout: 2_000 }),
					uploadHint.click({ timeout: 2_000 }),
				])
				await chooser.setFiles(files)
			}).toPass({ timeout: 30_000 })
			await expect(page.locator('.ant-sender .ant-file-card-list-item')).toHaveCount(files.length)
			await expect(page.getByText('Uploading...', { exact: true })).toHaveCount(0)
			await expect(page.getByText('Only the first 100,000 characters are sent')).toBeVisible()
		},
	},
	// Spec §7.2: an AG-UI app's Logs, the conversations tab with its filters and numbered pages.
	'admin-logs': {
		path: `/app-management/${AGUI_APP.id}/logs`,
		ready: openLogsShot,
	},
	// Spec §7.2, plan call P18: the transcript drawer on that conversation, its image loaded from the serve route.
	'admin-logs-drawer': {
		path: `/app-management/${AGUI_APP.id}/logs`,
		ready: async page => {
			await openLogsShot(page)
			await page
				.getByRole('row')
				.filter({ hasText: LOGS_SHOT_TITLE })
				.first()
				.getByRole('button', { name: 'View' })
				.click()
			const drawer = page.getByRole('dialog').filter({ hasText: LOGS_SHOT_TITLE })
			await expect(drawer.getByRole('tab', { name: 'Transcript' })).toBeVisible()
			await expect(drawer.getByText(`text ${LOGS_SHOT_TITLE}`, { exact: true })).toBeVisible()
			await imagesLoaded(drawer.getByRole('img', { name: 'photo.png' }))
		},
	},
}
```

`logsConversation` makes its own conversation through the upload and runs routes, so the Logs shots hold a row with an image whether or not the specs ran first (the seed empties the app's conversations on every run); `imagesLoaded` is the function declared further down the file (hoisted).

- [ ] **Step 6: Gates on the four files**

Run:

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint e2e/agui-files.spec.ts e2e/agui-logs.spec.ts e2e/agui-admin.spec.ts e2e/screenshots.spec.ts
pnpm exec oxfmt --check e2e/agui-files.spec.ts e2e/agui-logs.spec.ts e2e/agui-admin.spec.ts e2e/screenshots.spec.ts
pnpm exec playwright test --list e2e/agui-files.spec.ts e2e/agui-logs.spec.ts e2e/agui-admin.spec.ts
pnpm exec playwright test --list e2e/screenshots.spec.ts -g "chat-agui-files|admin-logs"
```

Expected: tsc exits 0; oxlint reports nothing; oxfmt "All matched files use the correct format."; the first list ends `Total: 58 tests in 4 files`, the second `Total: 10 tests in 2 files` (the `setup` project's one and the three shots per project).

- [ ] **Step 7: Run the specs on the three projects**

Stop `pnpm dev` first (one `next dev` per checkout), and make sure `pnpm test:db` is not running (both use 127.0.0.1:5433).

Run: `pnpm test:e2e e2e/agui-files.spec.ts e2e/agui-logs.spec.ts e2e/agui-admin.spec.ts` Expected: `58 passed`, no `failed` line. A failure is debugged with the trace (`pnpm test:e2e:report`) and superpowers-extended-cc:systematic-debugging, never by loosening an assertion: each one is a 2c "done when" item. If a locator of Step 1's table misses because the markup differs, fix the locator; if the behaviour differs (a file the agent does not get, a refusal that stores a row, a card that stays after a send, a filter that does not reach the URL, a view without its row, a gate that lets a user in), the bug is in Tasks 1–17 and is fixed there in its own commit.

Then the screenshots: `pnpm exec playwright test e2e/screenshots.spec.ts -g "chat-agui-files|admin-logs"` Expected: `10 passed`; look at the new `e2e/screenshots/chat-agui-files-*.png`, `admin-logs-*.png` and `admin-logs-drawer-*.png` (not committed) and keep them for the PR's review (frontend conventions §4.6). Then clear the stale route types an e2e run leaves (Global Constraints): `rm -rf .next/dev/types && pnpm exec next typegen`.

- [ ] **Step 8: Commit**

```bash
git add e2e/agui-files.spec.ts e2e/agui-logs.spec.ts e2e/agui-admin.spec.ts e2e/screenshots.spec.ts
git commit -m "test(e2e): attachments in the AG-UI chat, and the Logs

Part 2 spec §7 and §12 (2c) against the stub's files echo on three
projects: an image, a PDF and text files reach the agent as the app's
settings say; a file-only message; a cut text; the per-message and
per-conversation caps; each refusal on its card
or in the browser, and the route's codes; a removed file deleted; the
files after a reload; the native app's document part. The admin's
Attachments section. The Logs: the row action, the list with its filters
and numbered pages in the URL, the read-only transcript and its audit,
the owner's access log, the admin and user gates. Screenshots of the
composer with files, the Logs page and its drawer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["e2e/agui-files.spec.ts", "e2e/agui-logs.spec.ts", "e2e/agui-admin.spec.ts", "e2e/screenshots.spec.ts"], "verifyCommand": "pnpm test:e2e e2e/agui-files.spec.ts e2e/agui-logs.spec.ts e2e/agui-admin.spec.ts", "acceptanceCriteria": ["pnpm test:e2e e2e/agui-files.spec.ts e2e/agui-logs.spec.ts e2e/agui-admin.spec.ts passes on desktop-light, desktop-dark and mobile-light: 58 passed, 0 failed", "A JPEG, a text PDF, notes.txt and a UTF-16 CSV are stored with their detected types, the run body names their ids in attach order, the echo shows text files please, image image/jpeg <size>, the PDF's and the two text files' first and last lines in order, the composer empties and the user turn shows the image and three cards", "File-only: Send disabled with nothing attached and enabled with an image; Enter sends text '' with the id; the echo is only image image/png <size>; the title is ''", "long.txt is answered truncated: true, its card reads Only the first 100,000 characters are sent, and the echo ends with the truncation note", "Six files picked at once leave five cards and At most 5 files, the five reach the agent; in the same conversation a 3.5 MB file goes and a second one's card reads This conversation already holds 6 MB of files", "scan.pdf, cities-1256.csv and blank.pdf keep cards with their reasons; a send shows Remove the files that could not be uploaded and makes no run until they are removed; icon.svg and big.txt are refused in the browser with no card and no upload; the route answers 413/415/400/400/400 with the five codes and stores none; the native app answers 415 to a PNG and 201 to blank.pdf", "Removing an uploaded card sends DELETE answered 204 and the row is gone", "After a reload the user turn shows its text, the loaded image from /api/apps/<app>/attachments/<id> that opens in the preview, and a card that downloads notes.txt", "The native app's picker accepts .pdf,.txt,.md,.csv, its PDF reaches the agent as document application/pdf <bytes>, and a PNG is refused with Unsupported file type: png", "The admin's Attachments section opens on the defaults, saves images on, As PDF and 1024 into apps.settings.attachments, reopens on them, and the chat picker's accept gains the image extensions", "Logs: no Logs on a Dify app's menu, the AG-UI app's opens /app-management/<id>/logs; the list shows the user's conversation with 2 messages and the total; user, status, deleted and date filters and page 2 and pageSize=20 (desktops) reach the URL; View opens the read-only drawer with the email, the loaded image, the echo, Succeeded and {}; at least one view and one download row for the owner, listed on the Access log tab; an admin has no Access log tab even at ?tab=access; a user is sent to /apps and the logs route answers 403 forbidden", "pnpm exec playwright test e2e/screenshots.spec.ts -g 'chat-agui-files|admin-logs' writes the composer, Logs and drawer shots on the three projects", "tsc, oxlint and oxfmt clean on the four files; no other spec changed"], "modelTier": "standard", "userGate": true, "tags": ["user-gate"]}
```

---

### Task 20: Records — ADR-0037, the note on ADR-0030, the agent authors' guide, AGENTS.md, the spec and Part 2's progress

**Goal:** Every record spec §11 names for 2c is in the branch: ADR-0037 "Keep chat attachments and admin logs on the hub" (proposed; Task 21 asks the owner to accept it) with its index row, a dated note on ADR-0030 (the `chatImage` kind), `docs/agui-agents.md`'s attachment settings and its "Attachments" section, AGENTS.md's Layout, the spec's three changes from decisions 69 and 70 (§7, §8, §12) and its §0 2c row and Next line, and the running record's decision 72.

Spec §11 ("2c: **ADR-0037** 'Keep chat attachments and admin logs on the hub': `bytea`, the PDF library, the caps, the audit and the notice. A note on ADR-0030 (the `chatImage` kind). `docs/agui-agents.md`: attachment kinds"; "every slice: AGENTS.md's Layout, §0 of this spec, the running record"), spec §0's hand-off rules (decision 57). 2c adds a dependency (`pdfjs-dist`), a table pair and a pattern of the hub's own (the PDF worker thread), so ADR-0015 asks for a new record, which is ADR-0037; the adr-skill's conventions ("Add learnings: append to `## More Information` with a date stamp. Do not rewrite history") are why ADR-0030 gets a dated note at its end, in the `Note, <date> (…):` paragraph style it already uses. The notice of spec §7.2 is dropped and the Logs' keyset paging replaced (decision 69), so the spec's own text changes in this task, each change marked as the 2c plan's with its decision, because "Facts that are not in the repo yet are not facts" (spec §0). The running record's decisions 69 ("the owner's first answers"), 70 ("the answers after the research") and 71 ("2c's plan is written") come from this plan's PR, so the build writes 72 here and 73 in Task 21. `docs/frontend-conventions.md` needs no change: its §4.1 already names `components/shared-chat/` and `components/admin/`.

**Files:**

- Create: `docs/decisions/0037-keep-chat-attachments-and-admin-logs-on-the-hub.md`
- Modify: `docs/decisions/README.md` (the index row), `docs/decisions/0030-set-each-settings-area-from-the-environment-or-the-admin-page.md` (a dated note at the end)
- Modify: `docs/agui-agents.md` (the settings table's three attachment rows; "Each request"'s file sentence; a new section "Attachments" before "Ids and limits")
- Modify: `AGENTS.md` (Layout: the `app/`, `components/` and `lib/` bullets)
- Modify: `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` (§0: the 2c row and the Next line; §7: the decisions' changes; §8: four codes; §12: the 2c line)
- Modify: `docs/superpowers/research/2026-10-11-provider-hub/README.md` (decision 72)

**Acceptance Criteria:**

- [ ] `docs/decisions/0037-keep-chat-attachments-and-admin-logs-on-the-hub.md` exists with `status: proposed`, and `grep -c` in it for `bytea`, `pdfjs-dist`, `worker_threads`, `resourceLimits`, `ignoredOptionalDependencies`, `50,000,000`, `UTF-16`, `attachment_id`, `no-store`, `OFFSET`, `notice` → each ≥ 1; `docs/decisions/README.md` has its row (`grep -c '\[0037\]'` → `1`).
- [ ] `grep -c "^Note, $(date +%F) (Part 2c" docs/decisions/0030-*.md` → `1`, naming `chatImage` and `CHAT_IMAGE_MAX_PIXELS`.
- [ ] `docs/agui-agents.md` has `## Attachments` (`grep -c '^## Attachments$'` → `1`), no longer says `the hub sends no files yet` (→ `0`), and names `mimeType`, `[file `, `100,000` and `native` (each ≥ 1).
- [ ] `grep -c 'components/admin/logs' AGENTS.md` → `1`; `grep -c 'attachments' AGENTS.md` ≥ `1`; `wc -l < AGENTS.md` stays below `200`.
- [ ] Spec: §0's 2c row names this plan with the merged plan PR's number and `built: Tasks 1–19`; §7.2 no longer holds the notice bullet (`grep -c 'Admins can read conversations in this app' docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` → `0`); §8's table names `attachment_no_text`, `attachment_encoding`, `unsent_attachments_full` and `attachment_not_found` (each ≥ 1); §12's 2c line no longer says `users see the notice` (→ `0`); `grep -cE 'PLAN_PR|DEVIATIONS'` on the spec and the running record → `0` each; `grep -n '^72\. ' docs/superpowers/research/2026-10-11-provider-hub/README.md` finds one line with today's date.
- [ ] `pnpm exec oxfmt --check` on the seven changed Markdown files reports no findings.

**Verify:** `grep -c '^## Attachments$' docs/agui-agents.md && grep -c "(Part 2c" docs/decisions/0030-*.md && grep -c '^status: proposed' docs/decisions/0037-*.md && wc -l < AGENTS.md` → `1`, `1`, `1`, a number below 200

**Steps:**

- [ ] **Step 1: Read what the records describe**

Read, in this order: ADR-0030's last notes and ADR-0035 (the newest record's shape: frontmatter, "Context and Problem Statement", "Decision Drivers", "Considered Options", "Decision Outcome", "Consequences", "Implementation Plan", "Verification", "More Information"), `docs/agui-agents.md`, the `adr-skill` (invoke it with the Skill tool: its conventions for a new record and for appending dated learnings to an accepted one), `git log --format='%h %s%n%b' fork/overhaul..HEAD` (Tasks 1–19's commits with their bodies), and the files the records name. Where a task deviated from this plan (its commit message, a ruling of the session that ran it, or a review fix says so), the records describe what was built, and the deviation is named in Step 7's `DEVIATIONS` list; if a sentence below states something the build did differently, change it to what was built and name it there too.

- [ ] **Step 2: ADR-0037**

Create `docs/decisions/0037-keep-chat-attachments-and-admin-logs-on-the-hub.md` with (replace `TODAY` with `date +%F`):

```markdown
---
status: proposed
date: TODAY
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code sessions (Part 2c plan, its research, and its build, 2026-10-15)
---

# Keep chat attachments and admin logs on the hub

## Context and Problem Statement

Part 2 ([ADR-0033](0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md), [ADR-0034](0034-add-ag-ui-agents-as-a-provider.md)) keeps AG-UI conversations in the hub's own store. Its last slice, 2c, lets users attach images, PDFs and text files to a message, and lets admins read every conversation of an app (Part 2 spec §7; running record decisions 42, 48, 49, 53, 54). The owner's agents are Pydantic AI services on a Docker network: a model provider cannot fetch a hub URL, and Pydantic AI does not download one from a private address, so only bytes sent inline reach the model (`agui-spike.md`). Many self-hosted models read no images, and most refuse PDF `document` parts. Admins reading users' conversations is access to sensitive data that OWASP's Logging Cheat Sheet asks to log, and none of the reference hubs logs it (`part2-store-and-logs.md` §4.6).

## Decision Drivers

- Documented approaches only ([ADR-0002](0002-use-documented-library-approaches-only.md)); a pattern of the hub's own only with the owner's word, recorded with its gap.
- One store and one backup: no new service beside PostgreSQL ([ADR-0031](0031-move-the-database-to-postgresql-18.md)).
- What reaches the agent is what the app's model can read, decided per app.
- A file is proven by its bytes, never by what the browser says (OWASP File Upload Cheat Sheet).
- A crafted file must not stop the hub for everyone.
- Admins read, never write; every read is on record, and the owner can read the record.

## Considered Options

Where the bytes live: PostgreSQL `bytea` · a volume on the hub's container · S3-compatible storage (LobeHub's route).

How the agent gets them: inline base64 `data` sources · hub URLs (`url` sources) · provider file handles (`file` sources, which Pydantic AI 2.56 refuses with 422).

How a PDF becomes text: `pdfjs-dist` (Mozilla) · `unpdf` (unjs's wrapper of a pdf.js build); on the calling thread (LibreChat, LobeHub) · in a `worker_threads` Worker · in a child process.

How the Logs page through conversations: keyset ("Load more" or Newer/Older) · numbered pages with a total (offset).

How users learn that admins read: a line under the composer (spec §7.2 as written, after the UK ICO) · no notice in the chat.

## Decision Outcome

Chosen: `bytea`, inline base64, `pdfjs-dist` in a worker thread, numbered pages, and no notice in the chat: the owner's answers of decisions 48, 53, 54, 69 and 70, each after the docs, best practice and reference projects of `part2c-files-logs.md`.

### The files

- **Stored** in `conversation_attachments` as `bytea` (the hub's icons and brand images are stored the same way): the uploader, the app, the conversation and the AG-UI message once sent, the kind (`image`, `document`, `text`), the detected media type, the original name for display only, the stored size, the SHA-256, the bytes and the text the agent reads. A row is unsent until a run's transaction links it to the user message it stores.
- **Uploaded when picked** (`POST /api/apps/[appId]/attachments`): the extension claims the kind (`png jpg jpeg webp`, `pdf`, `txt md csv`) and the bytes must prove it: an image is what sharp decodes as PNG, JPEG or WebP; a PDF has `%PDF-` within its first 1,024 bytes and opens in pdf.js; a text file decodes as UTF-8, or as UTF-16 with its byte-order mark, and holds no NUL. Anything else is refused with its own code (`attachment_type_not_allowed`, `attachment_invalid`, `attachment_encoding`, `attachment_no_text`).
- **Limits:** 5 MB a file (answered from `Content-Length` before the body is read, under Next's 10 MB `proxyClientMaxBodySize`), 5 files a message, 6 MB of sent files a conversation (every run re-sends them all), 25 unsent files a user. Removing a card deletes its unsent file (`DELETE …/attachments/[attachmentId]`), and the daily purge removes files never sent after 24 hours.
- **Images** keep their size and format unless the app sets a largest edge; they are decoded within 50,000,000 pixels (default 24 MP and 48 MP phone photos pass; logos and icons keep [ADR-0030](0030-set-each-settings-area-from-the-environment-or-the-admin-page.md)'s 4096 × 4096), re-encoded with their metadata removed, JPEG and WebP at quality 90, and an animated WebP is refused.
- **Text** from a PDF or a text file is cut at 100,000 characters, with a note to the agent and on the file's card; a PDF without text is refused in `text` mode only.
- **To the agent**, every run: the user message's `content` becomes the text part (left out when blank), then one part per file: an `image` part with a `data` source, a PDF as a `document` part in the app's `native` mode, and otherwise a text part `[file <name>]` with the stored text. The app's settings at run time decide, and a file of a kind the app no longer takes is named, not sent. The stored message keeps its text; the bytes are joined only for the run, and the run session never writes a user message back.
- **Served back** (`GET …/attachments/[attachmentId]`) with the stored type, `nosniff`, a sandboxing CSP, `Cache-Control: private, no-store` (ASVS 5.0 14.3.2), inline only for an image.

### Reading PDFs in a worker thread

pdf.js's documented Node path (`pdfjs-dist/legacy/build/pdf.mjs`) runs on the calling thread, and no timer can interrupt it: the research measured a crafted 92 KB PDF stalling the event loop 3.9 s and a crafted 916 KB one crashing the process after about 56 s. So `extractPdfText` runs `lib/chat/pdf-text.worker.mjs` in a Node `worker_threads` Worker with `resourceLimits.maxOldGenerationSizeMb: 256` and terminates it after 10 seconds; a timeout, a heap overflow, a password or a broken file is `attachment_invalid`. Inside, `getDocument` gets the CMaps and standard fonts as absolute paths (without the CMaps, CJK text vanishes silently) and the text is read with `page.streamTextContent()`, stopping at 100,001 characters. The worker is a plain module started by path, `path.join(/* turbopackIgnore: true */ process.cwd(), 'lib/chat/pdf-text.worker.mjs')`, and shipped with pdf.js's files by `outputFileTracingIncludes`. Without the comment Turbopack 16.3.4 bundles a `worker_threads` worker into a chunk that breaks at run time; Next's docs describe `turbopackIgnore` only on `import()`, `require()` and `new Worker()` expressions, and this placement on the path is the one Next's own server code uses (`next-server.js`, `image-optimizer.js`). The owner accepted it as the one exception to [ADR-0002](0002-use-documented-library-approaches-only.md) ("Magic comment", decision 70); the plan's build check (its Task 7) fails if a Next upgrade changes it, and a workspace package in `serverExternalPackages`, the documented alternative, is bundled too under this repo's pnpm linking. `pdfjs-dist` is in `serverExternalPackages`, pinned exactly, and its optional native `@napi-rs/canvas` (31 MB, not needed for text) is skipped with pnpm's `ignoredOptionalDependencies`.

This is the hub's own pattern, not pdf.js's: a maintainer wrote "we only support standard Web Workers" (mozilla/pdf.js#21934). Its known gap: `resourceLimits` "only affect the JS engine, and no external data, including no ArrayBuffers" (Node docs), and the streams pdf.js inflates are such data (the research measured 985 MB from a crafted 916 KB file), so a crafted file can still push a small container over its memory limit; Docker then restarts it.

### The Logs and the access log

- **The page** (`/app-management/[appId]/logs`, owner and admin, on apps whose provider keeps its history) lists an app's conversations with numbered pages, a page-size changer, a jumper and the total, like the other admin tables: `LIMIT`/`OFFSET` with an exact `count(*)` on `(app_id, updated_at)`, as Dify, Langfuse, agenticos, Open WebUI and LibreChat page their admin lists. A conversation that moves while an admin pages may repeat or be skipped once. Filters (last activity, user, status, deleted) live in the URL; the open conversation does not.
- **The drawer** reads one transcript through `GET /api/apps/[appId]/logs/[conversationId]`, a Route Handler so a prefetch never writes a row, and renders it with the shared chat's own components, read-only, beside the runs and the final state.
- **The access log** (`conversation_access_log`, no foreign keys, so a row outlives the conversation, the app and the actor; never purged in Part 2) gets a `view` row when an admin opens a transcript and a `download` row, naming the attachment, for every fetch of an attachment by anyone but its uploader, thumbnails included: products audit fetches, not what was on screen (Google Workspace, Microsoft Purview, Nextcloud; `part2c-files-logs.md` R3). The owner reads the app's log in an "Access log" tab.
- **No notice in the chat** (the owner: "don't show it"). The spec's line under the composer, after the UK ICO's "must inform workers about any monitoring", is not built; informing users is left to the operator (the ICO's own example is the intranet or signage, and no reference product shows a built-in notice).

### Consequences

- Good, because one database holds everything: one backup, transactions across messages and their files, no new service.
- Good, because what reaches the agent is decided per app and per run, from bytes the hub proved, and the model never needs to reach the hub.
- Good, because a crafted PDF is refused instead of freezing or crashing the hub, within the gap above.
- Good, because every admin read is on record, which none of the reference hubs offers.
- Bad, because `bytea` grows the database and its backups with every file, and every run re-sends a conversation's files (the 6 MB cap bounds both); a volume or S3-compatible storage would need its own ADR.
- Bad, because a 5 MB image is about 6.7 MB as base64, over some providers' per-image limits (Bedrock, Vertex); `maxImageEdge` is the app's way to stay under them.
- Bad, because five files of 100,000 characters each are re-sent on every run, and the hub sets no token budget per request; the agent's model reports what it cannot take.
- Bad, because the PDF worker is a pattern of the hub's own, with the memory gap above, and `pdfjs-dist` must be bumped with each monthly release ("Only the latest release is supported").
- Neutral, because the Logs' offset paging departs from the spec's keyset: exact pages and a total, at the cost of a scan that grows with the page number.

## Implementation Plan

- **Dependencies**: `pdfjs-dist` 6.4.299, pinned (`package.json`); `@napi-rs/canvas` ignored (`pnpm-workspace.yaml`).
- **Affected paths**: `db/schema/attachments.ts` and its migration; `lib/chat/{attachment-rules,documents,uploads,attachment-parts,attachment-response,log-view}.ts`, `lib/chat/pdf-text.worker.mjs`; `lib/data/{attachments,access-log,logs}.ts`; `lib/settings/images.ts` (`chatImage`); `app/api/apps/[appId]/attachments/**`, `app/api/apps/[appId]/logs/[conversationId]/route.ts`, `app/(admin)/app-management/[appId]/logs/`; `components/shared-chat/` (the composer's files, the bubble's files), `components/admin/logs/`; `next.config.ts`.
- **Pattern**: a file is claimed by its extension and proven by its bytes; the run, not the stored message, carries the bytes; an admin read goes through a Route Handler that writes the access log first.
- **Avoid**: hub URLs or `file` sources toward an agent; pdf.js on a request's thread; trusting the browser's `Content-Type`; writing a user message from the run session; any admin write in a user's conversation.
- **Tests**: `__tests__/chat-attachment-rules.test.ts`, `chat-documents.test.ts`, `settings-chat-image.test.ts`, `chat-uploads.test.ts`, `chat-attachment-response.test.ts`, `chat-attachment-parts.test.ts`, `chat-log-view.test.ts`; `__tests__/db/attachments*.db.test.ts`, `logs.db.test.ts`; e2e `agui-files.spec.ts`, `agui-logs.spec.ts`.

### Verification

- [ ] An image, a PDF and a text file reach the stub agent as the app's settings say, live and on the next run (e2e `agui-files.spec.ts`).
- [ ] Each refusal answers its code before anything is stored (`chat-uploads.test.ts`).
- [ ] A PDF that inflates past the worker's limits is refused while the hub keeps answering (`chat-documents.test.ts`).
- [ ] The standalone build ships the worker and pdf.js's files, and the Docker image reads a PDF (Task 21's Docker gate).
- [ ] An admin's transcript and every attachment fetch write their rows, the owner reads them, and an admin does not see the tab (e2e `agui-logs.spec.ts`, `logs.db.test.ts`).
- [ ] `.next/static` holds no `pdfjs` or `pdf.worker`.

## More Information

- Part 2 spec `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` §7 (with the 2c plan's changes), §8, §9; plan `docs/superpowers/plans/2026-10-15-part-2c-agui-files-logs.md` (plan calls P1–P24); running record decisions 42, 48, 49, 53, 54, 69, 70.
- Research: `docs/superpowers/research/2026-10-11-provider-hub/part2c-files-logs.md` (R1 attachments, R2 documents and images with the measurements above, R3 the Logs), `part2-hitl-state-files.md` §4, `part2-store-and-logs.md` §4–§7.
- Docs: pdf.js `examples/node/` and `src/display/api.js` at v6.4.299; Node 22 "Worker threads" (`resourceLimits`, `terminate()`); Next 16 bundled docs (`serverExternalPackages`, `output.md`'s `outputFileTracingIncludes`, `proxyClientMaxBodySize`); sharp 0.35 (`limitInputPixels`, `autoOrient`, `pages`, `jpeg`/`webp` `quality`); WHATWG Encoding (`TextDecoder` `fatal`); OWASP File Upload and Logging cheat sheets; OWASP ASVS 5.0 14.3.2; RFC 6266 and RFC 8187; AG-UI 1.0 content parts.
- Reference projects (commits in the research): LibreChat, Open WebUI, LobeHub, assistant-ui, Vercel AI Elements and ai-chatbot, CopilotKit, the vstorm template, Dify, Langfuse, agenticos.
```

- [ ] **Step 3: The index row and the note on ADR-0030**

In `docs/decisions/README.md`, after the row that begins with `| [0036](0036-scroll-the-chats-with-use-stick-to-bottom.md)`, add:

```text
| [0037](0037-keep-chat-attachments-and-admin-logs-on-the-hub.md) | Keep chat attachments and admin logs on the hub | proposed | TODAY |
```

Append at the end of `docs/decisions/0030-set-each-settings-area-from-the-environment-or-the-admin-page.md`, after a blank line:

```markdown
Note, TODAY (Part 2c, [ADR-0037](0037-keep-chat-attachments-and-admin-logs-on-the-hub.md)): the image pipeline also takes chat attachments, as the kind `chatImage` (`processChatImage` in `lib/settings/images.ts`): PNG, JPEG or WebP up to 5 MB in (`ATTACHMENT_MAX_BYTES`), decoded within 50,000,000 pixels (`CHAT_IMAGE_MAX_PIXELS`, the owner's choice so that default phone photos pass; logos, favicons and app icons keep this record's 4096 × 4096), an animated WebP refused, and re-encoded in its own format at its own size unless the app sets a largest edge, JPEG and WebP at quality 90 and PNG with sharp's defaults, metadata removed as here. The other kinds behave as before.
```

Run `sed -i "s/TODAY/$(date +%F)/g" docs/decisions/0037-keep-chat-attachments-and-admin-logs-on-the-hub.md docs/decisions/README.md docs/decisions/0030-set-each-settings-area-from-the-environment-or-the-admin-page.md`.

- [ ] **Step 4: The agent authors' guide**

In `docs/agui-agents.md`, in "The app's settings", after the row that begins with `| Ask the user |`, add these three rows (a `text` block, so they are pasted as they are):

```text
| Images | Off by default. On, users may attach PNG, JPEG and WebP images, which reach your agent as `image` parts. Turn it on only if your model reads images. |
| Documents | Off, As text (the default) or As PDF. As text, the hub reads PDFs and text files and sends their text; As PDF, PDFs go as `document` parts, which most models refuse. |
| Largest image edge | Empty keeps an image's size; a number from 256 to 8192 shrinks larger images to fit that many pixels on their longer edge. |
```

In "Each request", replace the sentence `A user message is plain text of at most 32,000 characters; the hub sends no files yet.` with:

```markdown
A user message is text of at most 32,000 characters, or, when the user attached files, a list of content parts (see "Attachments").
```

Before the line `## Ids and limits`, add:

```markdown
## Attachments

A user message with files reaches your agent with `content` as a list: a `text` part with what the user typed (left out when they typed nothing), then one part per file in the order they attached them. Every run re-sends every file of the conversation, so your agent stays stateless.

| The file | The app's Documents setting | The part |
| --- | --- | --- |
| an image (PNG, JPEG, WebP) | any; Images must be on | `{ type: 'image', source: { type: 'data', value: <base64>, mimeType } }` |
| a PDF | As PDF | `{ type: 'document', source: { type: 'data', value: <base64>, mimeType: 'application/pdf' } }` |
| a PDF | As text | `{ type: 'text', text: '[file report.pdf]\n<its text>' }` |
| a text file (`.txt`, `.md`, `.csv`) | As text or As PDF | `{ type: 'text', text: '[file notes.csv]\n<its text>' }` |

- `mimeType` is AG-UI 1.0's name; Pydantic AI on `ag-ui-protocol` 0.1.22 reads it. The hub never sends a URL or a `file` source: your model provider could not fetch the hub, and Pydantic AI 2.56 refuses `file` sources with 422.
- A file's text is at most 100,000 characters; a longer one ends with `[truncated: only the first 100,000 characters of this file are included]`.
- Images keep their size unless the app sets a largest edge. A 5 MB image is about 6.7 MB as base64, more than some providers take per image (Bedrock and Vertex: 5 MB); set the largest edge for those.
- If an admin turns a kind off after users attached it, its files are no longer sent: a text part `[file <name> was not sent: this app no longer accepts this kind of file]` takes their place.
```

- [ ] **Step 5: AGENTS.md's Layout**

In `AGENTS.md`, replace `` `(admin)` (app, user and group management, settings) `` with `` `(admin)` (app, user and group management, an app's Logs, settings) ``.

In the `components/` bullet, replace `` `shared-chat/` (the AG-UI chat on the hub's store, with its approval, question, interrupt, plan and activity cards; ADR-0033, ADR-0034) `` with `` `shared-chat/` (the AG-UI chat on the hub's store, with its approval, question, interrupt, plan and activity cards and its attachments; ADR-0033 to ADR-0035, ADR-0037), `admin/logs/` (an app's Logs page, transcript drawer and access log; ADR-0037) ``.

In the `lib/` bullet, replace ``the client-safe rules the browser shares: `ask_user`, the interrupt answers, the plan state and the open items; ADR-0033, ADR-0034)`` with ``the attachments' upload, PDF worker and content parts, beside the client-safe rules the browser shares: `ask_user`, the interrupt answers, the plan state, the open items and the attachment rules; ADR-0033, ADR-0034, ADR-0037)``.

Check: `grep -c 'components/admin/logs\|admin/logs/' AGENTS.md && wc -l < AGENTS.md` → at least `1`, a number below 200.

- [ ] **Step 6: The spec's changes (decisions 69 and 70)**

In `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md`:

1. In §7.2, replace the whole bullet that begins with `- **Notice:** one line under the composer` with:

```markdown
- **No notice** (the 2c plan, decision 69: the owner, "don't show it"): nothing is shown in the chat; informing users is the operator's (ADR-0037).
```

2. In §7.2, in the bullet that begins with `- **Page**`, replace ``Keyset pagination on `(updated_at, id)` using `(app_id, updated_at)`.`` with ``Numbered pages with a page-size changer and the total, like the other admin tables (the 2c plan, decision 69): `LIMIT`/`OFFSET` and a `count(*)` on `(app_id, updated_at)`.``

3. At the end of §7 (before `## 8. Errors and i18n`), add:

```markdown
### 7.3 Changed by the 2c plan

Decisions 69 and 70 (the owner, 2026-10-15, after the plan's questions and its research `part2c-files-logs.md`) settle what §7.1 and §7.2 left open and change these points; ADR-0037 records them:

- **PDFs** are read with `pdfjs-dist` 6.4.299 in a `worker_threads` Worker with a 256 MB heap and a 10-second limit; long text is cut at 100,000 characters with a note, and a PDF without text is refused in `text` mode.
- **Text files** may be UTF-8 or UTF-16 with a byte-order mark; a NUL byte refuses them.
- **Images** are decoded within 50,000,000 pixels (not ADR-0030's 4096 × 4096); an animated WebP is refused; JPEG and WebP are re-encoded at quality 90.
- **Unsent files:** removing a card deletes its file (`DELETE /api/apps/[appId]/attachments/[attachmentId]`), and a user may have at most 25 unsent files.
- **The access log** rows of a download name the attachment (`attachment_id`, no foreign key).
- **The Logs** page with numbered pages (offset), and **no notice** in the chat (§7.2).
```

4. In §8's table, after the row that begins with ``| `attachment_invalid` |``, add these four rows:

```text
| `attachment_no_text` | 400 | a PDF without text in `text` mode (the 2c plan) |
| `attachment_encoding` | 400 | a text file that is neither UTF-8 nor UTF-16 (the 2c plan) |
| `unsent_attachments_full` | 413 | a 26th unsent file (the 2c plan) |
| `attachment_not_found` | 404 | the serve and delete routes (the 2c plan) |
```

5. In §4.1, replace `(AG-UI true, Dify false until Part 3; §7.3 reads it)` with `(AG-UI true, Dify false until Part 3; §7.2 reads it)`: §7.2's Logs entry is the reader, and §7.3 is now the plan's changes.

6. In §12, in the line that begins with `- **2c:**`, replace `admins read conversations in the Logs, every view is in the access log, and users see the notice;` with `admins read conversations in the Logs, and every view and download is in the access log;`.

Check: `grep -c 'Admins can read conversations in this app' <spec>` → `0`; `grep -c 'users see the notice' <spec>` → `0`; `grep -c '^### 7.3 Changed by the 2c plan$' <spec>` → `1`; `grep -c '§7.3 reads it' <spec>` → `0`.

- [ ] **Step 7: Part 2's progress and the running record**

In spec §0, replace the row that begins with ``| 2c attachments and Logs | `feat/agui-files-logs` |`` (as the plan's PR left it) with:

```markdown
| 2c attachments and Logs | `feat/agui-files-logs` | `docs/superpowers/plans/2026-10-15-part-2c-agui-files-logs.md` (21 tasks; `docs/part-2c-plan`, PR #PLAN_PR) | built: Tasks 1–19, each reviewed, and the records (Task 20): one migration (`chat_attachments`), one dependency (`pdfjs-dist` 6.4.299), ADR-0037 proposed. Plan deviations (ruled while it ran): DEVIATIONS. The gates and the Docker gate: Task 21 | — | — |
```

Replace the line that begins with `**Next:**` with:

```markdown
**Next:** 2c's gates and the Docker gate (Task 21 of its plan), then the owner's check and the merge. Still due for 2a: the owner's browser check on the local stack (spec §12's "done when"); a problem it finds becomes a `fix/` branch to `fork/overhaul` (decision 61). The images `ai-app-hub-local-app:part2a` and `:part1` and the dump `~/ai-app-hub-backups/local-before-part2a.sql` stay until the owner lets them go.
```

In `docs/superpowers/research/2026-10-11-provider-hub/README.md`, after decision 71 and before `## Ideas kept for later`, add, with a blank line before and after:

```markdown
72. **2c is built** (TODAY): Tasks 1–19 of `docs/superpowers/plans/2026-10-15-part-2c-agui-files-logs.md` on `feat/agui-files-logs`, subagent-driven, each task reviewed. One migration (`chat_attachments`: `conversation_attachments` and `conversation_access_log`) and one dependency (`pdfjs-dist` 6.4.299, `@napi-rs/canvas` ignored). Records: ADR-0037 (proposed), a dated note on ADR-0030 (`chatImage`), `docs/agui-agents.md`'s attachment settings and "Attachments", the spec's §7.3 and its §7.2, §8 and §12 changes from decisions 69 and 70. Deviations from the plan (ruled while it ran): DEVIATIONS. Next: the gates, the Docker gate and the PR (Task 21), then the owner's check.
```

`PLAN_PR` is the plan's merged PR: `gh pr list -R LovingCivilian/dify-app-hub --state merged --head docs/part-2c-plan --json number --jq '.[0].number'`. `DEVIATIONS` is the list Step 1 gathered, or `none`. Fill them and the date:

```bash
PLAN_PR=$(gh pr list -R LovingCivilian/dify-app-hub --state merged --head docs/part-2c-plan --json number --jq '.[0].number')
sed -i -e "s/PLAN_PR/$PLAN_PR/g" -e "s/TODAY/$(date +%F)/g" docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
```

Replace both `DEVIATIONS` by hand, then check: `grep -cE 'PLAN_PR|DEVIATIONS|TODAY' docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md` Expected: `0` for both.

- [ ] **Step 8: Format check and commit**

```bash
pnpm exec oxfmt --check docs/decisions/0037-keep-chat-attachments-and-admin-logs-on-the-hub.md docs/decisions/README.md docs/decisions/0030-set-each-settings-area-from-the-environment-or-the-admin-page.md docs/agui-agents.md AGENTS.md docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
```

Expected: no findings (if oxfmt reflows a table, run it with `--write` on that file and look at the diff).

```bash
git add docs/decisions/0037-keep-chat-attachments-and-admin-logs-on-the-hub.md docs/decisions/README.md docs/decisions/0030-set-each-settings-area-from-the-environment-or-the-admin-page.md docs/agui-agents.md AGENTS.md docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
git commit -m "docs(agui): ADR-0037, the chatImage note, the agent guide's attachments and Part 2's progress

ADR-0037 records bytea, inline base64, pdfjs-dist in a worker thread,
the caps, the Logs' numbered pages, the access log and why no notice
is shown (decisions 69 and 70); ADR-0030 gains the chatImage kind;
docs/agui-agents.md describes the attachment settings and parts; the
spec's §7.3 and its §7.2, §8 and §12 changes; AGENTS.md's Layout;
spec §0 and decision 72.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the seven files; lint-staged changes nothing.

```json:metadata
{"files": ["docs/decisions/0037-keep-chat-attachments-and-admin-logs-on-the-hub.md", "docs/decisions/README.md", "docs/decisions/0030-set-each-settings-area-from-the-environment-or-the-admin-page.md", "docs/agui-agents.md", "AGENTS.md", "docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md", "docs/superpowers/research/2026-10-11-provider-hub/README.md"], "verifyCommand": "grep -c '^## Attachments$' docs/agui-agents.md && grep -c '(Part 2c' docs/decisions/0030-*.md && grep -c '^status: proposed' docs/decisions/0037-*.md && wc -l < AGENTS.md", "acceptanceCriteria": ["ADR-0037 exists, status proposed, names bytea, pdfjs-dist, worker_threads, resourceLimits, ignoredOptionalDependencies, 50,000,000, UTF-16, attachment_id, no-store, OFFSET and the notice; its index row exists", "ADR-0030 has one dated Part 2c note naming chatImage and CHAT_IMAGE_MAX_PIXELS", "docs/agui-agents.md has the three settings rows and an Attachments section, and no longer says the hub sends no files", "AGENTS.md's Layout names admin/logs and the attachments, below 200 lines", "spec: §0's 2c row and Next line; §7.2 without the notice bullet and with numbered pages; §7.3; §8's four codes; §12 without the notice; no PLAN_PR, DEVIATIONS or TODAY left; running record decision 72 dated today", "oxfmt clean on the seven files"], "modelTier": "standard"}
```

---

### Task 21: Final verification and the Docker gate

**Goal:** Every whole-branch gate exits clean (Steps 1–6); then, only after the owner's captured go-ahead, the owner's local stack keeps its current image as `ai-app-hub-local-app:part2b` and its database in `~/ai-app-hub-backups/local-before-part2c.sql`, is rebuilt from this branch and shows `Database migration complete` once, RestartCount 0, seven migration rows ending in `_chat_attachments` with the two new tables, a PDF read by the worker inside the image, no pdf.js or AG-UI client code in the browser bundle and AGENTS.md's signed-out checks with 2c's new routes; `feat/agui-files-logs` is pushed, its PR to `fork/overhaul` is open, and spec §0 and decision 73 record the gates.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

Spec §0 ("Gates: AGENTS.md's, then the Docker gate"), §10 ("Docker gate": "from 2c, the attachment and logs routes") and §12. No earlier task touches the owner's stack (`ai-app-hub-local`, `docker-compose.local.yml`, port 5300, PostgreSQL on 127.0.0.1:5432); this one does so only after the owner's word (Step 7). 2c has a migration (Task 3), so the database is dumped before the rebuild, as 2a's gate did (its plan's Task 19 Step 8), and the way back (Step 17) restores it with 2b's image. Before 2c's migration runs, 2b's code never reads the two new tables; after it, 2b's code still runs on the database (it ignores tables it does not know, and its `aguiSettingsSchema` drops the unknown `attachments` key: zod 4 "Objects"), so the image alone is a way back too, with the attachments left in place. The owner's browser check and the merge are the owner's (decision 61's pattern); this task ends with the PR open and the owner told what to check.

**Files:** none changed in the repository, except Step 15's records (spec §0, the running record) and Step 16's acceptance of ADR-0037 on the owner's word. Outside it: the image tag `ai-app-hub-local-app:part2b` and the dump `~/ai-app-hub-backups/local-before-part2c.sql` (Step 8), kept until the owner lets them go; the PR body in the session's scratchpad (Step 13).

**Acceptance Criteria:**

- [ ] Steps 1 to 6 are green on the whole branch: after the fetch, `git log --oneline HEAD..fork/overhaul` prints nothing; tsc; oxlint and oxfmt on the changed files; `npx -y @ant-design/cli lint ./ --format json` with `"total": 0`; `pnpm i18n:lint` ("No issues found.") and `pnpm i18n:status` (zh and ar at 100%); Step 2's checks print what they list; `pnpm test`; `pnpm test:db`; `pnpm test:ldap`; `pnpm test:e2e` with 0 failed on desktop-light, desktop-dark and mobile-light.
- [ ] The owner's explicit go-ahead to Step 7's message is captured before Step 8; nothing touches `ai-app-hub-local` before it.
- [ ] The old image is tagged `ai-app-hub-local-app:part2b` (never overwritten), and `~/ai-app-hub-backups/local-before-part2c.sql` exists with mode `600`, a size above zero and `15` `CREATE TABLE` lines; Step 8 printed the migration rows and the counts before the rebuild.
- [ ] After the rebuild: `docker compose -f docker-compose.local.yml logs app | grep -c "Database migration complete"` prints `1`; `docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app` prints `0`; `drizzle.__drizzle_migrations` lists seven rows, the six before and one ending `_chat_attachments`; `conversation_access_log` and `conversation_attachments` exist; the apps and conversations counts are unchanged.
- [ ] Step 11 prints `0` four times (`[ag-ui]`, `@ag-ui/`, `pdfjs` and `pdf.worker` in `.next/static`) and reads the text of the PDF fixture through the worker inside the running image.
- [ ] Step 12's signed-out checks answer as listed, the four new routes with the 401 envelope and the Logs page with the redirect to `/login`, and `/api/health` answers `200` again after `restart postgres`.
- [ ] `feat/agui-files-logs` is pushed; the PR to `fork/overhaul` follows `.github/PULL_REQUEST_TEMPLATE.md`'s sections, names ADR-0037 and ADR-0030, and ends with the session's attribution lines; spec §0's 2c row names the PR and the gates, and decision 73 is written.

**Verify:** `docker compose -f docker-compose.local.yml logs app | grep -c "Database migration complete" && docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app && gh pr view feat/agui-files-logs -R LovingCivilian/dify-app-hub --json state,baseRefName --jq '"\(.state) \(.baseRefName)"'` → `1`, `0`, `OPEN fork/overhaul`

**Interfaces:** consumes every earlier task. Nothing in `.env` or `.env.development.local` is read or printed: inside the PostgreSQL container, `psql` and `pg_dump` read the database's name and user from the container's own `POSTGRES_*` variables (`sh -c '… "$POSTGRES_USER" …'`).

- [ ] **Step 1: Static gates on the whole branch**

First make sure the branch holds everything `fork/overhaul` has (Global Constraints: a `fix/` branch, or #73's or #74's, may have merged meanwhile):

```bash
git fetch origin fork/overhaul:fork/overhaul
git log --oneline HEAD..fork/overhaul
```

Expected: the fetch updates or confirms the local `fork/overhaul`, and the log prints nothing. If it prints commits, merge `fork/overhaul` into `feat/agui-files-logs` (`git merge fork/overhaul`, a merge commit, as the branch model keeps history), and run every step of this task from here on the result.

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit` Expected: no output.

Run: `pnpm exec oxlint $(git diff --name-only --diff-filter=AMR fork/overhaul...HEAD -- '*.ts' '*.tsx' '*.mjs')` Expected: no findings.

Run: `pnpm exec oxfmt --check $(git diff --name-only --diff-filter=AMR fork/overhaul...HEAD)` Expected: no findings.

Run: `npx -y @ant-design/cli lint ./ --format json` Expected: `"summary": { "total": 0, …}` (the ratchet in `docs/frontend-conventions.md`).

Run: `pnpm i18n:lint && pnpm i18n:status` Expected: "No issues found." and `zh` and `ar` at 100%.

- [ ] **Step 2: The boundaries**

Run: `git grep -nE "from '(@ag-ui/(client|encoder)|pdfjs-dist|sharp)" -- components app hooks lib/chat/turn.ts lib/chat/attachment-rules.ts lib/chat/log-view.ts lib/chat/ask-user.ts lib/chat/interrupt-answers.ts lib/chat/plan-state.ts lib/chat/open-items.ts ':!app/api'` Expected: no output (spec §9: the browser carries none of their runtime; the route handlers under `app/api` are server code, and the listed `lib/chat/` modules are client-safe).

Run: `git grep -nE "^import [^t].*from '@ag-ui/core" -- components lib/chat/turn.ts lib/chat/attachment-rules.ts lib/chat/log-view.ts lib/chat/ask-user.ts lib/chat/interrupt-answers.ts lib/chat/plan-state.ts lib/chat/open-items.ts` Expected: no output (`import type` only).

Run: `git grep -lE "pdfjs-dist" -- lib app components ':!lib/chat/documents.ts' ':!lib/chat/pdf-text.worker.mjs'` Expected: no output (only the worker loads pdf.js, and only `documents.ts` starts the worker; `next.config.ts` names the package and is outside these folders).

Run: `git grep -lE "from '@/lib/providers/(dify|agui)" -- app components hooks lib db ':!lib/providers' ':!components/provider-ui' ':!components/chat' ':!app/api/dify'` Expected: no output.

Run: `git diff --name-only fork/overhaul...HEAD -- db/migrations | sed -E 's|/[^/]+$||' | sort -u` Expected: one folder, `db/migrations/<14 digits>_chat_attachments` (Global Constraints: one migration).

Run: `git diff fork/overhaul...HEAD -- package.json | grep -E '^[+-][[:space:]]'` Expected: one line, `+		"pdfjs-dist": "6.4.299",` (two tabs: `package.json` is indented with tabs; Global Constraints: one dependency, pinned exactly).

- [ ] **Step 3: The unit suite**

Run: `pnpm test` Expected: PASS; keep the summary line (files and tests) for Step 13.

- [ ] **Step 4: The live database suite**

Run: `pnpm test:db` Expected: PASS, `attachments-schema.db.test.ts`, `attachments.db.test.ts`, `logs.db.test.ts` and `conversations-run.db.test.ts` among them; the teardown stops the e2e PostgreSQL. Keep the test count.

- [ ] **Step 5: The directory suite**

Run: `pnpm test:ldap` Expected: PASS (2c changes nothing in the directory code; the whole-branch gate runs every suite). Keep the test count.

- [ ] **Step 6: The e2e suite on an empty PostgreSQL**

Stop `pnpm dev` if it runs (one `next dev` per checkout), and make sure `pnpm test:db` is not running (the two share the e2e PostgreSQL). Run in the background (about 35 minutes; the Bash tool's `run_in_background`, its output read when it ends): `docker compose -f docker-compose.e2e.yml --profile ldap down -v && pnpm test:e2e` Expected: 0 failed on `desktop-light`, `desktop-dark` and `mobile-light`, with `e2e/agui-files.spec.ts` and `e2e/agui-logs.spec.ts` beside every Dify spec and 2a's and 2b's AG-UI specs. Keep the passed and skipped counts. A failure is investigated (superpowers-extended-cc:systematic-debugging), fixed in its own commit, and Steps 1–6 run again.

Then free the memory the Docker build needs (about 5 GB on this machine), and clear the dev types the e2e server left (they break tsc):

```bash
docker compose -f docker-compose.e2e.yml --profile ldap down
rm -rf .next/dev/types && pnpm exec next typegen && pnpm exec tsc --noEmit
```

Expected: the e2e containers stopped; no tsc output.

- [ ] **Step 7: Stop and ask the owner before touching their stack**

Send the owner this and wait for their word:

> Part 2c passes every gate (tsc, oxlint, oxfmt, the antd lint, the i18next checks, `pnpm test`, `pnpm test:db`, `pnpm test:ldap`, the e2e suite on three projects). The Docker gate is next, on your local stack; the app is down for about two minutes during the rebuild, and PostgreSQL stays up apart from one restart check.
>
> 1. I keep the current image as `ai-app-hub-local-app:part2b`, stop the app container, and dump the database to `~/ai-app-hub-backups/local-before-part2c.sql` (mode 600, outside the repo; it holds your apps' secrets and the password hashes in plain text, and I never print it). 2c has one migration, which adds two tables and changes nothing else.
> 2. I rebuild from `feat/agui-files-logs`. Its entrypoint runs the migration once.
> 3. The checks: the migration log, the restart count, the two new tables, a PDF read by the worker inside the image, the browser bundle, AGENTS.md's signed-out curls with 2c's four new routes and the Logs page, and one `docker compose restart postgres` with the health check after it.
> 4. Then I push `feat/agui-files-logs` and open the PR to `fork/overhaul`. Your browser check, accepting ADR-0037 and the merge stay yours.
>
> If you want 2b back afterwards, Step 17 restores the dump and starts the `part2b` image again, on your word only. May I go ahead?

- [ ] **Step 8: Keep the old image, take the app down, back up (after the owner's word)**

```bash
docker compose -f docker-compose.local.yml ps --format '{{.Name}} {{.Status}}'
```

Expected: `ai-app-hub-local-postgres` running and `(healthy)`; `ai-app-hub-local-app` running, or not listed. If PostgreSQL is not running, stop and tell the owner instead of starting it. If the app is not listed, check that nothing else holds port 5300: `curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health` Expected: `000`; anything else is another server on the port (the quick dev loop's `pnpm dev`): stop and ask the owner.

```bash
if docker image inspect ai-app-hub-local-app:part2b >/dev/null 2>&1; then
  echo 'ai-app-hub-local-app:part2b already exists: stop and ask the owner'
else
  docker image tag ai-app-hub-local-app:latest ai-app-hub-local-app:part2b &&
    docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
fi
docker image inspect -f '{{.Id}}' ai-app-hub-local-app:part2b
```

Expected: no "already exists" line; the app container stopped and removed (or nothing to remove); the old image's id (the tag is never overwritten; `ai-app-hub-local-app:part2a`, `:part1` and `~/ai-app-hub-backups/local-before-part2a.sql` stay untouched).

```bash
install -d -m 700 "$HOME/ai-app-hub-backups"
(umask 077 && set -o noclobber && docker compose -f docker-compose.local.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$HOME/ai-app-hub-backups/local-before-part2c.sql")
stat -c '%a %s' "$HOME/ai-app-hub-backups/local-before-part2c.sql"
grep -c '^CREATE TABLE' "$HOME/ai-app-hub-backups/local-before-part2c.sql"
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<'SQL'
SELECT name FROM drizzle.__drizzle_migrations ORDER BY created_at;
SELECT 'apps ' || count(*) FROM apps;
SELECT 'conversations ' || count(*) FROM conversations;
SQL
```

Expected: `600` and a size above zero; `15` (Part 1's eleven tables, 2a's three and `drizzle.__drizzle_migrations`); six migration names (`<14 digits>_baseline`, `_apps_expand`, `_apps_data`, `_apps_contract`, `_agui_provider`, `_conversations`), then `apps <n>` and `conversations <n>`; keep this output for Step 10. `noclobber` refuses to overwrite an earlier backup: stop and ask the owner what to do with it. If anything is not as expected, bring the old app back (`docker compose -f docker-compose.local.yml up -d --no-build app`; Compose `up --no-build`: "Don't build an image", so it starts the old `:latest`), check `curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health` → `200`, and report. Never `cat`, `head` or `grep` lines out of the dump beyond the `CREATE TABLE` count.

- [ ] **Step 9: Rebuild the app container (AGENTS.md "Docker stack")**

Never build this folder's image while the `fork/main` folder builds its own. The app container is already down:

```bash
docker compose -f docker-compose.local.yml up -d --build app
```

Expected: about two minutes (80 s of it `next build`). If the build is killed for memory, do not restart it unprompted (AGENTS.md): bring the old app back as Step 8's failure path does and report. If Docker's CLI answers "Cannot allocate memory" from its config on `/mnt/c` (decision 68), run the same command with `DOCKER_CONFIG` pointing at a fresh folder inside WSL, as 2b's gate did.

- [ ] **Step 10: The migration on the real database**

- `docker compose -f docker-compose.local.yml logs app | grep -c "Database migration complete"` Expected: `1`.
- `docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app` Expected: `0` (a failed migration rolls back and shows as a restart loop here; then Step 17).

```bash
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<'SQL'
SELECT name FROM drizzle.__drizzle_migrations ORDER BY created_at;
SELECT string_agg(tablename, ' ' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'conversation%';
SELECT 'apps ' || count(*) FROM apps;
SELECT 'conversations ' || count(*) FROM conversations;
SQL
```

Expected: seven names, Step 8's six and then `<14 digits>_chat_attachments`; `conversation_access_log conversation_attachments conversation_messages conversation_runs conversations`; the same two counts as Step 8 (the owner's apps and conversations are untouched).

- [ ] **Step 11: The bundle and the PDF worker inside the image**

```bash
docker compose -f docker-compose.local.yml exec -T app sh -c "for s in '[ag-ui]' '@ag-ui/' 'pdfjs' 'pdf.worker'; do grep -rlF \"\$s\" .next/static | wc -l; done"
```

Expected: `0` four times. `[ag-ui]` prefixes every warning `@ag-ui/client` 1.0.2 logs, so a client chunk that bundled it would contain the string; `pdfjs` and `pdf.worker` would mark pdf.js in a client chunk. The image's static chunks are at `/app/.next/static` (Dockerfile: `COPY --from=builder /app/.next/static ./.next/static`). If any count is above zero, report the files to the owner and stop.

Then the PDF worker inside the running image (Task 7 Step 10's check, run where the hub runs): the image's working directory is `/app` (Dockerfile `WORKDIR /app`), where `.next/standalone`'s files sit, so the worker starts from the same path as it does for an upload.

```bash
CHECK=$(mktemp -d)
cp __tests__/fixtures/pdf/text.pdf __tests__/fixtures/pdf/cjk.pdf "$CHECK/"
cat > "$CHECK/check-pdf.mjs" <<'JS'
// Reads two fixtures through the worker as lib/chat/documents.ts starts it, inside the image.
import { readFileSync } from 'node:fs'
import { Worker } from 'node:worker_threads'

for (const name of ['text.pdf', 'cjk.pdf']) {
	const bytes = new Uint8Array(readFileSync(`/tmp/pdf-check/${name}`))
	const worker = new Worker(`${process.cwd()}/lib/chat/pdf-text.worker.mjs`, {
		workerData: { bytes, maxCodePoints: 100_001 },
		stderr: true,
	})
	const message = await new Promise((resolve, reject) => worker.on('message', resolve).on('error', reject))
	console.log(name, JSON.stringify(message))
	await worker.terminate()
}
JS
docker compose -f docker-compose.local.yml cp "$CHECK/." app:/tmp/pdf-check
docker compose -f docker-compose.local.yml exec -T -w /app app node /tmp/pdf-check/check-pdf.mjs
docker compose -f docker-compose.local.yml exec -T app rm -rf /tmp/pdf-check
rm -rf "$CHECK"
```

Expected:

```text
text.pdf {"ok":true,"text":"Quarterly report\nRevenue grew by 12 percent."}
cjk.pdf {"ok":true,"text":"Hello CJK\n日本語テスト"}
```

If the worker fails to start, or the Japanese line is missing (the CMaps were not shipped), report to the owner and stop: an upload of a PDF would be refused in the image.

- [ ] **Step 12: The signed-out checks (AGENTS.md's list plus 2c's routes) and the database restart**

Run each with `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' <url>` unless a body is named. `<app id>` is any id from `docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT id FROM apps LIMIT 1"'`; `<uuid>` is any UUID (`cat /proc/sys/kernel/random/uuid`), since a signed-out request never reaches a handler.

| Request | Expected |
| --- | --- |
| `localhost:5300/api/health` | `200` |
| `localhost:5300/apps` | `307 http://localhost:5300/login?callbackUrl=%2Fapps` |
| `curl -s localhost:5300/api/dify/<app id>/parameters` | `{"code":"unauthorized",…}` with 401 (`-w '%{http_code}'`) |
| `curl -s localhost:5300/api/client/apps` | the same 401 envelope |
| `curl -s localhost:5300/api/users` and `/api/init/status` | the same 401 envelope |
| `curl -s -X POST -H 'Content-Type: application/json' -d '{}' localhost:5300/api/apps/<app id>/runs` | the same 401 envelope |
| `curl -s localhost:5300/api/apps/<app id>/conversations` | the same 401 envelope |
| `curl -s -X POST localhost:5300/api/apps/<app id>/conversations/<uuid>/runs/<uuid>/stop` | the same 401 envelope |
| `curl -s -X POST -F 'file=@/etc/hostname;filename=a.txt' localhost:5300/api/apps/<app id>/attachments` | the same 401 envelope |
| `curl -s localhost:5300/api/apps/<app id>/attachments/<uuid>` | the same 401 envelope |
| `curl -s -X DELETE localhost:5300/api/apps/<app id>/attachments/<uuid>` | the same 401 envelope |
| `curl -s localhost:5300/api/apps/<app id>/logs/<uuid>` | the same 401 envelope |
| `localhost:5300/app-management/<app id>/logs` | `307 http://localhost:5300/login?callbackUrl=%2Fapp-management%2F<app id>%2Flogs` |
| `curl -s localhost:5300/api/branding/logo` | 404 `{"code":"not_found",…}` while `BRANDING_MODE` is unset |
| `localhost:5300/init` | `307 http://localhost:5300/login` |
| `curl -s localhost:5300/login \| grep -c 'href="/forgot-password"'` | `0` while SMTP is off |
| `curl -s localhost:5300/login \| grep -c 'id="antd-cssinjs"'` | `1` |

2c changes the database layer (a migration and three DAL modules), so AGENTS.md's database-layer check follows (the pool's error listener):

```bash
docker compose -f docker-compose.local.yml restart postgres
docker compose -f docker-compose.local.yml up -d --no-recreate --wait --wait-timeout 120 postgres
curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health
docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app
```

Expected: `200` and `0` (Compose `up`: `--wait` "Wait for services to be running|healthy", `--no-recreate` "If containers already exist, don't recreate them").

- [ ] **Step 13: Push and open the PR**

```bash
git status --short
git log --oneline fork/overhaul..HEAD | wc -l
git push -u origin feat/agui-files-logs
```

Expected: no `git status` output (everything committed); the branch's commit count; the push creates `origin/feat/agui-files-logs`. Note the gates' commit: `git rev-parse --short=8 HEAD` (`GATE_SHA` below and in Step 15).

Write the PR body below to `pr-2c.md` in your session's scratchpad directory (never in the repository), replacing the tokens with this task's results: `PLAN_PR` (the plan's merged PR, as in Task 20 Step 7), `DEVIATIONS` (running record decision 72's list, or "none"), `GATE_SHA`, `UNIT_TESTS` (Step 3's files and tests), `DB_TESTS`, `LDAP_TESTS`, `E2E_PASSED` and `E2E_SKIPPED` (Steps 4–6). Then append, after a blank line, the session's attribution lines for pull requests (the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line, a blank line, and the session link the session's system reminder gives), and check that no token is left: `grep -cE 'PLAN_PR|DEVIATIONS|GATE_SHA|UNIT_TESTS|DB_TESTS|LDAP_TESTS|E2E_PASSED|E2E_SKIPPED' <scratchpad>/pr-2c.md` Expected: `0`.

```markdown
## Overview

Part 2c of the provider hub, the last slice of Part 2: **attachments and Logs.**

- **Attachments:** users attach images, PDFs and text files in an AG-UI app's chat, as the app allows (images off by default; PDFs read to text by default, or sent as PDF parts). Files are uploaded when picked, proven by their bytes, stored in PostgreSQL (`bytea`) and sent to the agent inline on every run. Removing a card deletes its file, and the daily purge removes files never sent.
- **Limits:** 5 MB a file, 5 a message, 6 MB a conversation, 25 unsent a user; images up to 50 MP, kept at their size unless the app sets a largest edge; text cut at 100,000 characters with a note; text files in UTF-8 or UTF-16.
- **PDFs** are read by pdf.js in a worker thread with a memory and a time limit, so a crafted file is refused instead of freezing or crashing the hub.
- **Logs:** owners and admins read every conversation of an AG-UI app, read-only, with numbered pages, filters and a transcript drawer (runs, state); every transcript opened and every attachment fetched there is in the access log, which the owner reads in its own tab. No notice is shown in the chat (the owner's decision).

One migration (`chat_attachments`: `conversation_attachments`, `conversation_access_log`) and one dependency (`pdfjs-dist` 6.4.299). It follows **ADR-0037** (proposed here), with a note on **ADR-0030** (the `chatImage` kind).

- Spec: `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md`, slice 2c (§7, with §7.3's changes from decisions 69 and 70).
- Plan: `docs/superpowers/plans/2026-10-15-part-2c-agui-files-logs.md` (PR #PLAN_PR), run subagent-driven: 21 tasks.

## Changes

| Type | File | Description |
| --- | --- | --- |
| Added | `db/schema/attachments.ts`, `db/migrations/*_chat_attachments/` | The two tables, their indexes and CHECKs |
| Added | `lib/chat/{attachment-rules,documents,uploads,attachment-parts,attachment-response,log-view}.ts`, `lib/chat/pdf-text.worker.mjs` | The rules (client-safe), PDF and text reading, the upload pipeline, the content parts, the served headers, the timeline view |
| Added | `lib/data/{attachments,access-log,logs}.ts` | The attachments, the access log and the Logs' reads |
| Changed | `lib/settings/images.ts` | The `chatImage` kind |
| Changed | `lib/chat/{schemas,run,session,turn,adapter}.ts`, `lib/data/conversations.ts`, `lib/providers/agui/*` | The run's files, their linking, the parts, files in history, the attachments settings |
| Added | `app/api/apps/[appId]/attachments/**`, `app/api/apps/[appId]/logs/[conversationId]/route.ts`, `app/(admin)/app-management/[appId]/logs/` | Upload, serve and delete; the transcript route; the Logs page |
| Added | `components/shared-chat/{hooks/use-shared-attachments.tsx,attachment-items.ts,turn-files.tsx}`, `components/admin/logs/` | The composer's files, the bubble's files, the Logs page, drawer and access log |
| Changed | `components/shared-chat/**`, `components/chat/chat-view/chat-sender.tsx`, `components/admin/apps/app-actions.tsx`, `components/provider-ui/agui/form-section.tsx` | Sending files (file-only too), the "Logs" row action, the Attachments section |
| Changed | `next.config.ts`, `package.json`, `pnpm-workspace.yaml` | `pdfjs-dist` server-only and traced; `@napi-rs/canvas` ignored |
| Changed | `e2e/fixtures/stub/*`, `e2e/auth.setup.ts`; Added `e2e/agui-files.spec.ts`, `e2e/agui-logs.spec.ts` | The stub's `files` scenario, the seeded native app, the specs |
| Changed | locales en/zh/ar | Every new text |
| Changed | `docs/decisions/{0037,0030,README}`, `docs/agui-agents.md`, `AGENTS.md`, spec, running record | The records |

**Deviations from the plan** (ruled while it ran): DEVIATIONS

## Testing

- [x] Gates on the whole branch at `GATE_SHA`:
  - `pnpm exec next typegen && pnpm exec tsc --noEmit`, oxlint and oxfmt are clean.
  - `npx -y @ant-design/cli lint ./` reports total 0.
  - `pnpm i18n:lint` is clean, and `i18n:status` shows zh and ar at 100%.
  - The boundary checks: no `@ag-ui/client`, `@ag-ui/encoder`, `pdfjs-dist` or `sharp` in browser code; `@ag-ui/core` as types only in the client-safe modules; pdf.js only in the worker; one migration and one dependency.
  - `pnpm test`: UNIT_TESTS.
  - `pnpm test:db`: DB_TESTS tests.
  - `pnpm test:ldap`: LDAP_TESTS tests.
  - `pnpm test:e2e` on an empty PostgreSQL: E2E_PASSED passed, E2E_SKIPPED skipped, 0 failed, on desktop-light, desktop-dark and mobile-light.
- [x] Docker gate on the owner's local stack, run on their go-ahead:
  - The old image is kept as `ai-app-hub-local-app:part2b`, and the database dumped to `~/ai-app-hub-backups/local-before-part2c.sql`.
  - After the rebuild: one `Database migration complete`, RestartCount 0, seven migration rows ending `_chat_attachments`, the two new tables, and the same apps and conversations counts.
  - The worker reads a PDF inside the image; `.next/static` has no AG-UI client or pdf.js code.
  - Every AGENTS.md signed-out check passes with 2c's four routes and the Logs page, and the app answers `/api/health` again after a PostgreSQL restart.
- [x] No new TypeScript errors.
- [ ] **The owner's browser check** (spec §12, "2c done when").

## Related Issue

- None closed. #66 stays open (a refused first run still leaves an orphan conversation, now with its files); #73 and #74 are untouched.
```

```bash
gh pr create -R LovingCivilian/dify-app-hub --base fork/overhaul --head feat/agui-files-logs --title "feat(agui): Part 2c, attachments and Logs" --body-file <scratchpad>/pr-2c.md
gh pr view feat/agui-files-logs -R LovingCivilian/dify-app-hub --json number,state,baseRefName --jq '"\(.number) \(.state) \(.baseRefName)"'
```

Expected: the PR's URL; then `<number> OPEN fork/overhaul`.

- [ ] **Step 14: Bring nothing else forward**

2c closes no issue and ticks no item (Related Issue above). Check that the open follow-ups are as the plan left them: `gh issue list -R LovingCivilian/dify-app-hub --label fork/overhaul --state open --json number --jq 'map(.number) | sort'` Expected: a list that holds 66, 69, 73 and 74 (and any the owner opened since). A finding this run left for later becomes a new issue labelled `fork/overhaul`, named in Step 15's record.

- [ ] **Step 15: Record the gates and the PR**

In `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` §0, in the row that begins with ``| 2c attachments and Logs | `feat/agui-files-logs` |``, replace the row's end as Task 20 wrote it, `The gates and the Docker gate: Task 21 | — | — |`, with:

```markdown
The gates and the Docker gate passed (`GATE_SHA`, GATE_DATE); the owner's browser check and ADR-0037's acceptance pending | #PR_NUMBER | — |
```

Replace the line that begins with `**Next:**` with the line below, keeping after it any sentence of the old line that is still true about 2a or Part 1:

```markdown
**Next:** the owner's browser check of 2c on the local stack (`localhost:5300`, built from `feat/agui-files-logs` at `GATE_SHA`; spec §12, "2c done when"), ADR-0037's acceptance and the merge of PR #PR_NUMBER, all the owner's; a problem the check finds becomes a fix on `feat/agui-files-logs`. Then Part 3's spec (Dify onto the shared chat). The image `ai-app-hub-local-app:part2b` and the dump `~/ai-app-hub-backups/local-before-part2c.sql` (2b, for a way back: Task 21 Step 17 of the 2c plan) stay until the owner lets them go.
```

In `docs/superpowers/research/2026-10-11-provider-hub/README.md`, after decision 72 and before `## Ideas kept for later`, add, with a blank line before and after:

```markdown
73. **2c passes its gates** (GATE_DATE).
    - **Gates** at `GATE_SHA`: tsc, oxlint, oxfmt, the antd lint at 0, i18next lint and status (zh and ar 100%), the boundary checks as listed, `pnpm test` UNIT_TESTS, `pnpm test:db` DB_TESTS, `pnpm test:ldap` LDAP_TESTS, and the e2e suite on an empty PostgreSQL with E2E_PASSED passed, E2E_SKIPPED skipped and 0 failed.
    - **The Docker gate** ran on the owner's go-ahead ("OWNER_WORDS", GATE_DATE): the old image kept as `ai-app-hub-local-app:part2b` and the database dumped to `~/ai-app-hub-backups/local-before-part2c.sql` (mode 600, 15 tables); one `Database migration complete`, RestartCount 0, seven migration rows ending `_chat_attachments`, the two new tables and the same apps and conversations counts; the worker read a PDF inside the image; no `[ag-ui]`, `@ag-ui/`, `pdfjs` or `pdf.worker` in `.next/static`; every signed-out check as AGENTS.md lists with 2c's four routes and the Logs page, and `/api/health` 200 after a PostgreSQL restart.
    - **The PR** is #PR_NUMBER to `fork/overhaul`. The owner's browser check (spec §12, "2c done when"), ADR-0037's acceptance and the merge are the owner's; a problem the check finds becomes a fix on `feat/agui-files-logs`.
```

`OWNER_WORDS` is the owner's reply to Step 7, quoted as they wrote it. Replace the `UNIT_TESTS`, `DB_TESTS`, `LDAP_TESTS`, `E2E_PASSED`, `E2E_SKIPPED` and `OWNER_WORDS` tokens by hand with Steps 3–7's results, then fill the rest and check:

```bash
GATE_SHA=$(git rev-parse --short=8 HEAD)
PR=$(gh pr view feat/agui-files-logs -R LovingCivilian/dify-app-hub --json number --jq .number)
sed -i -e "s/GATE_SHA/$GATE_SHA/g" -e "s/PR_NUMBER/$PR/g" -e "s/GATE_DATE/$(date +%F)/g" docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
grep -cE 'GATE_SHA|GATE_DATE|PR_NUMBER|UNIT_TESTS|DB_TESTS|LDAP_TESTS|E2E_PASSED|E2E_SKIPPED|OWNER_WORDS' docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
grep -n '^73\. ' docs/superpowers/research/2026-10-11-provider-hub/README.md
pnpm exec oxfmt --check docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
```

Expected: `0` for both files; one line with today's date; no findings.

```bash
PR=$(gh pr view feat/agui-files-logs -R LovingCivilian/dify-app-hub --json number --jq .number)
git add docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
git commit -m "docs(agui): record 2c's gates and PR #$PR in Part 2's progress

Spec §0's 2c row and Next line, and running record decision 73.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

Expected: one commit; the push updates the PR.

- [ ] **Step 16: Report to the owner, then their check, ADR-0037 and the merge**

Report to the owner: Steps 1–15's results, the PR's link, the migration rows and counts, and what to check in the browser (spec §12, "2c done when"; the owner uses Firefox) on `localhost:5300`: in App management, edit an AG-UI app that points at their agent service and open its Attachments section (Images on if their model reads images; Documents "As text"); in its chat, attach an image, a PDF and a `.csv`, send them with and without text, and see the agent answer about them; a refused file (a `.svg`, a 6 MB file) keeps its card with the reason; removing a card before sending; a reload shows the files on the user's turn. Then the "Logs" row action on that app: the list, a filter, the pages, "View" with the transcript, its runs and its state, and the "Access log" tab with the view and the image downloads just made. Wait for their word.

On the owner's word after a passing check: set `status: accepted` in ADR-0037 and its index row, commit (`docs(agui): accept ADR-0037`, with the trailer) and push. A problem they report becomes a fix on this branch (superpowers-extended-cc:systematic-debugging): Steps 1–12 run again for what it touched, the fix is pushed to the PR, and spec §0's row says so.

When the owner has merged the PR (the merge is theirs), remove the local branch (AGENTS.md: `gh pr merge … --delete-branch` and the web button delete only the GitHub branch):

```bash
git switch fork/overhaul && git pull --ff-only origin fork/overhaul && git branch -d feat/agui-files-logs
git ls-remote --heads origin feat/agui-files-logs
```

Expected: the branch deleted locally; `ls-remote` prints nothing (if it prints the branch, `git push origin --delete feat/agui-files-logs`). The merge's own record (spec §0's Merged cell, the running record) goes with Part 3's spec branch, as 2a's and 2b's did.

- [ ] **Step 17: The way back (only on the owner's word)**

Restore 2b as it was before Step 8 (everything written after the backup is gone; say so to the owner before running it):

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" -T template0 "$POSTGRES_DB"'
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$HOME/ai-app-hub-backups/local-before-part2c.sql"
docker image tag ai-app-hub-local-app:part2b ai-app-hub-local-app:latest
docker compose -f docker-compose.local.yml up -d --no-build app
curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health
```

Expected: no `ERROR` from the restore (PostgreSQL 18 "SQL Dump", "Restoring the Dump": a database created from `template0`, `ON_ERROR_STOP`, `--single-transaction`); `200`. The 2c image loses its `:latest` tag; Step 9 rebuilds it. If the owner wants 2b back without losing what was written since, the image alone also works (2b's code ignores the two new tables and the `attachments` settings key): run only the `docker image tag` and `up --no-build` lines.

```json:metadata
{"files": [], "verifyCommand": "docker compose -f docker-compose.local.yml logs app | grep -c \"Database migration complete\" && docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app && gh pr view feat/agui-files-logs -R LovingCivilian/dify-app-hub --json state,baseRefName --jq '\"\\(.state) \\(.baseRefName)\"'", "acceptanceCriteria": ["Steps 1-6 green on the whole branch: nothing on fork/overhaul missing from the branch, tsc, oxlint, oxfmt, antd lint total 0, i18n lint and status, Step 2's boundary checks as listed (no AG-UI client, encoder, pdfjs-dist or sharp in browser code; @ag-ui/core type-only in the client-safe modules; pdf.js only in the worker; provider modules only through the registry; one migration folder ending _chat_attachments; one package.json line, pdfjs-dist 6.4.299), pnpm test, pnpm test:db, pnpm test:ldap, pnpm test:e2e 0 failed on three projects", "the owner's go-ahead to Step 7 captured before Step 8", "image tagged ai-app-hub-local-app:part2b, never overwritten; ~/ai-app-hub-backups/local-before-part2c.sql mode 600, size > 0, 15 CREATE TABLE lines; migration rows and apps and conversations counts printed before the rebuild", "after the rebuild: one 'Database migration complete', RestartCount 0, seven migration rows ending _chat_attachments, conversation_access_log and conversation_attachments exist, the same counts", "Step 11 prints 0 four times and the worker inside the image reads the PDF fixture's text", "every signed-out check of Step 12 answers as listed, the four new routes with the 401 envelope and the Logs page with the 307 to /login; /api/health 200 and RestartCount 0 after restarting postgres", "feat/agui-files-logs pushed; PR to fork/overhaul open with the template's sections, ADR-0037 and ADR-0030 named and the session's attribution lines", "spec §0's 2c row names the PR and the gates' commit; running record decision 73 written and pushed"], "modelTier": "standard", "userGate": true, "tags": ["user-gate"]}
```

---

## Self-review: spec coverage

Each requirement of spec §7 and 2c's rows elsewhere, and each of decisions 69 and 70, with the task that builds it and the test that proves it.

| Spec or decision | Requirement | Task | Proof |
| --- | --- | --- | --- |
| §2.2 | `attachments.images` (false), `.documents` (`'text'`), `.maxImageEdge` (null or 256–8192), zod defaults so 2a and 2b documents parse; the chat DTO carries the allowed kinds, never `maxImageEdge` | 1, 2 | `agui-schema`, `provider-registry`, `data-apps`, `app-management-schemas` tests; Task 19's admin test |
| §7.1 | Table `conversation_attachments` (owner, app, conversation and message once sent, kind CHECK, detected MIME, name, size, SHA-256, `bytea`, extracted text) | 3 | `attachments-schema.db.test.ts` (CHECKs, cascades, `bytea`) |
| §7.1, §3.4 | Unsent rows purged after 24 hours by the daily job | 6 | `attachments.db.test.ts` (the boundary), `chat-purge.test.ts` |
| §7.1 | Upload: one multipart `file`, `resolveChatRoute`, kind allowed by the app, type from the bytes, 5 MB, 6 MB a conversation, 5 a message; 413, 415, 400 | 1, 7, 9 | `chat-uploads.test.ts` (every refusal stores nothing), the route test (Content-Length before `formData`), `chat-schemas.test.ts` (1–5 ids) |
| §7.1 | Images: PNG, JPEG, WebP decoded by sharp with a pixel limit, metadata stripped, re-encoded in their format at their size, shrunk only to `maxImageEdge`; the `chatImage` kind | 4 | `settings-chat-image.test.ts` |
| §7.1, §9 | PDFs by `%PDF-`; text mode extracts with `pdfjs-dist` (chosen in ADR-0037), at most 100,000 characters; text files UTF-8 | 5, 7 | `chat-documents.test.ts`; Task 7's build check |
| §7.1 | To the agent: the text part, then per attachment an `image` part, a `document` part in native mode, or `[file name]` and the text; `mimeType`; never a URL; every run re-sends every attachment | 9 | `chat-attachment-parts.test.ts`, `chat-run.test.ts`; Task 19's echo through the stub (Task 18) |
| §7.1 | Serving back to the owner or an admin through the Logs (audited): detected `Content-Type`, `nosniff`, the sandbox CSP, `inline` only for images | 6, 8 | `chat-attachment-response.test.ts`, `attachments.db.test.ts`; Task 19 |
| §7.1 | UI: X `Attachments` in `Sender.Header` limited to the allowed kinds; `FileCard` and thumbnails in the user bubble | 10, 11, 12 | `shared-chat-attachment-items.test.ts`, `shared-chat-provider.test.ts`, `chat-turn.test.ts`; Task 19 (send, reload, preview) |
| §7.2 | "Logs" row action on `hubHistory` apps | 14 | `data-apps.test.ts`; Task 19 (`menuitem` "Logs" on the AG-UI app only) |
| §7.2, decision 69 (5) | The page: owner and admin; user, title, messages, last activity, tokens, status tags; filters in the URL; numbered pages with the total (the owner's change from keyset) | 13, 15 | `logs.db.test.ts`, `admin-logs-query.test.ts`, `admin-log-columns.test.ts`, `admin-logs-page.test.ts`; Task 19 |
| §7.2 | The drawer: `GET …/logs/[conversationId]` (a Route Handler: no prefetch writes a row), owner and admin in the handler and the data layer; the read-only transcript, the run timeline, the state | 13, 14, 16 | `admin-logs-route.test.ts`, `admin-log-runs.test.ts`, `logs.db.test.ts`; Task 19 (transcript, Runs, State) |
| §7.2 | Audit: `conversation_access_log` (no foreign keys, `view`/`download`, indexes), written by opening a transcript or downloading through the Logs; not purged | 3, 6, 13 | `attachments-schema.db.test.ts`, `attachments.db.test.ts`, `logs.db.test.ts`; Task 19 (rows in the database and the tab) |
| §7.2 | Access log tab, owner only | 13, 17 | `logs.db.test.ts` (an admin refused), `admin-logs-page.test.ts`; Task 19 (admin sees no tab) |
| §7.2, decision 69 (8) | ~~The notice~~: not shown (the owner) | — (20 strikes it in the spec) | Task 20's greps |
| §8, P4 | `attachment_too_large`, `conversation_attachments_full`, `attachment_type_not_allowed`, `attachment_invalid`, and the plan's `attachment_no_text`, `attachment_encoding`, `unsent_attachments_full`, `attachment_not_found`, each worded in en, zh and ar | 1, 7 | `chat-uploads.test.ts`, `shared-chat-view.test.ts`, `i18n-locales.test.ts` |
| §10 | Unit: type sniffing and the caps; the content-part builder per documents mode; the attachment response headers | 1, 5, 7, 9, 8 | the test files above |
| §10 | Database: the attachments table and its cap; the access log | 3, 6, 13 | `pnpm test:db` |
| §10 | e2e: an attachment echo, the caps, the Logs list and transcript, the access log | 18, 19 | `agui-files.spec.ts`, `agui-logs.spec.ts` on three projects |
| §10 | The Docker gate: signed-out 401s from the attachment and logs routes, the migration once, RestartCount 0 | 21 | Task 21 Steps 10–12 |
| §11 | ADR-0037; the note on ADR-0030 (`chatImage`); `docs/agui-agents.md`'s attachment kinds; AGENTS.md's Layout; spec §0; the running record | 20 | Task 20's greps |
| §12 | 2c done when: files reach the agent per the app's settings; the caps hold; admins read in the Logs; every view in the access log; purge after 30 days | 9, 7, 13–17, 6 | the e2e suite; the owner's check (Task 21) |
| Decision 69 (2) | File-only messages | 9, 11 | `chat-schemas.test.ts`; Task 19 |
| Decision 69 (3) | Text cut at 100,000 with a note to the agent and on the card; a PDF without text refused in `text` mode | 1, 5, 7, 11 | `chat-attachment-rules.test.ts` (`capText`), `chat-uploads.test.ts`; Task 19 (the card's note) |
| Decision 69 (4), 70 (5) | Every non-uploader fetch is a `download` row naming the attachment | 3, 6, 8 | `attachments.db.test.ts`; Task 19 |
| Decision 69 (6) | The extension claims the kind, the bytes prove it | 1, 7 | `chat-uploads.test.ts` (a `.pdf` that is a PNG) |
| Decision 70 (1), (9) | PDFs in a worker thread with heap and time limits; its path marked `turbopackIgnore` | 5, 7 | `chat-documents.test.ts` (the time and heap limits; the event loop keeps running); Task 7's build check; Task 21's in-image check |
| Decision 70 (2), (7), (8) | 50 MP; animated WebP refused; quality 90 | 4 | `settings-chat-image.test.ts` |
| Decision 70 (3), (6) | UTF-8 or UTF-16 with a BOM; NUL refused | 5, 7 | `chat-documents.test.ts` (`decodeText`); Task 19 (the Windows-1256 CSV refused) |
| Decision 70 (4) | Removing a card deletes its file; 25 unsent a user | 6, 7, 8, 11 | `attachments.db.test.ts`, `chat-uploads.test.ts`; Task 19 (DELETE on remove) |

**Placeholder scan.** No step says "TBD", "similar to Task N" or "add error handling"; every code step holds its code. The only fill-ins are Task 20's and 21's tokens (`TODAY`, `PLAN_PR`, `DEVIATIONS`, `GATE_SHA`, `PR_NUMBER`, the test counts and `OWNER_WORDS`), which their steps fill from a command or the run's results.

**Type consistency.** The Shared contracts name every cross-task export, and the pre-flight (below) applied Tasks 1–19 in order in one copy and type-checked every file, tests included.

## Pre-flight (2026-10-15)

Before this plan's PR, Tasks 1–19 were applied exactly as written, in order, to one scratch copy of `fork/overhaul` at `09000df4` with a real `node_modules` (one commit per task, branch `feat/agui-files-logs`), the 2a and 2b handoffs' lesson: every find fragment matched once, every failing-test step failed as its text says, lint-staged changed nothing, and every test file was type-checked. Task 5's `pnpm add -E pdfjs-dist@6.4.299` added one package and did not install `@napi-rs/canvas`; Task 3's generated SQL matched the quoted SQL; Task 7's build check came out as written (no worker chunk, the worker's path kept once, nothing of pdf.js in `.next/static`, the standalone build reading a PDF and a Japanese one through the worker).

Five things did not fit and were fixed in the texts, which now produce what was committed:

- **The decided move:** `UploadRefusalCode` and `UPLOAD_REFUSALS` live in Task 1's `lib/chat/attachment-rules.ts`, so the run route (Task 9) does not load the upload pipeline (sharp, the PDF worker).
- **Task 11:** every AG-UI chat load logged "Hydration failed": X's `Sender.Header` with `forceRender` renders the closed panel on the server and nothing on the browser's first render. The hook renders the header after hydration (P13).
- **Task 13:** its database test's sent attachment lacked the `position` Task 3's CHECK requires.
- **Task 19:** four slips in the specs (a 0 × 0 radio input clicked by its label; a removed last card left hidden in the DOM by X's leave motion, so the helper keeps visible cards; the Logs fixture's order, so the user's conversation leads page 1; a comment about two `view` rows in development that was untrue: one opening writes one `view` row). No assertion was loosened and no product code changed.
- **Task 21 Step 2:** the `package.json` grep missed the tab-indented line.

After Task 19: tsc clean; oxlint and oxfmt clean on the 127 changed paths; the antd lint at 0; `i18next-cli lint` clean and zh and ar at 100% (593 keys); `pnpm test` 206 files and 2,930 tests; `pnpm test:db` 13 files and 151 tests; Task 21's boundary greps as listed. e2e, on an empty PostgreSQL: `agui-files`, `agui-logs` and `agui-admin` on desktop-light, mobile-light and desktop-dark, 20 passed each (setup plus 19), none failed or skipped; 2a's and 2b's `agui-chat` and `agui-hitl` with the Dify chat's `chat-files` and `chat` on desktop-light, 59 passed; the new screenshots on the three projects, 10 passed; no hydration or uncaught browser error in any final run. Each task's Verify counts are the ones seen. The build still runs every gate itself: the pre-flight proves the plan applies, not the branch.

One observation for the owner's check, unchanged by the plan: after the last card is removed from the composer, its hidden element replays its leave animation when a new file opens the list again (X 2.9's own behaviour; the Dify chat shows it too).
