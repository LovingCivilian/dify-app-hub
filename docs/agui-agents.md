# AG-UI agents in the hub

For the authors of agents an AG-UI app in the hub points at. The hub is an AG-UI 1.0 consumer ([ADR-0033](decisions/0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md), [ADR-0034](decisions/0034-add-ag-ui-agents-as-a-provider.md)); anything that follows the AG-UI spec over HTTP + SSE works, and a 0.x producer (Pydantic AI on `ag-ui-protocol` 0.1.x) works too.

## The app's settings

| Field | What it is |
| --- | --- |
| Agent URL | The full endpoint the hub POSTs to, e.g. `http://agents:8000/agents/assistant`. The hub's server calls it; the browser never does, so a Docker service name is fine. |
| Audience | The JWT's `aud`; your agent checks it, e.g. `assistant`. |
| JWT secret | 32–512 characters, shared with your agent: `openssl rand -base64 48`. Never the hub's `NEXTAUTH_SECRET`. Stored write-only; leave it blank on Edit to keep it. |

The issuer is the hub-wide `AGENT_JWT_ISSUER` (default `nextjs-bff`).

## Each request

`POST <Agent URL>` with:

- `Content-Type: application/json`
- `Accept: text/event-stream`
- `Authorization: Bearer <JWT>`, the only credential. No browser header and no NextAuth token reach your agent.
- The body: the AG-UI `RunAgentInput`, built by the hub from its own store: `threadId` (the hub's conversation id), `runId` (new for every run), `messages` (the whole thread: user, assistant with tool calls, tool results, reasoning with any `encryptedValue` you sent; activity messages stripped), `state` (your last state), `tools` (`[]`: the hub advertises no tools yet), `context` `[]`, `forwardedProps` `{}`, and `resume` when the user answered your interrupts.

Your agent is stateless: the hub re-sends the whole history every run.

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

The hub shows text, reasoning, tool calls with their results, and run errors. It does not show `RAW` events or `REASONING_ENCRYPTED_VALUE` (it keeps the value in the stored message and sends it back with the history).

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
