import 'server-only'

import { HttpAgent } from '@ag-ui/client'

import type { ChatAdapter, ChatTurnOpened, UpstreamErrorCode } from '@/lib/chat/adapter'
import { env } from '@/lib/env'

import { mintAgentToken } from './jwt'

/**
 * Part 2 spec §4.3 step 4: the agent's refusal before any stream, as the hub's code. The owner's service answers 401 for a
 * bad or expired token, 404 for an unknown agent, 415 for a body that is not JSON and 422 for an invalid one (spec §2.3;
 * Pydantic AI's `dispatch_request`: 415 and 422, `ui/_adapter.py`); 403 is a refusal of the caller too. Anything else is
 * the hub's existing `upstream_error` (plan call P5).
 */
export const upstreamCodeFor = (status: number): UpstreamErrorCode => {
	if (status === 401 || status === 403) return 'agent_auth_failed'
	if (status === 404) return 'agent_not_found'
	if (status === 415 || status === 422) return 'agent_rejected_input'
	return 'upstream_error'
}

/**
 * AG-UI's chat adapter (spec §4.3 step 3): one `HttpAgent` per run, run with `runAgent()`, the documented path that applies
 * `@ag-ui/client`'s 0.x → 1.0 compatibility boundary, enforcement and verification (docs.ag-ui.com "HttpAgent" and
 * "AbstractAgent"; research `part2-proxy-stop-identity.md` §1.2; `run()` would hand over raw events). CopilotKit's runtime
 * consumes an upstream agent the same way (`runner/in-memory.ts`: `agent.runAgent(input, { onEvent })`).
 *
 * The request (spec §2.3): `HttpAgent` posts the `RunAgentInput` with `Content-Type: application/json` and `Accept:
 * text/event-stream` (src/agent/http.ts `requestInit`); the hub adds exactly one header, `Authorization: Bearer <JWT>`,
 * minted for this request. `tools`, `context` and `forwardedProps` are always sent (Pydantic AI on protocol 0.1.22
 * requires them; spec §4.3 step 3).
 *
 * The `fetch` option (in the 1.0.2 typings, `HttpAgentConfig.fetch`; the docs page shows only `url` and `headers`) is where
 * the hub sees the agent's status before it answers the browser (spec §4.3 step 4): a refusal settles `opened` with its
 * code and hands the client an empty body of the same status, so the agent's error text is never read, logged or passed
 * on (spec §2.4: "none is echoed"); the client then fails the run with "HTTP <status>: " (src/run/http-request.ts), which
 * `runAgent` rejects with and the adapter takes as `failed`. A fetch that rejects is an agent that did not answer
 * (`provider_unreachable`), unless the hub aborted it itself: a Stop or the browser leaving before the agent answered
 * opens the run as `{ ok: true }` with nothing streamed, and the session closes it as cancelled or truncated (spec §4.5).
 *
 * The subscriber's hooks are the documented `AgentSubscriber` ones (docs.ag-ui.com "AbstractAgent", subscribers;
 * `index.d.ts` `AgentSubscriber`): `onEvent` sees each event before it is applied, `onMessagesChanged` and
 * `onStateChanged` the applied lists (src/agent/agent.ts `processApplyEvents`). An abort is not a failure: the client
 * swallows an `AbortError` and, mid-stream, emits its own `RUN_ERROR { code: 'abort' }` (src/transform/http.ts), which the
 * session drops.
 */
export const aguiChat: ChatAdapter<'agui'> = {
	runTurn({ settings, secrets }, input, sink) {
		const { signal } = input.abortController
		let open: (value: ChatTurnOpened) => void = () => undefined
		const opened = new Promise<ChatTurnOpened>(resolve => {
			open = resolve
		})
		const fetchUpstream = async (url: string, init: RequestInit): Promise<Response> => {
			let response: Response
			try {
				response = await fetch(url, init)
			} catch (error) {
				open(signal.aborted ? { ok: true } : { ok: false, code: 'provider_unreachable' })
				throw error
			}
			if (response.ok) {
				open({ ok: true })
				return response
			}
			open({ ok: false, code: upstreamCodeFor(response.status) })
			// Streams API: cancel() discards the body unread and releases the connection (MDN ReadableStream.cancel()).
			await response.body?.cancel()
			return new Response(null, { status: response.status })
		}
		const finished = (async () => {
			try {
				const token = await mintAgentToken({
					caller: input.caller,
					secret: secrets.jwtSecret,
					audience: settings.audience,
					issuer: env().agentJwtIssuer,
				})
				const agent = new HttpAgent({
					url: settings.agentUrl,
					headers: { Authorization: `Bearer ${token}` },
					threadId: input.threadId,
					initialMessages: input.messages,
					initialState: input.state,
					fetch: fetchUpstream,
				})
				await agent.runAgent(
					{
						runId: input.runId,
						tools: input.tools,
						context: [],
						forwardedProps: {},
						...(input.resume ? { resume: input.resume } : {}),
						abortController: input.abortController,
					},
					{
						onEvent: ({ event }) => {
							sink.event(event)
						},
						onMessagesChanged: ({ messages }) => {
							sink.messages(messages)
						},
						onStateChanged: ({ state }) => {
							sink.state(state)
						},
					},
				)
				return { failed: false }
			} catch {
				// A refusal, a refused connection, a stream that broke or failed verification; an abort is the hub's own.
				return { failed: !signal.aborted }
			} finally {
				// A run that ended before any request (the outgoing input refused by the client's enforcement) never opened.
				open({ ok: false, code: 'upstream_error' })
			}
		})()
		return { opened, finished }
	},
}
