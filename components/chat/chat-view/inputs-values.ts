import type {
	UserInputControlType,
	UserInputFieldConfig,
	UserInputFormItem,
} from '@/lib/dify/types'
import { unParseGzipString } from '@/lib/helpers'

import { toControlFile, toFileMapping, type UploadedFile } from './file-types'

/** Dify lists each input as `{ [controlType]: field }` with only the one key present (a partial record). */
export type InputDefinition = UserInputFormItem

export interface ResolveArgs {
	form: InputDefinition[]
	/** Decoded `?var=` values (gzip-decoded by the caller with unParseGzipString). */
	urlValues: Record<string, unknown>
	/** `?isKeepAll=true` values kept across navigations (decoded by the caller as well). */
	globalParams: Record<string, unknown>
	conversationInputs: Record<string, unknown>
	/** True while the conversation has not been sent yet (a new chat). */
	isTemp: boolean
	allowUpdate: boolean
	/**
	 * The link's values were applied to this conversation already (the caller remembers which keys):
	 * they are used once, then what is stored or typed wins.
	 */
	seeded: boolean
}

/** The controls the form renders; Dify may list others (external data tools), which are not inputs. */
export const SUPPORTED_CONTROL_TYPES: readonly UserInputControlType[] = [
	'text-input',
	'select',
	'number',
	'paragraph',
	'file',
	'file-list',
]

/** One input's definition; `type` is the field's own, or its control key when the field has none. */
export type InputField = UserInputFieldConfig

/** Field definitions flattened from Dify's `{ [controlType]: field }` list, the supported controls only. */
export const inputFields = (form: InputDefinition[]): InputField[] =>
	form.flatMap(item => {
		const entry = Object.entries(item)[0]
		if (!entry) return []
		const [type, field] = entry
		if (!field || !SUPPORTED_CONTROL_TYPES.includes(type as UserInputControlType)) return []
		return [{ ...field, type: field.type ?? type }]
	})

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * A stored value in the shape its control holds: a conversation's file inputs come back from Dify with
 * `filename`, `remote_url` and `related_id`, which the file control reads as `name`, `url` and
 * `upload_file_id` (toControlFile, ported from the old form's normalizeFieldValue).
 */
const controlValueOf = (type: InputField['type'], value: unknown) => {
	if (type === 'file' && isRecord(value)) return toControlFile(value, 0)
	if (type === 'file-list' && Array.isArray(value)) {
		return value.map((file, index) => (isRecord(file) ? toControlFile(file, index) : file))
	}
	return value
}

/**
 * The link's input values (`?<variable>=<gzip>`, spec §4.7) for the form's variables, decoded with
 * unParseGzipString. `raw` reads a variable's value from the link; a value that does not decode is left
 * out and reported through `onError` (the chat and the run view show it as a toast).
 */
export const decodeLinkInputs = (
	form: InputDefinition[],
	raw: (variable: string) => string | null | undefined,
	onError: (variable: string, error: unknown) => void,
): Record<string, unknown> => {
	const values: Record<string, unknown> = {}
	for (const { variable } of inputFields(form)) {
		const encoded = raw(variable)
		if (!encoded) continue
		const { error, data } = unParseGzipString(encoded)
		if (error) onError(variable, error)
		else values[variable] = data
	}
	return values
}

/**
 * Which value each input starts with (today's rules, spec §4.9): the link's value on a new chat or when
 * updates are allowed (once per conversation, see `seeded`), else the conversation's stored inputs (for a
 * new chat those are the values typed so far) in the control's shape, else the default.
 */
export const resolveInitialInputs = ({
	form,
	urlValues,
	globalParams,
	conversationInputs,
	isTemp,
	allowUpdate,
	seeded,
}: ResolveArgs): Record<string, unknown> =>
	Object.fromEntries(
		inputFields(form).map(field => {
			const external = seeded
				? undefined
				: (urlValues[field.variable] ?? globalParams[field.variable])
			if (external !== undefined && (isTemp || allowUpdate)) return [field.variable, external]
			if (conversationInputs[field.variable] !== undefined) {
				return [field.variable, controlValueOf(field.type, conversationInputs[field.variable])]
			}
			return [field.variable, field.default || undefined]
		}),
	)

/**
 * The inputs as POST /chat-messages takes them: a `file` input as one Dify file object and a `file-list`
 * input as an array of them (OpenAPI InputFileObject; ChatRequest.inputs follow the app's
 * `user_input_form`), stored files included; files still uploading are left out. Other values go as they are.
 */
export const apiInputs = (
	form: InputDefinition[],
	values: Record<string, unknown>,
): Record<string, unknown> => {
	const types = new Map(inputFields(form).map(field => [field.variable, field.type]))
	return Object.fromEntries(
		Object.entries(values).map(([name, value]) => {
			const type = types.get(name)
			if (type === 'file')
				return [name, isRecord(value) ? toFileMapping(value as UploadedFile) : undefined]
			if (type === 'file-list') {
				return [
					name,
					Array.isArray(value)
						? value.filter(isRecord).flatMap(file => toFileMapping(file as UploadedFile) ?? [])
						: undefined,
				]
			}
			return [name, value]
		}),
	)
}

/**
 * The files of the form's file inputs that cannot go yet (antd Upload's item status): still `uploading`, or
 * failed (`error`). apiInputs leaves them out, and a required input holding one still passes validation,
 * so a send waits for them, or for their removal, instead of going without them.
 */
export const pendingFileInputs = (form: InputDefinition[], values: Record<string, unknown>) => {
	const uploading: Record<string, unknown>[] = []
	const failed: Record<string, unknown>[] = []
	for (const field of inputFields(form)) {
		if (field.type !== 'file' && field.type !== 'file-list') continue
		const value = values[field.variable]
		for (const file of Array.isArray(value) ? value : [value]) {
			if (!isRecord(file)) continue
			if (file.status === 'uploading') uploading.push(file)
			else if (file.status === 'error') failed.push(file)
		}
	}
	return { uploading, failed }
}

/** `?sender_text=`: the URL decoding has happened already, the link's text is encoded once more (today's rule); text that is not valid percent-encoding stays as it is. */
export const decodeSenderText = (raw: string | null): string => {
	if (!raw) return ''
	try {
		return decodeURIComponent(raw)
	} catch {
		return raw
	}
}
