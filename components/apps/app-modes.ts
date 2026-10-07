import type { AppMode } from '@/lib/dify/types'

/*
 * Translation keys per Dify app mode: the short name (labels, filters) and the admin form's option text.
 * `as const satisfies` keeps each value a literal key, which the typed `t()` requires (types/i18next.d.ts).
 */
export const APP_MODE_NAME_KEYS = {
	chat: 'app_mode.name.chatbot',
	'agent-chat': 'app_mode.name.agent',
	'advanced-chat': 'app_mode.name.chatflow',
	workflow: 'app_mode.name.workflow',
	completion: 'app_mode.name.text_generator',
	agent: 'app_mode.name.agent_app',
} as const satisfies Record<AppMode, string>

export const APP_MODE_OPTION_KEYS = {
	chat: 'app_mode.option.chatbot',
	'agent-chat': 'app_mode.option.agent',
	'advanced-chat': 'app_mode.option.chatflow',
	workflow: 'app_mode.option.workflow',
	completion: 'app_mode.option.text_generator',
	agent: 'app_mode.option.agent_app',
} as const satisfies Record<AppMode, string>

/** The admin form's choices, in the order of Dify's console. */
export const APP_MODE_OPTIONS: readonly AppMode[] = [
	'chat',
	'agent',
	'advanced-chat',
	'agent-chat',
	'workflow',
	'completion',
]
