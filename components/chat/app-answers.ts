import {
	DEFAULT_APP_SITE_SETTING,
	type IDifyAppParameters,
	type IDifyAppSiteSetting,
} from '@/lib/core'

import { envelopeError } from './hooks/dify-errors'

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object'

/**
 * GET /parameters as `DifyApi` resolves it. BaseRequest throws only on a 401 and resolves every other
 * answer's JSON, so Dify's error body (documented: 400 `app_unavailable`, `agent_not_published`) or the
 * proxy's `{ error }` arrives as a value. A parameters answer always carries the `user_input_form` list
 * (OpenAPI AppParametersResponse); anything else is thrown as `{ status, code?, message }` (envelopeError).
 */
export const toAppParameters = (answer: unknown): IDifyAppParameters => {
	if (isRecord(answer) && Array.isArray(answer.user_input_form)) {
		return answer as unknown as IDifyAppParameters
	}
	throw envelopeError(answer)
}

/**
 * GET /site (the `data` of the proxy's envelope): the WebApp settings, or the defaults for an error body
 * (documented: 403 `forbidden`; Dify before 1.4 has no /site). A settings answer carries its `title`.
 */
export const toSiteSetting = (answer: unknown): IDifyAppSiteSetting =>
	isRecord(answer) && typeof answer.title === 'string'
		? (answer as unknown as IDifyAppSiteSetting)
		: // IDifyAppSiteSetting types `show_workflow_steps` as the literal `false`; the default holds a boolean.
			(DEFAULT_APP_SITE_SETTING as IDifyAppSiteSetting)
