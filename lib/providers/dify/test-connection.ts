import 'server-only'

import type { ConnectionTestResult } from '../connection'
import { difyClient } from './client'
import { DifyError } from './errors'
import type { DifySecrets, DifySettings } from './schema'

/** Plan decision f: a base that never answers is unreachable after 10 s (the hub's database timeout, Part 0). */
export const CONNECTION_TEST_TIMEOUT_MS = 10_000

/** The longest `mode` echoed back to the admin: an upstream's text is shown, so it is bounded (Dify's modes are under 16). */
export const REPORTED_MODE_MAX_LENGTH = 64

/**
 * Part 1 spec §4.2 (decision 18): GET /info with the key (endpoint map §1.1: `{ name, description, tags, mode,
 * author_name }`, no end-user context). An answer with the chosen type is success, another `mode` a warning. Dify's 401
 * is a refused key. A network failure, the timeout (MDN `AbortSignal.timeout()`: the fetch rejects with a
 * "TimeoutError" DOMException, which the client turns into upstream_unreachable) or a 5xx is unreachable. Any other
 * answer is an upstream error, an OK answer that is not Dify's JSON included: a base without `/v1` reaches Dify's
 * console, which answers its HTML page with 200 (Review Focus 3).
 */
export const testDifyConnection = async (
	settings: DifySettings,
	secrets: DifySecrets,
): Promise<ConnectionTestResult> => {
	let response: Response
	try {
		response = await difyClient({ apiBase: settings.apiBase, apiKey: secrets.apiKey }).fetchInfo(
			AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS),
		)
	} catch (error) {
		if (!(error instanceof DifyError)) throw error
		if (error.code === 'upstream_unreachable' || error.status >= 500)
			return { ok: false, code: 'unreachable' }
		if (error.status === 401) return { ok: false, code: 'key_refused' }
		return { ok: false, code: 'upstream_error' }
	}
	let mode: unknown
	try {
		const body: unknown = await response.json()
		mode = typeof body === 'object' && body !== null ? (body as { mode?: unknown }).mode : undefined
	} catch {
		return { ok: false, code: 'upstream_error' }
	}
	// A mode that is no short string is not Dify's /info answer: an upstream error, and the text is never passed on.
	if (typeof mode !== 'string' || mode.length === 0 || mode.length > REPORTED_MODE_MAX_LENGTH)
		return { ok: false, code: 'upstream_error' }
	return mode === settings.appType
		? { ok: true }
		: { ok: true, warning: { code: 'type_mismatch', reported: mode } }
}
