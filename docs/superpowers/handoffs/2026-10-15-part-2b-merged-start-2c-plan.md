# Handoff: Part 2b is merged; write 2c's plan (2026-10-15)

The next session **writes the implementation plan for slice 2c of Part 2: attachments and Logs** (spec §7: chat attachments stored on the hub and sent inline, the admin Logs page, the access log, the notice to users). 2c's design is settled by the approved Part 2 spec, so this is a plan, not a spec. The owner asked for this handoff because the 2b planning session's context was full ("This chat context is already bloated as is, so I would like to plan to see in a new session").

## Where things stand

- **2b is merged.** PR #72 merged into `fork/overhaul` as `09000df4` (2026-10-15). Its plan was PR #71. Spec §0's 2b row and running record decisions 61–68 hold the whole story.
- **This branch.** `docs/part-2c-plan` was branched from `09000df4`; its first commit is this handoff and the updated §0 Next line. 2c's plan goes on this branch, with its own PR to `fork/overhaul` (decision 33: a plan is written against the code as it stands after the previous slice merged). The build then runs in its own session on `feat/agui-files-logs` (spec §0 table).
- **Local stack.** `localhost:5300` runs the merged `fork/overhaul`. These stay until the owner lets them go:
  - the images `ai-app-hub-local-app:part2a` and `:part1`;
  - the dump `~/ai-app-hub-backups/local-before-part2a.sql`.
- **Still due:** the owner's 2a browser check (spec §0). The owner has used the shared chat heavily since, but nobody recorded the check.
- **Open issues** (label `fork/overhaul`):
  - **#74 is the owner's call:** where an answered interrupt's card sits in its turn. Today it shows after the whole turn; the alternative anchors it where it was sent. It may matter for the Logs transcript.
  - **#73:** remove the scroll workaround once use-stick-to-bottom ships its PR #43.
  - **#69:** the AG-UI core's remaining follow-ups, including two 2b known limits.
  - **#66:** an orphan conversation after a refused first run. Spec §7 says nothing on it; 2c touches the refusal path only if attachments change it.

## Read first, in order

1. `AGENTS.md`.
2. Spec §0 (`docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md`).
3. This handoff.
4. The running record `docs/superpowers/research/2026-10-11-provider-hub/README.md`, decisions 40–68:
   - **48, 53, 54** and **42, 49** are 2c's own decisions: bytea and inline sending; image size; the per-conversation cap; admins can read; audit, notice, soft delete.
   - **62–68** are 2b's.
5. Spec §7, plus 2c's rows in §1, §2.2 (the `attachments.*` settings), §3.4 (the purge of unsent attachments), §8 (the upload error codes), §9 (`pdfjs-dist`), §10, §11 and §12. 2c's ADR is **ADR-0037**: 0035 and 0036 were taken by 2b's look and scrolling.
6. **What 2b's look and scrolling decided** (2c's UI must follow both):
   - **ADR-0035:** one `ChatCard` for everything the chat shows, the "box rule", and `lib/chat/sent-answers.ts`, which the Logs can reuse to show decisions.
   - **ADR-0036:** both chats scroll through `ChatScroll` (`components/chat/chat-view/chat-scroll.tsx`), using use-stick-to-bottom.
   - **Notes:** ADR-0033's (the run's `resume` is now read for the chat, not only for the Logs) and ADR-0034's.
7. **Research:**
   - `…/part2-hitl-state-files.md` §4 and Implications D: AG-UI content parts, what Pydantic AI accepts, how reference hubs store uploads, PostgreSQL bytea, OWASP upload rules.
   - `…/part2-store-and-logs.md`: admin access, retention, the access log.
   - `…/agui-spike.md`: only inline base64 attachments reach the model.
8. **The 2b plan as the model:** `docs/superpowers/plans/2026-10-14-part-2b-agui-hitl.md`. Use its front half (Global Constraints, User decisions, Plan calls, File map, Cross-task ordering, Shared contracts), its task format with `json:metadata`, its self-review table and its "Pre-flight" section.
9. **2c's code neighbours:**
   - Dify's upload route and `parseFilePart`.
   - `components/chat/chat-view/sender-attachments.tsx` and `components/chat/message/message-files.tsx` (spec §7.1 reuses their pattern).
   - `lib/settings/images.ts`, for the new `chatImage` kind.
   - `lib/chat/purge.ts`.
   - The admin apps table, for the "Logs" row action.
   - `lib/providers/registry.ts`'s `hubHistory`.

## How 2b's plan was made (repeat what worked)

- **Ask the owner first.** The owner's standing instruction: "Ask me about anything the spec leaves open before deciding it."
  - Ask with AskUserQuestion: up to four questions, each option stating what changes and what does not, the recommended option first.
  - When the owner asks "explain in layman's terms" or "what do reference projects do?", answer in plain words with the references named (CopilotKit, assistant-ui and the vstorm template were the useful ones), then ask again.
  - Record the answers as a running-record decision with the owner's words, as decision 62 did.
- **Write the front half first:** Global Constraints, plan calls and binding Shared contracts.
- **Then parallel drafters**, one per group of tasks, each with a common brief, writing `task-NN.md` files in the session scratchpad. Each verified its own tasks in its own scratch copy against stubs of the others. Relay contract changes between drafters as they report.
- **Then a pre-flight agent** applies every code task from the assembled plan text, in order, to ONE fresh scratch copy, with gates after each task and the new e2e specs at the end. It found the one cross-task slip the drafters could not see: a fragment that quoted a file as it was before an earlier task changed it.
- **Scratch-copy safety** (memory `plan-preflight-scratch-copies`):
  - Never run `pnpm` in a copy whose `node_modules` is symlinked: pnpm tries to purge the real one.
  - Use `./node_modules/.bin/*`, plus a shim for scripts that call `pnpm exec`.
  - `next dev` needs a real `node_modules` copy for e2e.
  - Serialise tsc and vitest with `flock`; the machine has about 5 GB of RAM.
- **Assemble and check:**
  - Assemble with oxfmt and check every table's cell count.
  - Generate `.tasks.json` from the formatted plan. Cut each description at `**Steps:**` or the first `- [ ] **Step`; one task had no Steps header and came out at 44k characters.
  - Keep subjects to 60 characters.
  - Tag e2e and gate tasks `userGate` with the banner, as 2a and 2b did.
- **Stopping the app:** the owner allowed stopping the local app container to free memory during the pre-flight ("you can bring down the current instance to free memory"). Ask again; that was for that run.

## Things 2c's plan must know that are not written elsewhere

- **e2e conventions changed after 2b's look:**
  - cards are `.ant-collapse` items;
  - the question card's buttons are matched by exact name;
  - the scroll box is `[class*="scrollBox"]`;
  - completed tool cards start open (don't click them open).

  Read `e2e/agui-hitl.spec.ts` for the current helpers.

- **The plan's machine:**
  - the owner checks in Firefox on Windows (memory `owner-browser-firefox`);
  - C: is 96% full, and Docker's CLI config on `/mnt/c` failed with "Cannot allocate memory", so the 2b Docker gate ran with `DOCKER_CONFIG` pointing at a folder inside WSL (decision 68).
- **The stub as a playground:** the e2e stub agent doubles as the owner's playground app (decision 68: "keep it as is for now"). 2c's attachment-echo scenario goes into the same stub (`e2e/fixtures/stub/agui.ts`), with keywords no earlier prompt uses (the 2b plan's Task 16 table lists them).

## Likely open points for the owner (ask; do not decide)

Checked against spec §7 only; the next session confirms each is really open before asking:

- `pdfjs-dist`: the release to pin and its documented Node usage (spec §9 leaves both to 2c's plan and ADR-0037). The alternative is a better-documented library, if the docs check finds one.
- **Upload UI:**
  - When does an upload start: when the file is picked, or on send?
  - What does the user see when an attachment is refused?
  - The detected type versus the file's extension.
  - Mind ADR-0035's box rule for the file cards in a user turn.
- **The Logs page:**
  - the exact filters and page size;
  - what the drawer shows for an answered interrupt (`sent-answers.ts`);
  - whether #74's choice affects the read-only transcript.
- **The notice:** exactly where it sits under the composer, beside the answer-pending hint and the ask_user card.
- **The purge:** whether the 24-hour rule for unsent attachments runs in the same daily job (spec §3.4 says it does; confirm the hour).

## Suggested skills

- `superpowers-extended-cc:writing-plans`: the plan itself, with its `.tasks.json`.
- `superpowers-extended-cc:dispatching-parallel-agents`: the drafters and the pre-flight.
- `adr-skill`: ADR-0037, the note on ADR-0030 (`chatImage`), and any note on ADR-0035/0036.
- `antd`, through the CLI with `npx -y @ant-design/cli … --version 6.6.5`: Table, Drawer, Timeline, Upload, Descriptions.
- `x-components`: Attachments, FileCard, Sender.Header.
- `x-chat-provider`, `use-x-chat` and `x-request`: attachments in the run body, and the upload fetch.
- `context7-mcp` and `crawl4ai`: `pdfjs-dist`'s Node usage, sharp, the OWASP File Upload and Logging cheat sheets, the Next bundled docs for multipart Route Handlers and `proxyClientMaxBodySize`.
- `superpowers-extended-cc:verification-before-completion`: before the plan's PR.
