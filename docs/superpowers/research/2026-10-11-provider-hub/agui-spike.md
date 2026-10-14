# The AG-UI spike (Part 2, 2026-10-14)

The spike that the charter's decision 6 puts before Part 2's spec. It answers the charter's spike questions (§7 risks; running record decision 6) by running real code: `useXChat` against AG-UI runs, what "stop" does, and the 0.x versus 1.0 streams. It also checks structured history replay, attachments and state.

Everything built for it was throwaway: a local branch `spike/agui` (never pushed, deleted), a Python agent and a Node stub in a scratch folder. Only this note is kept. The code is in the appendix so a later session can rerun it.

## Answers to the charter's spike questions

| Question | Answer | Evidence below |
| --- | --- | --- |
| Can `useXChat` carry an AG-UI run that produces several messages and ends in an interrupt? | Yes, as **one X message per assistant turn holding ordered parts**, folded by a pure reducer in `transformMessage`. Interrupts and frontend-tool answers continue the same turn through `onReload(turnId, …)` with `requestPlaceholder` returning the turn. | "Browser side" |
| What does "stop" do to an agent? | Closing the upstream request cancels the agent's model stream (Pydantic AI on Starlette: `CancelledError` within a chunk). `@ag-ui/client` emits its own `RUN_ERROR {code: "abort"}` and keeps the partial message. AG-UI defines no stop request; the hub needs its own stop route (spec §3). | "Agent side", "Hub-server side", "Browser side" |
| 0.x versus 1.0 streams | `@ag-ui/client` 1.0.2's `HttpAgent.runAgent()` on the hub's server reads Pydantic AI's 0.x stream (protocol 0.1.22) and a spec-level 1.0 stub alike; its compatibility boundary runs inside `runAgent()`. | "Hub-server side" |
| Does structured history replay? | Yes: reasoning, tool calls, tool results, approvals, denials and frontend-tool answers all reach the model as typed parts. | "Agent side", "Browser side" |
| Attachments and state | Inline base64 `data` sources reach the model as bytes; URL sources do not reach a hub-internal file. State and activity deltas are JSON Patch; the server should fold them and send snapshots. | all three |

## How to rerun it

1. Agent: `uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python "pydantic-ai-slim[ag-ui]==2.56.0" uvicorn`, save Appendix A as `agent.py`, run `PYDANTIC_AI_NO_BANNER=1 .venv/bin/uvicorn agent:app --host 127.0.0.1 --port 9100`. Scenarios by the last user text: weather, delete, ask, plan, image, error, slow, history.
2. 1.0 stub: in a folder with `npm install @ag-ui/client@1.0.2 @ag-ui/core@1.0.2 @ag-ui/encoder@1.0.2`, save Appendix B and run `node stub-1-0.mjs <that folder> 9101`. Scenarios: input, activity, frontend, cancel, encrypted, multi.
3. Hub side: on a throwaway branch, `pnpm add` the three packages, add Appendix C as `app/api/spike-agui/route.ts` and Appendix D as the provider of a client page under `app/(user)/`, and drive it with a temporary Playwright spec under the e2e harness (`pnpm exec playwright test <spec> --project desktop-light`). Delete all of it afterwards.

## Findings

Setup: pydantic-ai-slim[ag-ui] 2.56.0 (ag-ui-protocol 0.1.22 resolved, starlette 1.8.0), FunctionModel stream_function (no key), `AGUIAdapter.dispatch_request(request, agent=…, deps=StateDeps(Plan()))`; Node 22.21.1, @ag-ui/client|core|encoder 1.0.2 (client deps: rxjs 7.8.1, zod ^3.25.76, fast-json-patch, uuid, untruncate-json, compare-versions); a spec-level 1.0 stub on node:http + EventEncoder.

### Agent side (Pydantic AI 2.56, raw SSE)

- A 1.0 RunAgentInput (with `protocolVersion: "1.0"`, `resume`) is accepted by the 0.1.22 models.
- Stream: RUN*STARTED has no `protocolVersion` (0.x); REASONING*_ events (not THINKING\__); `RUN_FINISHED.outcome` {type: success|interrupt} is present (0.1.19+).
- An empty TEXT_MESSAGE_START/END pair precedes tool calls; TOOL_CALL_START.parentMessageId points at it.
- Approval: `requires_approval=True` + `output_type=[str, DeferredToolRequests]` → RUN_FINISHED outcome interrupt, `id: "int-<toolCallId>"`, reason `tool_call`, `message: "Approve delete_file({...})?"`, `toolCallId`, `responseSchema {approved: boolean (required), editedArgs: object, reason: string}`.
- Resume approved → the run starts with TOOL_CALL_RESULT for the original call, then text. Denied with `reason` → TOOL_CALL_RESULT content = the reason, plus `REASONING_ENCRYPTED_VALUE {subtype: message, entityId: <tool msg id>, encryptedValue: '{"pydantic_ai": {"outcome": "denied"}}'}`.
- Missing resume with the dangling tool call still in history → Pydantic AI strips it with a UserWarning ("Client-submitted history ended with unresolved tool call(s) … stripped") and the model call re-raises the interrupt.
- Frontend tool (`tools: [ask_user]` in RunAgentInput): the tool call streams and the run ends `outcome: success` with no `pendingToolCallIds`. The answer as a `tool` message in the next run's history is accepted and the model sees the ToolReturnPart.
- State: `ToolReturn(metadata=[StateSnapshotEvent])` / `[StateDeltaEvent]` → STATE_SNAPSHOT / STATE_DELTA after the TOOL_CALL_RESULT.
- Error: an exception in the model → RUN_STARTED, RUN_ERROR {message: <the exception text>} — raw exception text reaches the consumer.
- Attachments: `image` / `document` parts with `source {type: data, value: base64, mimeType}` arrive as `BinaryContent(media_type, bytes)`; `source {type: url}` arrives as `ImageUrl(url)` — the model provider (or Pydantic AI's force-download) would have to fetch it, so a hub-internal URL only works if the agent downloads it itself.
- Structured history replay: user, reasoning, assistant+toolCalls, tool, assistant, user → the model receives UserPromptPart=2, ThinkingPart=1, ToolCallPart=1, ToolReturnPart=1, TextPart=1. Full fidelity.
- An `activity` message left in history derailed the model's view of the last user text (spec: activity messages MUST be stripped before sending).
- Stop: closing the HTTP connection mid-stream cancels the model stream on the agent (`CancelledError` logged at the 10th word, ~2 s in). Starlette's StreamingResponse cancellation reaches the agent run.

### Hub-server side (@ag-ui/client 1.0.2 HttpAgent in Node)

- `new HttpAgent({url, headers, threadId, initialMessages, initialState})` + `runAgent({runId, tools, resume}, subscriber)` works server-side; it sends `protocolVersion: "1.0"` and the configured headers (custom `X-…` and `Authorization` arrive).
- `subscriber.onEvent` yields every event after the compatibility boundary; `EventEncoder.encodeSSE` re-encodes each for the browser.
- `runAgent` resolves `{result, newMessages}`: AG-UI 1.0 messages ready to store (reasoning message with the joined text; assistant with `toolCalls`; tool message with `encryptedValue` when the producer sent one; assistant text). `agent.state` holds the state after snapshot+delta (JSON Patch applied). `agent.pendingInterrupts` holds the open interrupts; `buildResumeArray(interrupts, responses)` builds `resume[]` and throws "missing responses for open interrupts: …" if one is not answered.
- `abortRun()` mid-stream: the upstream fetch is aborted (the agent's model stream is cancelled), the client emits its own `RUN_ERROR {message: "This operation was aborted", code: "abort"}`, and `newMessages` still holds the partial assistant message ("word0 … word7").
- 1.0 stub: `input_required` interrupt with a `responseSchema` → `pendingInterrupts`; resumed run sees `resume[{interruptId, status: resolved, payload}]`. ACTIVITY*SNAPSHOT + 3 ACTIVITY_DELTA → one `activity` message in `newMessages` with the patched content. A `cancelled` outcome passes through. Two assistant messages + reasoning + STEP*\* in one run → three messages in `newMessages`.
- **Gap:** `RUN_FINISHED.pendingToolCallIds` (declared in @ag-ui/core 1.0.2's types) is removed by the client's enforce boundary: "[ag-ui][enforce] Removed unrecognised material at '/pendingToolCallIds' on RUN_FINISHED". The hub must find unanswered frontend tool calls itself (a call to a hub-declared tool with no tool message).
- A REASONING_ENCRYPTED_VALUE for a reasoning message that never had REASONING_MESSAGE_START produced no message in `newMessages` (the stub's shape; Pydantic AI attaches its values to existing messages).

### Browser side (throwaway page + Playwright spec on desktop-light, next dev under the e2e harness)

Hub route `POST /api/spike-agui` (Route Handler: verifySession, one HttpAgent per run, `onEvent` → `EventEncoder.encodeSSE` into a ReadableStream, `request.signal` abort → `agent.abortRun()`, a final `CUSTOM hub:run-saved` with newMessages/state/pendingInterrupts). Browser: `useXChat` + an `AbstractChatProvider` whose `transformMessage` folds AG-UI events into ONE X message per assistant turn with ordered parts (`XRequest` with the documented `fetch` option; each `chunk.data` is one AG-UI event).

- Run 4 (final): the Pydantic AI test passed end to end; the 1.0 stub test passed multi-message and input_required, failed on activity (below).
- **Multi-message runs:** weather = reasoning, tool card (args + result), text as three ordered parts of one X message; one assistant bubble per run. The stub's reasoning + two assistant messages + STEP\_\* = three parts in one bubble.
- **Approvals:** RUN_FINISHED interrupt → the turn shows Approve/Reject on the gated tool part; `chat.onReload(turnId, {resume: {turn, entries}})` with `requestPlaceholder` returning the turn continues the SAME bubble; runs read "interrupt > success"; the resume run's TOOL_CALL_RESULT merges into the gated call. Reject sends `{approved: false, reason}` and the reason comes back as the tool result.
- **Ask-user (frontend tool):** the run ends with the `ask_user` call unanswered; choosing an option appends a `tool` message to the next run and `onReload` continues the same turn. The agent sends NO TOOL_CALL_RESULT for a frontend tool (the answer is the consumer's own message), so the hub must merge the answer into the turn itself (first run failed on exactly this).
- **input_required (1.0 stub):** a generic interrupt card with the schema's enum as buttons; resume `{region}` continued the same turn ("interrupt > success").
- **State:** STATE_SNAPSHOT + STATE_DELTA applied on the server (`agent.state`), shown from an external store via `useSyncExternalStore` (`"status":"completed"`).
- **Image:** inline base64 `image` part → the agent saw `BinaryContent(image/png …)`.
- **Structured history after 8 turns:** TextPart=6, ThinkingPart=1, ToolCallPart=6, ToolReturnPart=6, UserPromptPart=7 — approvals, denials and frontend-tool answers all replay.
- **Error:** RUN_ERROR inside a 200 stream → X status `success`, run outcome `error` (two layers: X transport status vs AG-UI outcome).
- **Stop:** Sender's "Stop loading" → `chat.abort()` → the browser's fetch aborts → Next aborts `request.signal` → `abortRun()` → the agent logged `slow stream stopped after 5 words: CancelledError`. With `requestFallback`, the aborted turn is removed and re-added at the end under a new id (status abort; runs "running > AbortError").
- **Activity:** ACTIVITY_SNAPSHOT rendered; the spike reducer did not apply ACTIVITY_DELTA (JSON Patch) — a browser-side fold needs a JSON Patch library (fast-json-patch is what @ag-ui/client uses), or the server folds and sends snapshots.
- **Spike-agent artefacts that taught something:** (1) a reused tool-call id across turns made HttpAgent's `newMessages` omit the second call (it updated the existing message) — tool-call ids must be unique per thread, and the store should be built from `agent.messages`/events, not `newMessages` alone; (2) after a RUN_ERROR the user message has no reply, so the next run carries two consecutive user messages, which Pydantic AI merges into one request.
- Dependency: `pnpm add @ag-ui/client@1.0.2 @ag-ui/core@1.0.2 @ag-ui/encoder@1.0.2` adds 13 packages; zod 3.25.76 enters beside the hub's zod 4.6.5 (via the client and @ag-ui/proto); tsc passed on the spike files.

## Appendix A: the scripted Pydantic AI agent (`agent.py`)

```python
"""Throwaway AG-UI spike agent: Pydantic AI 2.56 with a scripted FunctionModel (no LLM key).

Scenarios are picked by the last user text (like the hub's Dify stub). Every request body is logged to
requests.jsonl, and the slow stream logs whether it was cancelled when the client went away.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from pathlib import Path

from ag_ui.core import EventType, StateDeltaEvent, StateSnapshotEvent
from pydantic import BaseModel
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from pydantic_ai import Agent, DeferredToolRequests, ToolReturn
from pydantic_ai.messages import (
    BinaryContent,
    ImageUrl,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ThinkingPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, DeltaThinkingPart, DeltaToolCall, FunctionModel
from pydantic_ai.ui import StateDeps
from pydantic_ai.ui.ag_ui import AGUIAdapter

HERE = Path(__file__).parent
LOG = HERE / 'requests.jsonl'
CANCEL_LOG = HERE / 'cancel.log'


class Step(BaseModel):
    title: str
    status: str = 'pending'


class Plan(BaseModel):
    steps: list[Step] = []


def last_user_text(messages: list[ModelMessage]) -> str:
    for message in reversed(messages):
        if isinstance(message, ModelRequest):
            for part in reversed(message.parts):
                if isinstance(part, UserPromptPart):
                    if isinstance(part.content, str):
                        return part.content
                    return ' '.join(c for c in part.content if isinstance(c, str))
    return ''


def history_summary(messages: list[ModelMessage]) -> str:
    counts: dict[str, int] = {}
    for message in messages:
        for part in message.parts:
            name = type(part).__name__
            counts[name] = counts.get(name, 0) + 1
    return ', '.join(f'{k}={v}' for k, v in sorted(counts.items()))


def last_request_parts(messages: list[ModelMessage]):
    return messages[-1].parts if messages and isinstance(messages[-1], ModelRequest) else []


async def words(text: str, delay: float = 0.03):
    for word in text.split(' '):
        yield word + ' '
        await asyncio.sleep(delay)


async def stream(messages: list[ModelMessage], info: AgentInfo):
    parts = last_request_parts(messages)
    returns = [p for p in parts if isinstance(p, ToolReturnPart)]
    if returns:
        # Second model request of a turn: summarise the tool results it got.
        summary = '; '.join(f'{r.tool_name} -> {r.model_response_str()[:120]}' for r in returns)
        async for chunk in words(f'Tool results received: {summary}. History: {history_summary(messages)}'):
            yield chunk
        return

    text = last_user_text(messages).lower()
    frontend = [t.name for t in info.function_tools if t.name not in {'get_weather', 'delete_file', 'create_plan', 'complete_step'}]

    if 'error' in text:
        raise RuntimeError('scripted failure for the spike')

    if 'weather' in text:
        yield {0: DeltaThinkingPart(content='The user wants the weather. ')}
        yield {0: DeltaThinkingPart(content='I will call get_weather for Paris.')}
        yield {1: DeltaToolCall(name='get_weather', json_args='{"city": "Paris"}', tool_call_id=f'call_weather_{uuid.uuid4().hex[:8]}')}
        return

    if 'delete' in text:
        yield {0: DeltaToolCall(name='delete_file', json_args='{"path": "report.txt"}', tool_call_id=f'call_delete_{uuid.uuid4().hex[:8]}')}
        return

    if 'ask' in text:
        if 'ask_user' not in frontend:
            async for chunk in words(f'No ask_user tool was offered; frontend tools: {frontend}'):
                yield chunk
            return
        args = {'question': 'Which format do you want?', 'options': ['PDF', 'Word', 'Markdown']}
        yield {0: DeltaToolCall(name='ask_user', json_args=json.dumps(args), tool_call_id=f'call_ask_{uuid.uuid4().hex[:8]}')}
        return

    if 'plan' in text:
        yield {0: DeltaToolCall(name='create_plan', json_args='{"titles": ["Collect data", "Analyse", "Write report"]}', tool_call_id=f'call_plan_{uuid.uuid4().hex[:8]}')}
        yield {1: DeltaToolCall(name='complete_step', json_args='{"index": 0}', tool_call_id=f'call_step_{uuid.uuid4().hex[:8]}')}
        return

    if 'image' in text:
        found = []
        for message in messages:
            for part in message.parts:
                if isinstance(part, UserPromptPart) and not isinstance(part.content, str):
                    for c in part.content:
                        if isinstance(c, BinaryContent):
                            found.append(f'BinaryContent({c.media_type}, {len(c.data)} bytes)')
                        elif isinstance(c, ImageUrl):
                            found.append(f'ImageUrl({c.url[:60]})')
                        elif not isinstance(c, str):
                            found.append(type(c).__name__)
        async for chunk in words(f'Attachments seen: {found or "none"}'):
            yield chunk
        return

    if 'slow' in text:
        n = 0
        try:
            async for chunk in words(' '.join(f'word{i}' for i in range(200)), delay=0.2):
                n += 1
                yield chunk
        except BaseException as exc:  # noqa: BLE001 - the spike wants to see cancellation
            CANCEL_LOG.open('a').write(f'{time.time():.3f} slow stream stopped after {n} words: {type(exc).__name__}\n')
            raise
        CANCEL_LOG.open('a').write(f'{time.time():.3f} slow stream completed {n} words\n')
        return

    if 'history' in text:
        async for chunk in words(f'History received: {history_summary(messages)}'):
            yield chunk
        return

    yield {0: DeltaThinkingPart(content='Thinking about a reply.')}
    async for chunk in words('Hello from the **spike agent**. Try: weather, delete, ask, plan, image, error, slow, history.'):
        yield chunk


agent = Agent(
    FunctionModel(stream_function=stream, model_name='spike'),
    name='spike_agent',
    deps_type=StateDeps[Plan],
    output_type=[str, DeferredToolRequests],
)


@agent.tool_plain
def get_weather(city: str) -> str:
    """Weather for a city."""
    return json.dumps({'city': city, 'temperature_c': 18, 'conditions': 'cloudy'})


@agent.tool_plain(requires_approval=True)
def delete_file(path: str) -> str:
    """Delete a file (needs approval)."""
    return f'File {path!r} deleted'


@agent.tool
def create_plan(ctx, titles: list[str]) -> ToolReturn:
    """Create a plan in shared state."""
    ctx.deps.state.steps = [Step(title=t) for t in titles]
    snapshot = StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=ctx.deps.state.model_dump())
    return ToolReturn(return_value='plan created', metadata=[snapshot])


@agent.tool
def complete_step(ctx, index: int) -> ToolReturn:
    """Mark a plan step done."""
    delta = StateDeltaEvent(
        type=EventType.STATE_DELTA,
        delta=[{'op': 'replace', 'path': f'/steps/{index}/status', 'value': 'completed'}],
    )
    return ToolReturn(return_value=f'step {index} completed', metadata=[delta])


async def run(request: Request) -> Response:
    body = await request.body()
    with LOG.open('a') as log:
        log.write(json.dumps({'at': time.time(), 'headers': {k: v for k, v in request.headers.items() if k.lower().startswith(('x-', 'authorization'))}, 'body': json.loads(body or b'{}')}) + '\n')
    return await AGUIAdapter.dispatch_request(request, agent=agent, deps=StateDeps(Plan()))


app = Starlette(routes=[Route('/', run, methods=['POST'])])
```

## Appendix B: the spec-level 1.0 stub (`stub-1-0.mjs`)

```js
// Throwaway spike: a spec-level AG-UI 1.0 producer (the "second producer" of decision 7), on node:http with
// @ag-ui/encoder. Scenarios by the last user text: "input" (an input_required interrupt with a responseSchema),
// "activity" (ACTIVITY_SNAPSHOT/DELTA), "frontend" (RUN_FINISHED with pendingToolCallIds), "cancel" (a cancelled
// outcome), "multi" (two text messages and reasoning in one run), "encrypted" (REASONING_ENCRYPTED_VALUE).
// usage: node stub-1-0.mjs <node-dir> <port>
import http from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'

const [nodeDir, port] = process.argv.slice(2)
const require = createRequire(path.join(nodeDir, 'package.json'))
const { EventEncoder } = require('@ag-ui/encoder')
const { EventType } = require('@ag-ui/core')

const sleep = ms => new Promise(r => setTimeout(r, ms))
let counter = 0
const id = p => `${p}-${++counter}`

function lastUserText(messages) {
	const user = [...messages].reverse().find(m => m.role === 'user')
	if (!user) return ''
	return typeof user.content === 'string'
		? user.content
		: user.content
				.filter(c => c.type === 'text')
				.map(c => c.text)
				.join(' ')
}

function* textMessage(text) {
	const messageId = id('msg')
	yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' }
	for (const word of text.split(' '))
		yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: word + ' ' }
	yield { type: EventType.TEXT_MESSAGE_END, messageId }
}

function* scenario(input) {
	const text = lastUserText(input.messages).toLowerCase()
	const { threadId, runId } = input
	yield { type: EventType.RUN_STARTED, threadId, runId, protocolVersion: '1.0' }
	if (input.resume?.length) {
		yield* textMessage(`Resumed with ${JSON.stringify(input.resume)}`)
		yield { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: 'success' } }
		return
	}
	if (text.includes('input')) {
		yield* textMessage('I need one detail before I continue.')
		yield {
			type: EventType.RUN_FINISHED,
			threadId,
			runId,
			outcome: {
				type: 'interrupt',
				interrupts: [
					{
						id: id('int'),
						reason: 'input_required',
						message: 'Which region should the report cover?',
						responseSchema: {
							type: 'object',
							properties: {
								region: { type: 'string', enum: ['EMEA', 'APAC', 'AMER'] },
								note: { type: 'string' },
							},
							required: ['region'],
						},
					},
				],
			},
		}
		return
	}
	if (text.includes('activity')) {
		const messageId = id('act')
		yield {
			type: EventType.ACTIVITY_SNAPSHOT,
			messageId,
			activityType: 'progress',
			content: { label: 'Indexing', done: 0, total: 3 },
		}
		for (let i = 1; i <= 3; i++)
			yield {
				type: EventType.ACTIVITY_DELTA,
				messageId,
				activityType: 'progress',
				patch: [{ op: 'replace', path: '/done', value: i }],
			}
		yield* textMessage('Indexing finished.')
		yield { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: 'success' } }
		return
	}
	if (text.includes('frontend')) {
		const messageId = id('msg'),
			toolCallId = id('call')
		yield {
			type: EventType.TOOL_CALL_START,
			toolCallId,
			toolCallName: 'ask_user',
			parentMessageId: messageId,
		}
		yield {
			type: EventType.TOOL_CALL_ARGS,
			toolCallId,
			delta: JSON.stringify({ question: 'Pick one', options: ['A', 'B'] }),
		}
		yield { type: EventType.TOOL_CALL_END, toolCallId }
		yield {
			type: EventType.RUN_FINISHED,
			threadId,
			runId,
			outcome: { type: 'success' },
			pendingToolCallIds: [toolCallId],
		}
		return
	}
	if (text.includes('cancel')) {
		yield* textMessage('Partial answer before the producer cancelled')
		yield { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: 'cancelled' } }
		return
	}
	if (text.includes('encrypted')) {
		const messageId = id('rsn')
		yield { type: EventType.REASONING_START, messageId }
		yield {
			type: EventType.REASONING_ENCRYPTED_VALUE,
			subtype: 'message',
			entityId: messageId,
			encryptedValue: 'opaque-blob-123',
		}
		yield { type: EventType.REASONING_END, messageId }
		yield* textMessage('Answer after hidden reasoning.')
		yield { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: 'success' } }
		return
	}
	// "multi" and default: reasoning, two assistant messages, a step, usage.
	const rid = id('rsn')
	yield { type: EventType.REASONING_START, messageId: rid }
	yield { type: EventType.REASONING_MESSAGE_START, messageId: rid, role: 'reasoning' }
	yield { type: EventType.REASONING_MESSAGE_CONTENT, messageId: rid, delta: 'Two parts coming.' }
	yield { type: EventType.REASONING_MESSAGE_END, messageId: rid }
	yield { type: EventType.REASONING_END, messageId: rid }
	yield { type: EventType.STEP_STARTED, stepName: 'draft' }
	yield* textMessage('First message of the run.')
	yield { type: EventType.STEP_FINISHED, stepName: 'draft' }
	yield* textMessage('Second message of the run.')
	yield {
		type: EventType.RUN_FINISHED,
		threadId,
		runId,
		outcome: { type: 'success' },
		usage: [{ inputTokens: 10, outputTokens: 20 }],
	}
}

http
	.createServer(async (req, res) => {
		if (req.method !== 'POST') {
			res.writeHead(405).end()
			return
		}
		let body = ''
		for await (const chunk of req) body += chunk
		let input
		try {
			input = JSON.parse(body)
		} catch {
			res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"bad json"}')
			return
		}
		if (!input.threadId || !input.runId || !Array.isArray(input.messages)) {
			res
				.writeHead(422, { 'Content-Type': 'application/json' })
				.end('{"error":"invalid RunAgentInput"}')
			return
		}
		const encoder = new EventEncoder({ accept: req.headers.accept })
		res.writeHead(200, { 'Content-Type': encoder.getContentType(), 'Cache-Control': 'no-cache' })
		for (const event of scenario(input)) {
			res.write(encoder.encodeSSE({ ...event, timestamp: Date.now() }))
			await sleep(10)
		}
		res.end()
	})
	.listen(Number(port), '127.0.0.1', () => console.log(`1.0 stub on ${port}`))
```

## Appendix C: the hub route (`app/api/spike-agui/route.ts`)

```ts
// THROWAWAY SPIKE (spike/agui, never pushed): the hub's server as an AG-UI consumer and re-encoder.
import { HttpAgent } from '@ag-ui/client'
import { EventEncoder } from '@ag-ui/encoder'

import { verifySession } from '@/lib/auth/session'

const AGENTS: Record<string, string> = {
	py: 'http://127.0.0.1:9100/',
	stub: 'http://127.0.0.1:9101/',
}

export async function POST(request: Request) {
	const actor = await verifySession()
	if (!actor) return Response.json({ code: 'unauthorized' }, { status: 401 })
	const body = await request.json()
	const agent = new HttpAgent({
		url: AGENTS[body.agent] ?? AGENTS.py,
		headers: { 'X-Hub-User-Id': actor.id },
		threadId: body.threadId,
		initialMessages: body.messages,
		initialState: body.state ?? {},
	})
	const encoder = new EventEncoder()
	const text = new TextEncoder()
	request.signal.addEventListener('abort', () => {
		console.log('[spike-agui] browser disconnected: aborting upstream')
		agent.abortRun()
	})
	const stream = new ReadableStream({
		async start(controller) {
			const send = (event: Parameters<EventEncoder['encodeSSE']>[0]) => {
				try {
					controller.enqueue(text.encode(encoder.encodeSSE(event)))
				} catch {
					// the browser has gone; the abort listener stops the upstream run
				}
			}
			try {
				const result = await agent.runAgent(
					{
						runId: crypto.randomUUID(),
						tools: body.tools ?? [],
						...(body.resume ? { resume: body.resume } : {}),
					},
					{ onEvent: ({ event }) => send(event) },
				)
				// What the hub would store: the run's new messages, the state and the open interrupts.
				send({
					type: 'CUSTOM' as never,
					name: 'hub:run-saved',
					value: {
						newMessages: result.newMessages,
						state: agent.state,
						pendingInterrupts: agent.pendingInterrupts,
					},
				} as never)
			} catch (error) {
				console.log('[spike-agui] runAgent threw', error)
			} finally {
				try {
					controller.close()
				} catch {}
			}
		},
	})
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-store',
			'X-Accel-Buffering': 'no',
			'X-Content-Type-Options': 'nosniff',
		},
	})
}
```

## Appendix D: the turn reducer and X provider (`agui-provider.ts`)

The page (`spike-chat.tsx`, `useXChat` + `Bubble.List` + `Sender`, Approve/Reject and choice buttons, a state `<pre>`) and the Playwright spec are not kept; the provider below is the part the design builds on.

```ts
// THROWAWAY SPIKE (spike/agui, never pushed): one X message per assistant turn, holding ordered parts.
import type { Interrupt, Message, ResumeEntry } from '@ag-ui/core'
import { AbstractChatProvider } from '@ant-design/x-sdk'
import type { SSEOutput, TransformMessage, XRequestOptions } from '@ant-design/x-sdk'

export type TurnPart =
	| { kind: 'text'; messageId: string; text: string }
	| { kind: 'reasoning'; messageId: string; text: string; encrypted?: boolean }
	| {
			kind: 'tool'
			toolCallId: string
			name: string
			args: string
			result?: string
	  }
	| { kind: 'activity'; messageId: string; activityType: string; content: unknown }
	| { kind: 'custom'; name: string; value: unknown }

export interface Turn {
	role: 'user' | 'assistant'
	parts: TurnPart[]
	runs: { runId: string; outcome?: string; error?: string }[]
	interrupts?: Interrupt[]
	aborted?: boolean
	eventCount?: number
}

export interface SpikeInput {
	text?: string
	image?: { mimeType: string; base64: string }
	resume?: { turn: Turn; entries?: ResumeEntry[]; toolMessages?: Message[] }
}

/** The "hub store" of the spike: AG-UI messages and state per thread, written from the route's hub:run-saved event. */
export const spikeStore = {
	messages: [] as Message[],
	state: {} as unknown,
	listeners: new Set<() => void>(),
	setState(state: unknown) {
		this.state = state
		for (const l of this.listeners) l()
	},
}

const upsert = <T extends TurnPart>(
	parts: TurnPart[],
	match: (p: TurnPart) => p is T,
	make: () => T,
	patch: (p: T) => T,
) => {
	const index = parts.findIndex(match)
	if (index === -1) return [...parts, patch(make())]
	return parts.map((p, i) => (i === index ? patch(p as T) : p))
}

export function applyAgUiEvent(turn: Turn, e: Record<string, any>): Turn {
	const t = { ...turn, eventCount: (turn.eventCount ?? 0) + 1 }
	const isText =
		(id: string) =>
		(p: TurnPart): p is Extract<TurnPart, { kind: 'text' }> =>
			p.kind === 'text' && p.messageId === id
	const isReasoning =
		(id: string) =>
		(p: TurnPart): p is Extract<TurnPart, { kind: 'reasoning' }> =>
			p.kind === 'reasoning' && p.messageId === id
	const isTool =
		(id: string) =>
		(p: TurnPart): p is Extract<TurnPart, { kind: 'tool' }> =>
			p.kind === 'tool' && p.toolCallId === id
	switch (e.type) {
		case 'RUN_STARTED':
			return { ...t, runs: [...t.runs, { runId: e.runId }], interrupts: undefined }
		case 'TEXT_MESSAGE_CONTENT':
			return {
				...t,
				parts: upsert(
					t.parts,
					isText(e.messageId),
					() => ({ kind: 'text', messageId: e.messageId, text: '' }),
					p => ({ ...p, text: p.text + e.delta }),
				),
			}
		case 'REASONING_MESSAGE_CONTENT':
			return {
				...t,
				parts: upsert(
					t.parts,
					isReasoning(e.messageId),
					() => ({ kind: 'reasoning', messageId: e.messageId, text: '' }),
					p => ({ ...p, text: p.text + e.delta }),
				),
			}
		case 'REASONING_ENCRYPTED_VALUE':
			return t
		case 'TOOL_CALL_START':
			return {
				...t,
				parts: upsert(
					t.parts,
					isTool(e.toolCallId),
					() => ({ kind: 'tool', toolCallId: e.toolCallId, name: e.toolCallName, args: '' }),
					p => p,
				),
			}
		case 'TOOL_CALL_ARGS':
			return {
				...t,
				parts: upsert(
					t.parts,
					isTool(e.toolCallId),
					() => ({ kind: 'tool', toolCallId: e.toolCallId, name: '?', args: '' }),
					p => ({ ...p, args: p.args + e.delta }),
				),
			}
		case 'TOOL_CALL_RESULT':
			return {
				...t,
				parts: upsert(
					t.parts,
					isTool(e.toolCallId),
					() => ({ kind: 'tool', toolCallId: e.toolCallId, name: '?', args: '' }),
					p => ({
						...p,
						result: typeof e.content === 'string' ? e.content : JSON.stringify(e.content),
					}),
				),
			}
		case 'ACTIVITY_SNAPSHOT':
			return {
				...t,
				parts: [
					...t.parts.filter(p => !(p.kind === 'activity' && p.messageId === e.messageId)),
					{
						kind: 'activity',
						messageId: e.messageId,
						activityType: e.activityType,
						content: e.content,
					},
				],
			}
		case 'STATE_SNAPSHOT':
		case 'STATE_DELTA':
			return t // applied by the route (agent.state) and sent in hub:run-saved
		case 'CUSTOM':
			if (e.name === 'hub:run-saved') return t
			return { ...t, parts: [...t.parts, { kind: 'custom', name: e.name, value: e.value }] }
		case 'RUN_FINISHED': {
			const runs = t.runs.map((r, i) =>
				i === t.runs.length - 1 ? { ...r, outcome: e.outcome?.type ?? 'success' } : r,
			)
			return {
				...t,
				runs,
				interrupts: e.outcome?.type === 'interrupt' ? e.outcome.interrupts : undefined,
			}
		}
		case 'RUN_ERROR': {
			const runs = t.runs.map((r, i) =>
				i === t.runs.length - 1
					? { ...r, outcome: 'error', error: `${e.code ?? ''} ${e.message}` }
					: r,
			)
			return { ...t, runs }
		}
		default:
			return t
	}
}

const emptyTurn = (): Turn => ({ role: 'assistant', parts: [], runs: [] })

export class AgUiSpikeProvider extends AbstractChatProvider<Turn, SpikeInput, SSEOutput> {
	agent = 'py'
	threadId = `spike-${Date.now()}`
	private resumeBase: Turn | null = null

	transformParams(
		requestParams: Partial<SpikeInput>,
		_options: XRequestOptions<SpikeInput, SSEOutput, Turn>,
	): SpikeInput {
		let messages = [...spikeStore.messages]
		if (requestParams.resume) {
			// A frontend tool's answer is the consumer's own tool message: no TOOL_CALL_RESULT comes back for it.
			const answers = new Map(
				(requestParams.resume.toolMessages ?? []).map(m => [
					(m as { toolCallId: string }).toolCallId,
					String(m.content),
				]),
			)
			this.resumeBase = {
				...requestParams.resume.turn,
				parts: requestParams.resume.turn.parts.map(p =>
					p.kind === 'tool' && answers.has(p.toolCallId)
						? { ...p, result: answers.get(p.toolCallId) }
						: p,
				),
			}
			messages = [...messages, ...(requestParams.resume.toolMessages ?? [])]
			spikeStore.messages = messages
		} else {
			this.resumeBase = null
			const content = requestParams.image
				? [
						{ type: 'text', text: requestParams.text ?? '' },
						{
							type: 'image',
							source: {
								type: 'data',
								value: requestParams.image.base64,
								mimeType: requestParams.image.mimeType,
							},
						},
					]
				: (requestParams.text ?? '')
			messages = [...messages, { id: crypto.randomUUID(), role: 'user', content } as Message]
			spikeStore.messages = messages
		}
		return {
			agent: this.agent,
			threadId: this.threadId,
			messages,
			state: spikeStore.state,
			resume: requestParams.resume?.entries,
			tools: [
				{
					name: 'ask_user',
					description: 'Ask the user a question with choices',
					parameters: {
						type: 'object',
						properties: {
							question: { type: 'string' },
							options: { type: 'array', items: { type: 'string' } },
						},
						required: ['question'],
					},
				},
			],
		} as unknown as SpikeInput
	}

	transformLocalMessage(requestParams: Partial<SpikeInput>): Turn | Turn[] {
		if (requestParams.resume) return []
		return {
			role: 'user',
			parts: [
				{
					kind: 'text',
					messageId: 'local',
					text: (requestParams.text ?? '') + (requestParams.image ? ' [image]' : ''),
				},
			],
			runs: [],
		}
	}

	transformMessage(info: TransformMessage<Turn, SSEOutput>): Turn {
		const origin = info.originMessage ?? this.resumeBase ?? emptyTurn()
		const data = info.chunk?.data
		if (!data) return origin
		let event: Record<string, any>
		try {
			event = JSON.parse(data)
		} catch {
			return origin
		}
		if (event.type === 'CUSTOM' && event.name === 'hub:run-saved') {
			spikeStore.messages = [...spikeStore.messages, ...event.value.newMessages]
			spikeStore.setState(event.value.state)
		}
		return applyAgUiEvent(origin, event)
	}
}
```
