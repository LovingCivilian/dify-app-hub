// web/lib/core/constants.ts
// 合并自原 src/constants/index.ts + src/constants/app.ts

/**
 * 消息角色
 */
export type IMessageRole = 'local' | 'user' | 'ai'

/**
 * 聊天中的角色
 */
export const Roles = {
	USER: 'user',
	AI: 'ai',
	LOCAL: 'local',
} as const

/**
 * 应用类型
 */
export enum AppModeEnums {
	TEXT_GENERATOR = 'completion',
	CHATBOT = 'chat',
	WORKFLOW = 'workflow',
	CHATFLOW = 'advanced-chat',
	AGENT = 'agent-chat',
}

export const AppModeLabels = {
	[AppModeEnums.TEXT_GENERATOR]: 'Text Generator',
	[AppModeEnums.CHATBOT]: 'Chatbot',
	[AppModeEnums.WORKFLOW]: 'Workflow',
	[AppModeEnums.CHATFLOW]: 'Chatflow',
	[AppModeEnums.AGENT]: 'Agent',
}

export const AppModeNames = {
	[AppModeEnums.TEXT_GENERATOR]: 'app_mode.name.text_generator',
	[AppModeEnums.CHATBOT]: 'app_mode.name.chatbot',
	[AppModeEnums.WORKFLOW]: 'app_mode.name.workflow',
	[AppModeEnums.CHATFLOW]: 'app_mode.name.chatflow',
	[AppModeEnums.AGENT]: 'app_mode.name.agent',
} as const

const AppModeOptionLabels = {
	[AppModeEnums.TEXT_GENERATOR]: 'app_mode.option.text_generator',
	[AppModeEnums.CHATBOT]: 'app_mode.option.chatbot',
	[AppModeEnums.WORKFLOW]: 'app_mode.option.workflow',
	[AppModeEnums.CHATFLOW]: 'app_mode.option.chatflow',
	[AppModeEnums.AGENT]: 'app_mode.option.agent',
} as const

export const AppModeOptions = [
	AppModeEnums.CHATBOT,
	AppModeEnums.WORKFLOW,
	AppModeEnums.CHATFLOW,
	AppModeEnums.AGENT,
	AppModeEnums.TEXT_GENERATOR,
].map(mode => {
	return {
		label: AppModeOptionLabels[mode],
		value: mode,
	}
})

export const OpeningStatementDisplayMode = {
	Default: 'default',
	Always: 'always',
}

export const OpeningStatementDisplayModeOptions = [
	{ label: 'app_setting.opening_display_default', value: OpeningStatementDisplayMode.Default },
	{ label: 'app_setting.opening_display_always', value: OpeningStatementDisplayMode.Always },
] as const

export const DEFAULT_APP_SITE_SETTING = {
	title: '',
	chat_color_theme: '',
	chat_color_theme_inverted: false,
	icon_type: 'emoji' as const,
	icon: '🤖',
	icon_background: '#1C64F2',
	icon_url: '',
	description: '',
	copyright: '',
	privacy_policy: '',
	custom_disclaimer: '',
	default_language: 'zh-CN',
	show_workflow_steps: false,
	use_icon_as_answer_icon: false,
}
