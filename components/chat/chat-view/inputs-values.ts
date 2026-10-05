import type { IUserInputForm, IUserInputFormItemType } from '@/lib/core'

/**
 * Dify lists each input as `{ [controlType]: field }` with only the one key present, which the
 * generated `IUserInputForm` (a total Record) does not express.
 */
export type InputDefinition = Partial<IUserInputForm>

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
export const SUPPORTED_CONTROL_TYPES: readonly IUserInputFormItemType[] = [
	'text-input',
	'select',
	'number',
	'paragraph',
	'file',
	'file-list',
]

/** Field definitions flattened from Dify's `{ [controlType]: field }` list, the supported controls only. */
export const inputFields = (form: InputDefinition[]) =>
	form.flatMap(item => {
		const entry = Object.entries(item)[0]
		if (!entry) return []
		const [type, field] = entry
		if (!SUPPORTED_CONTROL_TYPES.includes(type as IUserInputFormItemType)) return []
		return [{ ...field, type: field.type ?? (type as typeof field.type) }]
	})

/**
 * Which value each input starts with (today's rules, spec §4.9): the link's value on a new chat or when
 * updates are allowed (once per conversation, see `seeded`), else the conversation's stored inputs (for a
 * new chat those are the values typed so far), else the default.
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
				return [field.variable, conversationInputs[field.variable]]
			}
			return [field.variable, field.default || undefined]
		}),
	)

/** `?sender_text=`: the URL decoding has happened already, the link's text is encoded once more (today's rule); text that is not valid percent-encoding stays as it is. */
export const decodeSenderText = (raw: string | null): string => {
	if (!raw) return ''
	try {
		return decodeURIComponent(raw)
	} catch {
		return raw
	}
}
