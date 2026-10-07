import type { FileType, TransferMethod } from './files'

/** Dify 1.17.1 app modes served by the Service API (endpoint map, Conventions). `agent` is the new Agent app, SSE only. */
export const APP_MODES = [
	'chat',
	'agent-chat',
	'advanced-chat',
	'workflow',
	'completion',
	'agent',
] as const
export type AppMode = (typeof APP_MODES)[number]

export const isAppMode = (value: unknown): value is AppMode =>
	typeof value === 'string' && (APP_MODES as readonly string[]).includes(value)

/** The chat family of /chat-messages (source gate `not_chat_app`). */
export const CHAT_MODES: readonly AppMode[] = ['chat', 'agent-chat', 'advanced-chat', 'agent']
/** The run family of /workflows/run and /completion-messages. */
export const RUN_MODES: readonly AppMode[] = ['workflow', 'completion']

/** GET /info (endpoint map §1.1). */
export interface AppInfo {
	name: string
	description: string
	tags: string[]
	mode: AppMode
	author_name?: string | null
}

/** The nine control types of `user_input_form` (endpoint map §2.1). */
export type UserInputControlType =
	| 'text-input'
	| 'paragraph'
	| 'select'
	| 'number'
	| 'external_data_tool'
	| 'file'
	| 'file-list'
	| 'checkbox'
	| 'json_object'

export interface UserInputFieldConfig {
	variable: string
	label: string
	description?: string | null
	required?: boolean
	hide?: boolean
	default?: unknown
	type?: string
	max_length?: number | null
	options?: string[]
	allowed_file_types?: FileType[]
	allowed_file_extensions?: string[]
	allowed_file_upload_methods?: TransferMethod[]
	json_schema?: unknown
	config?: unknown
}

/** One `user_input_form` item: a single-key object keyed by its control type. */
export type UserInputFormItem = Partial<Record<UserInputControlType, UserInputFieldConfig>>

export interface FileUploadConfig {
	enabled?: boolean
	number_limits?: number
	allowed_file_types?: FileType[]
	allowed_file_extensions?: string[]
	allowed_file_upload_methods?: TransferMethod[]
	/** legacy image block, still sent */
	image?: {
		enabled?: boolean
		number_limits?: number
		detail?: string
		transfer_methods?: TransferMethod[]
	}
}

/** GET /parameters (endpoint map §1.1, §2.1). */
export interface AppParameters {
	opening_statement?: string | null
	suggested_questions?: string[]
	suggested_questions_after_answer?: { enabled: boolean }
	speech_to_text?: { enabled: boolean }
	text_to_speech?: {
		enabled: boolean
		voice?: string
		language?: string
		autoPlay?: 'enabled' | 'disabled'
	}
	retriever_resource?: { enabled: boolean }
	annotation_reply?: { enabled: boolean }
	more_like_this?: { enabled: boolean }
	user_input_form: UserInputFormItem[]
	sensitive_word_avoidance?: { enabled: boolean }
	file_upload?: FileUploadConfig
	system_parameters?: {
		image_file_size_limit?: number
		video_file_size_limit?: number
		audio_file_size_limit?: number
		file_size_limit?: number
		workflow_file_upload_limit?: number
	}
}

/** GET /site (endpoint map §1.1). `icon_url` for an image icon is a signed link that expires (charter §4.4). */
export interface SiteSettings {
	title: string
	chat_color_theme?: string | null
	chat_color_theme_inverted?: boolean
	icon_type?: 'emoji' | 'image' | null
	icon?: string | null
	icon_background?: string | null
	icon_url?: string | null
	description?: string | null
	copyright?: string | null
	privacy_policy?: string | null
	input_placeholder?: string | null
	custom_disclaimer?: string | null
	default_language?: string | null
	show_workflow_steps?: boolean
	use_icon_as_answer_icon?: boolean
}

/** GET /meta. */
export interface AppMeta {
	tool_icons: Record<string, string | { background: string; content: string }>
}
