# Part 2c research: attachments, documents and images, the Logs (2026-10-15)

The research behind Part 2c's plan (`docs/superpowers/plans/2026-10-15-part-2c-agui-files-logs.md`). The owner answered the plan's questions (running record decision 69) and then asked: "after you finish all of your questions, I want you to look online for documentation, best practices, and relevant projects and how they deal with those." Three research passes followed, one per area; their findings led to the owner's second set of answers (decision 70). Each part adds to the earlier Part 2 notes beside this one (`part2-hitl-state-files.md` §4, `part2-store-and-logs.md` §4–§7) and does not repeat them. Facts come first, each with its source; "docs silent" marks a gap, and **(opinion)** marks the researcher's own reading.

- **R1** (attachments): file-only messages, the name against the bytes, unsent files, upload timing, refusals and caps.
- **R2** (documents and images): `pdfjs-dist` and its Node usage, security and limits (with measurements), Next.js bundling, long and empty documents, images with sharp, text files.
- **R3** (the Logs): the attachment audit, numbered pages, the in-chat notice, and how reference products show logs.

R1 §3 and R2's implications were written before decision 70: they examine decision 69's answers, and decision 70 then reversed the delete route (R1 §3) and settled the points R2 raised (the worker thread, 50 MP, UTF-16, the small additions).

## R1: Attachments — the owner's three answers, upload timing, refusals, caps

Read-only research for slice 2c (spec §7.1). It adds to `part2-hitl-state-files.md` §4 and "Implications D" and does not repeat them. Facts first, each with its source; "docs silent" marks a gap; **(opinion)** marks my reading. "L" = line numbers at the named commit.

### Sources and versions read

| Source | Version / commit | How read |
| --- | --- | --- |
| `@ant-design/x` (Sender, Attachments, FileCard) | 2.9.0 in `node_modules`; repo `main` @ `fc3a0cc7f359` for demos | `es/**/*.js`/`.d.ts`; `gh api`; Context7 `/ant-design/x` |
| antd `Upload` | 6.6.5 | `antd doc Upload` |
| Next.js bundled docs | 16.3.4 | `node_modules/next/dist/docs/` |
| WHATWG Encoding; MDN `TextDecoder()`, `Blob.type` | live, 2026-10-15 | WebFetch |
| AG-UI docs (multimodal inputs, run input, schema 1.0) | live, 2026-10-15 | `docs.ag-ui.com/*.md` |
| OWASP File Upload CS / Input Validation CS | `89a49d9d8d85` / `b9500094c112` | `gh api` |
| LibreChat | `main` @ `e1dfc10449ff` (2026-10-06) | `gh api` + sparse blob-less clone (deleted) |
| Open WebUI | `main` @ `6a18585ff4c2` (2026-10-14) | `gh api` |
| LobeHub | `canary` @ `76495d1fd060` (2026-10-15) | `gh api` |
| vercel/ai-chatbot | `main` @ `c2f8235e1f3e` (2026-07-08) | `gh api` |
| vercel/ai-elements (`PromptInput`) | `main` @ `ca8be600bfd0` (2026-10-14) | `gh api` |
| assistant-ui | `main` @ `c71326ff9c91` (2026-10-15) | `gh api` |
| CopilotKit | `main` @ `5bdb48347d1e` (2026-10-15) | `gh api` |
| vstorm full-stack template | `475f799f7df0` | the repo's git-ignored `tmp/refs/fsat` (read only) |
| pydantic-ai | tag `v2.56.0` (`4cd82817fcb2`) | `gh api` |
| `file-type` README; pdf.js | `11e0d6473a37` (v22.2.0); `master` @ `0252c1f6c97d` | `gh api` |
| Claude vision docs; OpenAI images guide | live, 2026-10-15 | WebFetch |

---

### 1. File-only messages (owner: allowed)

**Docs**

- X's own Sender demo "Disable Ctrl" ("Customize the disable sending logic") does exactly this: `const submitDisabled = items.length === 0 && !value && !loading;` and `suffix={(_, info) => <info.components.SendButton disabled={submitDisabled} />}` (`packages/x/components/sender/demo/disable-ctrl.tsx` L15, L83–95; listed in `sender/index.en-US.md` L29).
- Mechanism in 2.9.0: `ActionButton` takes `restProps.disabled ?? rootDisabled ?? context.onSendDisabled` and pushes it to the Sender with `setSubmitDisabled` (`es/sender/components/ActionButton.js` L19–22); the Enter key path checks the same flag (`es/sender/Sender.js` L133–137). So the override governs both the button and Enter. X's default is `onSendDisabled: !innerValue` (L184), untrimmed: whitespace alone enables Send.
- AG-UI: `UserMessage.content` is "`string` | array of ContentPart, **required**" (schema 1.0, `UserMessage`); nothing requires a text part in the array (docs silent on a minimum). Every multimodal example puts text first (`sdk/js/core/multimodal-inputs.md`), none shows media alone.
- The hub's run body today refuses blank text: `runBodySchema.message.text` `.refine(text => text.trim() !== '')`, and "2a has no `attachmentIds` (2c adds them)" (`lib/chat/schemas.ts` L33–47). The conversation title already allows "empty when the message had no text" → localised "New conversation" (spec §3.1 L158).

**Best practice:** none in OWASP; product convention below.

**References** | Project | File-only? | Where | | --- | --- | --- | | LibreChat | yes: `isSubmittableMessage = text.trim() !== '' \|\| fileCount > 0`, "Lets users send a file without having to type a placeholder message" | `client/src/utils/messages.ts` L432–438; `SendButton.tsx` L11–12, L43–45; `useChatFunctions.ts` L375–393 | | Open WebUI | yes: Send disabled only when `prompt === '' && files.length === 0` | `MessageInput.svelte` L2871; `Chat.svelte` L3718–3719 | | LobeHub | yes: `if (!message && !hasFile) return`; title falls back to a default | `conversationLifecycle.ts` L718–726 | | assistant-ui | yes: `isEmpty = !text.trim() && !sendableAttachments.length`; `canSend` false when empty | `base-composer-runtime-core.ts` L84–86, L340–342; `default-thread-composer-runtime-core.ts` L29–32 | | AI Elements | yes (example): `if (!(hasText \|\| hasAttachments)) return` | `packages/examples/src/prompt-input.tsx` L176–182 | | vstorm | yes: button disabled when `!message.trim() && attachedFiles.length === 0` | `chat-input.tsx` L97–99, L395 | | vercel/ai-chatbot | mixed: the submit handler allows it (L403–405) but the button is `disabled={!input.trim() \|\| uploadQueue.length > 0}` (L570) | `components/chat/multimodal-input.tsx` | | CopilotKit | no in the stock input (`canSend = value.trim().length > 0`), but when files exist it **omits the text part** if the text is blank | `CopilotChatInput.tsx` L479–481, L517; `CopilotChat.tsx` L942–960 |

- Empty text parts: Anthropic's API rejects "text content blocks must be non-empty" (third-party reports: portkey.ai error library, Warp #5852; Anthropic docs silent). Pydantic AI 2.56's Anthropic mapper drops empty text itself ("Only yield non-empty text", `models/anthropic.py` L3105, L3111), but the hub talks to any AG-UI agent.

**Implications (opinion)**

- The evidence supports the owner: six of eight references allow it, and X documents the exact `SendButton disabled` override. Nothing argues for raising it again.
- Concrete follow-ons for the plan: (a) the run schema becomes "non-blank text **or** ≥1 attachment id"; (b) build `content` without a text part when the text is blank (CopilotKit's shape), never `{type:'text', text:''}`; (c) the override should trim (`!text.trim() && readyCount === 0`), as LibreChat and assistant-ui do, and also stay disabled while a card uploads or shows an error.

### 2. Name vs bytes (owner: "the extension claims the kind, the bytes must prove it")

**Docs**

- MDN `Blob.type`: browsers "won't actually read the bytestream … It is assumed based on the file extension; a PNG image file renamed to .txt would give `text/plain`"; uncommon extensions give `""`; "Client configuration (for instance, the Windows Registry) may result in unexpected values"; "not … a sole validation scheme". So the multipart part's type adds nothing over the extension.
- antd `Upload.accept` / `AcceptObject.format` is "same as native input accept attribute"; `filter: 'native'` uses browser filtering (`antd doc Upload` L44, AcceptObject) — a picker hint, not validation.
- sharp `metadata().format`: "Name of decoder used to parse image e.g. jpeg, png, webp, gif, svg, heif, tiff" (sharp.pixelplumbing.com/api-input) — the decoder picks by content, so a mislabelled image reports its real format.
- `file-type`: "for detecting binary-based file formats, not text-based formats like `.txt`, `.csv`, `.svg`" (README L9; `.csv` listed as undetectable L623).
- WHATWG Encoding: with `fatal: true`, `decode()` "throws a TypeError" on invalid input (§7.2 `#dom-textdecoder-decode`); `ignoreBOM` defaults to false, so a UTF-8 BOM is stripped (§7.1 serialize).
- PDF header: pdf.js searches for `%PDF-` within the first 1024 bytes and does not throw when absent (`src/core/document.js` L950–956, L1132–1141); Adobe's implementation note allows the header "somewhere within the first 1024 bytes" (secondary: idrsolutions, Apache TIKA-1085).

**Best practice**

- OWASP File Upload CS: "List allowed extensions" and "Validate the file type, don't trust the Content-Type header" (L9–11); validate the extension after decoding, against double extensions, null bytes, case, NTFS `:` (L49–60); signature checks "should not be used on its own" (L86–90); filename length limit (L13, L96–103).
- OWASP Input Validation CS: "an allowed extension alone does not establish safe content" (L60); "checking a filename is not checking the file's contents" (L73). Together: allowlist the extension **and** prove the content — the owner's rule.

**References** | Project | How the type is decided | Where | | --- | --- | --- | | LobeHub | browser-side `file-type` sniff; when the bytes say a different `image/*`, the file is relabelled and keeps its name (the owner's ".jpg that is a PNG stays PNG"); extension trusted over sniffing for audio containers | `src/store/file/slices/upload/action.ts` L73–89, L219–225; `chat/uploadGuard.ts` L109–155 | | LibreChat | trusts the browser type, extension only as fallback (`inferMimeType`), 415 on unsupported; images re-read by sharp ("has to describe the bytes on disk"); PDF `%PDF-` at offset 0 checked before provider send | `file-config.ts` L535–542; `routes/files/multer.js` L74–80, L121–124; `packages/api/src/files/mime.ts` L22–45; `files/validation.ts` L85–99 | | Open WebUI | extension allowlist (`rag.file.allowed_extensions`, 400), browser content type, and a text heuristic: NUL byte → binary, else UTF-8, **else Latin-1** "so that legacy-encoded files from Windows environments are not misclassified" | `routers/files.py` L66–94, L354–362 | | vercel/ai-chatbot | browser `Blob.type` in `["image/jpeg","image/png"]` only | `app/(chat)/api/files/upload/route.ts` L7–16 | | assistant-ui / CopilotKit / AI Elements | `accept` matched against browser `file.type` or the name's extension, client-side | `attachment.ts` L187–220; `shared/src/attachments/utils.ts` L126–140; `prompt-input.tsx` L555–576 | | vstorm | browser `content_type` allowlist; text decoded as UTF-8, `None` on failure (not refused) | `services/file_upload.py` L40–50, L83–88 |

**Implications (opinion)**

- Supported. The owner's rule is OWASP's two-step (allowlist, then content proof) and is stricter than every reference except LobeHub's image relabelling, which it matches. No reason to revisit "exact match" (MDN: the browser type is the extension anyway) or "bytes decide everything" (OWASP wants the allowlist; text kinds cannot be sniffed).
- Worth raising, on the **settled** text rule rather than on the owner's answer: "valid UTF-8" will refuse CSVs saved by Excel's plain "CSV (Comma delimited)" with non-ASCII text (a legacy code page; secondary sources: ablebits, hilton.org.uk; Microsoft docs not found) and UTF-16 text. Open WebUI chose a Latin-1 fallback for this reason. For an Arabic-locale hub this is a realistic refusal; the 400 message should say "save as UTF-8" at least.
- "Bytes prove text" is weak: any valid UTF-8 passes, including NUL bytes. Open WebUI's NUL check is a cheap extra (opinion: refuse U+0000).
- Precise the extension parse (OWASP L49–60): lowercase, last dot only, no extension → 415, refuse `:`/NUL in names, cap the stored `name` length.
- `%PDF-` at offset 0 (LibreChat's check) refuses rare files pdf.js would open; acceptable, but say so in the plan.

### 3. Unsent files (owner: no delete route, the purge removes them after 24 h)

**Docs**

- assistant-ui's documented production adapter: "`remove` deletes the uploaded file. It runs only if the user removes the attachment from the composer before sending", with a DELETE route that "rejects a key outside that user's prefix" (`apps/docs/content/docs/integrations/attachments/custom-adapter.mdx` L18–22, L75–104, L516). Its bundled `SimpleImageAttachmentAdapter.remove()` is a no-op because nothing was uploaded (`attachment.ts` L52–54).
- antd/X: `onRemove` "remove event will be prevented when the return value is false or a Promise which resolve(false)" (`antd doc Upload` L74) — the hook a delete call would use. AG-UI, Next: docs silent.

**Best practice:** OWASP is silent on orphaned uploads; it asks for size limits and "download request limits" (prior §4.5). LibreChat rate-limits uploads: 50 per user and 100 per IP per 15 min (`api/server/middleware/limiters/uploadLimiters.js` L7–10).

**References** | Project | Removed before send | Swept later | | --- | --- | --- | | LibreChat | **deleted**: debounced (1 s) batch DELETE unless the file is already `attached` | `createFile` sets `expiresAt` +1 h (Mongo TTL), cleared on use; but chat images and agent uploads pass `disableTTL` (`process.js` L533, L1008, L1355) | | LobeHub | **deleted**: `fileService.removeFile(id)`; a failed or pending draft is client-only | none found | | assistant-ui | adapter's `remove`; Cloud adapter aborts the upload and forgets the URL (`CloudFileAttachmentAdapter.ts` L159–168) | none | | Open WebUI | UI only (`files.splice`); the file stays in the user's library | none found at this commit | | ai-chatbot / vstorm / CopilotKit | state only (public Vercel Blob never deleted; vstorm row stays; CopilotKit holds base64 in memory) | none | | AI Elements | `URL.revokeObjectURL`; nothing on a server | n/a |

Sources: LibreChat `client/src/hooks/Files/useFileDeletion.ts` L89, L97–156; `packages/data-schemas/src/schema/file.ts` L188–194; `methods/file.ts` L1083–1101, L1240. LobeHub `src/store/file/slices/chat/action.ts` L209–232. Open WebUI `MessageInput.svelte` L2114–2117. ai-chatbot `multimodal-input.tsx` L624–631, `route.ts` L52–54. vstorm `chat-input.tsx` L253–255. CopilotKit `use-attachments.tsx` L348–350.

**Implications (opinion)**

- The evidence is split: the two big hubs that store files (LibreChat, LobeHub) and assistant-ui's docs delete on remove; Open WebUI and the smaller projects never delete. A 24 h sweep alone is a legitimate choice (LibreChat leans on a TTL too), so this does not by itself argue for reversing the answer.
- **One concrete reason to look again: the caps.** Without a delete route the server cannot tell a removed card from one about to be sent. If upload counts unsent rows toward "6 MB per conversation" or "5 files per message", a user who removes and re-adds files is refused for up to 48 h. Keeping the owner's answer, the spec should say: upload checks only the per-file cap and the conversation's **sent** total; the run route (which receives `attachmentIds`) checks 5 per message and 6 MB per conversation. A new conversation has no id at upload time, which forces that anyway.
- Second, unsent rows are unbounded within 24 h (5 MB each, in `bytea`). A per-user cap on unsent bytes or an upload rate limit (LibreChat's 50/15 min) closes it without a delete route.

### Upload timing and refusal UI (settled: upload at pick; error on the card; Send waits)

**Docs**

- antd Upload uploads on selection by default; "Uploading will be stopped with `false`" from `beforeUpload`, and `Upload.LIST_IGNORE` keeps a file out of the list (`antd doc Upload` L46); `customRequest` replaces the XHR (L47). `status: error` shows "different style" (L96).
- X 2.9.0 `Attachments` card text: `description` if set, else `percent%` while uploading, else for `error` the `response` when it is a string, otherwise "error" (`es/attachments/FileList/index.js` L37–44). `maxCount` is the list limit (`index.js` L26). The hub's Dify chat already relies on this (`components/chat/chat-view/sender-attachments.tsx`, `ready: !uploading && !failed`).
- Next 16: `request.formData()` in a Route Handler (`03-file-conventions/route.md` L501–523). Above `proxyClientMaxBodySize` (10 MB) the body "will only be buffered up to the limit … The request will not fail" (`proxyClientMaxBodySize.md` L7–9, L71–76); docs silent on a Route Handler size limit (only Server Actions have `bodySizeLimit`, `server-actions.md` L83).

**References**

- Upload at pick: LibreChat (`useFileHandling.ts` L360, `uploadFile.mutate`), Open WebUI (`MessageInput.svelte` L990–1006 `status: 'uploading'`), LobeHub (`chat/action.ts` L281+), ai-chatbot (L270–298), vstorm (L192–211), assistant-ui Cloud (`add` yields `running/uploading`, L64–80), CopilotKit (reads base64 or calls `onUpload` at pick, L120–125). At send: AI Elements (blob URL → data URL on submit, `prompt-input.tsx` L81–95, L867–878), assistant-ui Simple adapters (L36–50).
- Refusal kept **on the card**: LobeHub (`status: 'error'` with a described reason, plus Retry; `chat/action.ts` L393–402, L234–241); assistant-ui Cloud (`incomplete`/`error` with `message`, L142–150). **Toast and dropped**: LibreChat (`deleteFileById` + toast, `useFileHandling.ts` L322–345, L233–255), Open WebUI (L1098–1106), ai-chatbot, vstorm, CopilotKit (`onUploadFailed`, L146–158), AI Elements (`onError` codes `max_files|max_file_size|accept`, L501–506, L581–612).
- Send waits for uploads: LibreChat (`filesLoading`, `ChatForm.tsx` L235, L636), Open WebUI (`uploadPending`, L2871; a send with uploading/error files is queued, `Chat.svelte` L3759–3763), ai-chatbot (`uploadQueue`), CopilotKit ("Cannot send while attachments are uploading", `CopilotChat.tsx` L929–938), vstorm (`isUploading`).

**Implications (opinion)**

- Supported: pick-time upload is antd's default and what every storing hub does; error-on-card is X's built-in rendering and LobeHub's/assistant-ui's choice. A toast-and-drop design (LibreChat, Open WebUI) is the main alternative; the card is better for i18n'd server reasons (413/415/400 text stays next to the file).
- Check `Content-Length` before `formData()` and answer 413 `attachment_too_large` early: a body above 10 MB arrives truncated, and `formData()` would fail as a parse error (→ 400) instead of a size error. A pre-check is plain HTTP, not a custom mechanism.

### Caps (settled: 5 MB per file, 5 files per message, 6 MB per conversation)

| Source | Per file | Per message | Per conversation |
| --- | --- | --- | --- |
| LibreChat | `fileSizeLimit` 512 MB default | `fileLimit` 10; `totalSizeLimit` = composer files + incoming (`files.ts` L342–381; `file-config.ts` L553–591) | none; `resendFiles` default true: "this will increase token cost and you may experience errors with many attachments" (`parameterSettings.ts` L124–135; `translation.json` L534) |
| Open WebUI | `file.max_size` (unset default) | `file.max_count` (`MessageInput.svelte` L1149–1180) | none |
| ai-chatbot | 5 MB (`route.ts` L10–12) | — | none |
| vstorm | 10 MB (`file_storage.py` L28) | — | none |
| CopilotKit | 20 MB default (`use-attachments.tsx` L17) | — | none |
| AI Elements | `maxFileSize` | `maxFiles` | none |
| Claude API | 10 MB **base64-encoded** per image (5 MB on Bedrock/Vertex) | 100–600 images; 20 per message on claude.ai | request 32 MB; "each request resends the full conversation history … full image bytes are included in the payload on every turn" |
| OpenAI images | patch limit, no byte limit stated | 1,500 images | 512 MB payload |

**Implications (opinion)**

- Supported: no reference caps a conversation, and LibreChat's own warning plus Claude's docs describe the failure the 6 MB cap prevents (decision 54). 6 MB raw ≈ 8 MB base64 per run, well under Claude's 32 MB.
- Two details for the plan: (a) count stored bytes (after re-encoding/extraction), since that is what is re-sent; (b) a 5 MB raw image is ≈ 6.7 MB base64 — fine on the Claude API (10 MB) but over Bedrock/Vertex's 5 MB per image; an agent behind those providers fails unless `maxImageEdge` shrinks it. Worth one line in the admin help, not a cap change.
- UX: with 5 MB per file and 6 MB per conversation, a second large file in a conversation is refused with 413 `conversation_attachments_full`; the card's text should say the conversation is full, not the file too large.

## R2: Documents and images — PDF text, long and empty documents, images, text files

Read-only research for 2c's plan (spec §7.1, §9). Adds to `part2-hitl-state-files.md` §4 and "Implications D" and does not repeat them. Facts come first, each with its source. "Docs silent" marks a gap. **(opinion)** marks my own reading. "Measured" means I ran it on Node 22.21.1 (the Docker image's version) against the npm tarballs, outside the repo. The scripts are in the scratchpad's `r2/scripts/`.

### Sources and versions read

| Source | Version / commit | How read |
| --- | --- | --- |
| `pdfjs-dist` | 6.4.299 (npm, 2026-10-03; `latest`) | `npm pack`: `legacy/build/pdf.mjs`, `pdf.worker.mjs`, `types/`, `package.json` |
| `mozilla/pdf.js` | tag `v6.4.299` = `d0991a0d53f3` | `gh api`: `examples/node/getinfo.mjs`, `src/display/api.js`, `test/unit/api_spec.js`, README, docs pages, test PDFs |
| pdf.js wiki FAQ | live, 2026-10-15 | crawl4ai |
| pdf.js advisories, PRs, issues | GHSA-wgrm-67xf-hhpq, GHSA-hq66-cqwq-w95j; PRs #18015, #21002, #21005; issues #19946, #21720, #21934 | `gh api` |
| Context7 | `/mozilla/pdf.js/v6.3.289`, `/lovell/sharp`, `/pnpm/pnpm.io` | query-docs |
| `unpdf` | 1.9.0 (bundles pdf.js 6.4.299) | `npm pack`, README, `dist/index.mjs` |
| Next.js | 16.3.4 in the repo (`node_modules/next/dist/docs`, `dist/lib/server-external-packages.jsonc`); vercel/next.js #65406, #89177, #91642, #100227 | read, `gh` |
| LobeHub | `lobehub/lobehub` `canary` @ `76495d1fd060` (2026-10-15) | `gh api` |
| LibreChat | `main` @ `e1dfc10449ff` (2026-10-06) | `gh api` |
| Open WebUI | `main` @ `6a18585ff4c2` (2026-10-14), docs env page | `gh api` |
| AnythingLLM | `master` @ `7cbea8025211` (2026-10-14) | `gh api` |
| Dify | `main` @ `f7840ab2134b` (2026-10-15); `langgenius/graphon` `v0.7.0` = `11e2dee8cbd6` (Dify pins `graphon==0.7.0`) | `gh api` |
| sharp | 0.35.4 docs at tag `v0.35.4` (`4f02be9e5a9d`), fixtures from the same tag; the repo's installed sharp 0.35.4 | `gh api`, measured |
| Node.js 22 docs | `worker_threads`, `errors` | nodejs.org |
| MDN `TextDecoder()`; WHATWG Encoding | MDN 2025-06-28; spec "Last Updated 21 May 2026" | fetched |
| PostgreSQL 18 | Character Types | postgresql.org |
| Claude PDF support; DPReview iPhone 15 | live | fetched / search |
| GitHub Advisory DB | `pdfjs-dist`, `pypdf` (pip) | `gh api /advisories` |

---

### PDF library and its Node usage

- **The documented Node path is the legacy build.**
  - The official example `examples/node/getinfo.mjs` (lines 9–54) does `import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"`. It then loops `getPage(i)` and `getTextContent()`, joins `items.map(item => item.str).join(" ")`, calls `pdfPage.cleanup()`, and ends with `await loadingTask.destroy()`.
  - `docs/contents/examples/index.md` line 14 points to `examples/node/` for "usage in Node.js".
  - The FAQ's `legacy` build table lists "Node.js 22+ | Mostly | Limited | Some missing features, but no problems in general."
  - The modern build warns "Please use the `legacy` build in Node.js environments." (`build/pdf.mjs` line 9589).
  - The package has no `exports` map, `engines` `node >=22.13.0 || >=24`, and the optional dependency `@napi-rs/canvas ^1.0.10`. It is 34.9 MB unpacked.
- **The worker in Node.**
  - When `isNodeJS`, `PDFWorker` sets `#isWorkerDisabled = true` and `GlobalWorkerOptions.workerSrc ||= "./pdf.worker.mjs"` (legacy `pdf.mjs` ~22556–22560). It always uses the "fake worker" on the calling thread.
  - The fake worker uses `globalThis.pdfjsWorker.WorkerMessageHandler` if it is set. Otherwise it does `import(/*webpackIgnore: true*/ /*@vite-ignore*/ this.workerSrc)` (22711–22729). `pdf.worker.mjs` sets that global (worker line 71118).
  - Nothing needs configuring for text extraction. Messages go through `LoopbackPort` as promise microtasks (14818–14832), and the worker "yields" with `const deferred = Promise.resolve()` (worker 39770). See "Security and limits" for what that means.
- **Text items.**
  - `TextItem` has `{ str, dir, transform, width, height, fontName, hasEOL }`, where `hasEOL` means "Indicating if the text content is followed by a line-break". Whitespace "will be replaced by standard spaces (0x20)" (`api.js` 1167–1176, 1732).
  - `page.streamTextContent()` is public and documented: "`@returns {ReadableStream}` Stream for reading text content chunks" (1731–1756). `getTextContent()` is that stream collected in full (1765–1785).
  - How each project joins the items:
    - pdf.js's own test helper: `items.map(chunk => (chunk.str ?? "") + (chunk.hasEOL ? "\n" : "")).join("")` (`test/unit/api_spec.js` 87–91).
    - unpdf `extractText`: the same.
    - `getinfo.mjs` and LibreChat: joined with `" "`.
    - LobeHub: a newline whenever `transform[5]` (y) changes (LangChain's logic, `loaders/pdf/index.ts` 77–95).
- **CMaps and standard fonts.**
  - In Node, pdf.js reads them with `fs.readFile(baseUrl + filename)` (`NodeBinaryDataFactory`, legacy `pdf.mjs` 15842–15859). So `cMapUrl` and `standardFontDataUrl` must be **filesystem paths ending in `/`**; `getFactoryUrlProp` throws otherwise (14806–14814).
  - The official `pdf2png.mjs` example passes both. Measured on pdf.js's test file `90ms_rksj_h_sample.pdf`:
    - With `cMapUrl`: `"Hello ASCII\n日本語テスト"`.
    - Without it: `"Hello ASCII"` only, plus the warning ``loadFont - translateFont failed: "UnknownErrorException: Ensure that the `cMapUrl` API parameter is provided."``. The warning is silent at `VerbosityLevel.ERRORS`, so the CJK text disappears without any visible error.
    - Without `standardFontDataUrl` the text was identical, with a warning.
  - `wasmUrl` serves image decoders and ICC, not text.
- **`@napi-rs/canvas` is not needed for text in 6.4.299.**
  - At import, `pdf.mjs` tries `require("@napi-rs/canvas")` to polyfill `DOMMatrix` and `Path2D`, and warns if it is missing (15808–15833).
  - In 6.1.200 and 6.2.108 the import threw `ReferenceError: DOMMatrix is not defined` without it (#21720, closed 2026-08-06). In 6.4.299 the matrix is created lazily (`#SCALE_MATRIX ??= new DOMMatrix()`, 19505).
  - Measured: the import and the extraction work without the package, with three warning lines at import. A crafted Type3 bitmap-font PDF (TeX-style image-mask glyphs, which reach `DOMMatrix` in `compileType3Glyph`) still gave its text, with warnings `Type3 font resource "a" is not available`.
  - `@napi-rs/canvas-linux-x64-musl` 1.0.11 is 31 MB unpacked. pnpm's `ignoredOptionalDependencies` skips it (pnpm docs, dependency-resolution settings). LobeHub ships its own `DOMMatrix` polyfill instead (`loaders/pdf/domMatrix.ts`).
- **Errors.**
  - Without an `onPassword` callback, `loadingTask.promise` rejects with `PasswordException` (`api.js` 2733–2753). Measured on pdf.js's `issue3371.pdf`: `code` 1 "No password given"; with a wrong password, `code` 2 "Incorrect Password".
  - Bytes that are not a PDF give `InvalidPDFException` "Invalid PDF structure.".
  - An image-only PDF (a "scan") gives `""` after `trim()`.
- **`data`.** "If TypedArrays are used they will generally be transferred to the worker-thread … it will take ownership of the TypedArrays" (`api.js` 113–119). Pass a copy if the same buffer is also stored.
- **Releases.** Roughly monthly: 6.0.227 (05-30), 6.1.200 (06-27), 6.2.108 (07-28), 6.3.289 (08-29), 6.4.299 (10-03). A maintainer wrote "Only the latest release is supported." (#21934).
- **unpdf 1.9.0 (not taken).**
  - Its bundle "is built from PDF.js v6.4.299" (README line 94).
  - `getDocumentProxy` adds `cMapUrl` and `standardFontDataUrl` only when `pdfjs-dist/package.json` resolves (`dist/index.mjs` 64–82). Measured with unpdf alone: the CJK sample gave `"Hello ASCII"` only, with the same `cMapUrl` warning.
  - `extractText` reads all pages at once (`Promise.all`).
- **What the reference projects use:**
  - **LibreChat:** `pdfjs-dist ^5.4.624`; `await import('pdfjs-dist/legacy/build/pdf.mjs')`, then `getDocument({ data })` with defaults, then `str` joined with `" "` (`packages/api/src/files/documents/crud.ts` 74–93).
  - **LobeHub:** `pdfjs-dist 5.4.530`. It imports the legacy build and then `pdfjs-dist/legacy/build/pdf.worker.mjs` (to set `globalThis.pdfjsWorker`), and calls `getDocument({ data, useSystemFonts: true })` (`packages/file-loaders/src/loaders/pdf/index.ts` 23–35, 52–55).
  - **AnythingLLM collector:** `pdf-parse ^1.1.1`, which bundles pdf.js **v1.10.100**, with `isEvalSupported: false, useSystemFonts: true` (`collector/processSingleFile/convert/asPDF/PDFLoader/index.js` 13–17, 86).
  - **Open WebUI:** pypdf `PdfReader(...).extract_text()` (`backend/open_webui/retrieval/loaders/pdf.py` 21–44), run off the event loop with `asyncio.to_thread` (`loaders/main.py` 368–386).
  - **Dify:**
    - Knowledge: pypdfium2 `get_textpage().get_text_range()` (`api/core/rag/extractor/pdf_extractor.py` 98–117).
    - Chat document extractor: pdfium, then a pypdf fallback (graphon 0.7.0 `src/graphon/nodes/document_extractor/node.py` 503–561).

**Implications (opinion).**

- The evidence supports `pdfjs-dist` through the legacy build. It is Mozilla's documented Node path, and LibreChat and LobeHub use it the same way.
- unpdf adds nothing for a Node server, and alone it lost CJK text in the test.
- Nothing argues for another library. The plan should still take three points from this section:
  - Pass absolute `cMapUrl` and `standardFontDataUrl` paths. The hub has zh users, and missing CMaps fail silently.
  - Pin exactly and bump with each monthly release, since only the latest release is supported.
  - Skip `@napi-rs/canvas` with `ignoredOptionalDependencies`, plus a unit test that imports pdf.js and extracts a fixture. That test fails if a later release needs `DOMMatrix` at import again. Keeping the package is the other choice (31 MB native binary).

### Security and limits

- **CVE-2024-4367** (GHSA-wgrm-67xf-hhpq):
  - Affects ≤ 4.1.392; fixed in 4.2.67.
  - "If pdf.js is used to load a malicious PDF, and PDF.js is configured with `isEvalSupported` set to `true` (which is the default value), unrestricted attacker-controlled JavaScript will be executed".
  - Fix: #18015, "remove the use of eval in the font loader". Workaround: `isEvalSupported: false`.
- **`isEvalSupported` no longer exists.**
  - #21002 (merged 2026-03-30) replaced the eval-based PostScript interpreter with a Wasm compiler.
  - #21005 (merged 2026-04-04) "Also removes the `isEvalSupported` API option, since the `PostScriptCompiler` was the only remaining code where `eval` was used".
  - 6.4.299's `DocumentInitParameters` (`api.js` 110–215) and its types have no such option, and the builds contain no `new Function`. Passing it is ignored at runtime and is a TypeScript excess-property error (`getDocument(src?: DocumentInitParameters)`).
- **CVE-2026-16633** (GHSA-hq66-cqwq-w95j, 2026-07-28):
  - Affects ≥ 5.6.83 and < 6.2.108. The arbitrary-JS risk applies "with `enableScripting` set to true (which is the default value) and no CSP".
  - `enableScripting` is an annotation-layer (viewer) parameter (`pdf.mjs` 24052ff), not a `getDocument` option. Text extraction does not reach it, and 6.4.299 is past the fix anyway.
  - No other `pdfjs-dist` advisories after 2024 are listed (GitHub Advisory DB).
- **`getDocument` options that matter** (`api.js` 252–313 compute the defaults):
  - Defaults in Node: `disableFontFace` true, `useSystemFonts` false, `isOffscreenCanvasSupported` and `isImageDecoderSupported` false, `useWorkerFetch` false.
  - `enableXfa` defaults to false.
  - `stopAtErrors` defaults to false. When true, it rejects `getTextContent` "when the associated PDF data cannot be successfully parsed, instead of attempting to recover".
  - `maxImageSize` defaults to −1. Images above it "will not be rendered", so it affects rendering only.
  - **No option limits time, pages or decompressed size.** Docs silent.
- **Measured**, legacy 6.4.299 on Node 22.21.1, with a `setTimeout` meant to call `loadingTask.destroy()`:

| Input | Result |
| --- | --- |
| pdf.js's `compressed.tracemonkey-pldi-09.pdf` (14 pages, 1.0 MB, 82,791 chars) | 219 ms; longest event-loop stall 46 ms |
| crafted 92 KB PDF, one content stream inflating to 30 MB | `getTextContent` ran 4.0 s as **one 3.9 s event-loop stall**; the 1 s destroy timer never fired; 10.9 M chars |
| crafted 916 KB PDF, 300 MB inflated | ran ~56 s, then **the process died: "JavaScript heap out of memory"** (2 GB default heap); the 5 s timer never fired |
| same 916 KB file, `streamTextContent()` stopped at 100,000 chars | stopped after 1.0 s, but peak RSS 737 MB: the FlateDecode stream is inflated whole first (`asyncGetBytesFromDecompressionStream`, worker 9386–9420, no size cap) |
| same files in a `worker_threads` Worker with `resourceLimits: { maxOldGenerationSizeMb: 256 }` and a `terminate()` timer | tracemonkey 281 ms with main-thread stalls ≤ 10 ms; the 30 MB case was terminated at 1.0 s; the 300 MB case ended in `ERR_WORKER_OUT_OF_MEMORY` after 6.8 s, the process survived, **peak RSS 985 MB** |

- Node's docs on that last row: `resourceLimits` "only affect the JS engine, and no external data, including no ArrayBuffers. Even if these limits are set, the process may still abort if it encounters a global out-of-memory situation." (`worker_threads`, `new Worker` options).
- **pdf.js and `worker_threads`:** "That's not supported here, since we only support standard Web Workers." (maintainer on #21934, about importing pdf.js in a `worker_threads` worker; the Windows crashes reported there were in 5.x only).
- **How others bound the work:**
  - unpdf README, "Processing Untrusted PDFs": `maxImageSize: 16_777_216`, check `pdf.numPages`, "race extraction calls against a timeout". The measurement shows that a race cannot preempt the work.
  - LibreChat: 15 MB cap, in-process, no timeout (`crud.ts` 10, 29–36).
  - AnythingLLM: a separate collector service, i.e. a separate process.
  - Open WebUI: a thread.
  - Crafted-PDF exhaustion is a well-known class: pypdf alone has about 30 advisories in 2026, e.g. GHSA-x284-j5p8-9c5p "Manipulated FlateDecode image dimensions can exhaust RAM".
- **Encrypted PDFs in `native` mode.** Claude's PDF support requires "Standard PDF (no passwords/encryption)" (Claude docs, PDF support).

**Implications (opinion).**

- The library choice stands. "Its documented Node path" alone is not enough, though: that path runs on the request's thread and a timer cannot interrupt it. One upload under 1 MB froze the hub for 4 s or crashed it. Raise these with the owner; they belong in 2c's plan and ADR-0037:
  1. **Run the extraction in a `worker_threads` Worker** with `resourceLimits` and a wall-clock `terminate()` (e.g. 10 s). These are documented Node APIs. It bounds CPU and the JS heap and keeps the hub responsive.
     - It is our own pattern, not a pdf.js one (pdf.js "only support[s] standard Web Workers"), so it needs a sentence in ADR-0037.
     - A `child_process` is the stronger alternative: a separate process, which the kernel can kill on its own. It costs more to spawn.
  2. **Stop at 100,000 characters while streaming** (`streamTextContent`). Do not collect everything and then `slice`.
  3. **Inflated-stream memory stays unbounded** (external memory): 985 MB peak from a 916 KB file. A 5 MB file can go further and could get the 512 MB–1 GB container OOM-killed. Choices:
     - accept it, since only signed-in users of an app with `text` mode can trigger it and the container restarts;
     - lower the PDF byte cap in `text` mode;
     - use a child process. The owner should decide this knowingly.
  4. Map `PasswordException` and `InvalidPDFException` to `attachment_invalid`, and consider the same encryption check in `native` mode.
- **Recommended call**, inside the worker:

```ts
import { createRequire } from 'node:module'
import path from 'node:path'
import {
	getDocument,
	VerbosityLevel,
	PasswordException,
	InvalidPDFException,
} from 'pdfjs-dist/legacy/build/pdf.mjs'

const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
const task = getDocument({
	data: new Uint8Array(bytes), // a copy: pdf.js takes ownership (api.js 113–119)
	cMapUrl: `${root}/cmaps/`,
	cMapPacked: true, // CJK text (measured); filesystem path + trailing slash
	standardFontDataUrl: `${root}/standard_fonts/`,
	enableXfa: false,
	stopAtErrors: false, // documented defaults, stated on purpose
	useSystemFonts: false,
	disableFontFace: true, // Node defaults, stated on purpose
	verbosity: VerbosityLevel.ERRORS,
}) // no isEvalSupported: removed in #21005; then page.streamTextContent() with an early stop, and task.destroy()
```

### Next.js bundling

- **The repo today.**
  - `next` 16.3.4, `output: 'standalone'`, no `serverExternalPackages` (`next.config.ts`).
  - The Dockerfile deletes `.next/standalone/node_modules` and copies `pnpm deploy --prod` output instead (lines 11–18). So output tracing does not decide which `pdfjs-dist` files exist at runtime: `cmaps/`, `standard_fonts/` and `legacy/build/pdf.worker.mjs` are all there.
- **The documented opt-out.** The bundled `serverExternalPackages.md` says: "If a dependency is using Node.js specific features, you can choose to opt-out specific dependencies from the Server Components bundling and use native Node.js `require`."
  - The built-in list (`server-external-packages.jsonc`) has `canvas`, `sharp` and `@react-pdf/renderer`, **not `pdfjs-dist`** and not `@napi-rs/canvas`.
- **Turbopack and the worker import.**
  - Turbopack keeps imports marked with `webpackIgnore` or `turbopackIgnore` as they are. This has been supported since Next 15 RC.2 (#65406, closed 2024-10-04; bundled `08-turbopack.md` "Magic Comments").
  - **(Inference.)** So the fake worker's `import("./pdf.worker.mjs")` is resolved at runtime relative to `pdf.mjs`. If `pdf.mjs` were bundled into a chunk, the file would not be there; the same failure appears for Nuxt in #19946.
  - Listing `pdfjs-dist` as external keeps it in `node_modules`, where the relative import works.
- **LobeHub does both:** `serverExternalPackages: [..., 'pdfjs-dist', ...]` (`src/libs/next/config/define-config.ts` 364–372) and the worker import (`pdf/index.ts` 27–29).
- **Next issues touching `pdfjs-dist`:**
  - #100227 (open, 2026-10-15): a _client_ `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` while `pdfjs-dist` is external gives a Turbopack warning and a webpack error. The hub has no pdf.js in the browser, so this does not apply.
  - #89177: webpack-mode client crash through react-pdf.
  - #91642: per a maintainer, "next.js 16.2 adds new support for bundling worker threads". The bundled docs only say magic comments work with `new Worker()` expressions (`08-turbopack.md` 130). How a server-side worker file is bundled is otherwise docs silent.

**Implications (opinion).**

- Add `serverExternalPackages: ['pdfjs-dist']`. It is the documented mechanism, LobeHub does it, and it fits the Docker layout.
- If the extraction moves into a worker thread, 2c's plan needs a short spike on how that file is bundled and shipped. Either Next 16.2+ bundles `new Worker(new URL('./x', import.meta.url))`, or a plain `.mjs` is loaded with `turbopackIgnore` and copied into the image.
- The spike goes through `next build` and the Docker gate, not only `next dev`.

### Long and empty documents

| Project | Long text | What the model is told | Empty text (scans) |
| --- | --- | --- | --- |
| LobeHub | `FILE_INLINE_MAX_CHARS = 100_000` chars; above it a 4,000-char preview (`packages/prompts/src/prompts/files/file.ts` 18–21) | "[This is a preview, not the complete file, and no tool to read the rest is available here. Answer from the preview, and tell the user when the answer depends on the omitted part.]", or a `readAttachment` hint (83–84). A request-wide budget, because "Attachment text is re-sent on every turn" (`context-engine/src/tokenAccounting/attachmentBudget.ts` 69–79) | no refusal; only all-error pages fail (`file-loaders/src/loadFile.ts` 162–167) |
| LibreChat | `fileTokenLimit` default 100,000 **tokens** (`data-provider/src/file-config.ts` 555, 592); keeps the start (`api/src/utils/text.ts` 42–100) | nothing; `logger.warn` only (`files/context.ts` 75–87) | `if (!text?.trim()) throw new Error('No text found in document')` (`crud.ts` 38–42) |
| AnythingLLM | middle cut with `"--prompt truncated for brevity--"` when a prompt overflows (`server/utils/helpers/chat/index.js` 335–367) | the marker | OCR with tesseract.js, then refusal "No text content found in <file>." (`asPDF/index.js` 26–53) |
| Open WebUI | chunks for retrieval (no character cap found) | – | OCR only with `PDF_EXTRACT_IMAGES` (default `False`) or external engines; the default embedding path raises `EMPTY_CONTENT` "The content provided is empty. Please ensure that there is text or data present before proceeding." (`routers/retrieval.py` 1465–1466, `constants.py` 96); bypass mode passes it on |
| Dify (graphon 0.7.0) | none in the extractor | – | pdfium, then pypdf, then returns empty text, no refusal (`node.py` 503–561) |

- **Best practice for truncation notes.** I found no documented one in the AG-UI, Pydantic AI or Claude docs (docs silent). LobeHub's wording is the most explicit practice among the five projects.
- **Claude handles scans natively.** In `native` mode, Claude processes each PDF page as text plus an image (Claude docs, PDF support), so scans work there.
- **NUL characters.** PostgreSQL 18: "the character with code zero (sometimes called NUL) cannot be stored" in `text`. LobeHub strips `'\0'` from PDF text (`pdf/index.ts` 99). Open WebUI's `sanitize_text_for_db` removes "null bytes and invalid UTF-8 surrogates … for PostgreSQL storage" (`utils/misc.py` 919–926).

**Implications (opinion).**

- **The evidence supports "cut long, refuse empty".**
  - Refusing empty text is what LibreChat, AnythingLLM (after OCR) and Open WebUI's default path do.
  - 100,000 characters is exactly LobeHub's threshold.
  - "Refuse both" would throw away useful partial content, and "send empty with a marker" (Dify, LobeHub) wastes a run.
- For the plan:
  - **(a)** Make the cut during extraction (previous sections). Otherwise the cap protects nothing.
  - **(b)** Word the note so the model passes the limit on, after LobeHub: `[truncated: only the first 100,000 characters of report.pdf are included; tell the user when the answer may depend on the rest]`. With an early stop, the total length is unknown.
  - **(c)** Refuse empty only in `text` mode. In `native` mode a scan is fine for vision models.
  - **(d)** "Empty" means `text.trim() === ''`, as in LibreChat. A partly scanned PDF passes with its partial text. Fonts without ToUnicode give garbage text, which cannot be detected cheaply; accept both.
  - **(e)** Strip U+0000 before storing `extracted_text`.
  - **(f)** Cut on a code-point boundary: `slice` counts UTF-16 units and can split `𠮷` or an emoji.
  - **(g)** The per-file cap does not bound a run: 5 files × 100,000 characters are re-sent on every run (decision 54). LobeHub adds a request-wide budget. Worth a sentence in ADR-0037 even if the hub accepts it.

### Images (sharp)

- **Format, metadata and colour** (`api-output.md`, v0.35.4):
  - `toBuffer`: "If no explicit format is set, the output format will match the input image, except SVG input which becomes PNG output." and "By default all metadata will be removed, which includes EXIF-based orientation."
  - `keepMetadata`: without it, the default is "to convert to the device-independent sRGB colour space and strip all metadata, including the removal of any ICC profile".
- **Encoder defaults:**
  - `jpeg`: `quality` 80, `chromaSubsampling` `'4:2:0'`, `mozjpeg` false.
  - `png`: `compressionLevel` 6, `palette` false (lossless).
  - `webp`: `quality` 80, `lossless` false, `effort` 4.
  - `timeout({ seconds })` exists (since 0.29.2) and defaults to no limit.
- **Input options** (`api-constructor.md`):
  - `failOn`: default `'warning'`; "Use the default 'warning' level with untrusted input".
  - `limitInputPixels`: default 268402689 (0x3FFF²); "Assumes image dimensions contained in the input metadata can be trusted".
  - `autoOrient`: constructor option, default false. The `autoOrient()` operation: "Auto-orient based on the EXIF `Orientation` tag, then remove the tag".
  - `pages`: default 1, "Number of pages to extract for multi-page input (GIF, WebP, TIFF)"; `animated: true` reads all frames. `metadata().pages` reports the frame count.
  - `metadata()` lists no lossless/lossy flag for WebP (docs silent).
- **Resize** (`api-resize.md`): `fit: 'inside'` means "Preserving aspect ratio, resize the image to be as large as possible while ensuring its dimensions are less than or equal to both those specified"; `withoutEnlargement` means "Do not scale up if the width _or_ height are already less than the target dimensions".
- **Measured** (the repo's sharp 0.35.4, sharp's own fixtures, `{ limitInputPixels: 4096*4096, autoOrient: true }`, re-encoded to the same format with defaults):

| Input                                | Before | After                                     |
| ------------------------------------ | ------ | ----------------------------------------- |
| 2725×2225 JPEG photo                 | 829 KB | 651 KB (0.79)                             |
| 450×600 JPEG with EXIF orientation 6 | 138 KB | 83 KB; 600×450 upright, EXIF and ICC gone |
| 2048×1536 PNG                        | 655 KB | 538 KB                                    |
| 1024×772 WebP                        | 177 KB | **202 KB (+14%)**                         |
| 9-frame animated WebP                | 6.5 KB | 0.7 KB: **first frame only, no error**    |

- **Pixel limit and phone photos.** 4096×4096 is 16,777,216 pixels. The iPhone 15 family saves **24 MP by default** (DPReview, "best camera settings for iPhone 15"), which is ≈ 5712×4284 = 24.5 M pixels (my arithmetic). Those photos are refused; 12 MP (4032×3024) passes.
- **LibreChat** resizes with `sharp(input).rotate().resize({ fit: 'inside', withoutEnlargement: true, … })` to per-provider bounds (long side 2000, 1568 for Anthropic). It keeps sharp's default pixel limit (`api/server/services/Files/images/resize.js` 20–84).

**Implications (opinion).**

- The pipeline matches sharp's docs. Not one of the owner's two answers, but worth raising: **the 4096×4096 limit refuses default iPhone 15+ photos.** For `chatImage`, think about a higher limit, e.g. ~50 MP (24.5 MP RGBA decodes to ≈ 98 MB), together with `maxImageEdge` or a default edge. Otherwise users see `attachment_invalid` for an ordinary photo.
- Decide animated WebP explicitly: refuse when `metadata().pages > 1`, or accept the first frame. The default flattens silently.
- A lossless WebP becomes lossy at quality 80 and can grow, so count the **stored** bytes against the 6 MB per conversation.
- Add `.timeout({ seconds })`.

### Text files

- **Specs.**
  - MDN: `fatal` makes `decode()` "throw a `TypeError` when decoding invalid data". With `ignoreBOM` false (the default), "the byte order mark will be skipped over".
  - WHATWG Encoding: `TextDecoderOptions` has `fatal = false` and `ignoreBOM = false`. "If the error mode is "fatal" and encoding's decoder returns error, throws a TypeError."
- **Measured on Node 22.21.1** with `new TextDecoder('utf-8', { fatal: true })`:
  - a leading `EF BB BF` is removed;
  - invalid bytes throw `TypeError` with `code: 'ERR_ENCODING_INVALID_ENCODED_DATA'`;
  - `68 00 69` decodes to `"h\u0000i"`, because NUL is valid UTF-8;
  - a UTF-16LE file (`FF FE` BOM) throws.
- **The references:**
  - Open WebUI tries UTF-8 first, then chardet-guided CJK codecs (GB2312 mapped to `gb18030`), then latin-1 (`retrieval/loaders/main.py` 395–410).
  - LibreChat reads with `readFile(path, 'utf8')`, which replaces bad bytes and never refuses (`packages/api/src/utils/files.ts` 457–487).

**Implications (opinion).**

- `TextDecoder('utf-8', { fatal: true })` with default BOM stripping is the documented check.
- Also refuse or strip U+0000. A binary file renamed `.txt` can pass, and PostgreSQL cannot store NUL.
- Raise: zh users on Windows often have GBK/GB18030 (`.txt`, `.csv` from Excel), which UTF-8-only refuses. Open WebUI accepts them by detection.
- Keeping UTF-8 only is simple and documented. If the owner keeps it, the 400 message should say "save the file as UTF-8" in en, zh and ar.

## R3: The Logs — attachment audit, numbered pages, the in-chat notice

This note adds to `docs/superpowers/research/2026-10-11-provider-hub/part2-store-and-logs.md` §4, §5.6 and §7.7 and to spec §7.2. It does not repeat them. Facts come first, each with its source. "docs silent" marks a gap, and **(opinion)** marks my own reading. Reference code was read through `gh api` at the commits named below, with no clones.

### Sources and versions read

| Source | Version read |
| --- | --- | --- | --- | --- |
| OWASP Logging Cheat Sheet (`OWASP/CheatSheetSeries` `cheatsheets/Logging_Cheat_Sheet.md`) | last commit `d3b4f6f6fb92` (2026-10-04) |
| OWASP ASVS 5.0 (`OWASP/ASVS` `5.0/en/`, V14 and V16) | tag `v5.0.0_release` @ `5cf9b032440b`; checked identical on `master` |
| RFC 9111 (HTTP Caching), RFC 9110 §15.4.5 (304) | rfc-editor.org text, read 2026-10-15 |
| HTML Standard: "list of available images", lazy-loading attributes | html.spec.whatwg.org (living standard), read 2026-10-15 |
| Google Workspace: Drive log events (Admin help) and the Reports API Drive appendix | knowledge.workspace.google.com/admin/reports/drive-log-events; developers.google.com/workspace/admin/reports/v1/appendix/activity/drive, read 2026-10-15 |
| Microsoft Purview: "Audit log activities" | learn.microsoft.com/en-us/purview/audit-log-activities ("Last updated on 10/01/2026") |
| Nextcloud `admin_audit` (`nextcloud/server`) and its logging docs | `master` @ `15acdd7931a6`; docs.nextcloud.com/server/latest/admin_manual/configuration_server/logging_configuration.html |
| antd | 6.6.5, through `@ant-design/cli doc/demo Table | Pagination | Drawer | Timeline --version 6.6.5` |
| Next.js bundled docs | `node_modules/next/dist/docs/` of next 16.3.4 in the repo |
| Drizzle | Context7 `/drizzle-team/drizzle-orm-docs`; orm.drizzle.team/docs/guides/limit-offset-pagination |
| PostgreSQL | 18 docs: §7.6 LIMIT and OFFSET, SELECT, §3.5 window functions tutorial |
| ICO | "Monitoring workers" (hub page and "Data protection and monitoring workers"), "What methods can we use to provide privacy information?", read 2026-10-15 |
| GDPR Art. 13 | gdpr-info.eu/art-13-gdpr (EUR-Lex refused automated fetches in the earlier research) |
| langgenius/dify | `main` @ `f7840ab2` (line numbers moved since the earlier research's `e421dcc1`) |
| open-webui/open-webui; open-webui/docs | `main` @ `6a18585f`; docs @ `03d96980` |
| LibreChat-AI/LibreChat (`danny-avila/LibreChat` redirects there); LibreChat-AI/admin-panel | `main` @ `e1dfc104`; admin-panel @ `9315de90` |
| langfuse/langfuse | `main` @ `1d4f7563f754` |
| vstorm-co/agenticos | `main` @ `9ea7a718eb9c` (newer than the earlier research's `6f8d24c1`) |

Two helper agents read the reference code (sections 2 and 4). Five of their citations were re-read and matched: Dify `api/libs/pagination.py`, Dify `log/index.tsx` and Open WebUI `utils/audit.py`, plus Langfuse `usePaginationWindowPin.ts` and agenticos `repositories/agent_run.py`.

---

### 1. Every attachment fetch through the Logs is a download

#### Docs

- **OWASP Logging Cheat Sheet** (`d3b4f6f6fb92`). This adds to the earlier research's quotes (§5.6):
  - The list of events comes with a warning: "There is no one size fits all solution, and a blind checklist approach can lead to unnecessary 'alarm fog' that means real problems go undetected" (line 92).
  - Every entry records "when, where, who and what" (line 136). Under "Additionally consider recording" it lists "Object e.g. the affected component or other object (user account, data resource, file)" and "Result status" e.g. Success, Fail, Defer (lines 164–165).
  - "Never exclude any events from 'known' users such as … auditors" (line 186).
  - "Non sensitive personal data (e.g. personal names, telephone numbers, email addresses)" may "need to be treated in some special manner before the event is recorded" (lines 203, 208).
  - At rest: "All access to the logs must be recorded and monitored (and may need prior approval)" and "The privileges to read log data should be restricted and reviewed periodically" (lines 313–314).
  - Disposal: logs "must not be destroyed before the duration of the required data retention period, and must not be kept beyond this time" (line 335).
- **OWASP ASVS 5.0.0, V16** (Security Logging):
  - 16.1.1 (L2): an inventory documenting "what events are being logged … how access to it is controlled, and for how long logs are kept".
  - 16.2.1 (L2): each entry carries "when, where, who, what".
  - 16.3.2: "failed authorization attempts are logged. For L3, this must include logging all authorization decisions, including logging when sensitive data is accessed (without logging the sensitive data itself)". The hub's audit of successful reads is therefore an L3 control in ASVS terms.
  - 16.4.2 (L2): logs "are protected from unauthorized access and cannot be modified".
- **OWASP ASVS 5.0.0, V14** (Data Protection):
  - 14.3.2 (L2): "Verify that the application sets sufficient anti-caching HTTP response header fields (i.e., Cache-Control: no-store) so that sensitive data is not cached in browsers."
  - 14.2.2 (L2): sensitive data is not cached "in server components, such as load balancers and application caches".
- **RFC 9111, HTTP caching:**
  - `no-cache` (§5.2.2.4): the response "MUST NOT be used to satisfy any other request without forwarding it for validation and receiving a successful response".
  - `no-store` (§5.2.2.5): a cache "MUST NOT store any part of either the immediate request or the response", for private and shared caches alike. It also "is not a reliable or sufficient mechanism for ensuring privacy".
  - `private` (§5.2.2.7): "a shared cache MUST NOT store the response"; a private cache MAY.
- **RFC 9110 §15.4.5, 304:** a 304 means "the client, which made the request conditional, already has a valid representation"; there is "no need for the server to transfer a representation".
- **HTML Standard, the list of available images.** It exists "to avoid re-downloading images in the same document even when they don't allow caching per HTTP". Entries are removed "as appropriate given higher-layer caching semantics", and "User agents may also remove images from such lists at any time". A second display of the same image in the same page may therefore send no request at all, so the server cannot see it.
- **HTML Standard, lazy loading:** `loading="lazy"` is "Used to defer fetching a resource until some conditions are met"; `eager` (the default) fetches "immediately".
- **Audit of a 304:** docs silent. No vendor document found says whether a revalidation that answers 304 counts as an access (a web search turned up only 1990s access-log practice).

#### How products treat previews, thumbnails and downloads

- **Google Workspace Drive log.** It has separate `view` ("Document view."), `preview` ("Document preview."), `download` and `print` events (Reports API Drive appendix). The Admin help adds the following:
  - "The following _View_ actions are logged as _Download_ events: Previewing a file in the Drive app on a mobile device; Previewing a file, such as a PDF, that can't be directly opened in Docs or other Google apps".
  - "Downloads to offline browser caches" are not logged.
  - "_Item content prefetched_ events indicate that a Google app retrieved Drive data but did not immediately show it to the user."
  - "Not all activities in Drive are logged."
- **Microsoft Purview (SharePoint and OneDrive):**
  - `FilePreviewed`: "User previews files … These events typically occur in high volumes based on a single activity, such as viewing an image gallery."
  - `FileAccessed`: "After a user accesses a file, the system doesn't log the FileAccessed event again for the same user and file for the next five minutes." `FileAccessedExtended` covers continual access "for an extended period (up to three hours)", "to reduce the noise".
  - `FileDownloaded` is a separate activity.
  - FAQ: thumbnail calls are not always "intentionally triggered by the user … browser prefetch can result in similar events". Also: "Both the FilePreviewed and FileAccessed events indicate that a user's call led to a read of the file (or a read of a thumbnail rendering of the file) … the event distinction isn't a guarantee of the user's intent."
- **Nextcloud `admin_audit`** (`15acdd7931a6`):
  - Every server-side preview fetch is its own entry: `Operation::PreviewAccessed`, "Preview accessed: (id, width, height, crop, mode, path)" (`apps/admin_audit/lib/Listener/FileEventListener.php` lines 39–55, registered in `lib/AppInfo/Application.php` line 110).
  - Every file read is a separate entry: "File with id … accessed" (`lib/Actions/Files.php` lines 33–51, `Application.php` lines 197–202).
  - Preview responses carry `Cache-Control: private, max-age=86400, immutable` (`core/Controller/PreviewController.php` line 168; `lib/public/AppFramework/Http/Response.php` lines 89–92). A thumbnail shown again within a day therefore never reaches the server and is not audited.
  - The audit entry carries the request's method, URL, user agent and remote address (the logging docs, "admin_audit" fields).
- **Open WebUI `AUDIT_LOG_LEVEL`** (`backend/open_webui/utils/audit.py` @ `6a18585f`):
  - It writes JSON lines to a rotated file, with no table and no admin UI.
  - Each entry holds the user (id, name, email, role), verb, URI, source IP, user agent and (by level) the request and response bodies (lines 37–58, 294–321).
  - Only `POST/PUT/PATCH/DELETE` are audited. `GET` is audited only with `ENABLE_AUDIT_GET_REQUESTS` (lines 131, 155–156).
  - `AUDIT_EXCLUDED_PATHS` defaults to `/chats,/chat,/folders` (`env.py` 1230–1268).
  - The docs explain the GET default: reads "are far more numerous and would dominate the log. Turn it on when you need to see who **read** what" (`docs/reference/env-configuration.mdx` line 1239 @ `03d96980`).
  - Langfuse and agenticos do not audit opening a single trace or transcript either (section 4).

#### Implications (opinion)

- **The evidence supports the owner's answer.** Products audit fetches, not what was shown on screen:
  - Google turns previews of files it cannot render natively into `Download` events.
  - Nextcloud writes one row per preview fetch.
  - Microsoft writes one `FilePreviewed` per item of a gallery.

  "1 view + 3 downloads" for a transcript with three images is the same model. Microsoft says outright that the event type does not prove intent, and so it is with the hub's rows.

- **Two concrete points to settle in the plan (they do not reverse the answer):**
  1. **The row does not say which attachment it covers.** Spec §7.2's row is `id, actor_id, conversation_id, app_id, action, at`, so three `download` rows cannot be told apart. OWASP lists "Object … file" among the attributes to consider, and Nextcloud logs the file id and path. A nullable `attachment_id` (no FK, like the others) would fix this.
  2. **Caching on the Logs path.**
     - ASVS 14.3.2 (L2) asks for `no-store` on sensitive data. With `no-store` the browser keeps nothing to revalidate, so it never sends a conditional request and the 304 question disappears on that path. Each fetch is a 200 and one row.
     - With `private, no-cache` + ETag, the same image fetched again by the same admin becomes a 304. That request still passed authorization, so logging it would be consistent with "every fetch" (docs silent).
     - Either way, a re-display within the same open page may make no request (the HTML list of available images). The view row of the transcript covers that.
     - The owner's own path can keep `private, no-cache` + ETag.
- **Noise.** OWASP warns against "alarm fog", and Microsoft and Google both deduplicate or separate prefetches. The hub's rows are few: one admin opening a drawer. Purview's five-minute rule would be an option only if the access log grows noisy, not now.
- **Eager or lazy.** If thumbnails render with `loading="lazy"`, only images that come near the viewport are fetched and logged. Eager loading logs every image of the transcript at open. Both match "every fetch is a download"; the plan should pick one knowingly.

---

### 2. The Logs list on numbered pages (offset + COUNT)

#### Docs

- **antd 6.6.5 Table** (`doc Table`, `demo Table ajax`):
  - `pagination` is "Config of pagination … hide it by setting it to `false`".
  - `onChange(pagination, filters, sorter, extra: { currentDataSource, action: paginate | sort | filter })`.
  - The **Ajax demo** keeps `{ current: 1, pageSize: 10 }` in state and sends `page`/`limit`. It sets `total` after each fetch (the demo hard-codes it: "100 is mock data, you should read it from server // total: data.totalCount"). When the page size changes, it clears the rows ("`dataSource` is useless since `pageSize` changed").
  - FAQ: "Table total page count usually reduce after filter data, we by default return to first page"; for remote data "use the action from extra param to determine when return to first page".
- **antd 6.6.5 Pagination:**
  - `current`, `pageSize`, `total`, `showTotal(total, range)`, `showQuickJumper`, `showSizeChanger` and `onChange(page, pageSize)`.
  - `pageSizeOptions` defaults to `[10, 20, 50, 100]`.
  - `totalBoundaryShowSizeChanger` (6.2.0, default 50) shows the size changer above 50 rows unless it is set explicitly.
  - `simple` mode exists.
  - The repo's `tablePagination()` already sets `showSizeChanger`, `showQuickJumper` and `showTotal`. A server table adds `current`, `pageSize` and `total` to it.
- **antd 6.6.5 Drawer and Timeline**, for the detail view:
  - Drawer: `size` 'default' (378px), 'large' (736px), a number or (6.2.0) a string; `resizable` (6.1.0); `loading` shows a Skeleton; `destroyOnHidden` (5.25.0).
  - Timeline: `items[]` with `title`/`content`; `pending` is deprecated for `item.loading`; `orientation` and `variant` are available.
- **Next.js 16.3.4 (bundled docs):**
  - `page.md`: `searchParams` is a Promise of a plain object. "Handling filtering with `searchParams`" covers "filtering, pagination, or sorting". It is a request-time API that opts the page into dynamic rendering.
  - `use-search-params.md`, "Updating `searchParams`": `useRouter` or `Link` with a `createQueryString` that merges into `new URLSearchParams(searchParams.toString())`. "After a navigation is performed, the current page.js will receive an updated searchParams prop."
  - `use-router.md`:
    - `router.push` adds a history entry; `router.replace` does not.
    - `{ scroll: false }` keeps the scroll position.
    - Warning: "You must not send untrusted or unsanitized URLs to `router.push` or `router.replace`".
  - `02-guides/interactive-apps.md` Step 3, "Filter with pending feedback": "Calling `router.push()` starts a client navigation, and the server re-renders … with the new search params. Until that navigation completes, the page keeps rendering the old URL state". It wraps the navigation in a transition so the table can dim while pending.
  - `use-search-params.md` "Prerendering": wrap a `useSearchParams` client component in `<Suspense>` on prerendered routes. The Logs page reads `searchParams` on the server, so it is dynamic anyway.
- **Drizzle:**
  - The limit/offset guide lists "simple to implement and pages are easily reachable" as the benefit. Its drawbacks are "degradation in query performance with increasing offset because database has to scan all rows before the offset", and "inconsistency due to data shifts, which can lead to the same row being returned on different pages or rows being skipped".
  - The guide also says: "For consistent pagination, ensure ordering by a unique column … append a unique column". It offers a "deferred join" (page the ids in a subquery, then join).
  - The cursor guide's drawback is "the inability to directly navigate to a specific page". "If you need to directly navigate to a specific page … consider using offset/limit."
  - Totals come from `db.$count(table, where)` (`select count(*) … where …`) or `select({ value: count() })`. The guides do not cover a total for paging (docs silent).
- **PostgreSQL 18:**
  - §7.6: "it is important to use an ORDER BY clause that constrains the result rows into a unique order", and "The rows skipped by an OFFSET clause still have to be computed inside the server; therefore a large OFFSET might be inefficient."
  - Window functions see the rows "produced by the query's FROM clause as filtered by its WHERE, GROUP BY, and HAVING clauses", and an empty `OVER ()` spans "all rows" (tutorial §3.5). The SELECT reference applies LIMIT/OFFSET last (step 9). So `count(*) OVER ()` returns the filtered total on every row of the page in one query. It cannot stop early, because it has to see every filtered row (my reading of the processing order; docs silent on cost).

#### References

- **Dify** (`f7840ab2`):
  - Server: the console list takes `page` and `limit` (1–100, default 20) and `sort_by` (default `-updated_at`) (`api/controllers/console/app/conversation.py` 54–62, 76–79).
  - `api/libs/pagination.py` 77–84 runs `select(func.count()).select_from(stmt.subquery())` and then `.limit().offset((page-1)*per_page)`. The response is `{page, limit, total, has_more, data}` (`api/fields/conversation_fields.py` 409–414). The workflow-run logs use the same pattern (`workflow_app_log_query_repository.py` 151, 179–188).
  - Client: numbered pages with ellipses, a page-size select (10/25/50) and an editable "page/total" quick jumper (`packages/dify-ui/src/pagination/index.tsx` 296–345, 561–596). The pager shows only when the total is above 10.
  - Only `?page=` is in the URL, written with `router.replace(…, { scroll: false })`. Filters and size live in state and a per-app cache, and a filter change resets to page 1 (`web/app/components/app/log/index.tsx` 46–53, 132–148).
- **Langfuse** (`1d4f7563f754`):
  - Server: `traces.all` and `sessions.all` take `page` (0-based) and `limit` (1–100, default 50) and run `LIMIT … OFFSET limit*page`.
  - The total is a **separate** `countAll` procedure (`web/src/server/api/routers/traces.ts` 75–205; `packages/shared/src/server/services/traces-ui-table-service.ts` 485–527, 551–570; `sessions.ts` 206–234, 339–372).
  - Client: `?pageIndex=&pageSize=` in the URL through `use-query-params` (`web/src/hooks/usePaginationState.ts` 37–40, 75–91). Rows and count are fetched in parallel, and the pager shows the count as loading while the rows are already on screen (`data-table.tsx` 88–101).
  - The pager has "Rows per page" (10–100), a "Page [input] of N" jumper and first/previous/next/last (`data-table-pagination.tsx` 185–318). When the page is past the end, it snaps back (85–95).
  - Only the highest-volume `EventsTable` drops to has-next paging with an approximate "Total ≈" (`EventsTable.tsx` 2307–2319).
  - `usePaginationWindowPin` pins the upper time bound while the reader is past page 1, "Offset paging is only unstable on a live, open-ended timestamp-DESC set: new rows arrive at the top and shift every later page" (`web/src/components/table/hooks/usePaginationWindowPin.ts` 6–45).
- **agenticos** (`9ea7a718eb9c`):
  - Server: `GET /runs` takes `skip` and `limit` (≤100, default 50) and returns `{ items, total }`; "Every filter narrows both the page and `total`" (`backend/app/api/routes/v1/runs.py` 50–160).
  - The count is a second query with the same conditions. `.order_by(ordering.nullslast(), AgentRun.id)`; per its comment, `id` breaks ties "because neither sort column is unique", which otherwise makes paging repeat or skip rows (`backend/app/repositories/agent_run.py` 509–543).
  - Client: "x–y of N" with previous/next only, a fixed size of 50, and the page index in component state, reset when filters change (`frontend/src/components/ui/pagination-bar.tsx` 8–68; `run-history-tab.tsx` 35–36, 129–144).
- **Open WebUI** (`6a18585f`):
  - The admin user-chats modal uses infinite scroll over `page` (60 per page) with no total (`backend/open_webui/routers/chats.py` 783–813; `UserChatsModal.svelte` 23–96).
  - The admin user list returns `{users, total}` from a COUNT, with numbered pages, no size changer and no jumper (`routers/users.py` 79–126; `UserList.svelte` 498–500).
- **LibreChat** (`e1dfc104`):
  - Insights uses offset (`$skip`/`$limit`, `pageSize` 5–50) and returns `{page, pageSize, pages}`. The UI is "Page X of Y" with Prev/Next only (`packages/data-schemas/src/methods/insights.ts` 381–401, 636–656; `client/src/components/Insights/InsightsView.tsx` 523–571).
  - The admin audit API serves both an offset and a keyset cursor and always returns `total` (`packages/data-schemas/src/methods/auditLog.ts` 441–475). The admin panel uses it for numbered pages of 50 (`LibreChat-AI/admin-panel` `src/components/grants/AuditLogTab.tsx` 177–199, 599–603).

#### Implications (opinion)

- **The evidence supports the owner's answer.** Numbered pages with a total are what antd's Ajax demo, Drizzle's guide ("pages are easily reachable") and the repo's other admin tables do. So does every admin list with a total in the references: Dify's logs, Langfuse's traces, sessions and audit log, agenticos's runs and audit, Open WebUI's user list and LibreChat's admin audit panel all use offset paging plus an exact COUNT of the same filtered query. Cursors appear only for streams (Dify's in-drawer message history) and for Langfuse's highest-volume table. Langfuse's pager (size select, page jumper, page and size in the URL) is the closest match to the owner's choice. The costs are documented, and they are small at the hub's scale. OFFSET re-reads skipped rows, which matters on deep pages of a large app, and the COUNT re-runs the filter. One app's conversations on the `(app_id, updated_at)` index are cheap to count. Neither cost is a reason to raise the question again.
- **One concrete point for the plan: the sort key moves.** The list is ordered by last activity (`updated_at`), which changes whenever a user chats. A conversation further down that becomes active while the admin reads moves to the top. The rows before its old place shift down one, so the next page repeats a row; a delete with "include deleted" off skips one instead.
  - Drizzle, PostgreSQL and agenticos all call for a unique tiebreaker: order by `(updated_at DESC, id DESC)`.
  - Dify accepts the shift. Langfuse pins the upper time bound once the reader is past page 1, for new rows. Applied to `updated_at`, a pin would hide newly active rows from later pages until page 1 is reloaded.
  - The plan should state the tiebreaker and choose between accepting the shift and pinning. This is a detail of offset paging, not a reason to reopen the choice.
- **URL state:** page, size and the filters live in `searchParams`. The client table's `onChange` merges them into the query string and calls `router.replace` or `router.push` (with `scroll: false`) inside a transition, and a filter change resets `page` to 1 (antd's FAQ). Values are parsed on the server with zod (ADR-0025). An out-of-range page shows an empty page, or is clamped to the last page.

---

### 3. No in-chat notice (record only)

The owner decided: no notice in the chat. These are the facts for the record, with no recommendation.

- **ICO, "Monitoring workers":**
  - Word use: "Must refers to legislative requirements"; "Should … what we expect you to do to comply effectively"; "Could refers to an option or example".
  - The guidance is "under review" after the Data (Use and Access) Act.
  - Quotes from "Data protection and monitoring workers":
    - "you **must** tell workers about monitoring in a way that is accessible and easy to understand".
    - "Apart from in very exceptional circumstances where covert monitoring is justified, you **must** inform workers about any monitoring."
    - Under "What must we tell workers about our monitoring?": "You **must** make sure workers are aware of how and what personal information you are collecting during any monitoring. You **could** set up a system to ensure workers remain aware that monitoring is taking place. For example, through your organisation's intranet or signage in areas subject to monitoring. … you **must** keep privacy information up-to-date. You **must** also tell workers when you introduce changes."
    - "You **should** regularly bring the policies to the attention of workers." Its example puts the information in an acceptable-use policy "made known and accessible to all workers affected".
    - "you **should** seek and document the views of your workers or their representatives".
- **ICO, "What methods can we use to provide privacy information?":**
  - "you should not necessarily restrict the delivery of privacy information to a single notice"; "Where appropriate, you should incorporate a variety of techniques".
  - Just-in-time notices appear "at the point where an individual provides you with a particular piece of information".
  - "Try not to adopt approaches that … result in giving individuals constant alerts."
  - No single method is a legal requirement.
- **GDPR Art. 13:**
  - The information is due "at the time when personal data are obtained" (13(1)).
  - It covers "the purposes of the processing … as well as the legal basis" (13(1)(c)) and "the period for which the personal data will be stored, or if that is not possible, the criteria used to determine that period" (13(2)(a)).
  - 13(4): the duty does not apply "where and insofar as the data subject already has the information".
  - Whether GDPR or UK GDPR applies to the owner's company is not established (as in the earlier research).
- **Products** (confirming the earlier research's "none tells users", §4.6):
  - None of Open WebUI, agenticos or Dify shows a built-in "admins can read your chats" notice; LibreChat and LobeHub have no admin reader.
  - Two give operators a surface for one instead:
    - Open WebUI's `WEBUI_BANNERS` (`backend/open_webui/config.py` lines 2191–2197 @ `6a18585ff4c2`; its privacy page tells operators to "Publish clear usage guidance").
    - LibreChat's `interface.termsOfService` with `modalAcceptance: true` and `privacyPolicy` (`librechat.example.yaml` lines 205–216 @ `e1dfc10449ff`).

---

### 4. Logs list, transcript and access log in references

#### Docs

The spec settles the shape (§7.2). The docs for the parts are in section 2: antd Drawer, Timeline and Table, and Next.js `searchParams`.

#### References

- **Filters and their URL state:**
  - Dify keeps only `?page=` and the open `?conversation_id=` (nuqs, pushed on open, replaced on close) in the URL (`web/app/components/app/log/list.tsx` 740–777, 819–828).
    - Its period filter is a preset list with no free date range (`filter.tsx` 28–38).
    - The date window applies to whichever column the list is sorted by (`conversation.py` 284–297).
    - The list never shows deleted conversations (line 251).
  - agenticos keeps `?period=`, the filters (`status`, `surface`, `rated`, `person`, `version`, `model`, with "all" left out), `?agent=`, `?tab=` and the open `?run=` in the URL through `history.replaceState`, but not the page (`frontend/src/app/[locale]/(dashboard)/runs/page.tsx` 65–103; `frontend/src/lib/runs/filter-params.ts` 22–113).
  - Langfuse keeps `?dateRange=` (with a localStorage default), one encoded `?filter=` and `?pageIndex=&pageSize=` (`useGlobalDateRange.ts` 16–95; `useFilterState.ts` 35–186).
  - No reference has an "include deleted" filter. The hub's list (every filter plus the page in the URL) goes further than any of them.
- **Read-only transcript:**
  - Dify: a right-hand modal drawer, at most 640 px wide.
    - It shows the conversation id, the model and the inputs, then the chat without an input box. Messages page by a `first_id` cursor, 10 at a time, loading older ones on scroll up.
    - Admin rating and annotation stay available.
    - The list refetches on close to clear the unread dot (`list.tsx` 166–625, 866–872, 1030–1032).
  - agenticos: a resizable side panel **beside** the list, with prev/next run arrows and keys. Its code says it began as an overlay drawer and was changed because the overlay hid the neighbouring rows (`frontend/src/components/runs/run-detail-panel.tsx` 17–38; `focused-run.tsx` 40–70).
  - Langfuse: a session page with a virtualized, read-only stack of trace cards (input/output preview, name, time, scores), and a header with users, total traces and cost (`web/src/features/sessions/SessionPages.tsx` 569–576, 929–977).
  - Open WebUI: the admin opens the read-only `/s/{id}` page, a full navigation (`ChatsModal.svelte` 293).
- **Run timeline:**
  - Dify (chatflow): a panel beside the drawer with Result, Detail and Tracing tabs.
    - Detail lists status, error, elapsed time, total tokens, steps and exceptions.
    - Tracing is a node tree; each row has its icon, title, "N tokens · time" and a status icon, expanding to the error and to inputs, process data and outputs as JSON (`web/app/components/workflow/run/index.tsx` 173–254; `node.tsx` 159–345).
  - agenticos: a "Timeline" tab with the whole conversation cut into runs. Only the open run is expanded, tool calls are shown raw, and it loads 100 turns per page. A waterfall shows one bar per model request (`run-timeline.tsx` 22–133; `run-waterfall.tsx` 8–24).
  - Langfuse: Tree (default), Timeline (gantt) or Graph, chosen in `?view=` (`TracePanelNavigation.tsx` 1–62).
- **Access-log view:**
  - No reference ships an "opened this conversation" log.
  - Langfuse's enterprise audit log records mutations, plus only batch-export "download" and Slack "read".
    - Its table: time, type, user or API key, org, project, roles, resource type and id, action, before and after.
    - Its UI: offset pages with a count, `?pageIndex=&pageSize=`, no filters. Columns are Time, Actor, Resource Type, Resource ID, Action, Before, After and Compare.
    - A ClickHouse table for "access events (single reads, lists, exports, downloads)" was added on 2026-10-12, but only tests call its writer (`web/src/features/audit-logs/auditLog.ts` 136–256; `web/src/server/api/routers/auditLogs.ts` 81–220; `packages/shared/clickhouse/migrations/canonical/0052_create_audit_logs.up.sql` 1–37).
  - agenticos: a hash-chained `app_admin_audit_logs` table (actor, impersonator, org, action, target, details, IP), written in the action's transaction.
    - `GET /audit` pages by offset with a second COUNT and has no UI page.
    - Its only read entries are bulk exports, an app admin reading another tenant, and `memory.person.inspected`, which records actor, subject and a **reason** and no content. Reading a run or transcript is not audited (`backend/app/db/models/audit_log.py` 13–65; `backend/app/services/memory/facade.py` 76–114; `docs/governance.md` 1343–1362).
  - LibreChat: an append-only, hash-chained audit of grants and permissions. Its admin panel opens an entry in a deep-linkable `?entryId=` drawer.

#### Implications (opinion)

- **Drawer:** spec §7.2's large antd `Drawer` follows Dify. agenticos's note (an overlay hides the neighbouring rows) points to two antd options: `resizable` (6.1.0) or `size` set to a share of the viewport. Neither changes the design.
- **Detail state in the URL:** keeping the open conversation in the URL (Dify `?conversation_id=`, agenticos `?run=`, LibreChat `?entryId=`) would make an open transcript linkable. It also means a reload or a shared link reopens it and **writes another view row**. That is consistent with "every open is a view", but the plan should decide it on purpose.
- **Run timeline:** Dify's Detail fields (status, elapsed time, tokens, error) and agenticos's per-run grouping both match the spec's antd `Timeline` items (status, duration, tokens, error, interrupts and answers).
- **Access log:**
  - The hub's tab goes beyond every reference; none audits single reads.
  - Two cheap additions are seen in references: the object id (Langfuse's resource id, agenticos's target, Nextcloud's file id), which supports `attachment_id` (section 1), and offset pages with a count, the same pager as the Logs list.
  - agenticos's "reason" field is an option the spec did not take; noted, not proposed.
