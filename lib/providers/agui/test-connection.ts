import 'server-only'

import { env } from '@/lib/env'

import type { ProviderCaller } from '../caller'
import type { ConnectionTestResult } from '../connection'
import { mintAgentToken } from './jwt'
import type { AguiSecrets, AguiSettings } from './schema'

/** Spec §2.4: an agent that never answers is unreachable after 10 s, as Dify's test (Part 1 Plan decision f). */
export const AGUI_TEST_TIMEOUT_MS = 10_000

/**
 * Lets a body go unread: MDN `ReadableStream.cancel()`, "used when you've completely finished with the stream and don't
 * need any more data from it", which also releases the connection. The agent's text is never read, logged or echoed
 * (spec §2.4). A body already gone is no failure.
 */
const discard = async (response: Response): Promise<void> => {
	await response.body?.cancel().catch(() => undefined)
}

const isEventStream = (response: Response): boolean =>
	(response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/event-stream')

/**
 * Test connection for an AG-UI agent (spec §2.4): POST `{}` (valid JSON, an invalid `RunAgentInput`) to the agent URL
 * with a fresh JWT whose `sub` is the admin running the test. AG-UI defines no health route or capability exchange
 * ("No transport binding in this version carries a capabilities exchange", spec 1.0 Capabilities), and refused input
 * is "an HTTP error status with no event stream" (spec 1.0 HTTP + SSE, Errors), so a conforming agent refuses this
 * body before any run starts and no model is called: the hub's own convention, derived from that rule (ADR-0034).
 * 422 or 400 is reachable (the token passed, the body was refused); 401 or 403 a refused key; 404 an unknown agent;
 * 415 or another 4xx an upstream error; a refused connection, the timeout (MDN `AbortSignal.timeout()`) or a 5xx
 * unreachable; a 2xx event stream means the agent ran on invalid input: the body is cancelled at once and the test
 * warns. Docs silent on what a 2xx that is not a stream means: it is not an AG-UI answer, so an upstream error.
 */
export const testAguiConnection = async (
	settings: AguiSettings,
	secrets: AguiSecrets,
	caller: ProviderCaller,
): Promise<ConnectionTestResult> => {
	const token = await mintAgentToken({
		caller,
		secret: secrets.jwtSecret,
		audience: settings.audience,
		issuer: env().agentJwtIssuer,
	})
	let response: Response
	try {
		response = await fetch(settings.agentUrl, {
			method: 'POST',
			// Spec §2.3: exactly one auth header, the JWT; nothing from the browser.
			headers: {
				'Content-Type': 'application/json',
				Accept: 'text/event-stream',
				Authorization: `Bearer ${token}`,
			},
			body: '{}',
			signal: AbortSignal.timeout(AGUI_TEST_TIMEOUT_MS),
		})
	} catch {
		// fetch rejects for a refused connection, a host that does not resolve, and the timeout ("TimeoutError").
		return { ok: false, code: 'unreachable' }
	}
	const { status } = response
	const stream = isEventStream(response)
	await discard(response)
	if (status >= 200 && status < 300)
		return stream
			? { ok: true, warning: { code: 'ran_on_invalid_input' } }
			: { ok: false, code: 'upstream_error' }
	if (status === 400 || status === 422) return { ok: true }
	if (status === 401 || status === 403) return { ok: false, code: 'key_refused' }
	if (status === 404) return { ok: false, code: 'agent_not_found' }
	if (status >= 500) return { ok: false, code: 'unreachable' }
	return { ok: false, code: 'upstream_error' }
}
