import type { TFunction } from 'i18next'

import type { Turn } from '@/lib/chat/turn'
import { RequestError } from '@/lib/http/browser'

/** The agent's in-stream RUN_ERROR codes (spec §2.3): a title each; the agent's message is safe to show (the owner). */
export const AGENT_ERROR_CODES = [
	'usage_limit',
	'rate_limited',
	'busy',
	'model_unavailable',
	'agent_error',
] as const

const AGENT_CODE_KEYS = {
	usage_limit: 'shared_chat.error.usage_limit',
	rate_limited: 'shared_chat.error.rate_limited',
	busy: 'shared_chat.error.busy',
	model_unavailable: 'shared_chat.error.model_unavailable',
	agent_error: 'shared_chat.error.agent_error',
} as const satisfies Record<(typeof AGENT_ERROR_CODES)[number], string>

/**
 * The hub's own codes (spec §8; the route guard's access codes, ADR-0023): worded by key, never by their English
 * message (charter §4.5: nothing user-facing is English from the wire). The access codes keep the chat's existing keys.
 */
const HUB_CODE_KEYS = {
	agent_auth_failed: 'shared_chat.error.agent_auth_failed',
	agent_not_found: 'shared_chat.error.agent_not_found',
	agent_rejected_input: 'shared_chat.error.agent_rejected_input',
	provider_unreachable: 'shared_chat.error.provider_unreachable',
	upstream_error: 'shared_chat.error.upstream_error',
	conversation_not_found: 'shared_chat.error.conversation_not_found',
	run_in_progress: 'shared_chat.error.run_in_progress',
	answer_pending: 'shared_chat.error.answer_pending',
	answers_invalid: 'shared_chat.error.answers_invalid',
	unauthorized: 'chat.error_unauthorized',
	forbidden: 'chat.error_forbidden',
	app_not_found: 'chat.error_app_not_found',
	app_disabled: 'chat.error_app_disabled',
} as const

export const HUB_ERROR_CODES = Object.keys(HUB_CODE_KEYS) as (keyof typeof HUB_CODE_KEYS)[]

type AgentCode = keyof typeof AGENT_CODE_KEYS
type HubCode = keyof typeof HUB_CODE_KEYS
const isAgentCode = (code: string | undefined): code is AgentCode =>
	code !== undefined && Object.hasOwn(AGENT_CODE_KEYS, code)
const isHubCode = (code: string | undefined): code is HubCode =>
	code !== undefined && Object.hasOwn(HUB_CODE_KEYS, code)

export interface RunErrorView {
	titleKey:
		| (typeof AGENT_CODE_KEYS)[AgentCode]
		| (typeof HUB_CODE_KEYS)[HubCode]
		| 'shared_chat.error.generic'
	description?: string
}

/**
 * A run error as the turn's Alert shows it (spec §5.3): a localised title for the code and, for the agent's codes and
 * any code the hub does not know, the agent's message (spec §4.4: `RUN_ERROR` passes through with its message, which
 * the owner says is safe to show); a hub code shows its title alone.
 */
export const runErrorView = (error: { code?: string; message: string }): RunErrorView => {
	if (isHubCode(error.code)) return { titleKey: HUB_CODE_KEYS[error.code] }
	return {
		titleKey: isAgentCode(error.code) ? AGENT_CODE_KEYS[error.code] : 'shared_chat.error.generic',
		description: error.message || undefined,
	}
}

/** A failed read (the list, the history) in words: a hub code by its key, anything else `fallback` (failureText's rule). */
export const requestFailureText = (error: unknown, t: TFunction, fallback = ''): string =>
	error instanceof RequestError && isHubCode(error.code) ? t(HUB_CODE_KEYS[error.code]) : fallback

/**
 * The caption under a stopped turn (spec §5.3): "Stopped" for a run the user stopped or left (`cancelled`,
 * `truncated`), "Stopped: time limit" for the agent's own time limit (spec §2.3: `CUSTOM run_cancelled` with
 * `reason: 'run_timeout'`).
 */
export const stoppedCaptionKey = (
	turn: Turn,
): 'chat.stopped' | 'shared_chat.stopped_time_limit' | undefined => {
	const last = turn.runs.at(-1)
	if (!last || (last.outcome !== 'cancelled' && last.outcome !== 'truncated')) return undefined
	return last.cancelledReason === 'run_timeout' ? 'shared_chat.stopped_time_limit' : 'chat.stopped'
}
