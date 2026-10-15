# AG-UI agents in the hub

For the authors of agents an AG-UI app in the hub points at. The hub is an AG-UI 1.0 consumer ([ADR-0033](decisions/0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md), [ADR-0034](decisions/0034-add-ag-ui-agents-as-a-provider.md)); anything that follows the AG-UI spec over HTTP + SSE works, and a 0.x producer (Pydantic AI on `ag-ui-protocol` 0.1.x) works too.

## The app's settings

| Field | What it is |
| --- | --- |
| Agent URL | The full endpoint the hub POSTs to, e.g. `http://agents:8000/agents/assistant`. The hub's server calls it; the browser never does, so a Docker service name is fine. |
| Audience | The JWT's `aud`; your agent checks it, e.g. `assistant`. |
| JWT secret | 32–512 characters, shared with your agent: `openssl rand -base64 48`. Never the hub's `NEXTAUTH_SECRET`. Stored write-only; leave it blank on Edit to keep it. |
| Ask the user | Off by default. On, every run offers your agent the hub's `ask_user` tool (see "Asking the user"). Leave it off if your agent has a tool of that name. |

The issuer is the hub-wide `AGENT_JWT_ISSUER` (default `nextjs-bff`).

## Each request

`POST <Agent URL>` with:

- `Content-Type: application/json`
- `Accept: text/event-stream`
- `Authorization: Bearer <JWT>`, the only credential. No browser header and no NextAuth token reach your agent.
- The body: the AG-UI `RunAgentInput`, built by the hub from its own store: `threadId` (the hub's conversation id), `runId` (new for every run), `messages` (the whole thread: user, assistant with tool calls, tool results, the hub's answers to your `ask_user` calls, reasoning with any `encryptedValue` you sent; activity messages stripped), `state` (your last state), `tools` (the hub's `ask_user` tool while the app's "Ask the user" switch is on, `[]` otherwise: see "Asking the user"), `context` `[]`, `forwardedProps` `{}`, and `resume` when the run answers your interrupts (see "Interrupts").

Your agent is stateless: the hub re-sends the whole history every run.

The body is sent whole, with a `Content-Length` (never chunked): `@ag-ui/client`'s `HttpAgent` posts it as a JSON string. Runs of one conversation never overlap: while a run is active, the hub refuses the user's next request itself (409 `run_in_progress`), so your agent never sees two runs of one `threadId` at once. A user message is plain text of at most 32,000 characters; the hub sends no files yet.

## The JWT

HS256, signed with the app's JWT secret as UTF-8 bytes, minted fresh for every request (each run and each Test connection):

| Claim         | Value                                                    |
| ------------- | -------------------------------------------------------- |
| `sub`         | the user's permanent account id (a UUID); never an email |
| `iat`         | now                                                      |
| `exp`         | now + 60 s                                               |
| `iss`         | `AGENT_JWT_ISSUER` (default `nextjs-bff`)                |
| `aud`         | the app's Audience                                       |
| `auth_source` | `local` or `ldap`                                        |
| `roles`       | `["owner"]`, `["admin"]` or `["user"]`                   |

No `name` and no `email`. Verify every request, for example with PyJWT ("Usage Examples": `algorithms`, `audience`, `issuer`, `leeway`, `options.require`):

```python
import jwt

claims = jwt.decode(
    token,
    secret.encode(),
    algorithms=['HS256'],
    audience='assistant',
    issuer='nextjs-bff',
    leeway=10,
    options={'require': ['exp', 'iat', 'sub', 'iss', 'aud']},
)
```

Then put `claims['sub']`, `claims['auth_source']` and `claims['roles']` into your run's dependencies, and authorise sensitive tools there, not from anything in the body (Pydantic AI: "UI adapter endpoints aren't authentication boundaries").

## Answering

Before any stream, answer with a plain HTTP status and no event stream:

| Status | When | The user sees |
| --- | --- | --- |
| 401 | a missing, bad or expired token | "The agent refused the hub's credentials" (`agent_auth_failed`) |
| 404 | an unknown agent | "The agent was not found" (`agent_not_found`) |
| 415 | a body that is not JSON | "The agent refused the request" (`agent_rejected_input`) |
| 422 | a body that is not a valid `RunAgentInput` | the same |

The hub reads a 403 the same way as a 401 (`agent_auth_failed`); agents should still send 401.

A refused connection reads as "The agent is restarting, try again" (`provider_unreachable`). Any other status before the stream is an upstream error.

In the stream, a failure is `RUN_ERROR` with a `code` and a `message` the user may read. The hub titles these codes: `usage_limit`, `rate_limited`, `busy`, `model_unavailable`, `agent_error`; any other code gets a generic title. A run that hits your time limit sends `CUSTOM { name: 'run_cancelled', value: { reason: 'run_timeout' } }` and then `RUN_FINISHED`; the hub keeps the partial answer and shows "Stopped: time limit".

The hub shows text, reasoning, tool calls with their results, run errors, your interrupts (see "Interrupts"), a plan from your state and your activity messages (see "State and activity"). It does not show `RAW` events or `REASONING_ENCRYPTED_VALUE` (it keeps the value in the stored message and sends it back with the history), and it keeps `CUSTOM` events other than `run_cancelled` with the run without showing them.

Stream your content as events (`TEXT_MESSAGE_*`, `REASONING_*`, `TOOL_CALL_*`): the hub folds `MESSAGES_SNAPSHOT` into its store on the server only and never sends it to the browser, so content your agent sends only in snapshots appears after a reload, not while it streams.

## Asking the user

While the app's **Ask the user** switch is on (an admin sets it in the app form's Conversation settings; it is off by default), every run advertises one tool in `RunAgentInput.tools`: the hub's `ask_user`, the full-stack template's tool (`backend/app/agents/tools/ask_user_tool.py`, release 0.2.21). Its description tells the model that the answers come back in the next turn. Its arguments:

```json
{ "questions": [{ "question": "Which region?", "options": ["EU", "US"], "allow_custom": true }] }
```

| Argument | Rule |
| --- | --- |
| `questions` | 1–10 questions |
| `question` | 1–500 characters after trimming |
| `options` | optional, at most 10, each 1–200 characters after trimming; shown as choices |
| `allow_custom` | optional, `true` by default: the user may type their own answer (at most 2,000 characters) |

Unknown keys are ignored. Call it as a frontend tool (AG-UI "Tool calls", "Frontend tools"): do not answer the call yourself, and end the run with the success outcome. The user sees the questions above the composer, one at a time, with **Skip** (this question) and **Dismiss** (the rest), and cannot send a message until they are done. Several calls in one run are asked in one go, in call order. Once the last question, and any interrupt of the same run, has an answer, the hub starts the next run, which carries one `tool` message per call, keyed by its `toolCallId`, whose `content` is a transcript:

```text
Q: Which region?
A: EU

Q: Anything else?
A: (skipped)
```

`(skipped)` marks a question the user skipped or dismissed, `(no answer)` one left without an answer.

Arguments that break these rules show the user "The agent asked an invalid question" with Dismiss, and the call is answered with a `tool` message whose `error` is `invalid_arguments`. If an admin turns the switch off while a question waits, the question is released and the next run answers the call with `error` `not_available` ("This tool is not available here."), as it answers any call to a tool the hub did not advertise; answered questions stay in the conversation.

**The name:** if your agent has a tool named `ask_user` of its own, leave the switch off. Pydantic AI fails every run in which two tools share a name (`UserError`: "defines a tool whose name conflicts with existing tool"). A call to a tool the hub did not advertise, such as Pydantic AI Harness's deferred `ask_user_question`, is not a question for the user: it never blocks the composer, and the next run answers it `not_available`.

## Interrupts

A run that needs the user ends with `RUN_FINISHED` and the outcome `{ type: 'interrupt', interrupts: […] }` (AG-UI "Interrupt and resume"). The hub shows each interrupt and blocks the composer until every open interrupt and question has an answer; the user can change an answer until the last one is in. The next run then carries `resume`, one entry per interrupt of your run, in the order your outcome lists them: `{ interruptId, status: 'resolved', payload }` or `{ interruptId, status: 'cancelled' }`, beside the answers to any `ask_user` calls of the same run.

| Interrupt | The user sees | A resolved entry's `payload` |
| --- | --- | --- |
| `reason: 'tool_call'` with a `toolCallId` (an approval) | **Approve** and **Reject** on the tool's card, its arguments read-only | your `responseSchema`'s first required boolean property, else its first boolean property, else `approved`, set to `true` or `false`; Reject adds `reason: 'Rejected by the user'` when the schema has a string `reason` |
| `reason: 'confirmation'` without a `responseSchema` | **Yes** and **No** | `true` or `false` (AG-UI's boolean default) |
| any reason with a flat `responseSchema` | a form with **Submit** and **Cancel** | the form's values: only your schema's properties |
| anything else | your `message` and **Cancel** | — |

Approvals, for example:

| Your `responseSchema` | Approve | Reject |
| --- | --- | --- |
| Pydantic AI's: `approved` (boolean, required), `editedArgs`, `reason` (string) | `{ "approved": true }` | `{ "approved": false, "reason": "Rejected by the user" }` |
| Microsoft Agent Framework's: `accepted` (boolean, required), `arguments` | `{ "accepted": true }` | `{ "accepted": false }` |
| none | `{ "approved": true }` | `{ "approved": false }` |

The hub never sends `editedArgs`: the arguments are not editable. An approval whose `toolCallId` matches no tool call in the turn shows as a card of its own with the same buttons.

The approval shows your interrupt's `message` as the request beside **Reject** and **Approve** (without one, "Run this tool?"), so write it for the user, e.g. "Post this announcement to the team?", rather than rely on a framework default that repeats the call, such as Pydantic AI's `Approve <tool>(<args>)?`: the tool's card already shows its name and arguments.

**The form** reads a flat object schema: `properties` whose `type` is `string` (with `minLength`, `maxLength`), `number` or `integer` (with `minimum`, `maximum`) or `boolean`, or an `enum` of strings or numbers, each with an optional `title`, `description` and `default`; `required`; and at the top `title`, `description`, `additionalProperties: false` and `$schema`. Lengths count characters (code points). With any other keyword, a nested object or array, a `required` name that is not a property, or a `default` of the wrong type, the user sees only your `message` and **Cancel**. The hub checks every payload against your schema before your next run starts.

**The card's title** is the reason: the reasons AG-UI defines are translated, and any other reason (namespace your own, e.g. `myframework:choose_slot`) is shown as written. Write `message` for the user; it is shown as plain text.

**Cancel** sends `status: 'cancelled'` without a payload ("abandoned without providing meaningful input"); treat a cancelled approval as not executed.

**Expiry:** an interrupt whose `expiresAt` (ISO 8601) has passed shows as expired with only **Dismiss**, which sends `cancelled`; the hub refuses any other answer to it.

**One resume:** every interrupt of your run is answered in one `resume` list, never a partial one (AG-UI: "The resume list MUST cover every interrupt"). If your agent refuses that run before its stream (any error status before the stream, a 5xx included, no connection, or the hub failing before it sends), the interrupts stay open and the user can answer again.

A Stop, or the user leaving, after the hub has sent the answering run is not a refusal: the request may already have reached your agent, which may have acted on the answers, so the run is stored as stopped and its answers count as given. If that happens before your stream starts, your agent never sees the `resume`, and the conversation's next run is the user's next message, without one. Do not assume every interrupt gets a `resume`.

**LangGraph:** the hub reads only the 1.0 interrupt outcome of `RUN_FINISHED`. `ag-ui-langgraph` sends it only with `emit_interrupt_outcome=True` (`emitInterruptOutcome` in TypeScript; off by default); without it, interrupts arrive as the legacy `CUSTOM on_interrupt` event, which the hub does not read, and the run looks finished.

## State and activity

**A plan.** When your state (`STATE_SNAPSHOT`, `STATE_DELTA`) has this shape, with at least one step, the hub shows it in a panel above the composer:

```json
{
	"steps": [
		{ "description": "Find flights", "status": "completed" },
		{ "description": "Book a hotel", "status": "in_progress" }
	]
}
```

The panel reads "Plan 1/2" (completed steps), with a progress bar and the steps. It collapses once every step is completed.

| `status`      | The step shows |
| ------------- | -------------- |
| `pending`     | waiting        |
| `in_progress` | in progress    |
| `completed`   | done           |
| `blocked`     | an error       |
| anything else | waiting        |

It is the shape of AG-UI's Dojo `agentic_generative_ui` and Pydantic AI's example of it.

**Other state** is not shown to users. Your next run receives it unchanged as `state`, and users cannot edit it, so it is only ever what your agent sent. Keep secrets out of it: state round-trips through the hub (AG-UI "State").

**Activity:** an `activity` message (`ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA`) shows read-only in its turn as a small card titled with its `activityType`: an object whose values are strings, numbers, booleans or null as a list of fields, anything else as indented JSON, cut at 10,240 characters. Activity messages are stripped from the `messages` your next run receives (AG-UI "Activity": a consumer "MUST strip activity messages" from the messages it sends), so keep nothing you need only there.

Everything your agent sends is shown as plain text, never as HTML.

## Ids and limits

- **Unique ids:** keep message ids and tool-call ids unique across the whole thread, not only within a run. The hub stores one message per id, and two waiting calls with one id cannot be answered.
- **Bounds on what waits:** interrupt ids and tool-call ids are at most 256 characters, and one run leaves at most 50 interrupts and at most 50 `ask_user` calls open. The user's answers are checked against these bounds, so a run beyond them leaves a conversation nobody can answer: Stop does not clear it (there is no run to stop), only deleting the conversation does, or, when the stuck items are `ask_user` calls, turning the app's switch off.

## Stop and silence

The user's Stop closes the hub's request to your agent. On Starlette (FastAPI, Pydantic AI's `AGUIAdapter`) the stream sees `CancelledError` and the model call stops; the hub keeps what arrived and marks the turn "Stopped". Tool calls you started and did not answer come back in the next run's history with a `tool` message whose `error` is `stopped`.

The hub's HTTP client (Node's `fetch`, undici 6, whose documented `headersTimeout` and `bodyTimeout` default to 300 s each, Client options) gives up after five minutes without a byte from your agent. If a tool can run longer, send something before that: an SSE comment line (`: keep-alive`), which AG-UI consumers must tolerate, or a progress event.

## Test connection

The app form's Test connection POSTs `{}` (valid JSON, not a valid `RunAgentInput`) with a fresh JWT whose `sub` is the admin running it, and waits up to 10 seconds:

| Your answer | The form shows |
| --- | --- |
| 422 or 400 | "Connected" |
| 401 or 403 | "The key was refused" |
| 404 | "The agent was not found" |
| 415 or another 4xx | "The provider answered with an error" |
| no answer, the timeout, or a 5xx | "The provider could not be reached" |
| a 2xx event stream | "Connected, but the agent ran on a test request": your agent started a run on invalid input (the hub closes it at once; fix the agent) |
| a 2xx answer that is not an event stream | "The provider answered with an error" |

Check the token before validating the body, so a wrong secret shows as refused rather than "Connected". FastAPI runs auth dependencies before body validation for well-formed JSON, which is why the probe is `{}`.
