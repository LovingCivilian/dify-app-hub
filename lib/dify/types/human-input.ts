import type { FileType, TransferMethod } from './files'

export interface HumanInputDefault {
	type: 'constant' | 'variable' | string
	selector?: string[]
	value?: string
}

/** A form input; the select options and file restrictions are documented on GET /form/human_input (map §1.5). */
export interface HumanInputField {
	type: 'paragraph' | 'select' | 'file' | 'file-list' | string
	output_variable_name: string
	default?: HumanInputDefault | null
	option_source?: { type: string; value?: string[]; selector?: string[] }
	allowed_file_types?: FileType[]
	allowed_file_extensions?: string[]
	allowed_file_upload_methods?: TransferMethod[]
	number_limits?: number
}

export interface HumanInputAction {
	id: string
	title: string
	button_style: 'primary' | 'default' | 'accent' | 'ghost' | string
}

/** GET /form/human_input/{form_token}. */
export interface HumanInputForm {
	form_content: string
	inputs: HumanInputField[]
	resolved_default_values: Record<string, string>
	user_actions: HumanInputAction[]
	/** unix seconds */
	expiration_time: number
}

export type HumanInputFileMapping =
	| { transfer_method: 'local_file'; upload_file_id: string; type?: FileType }
	| { transfer_method: 'remote_url'; url?: string; remote_url?: string; type?: FileType }

/** POST /form/human_input/{form_token} body, without `user` (set by the route). */
export interface HumanInputSubmission {
	inputs: Record<string, string | HumanInputFileMapping | HumanInputFileMapping[]>
	action: string
}

/** `form_definition` of a history `extra_contents` item (OpenAPI HumanInputFormDefinition). */
export interface HumanInputFormDefinition {
	form_id?: string
	node_id?: string
	node_title?: string
	form_content?: string
	inputs?: HumanInputField[]
	actions?: HumanInputAction[]
	display_in_ui?: boolean
	form_token?: string | null
	resolved_default_values?: Record<string, string>
	expiration_time?: number
}

export interface HumanInputFormSubmission {
	node_id?: string
	node_title?: string
	rendered_content?: string
	action_id?: string
	action_text?: string
}

/** An `extra_contents` item of GET /messages (OpenAPI HumanInputContent). */
export interface HumanInputContent {
	type: string
	workflow_run_id?: string
	submitted?: boolean
	form_definition?: HumanInputFormDefinition | null
	form_submission_data?: HumanInputFormSubmission | null
}
