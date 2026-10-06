import { toFileMapping, type UploadedFile } from '../chat-view/file-types'
import type { HumanInputField, HumanInputState } from '../provider/message'

/** The form's effective state: the stream's word wins; otherwise the clock decides (spec §4.6 step 5). */
export const humanInputPhase = (
	humanInput: HumanInputState,
	nowSeconds: number,
): HumanInputState['state'] => {
	if (humanInput.state !== 'pending') return humanInput.state
	return humanInput.expiresAt > 0 && nowSeconds >= humanInput.expiresAt ? 'expired' : 'pending'
}

/**
 * The values a form opens with. OpenAPI, GET /form/human_input: `resolved_default_values` holds the
 * defaults that resolve from a workflow variable ("display these values"); a paragraph's `constant`
 * default "means `value` is used as a literal string" and is not in that map.
 */
export const humanInputInitialValues = (humanInput: HumanInputState): Record<string, string> => {
	const values: Record<string, string> = {}
	for (const field of humanInput.inputs) {
		const name = field.output_variable_name
		const resolved = humanInput.defaults[name]
		if (typeof resolved === 'string') values[name] = resolved
		else if (
			field.type === 'paragraph' &&
			field.default?.type === 'constant' &&
			field.default.value
		)
			values[name] = field.default.value
	}
	return values
}

// A file mapping (OpenAPI, POST /form/human_input): `{transfer_method: local_file, upload_file_id, type}` or
// `{transfer_method: remote_url, url, type}`, the same object as a chat input's file (toFileMapping).
const isFile = (value: unknown): value is UploadedFile =>
	Boolean(value) && typeof value === 'object'

/**
 * The submission's `inputs` (OpenAPI, POST /form/human_input): "Paragraph and select inputs take a
 * string; a `file` input takes one file mapping; a `file-list` input takes an array of file mappings."
 * A file still uploading has no id yet and is left out.
 */
export const humanInputSubmission = (
	fields: HumanInputField[],
	values: Record<string, unknown>,
): Record<string, unknown> => {
	const inputs: Record<string, unknown> = {}
	for (const field of fields) {
		const name = field.output_variable_name
		const value = values[name]
		if (field.type === 'file') inputs[name] = isFile(value) ? toFileMapping(value) : undefined
		else if (field.type === 'file-list')
			inputs[name] = (Array.isArray(value) ? value : [])
				.filter(isFile)
				.map(toFileMapping)
				.filter(Boolean)
		else inputs[name] = typeof value === 'string' ? value : ''
	}
	return inputs
}
