import type { Interrupt } from '@ag-ui/core'

/*
 * How the hub answers an AG-UI interrupt (Part 2 spec §6.1, §6.3; plan calls P5–P8, P14), client-safe: the browser's
 * cards build their answers with it, and the server's answers check (lib/chat/answers.ts) re-checks every resolved
 * entry with the same rules, as AG-UI asks of a client ("Clients should validate before submitting", concepts ›
 * Interrupts, contract rule 6). `@ag-ui/core` is imported for its types only (spec §9: the browser bundle carries no
 * AG-UI runtime). A `responseSchema` is the agent's, so untrusted: anything outside the subset below answers null or
 * false, never throws.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value)
/** JSON Schema Validation 2020-12 §6.1.1: "integer" matches "any number with a zero fractional part". */
const isInteger = (value: unknown): value is number => Number.isInteger(value)
/** §6.3.1, §6.3.2: a length bound "MUST be a non-negative integer". */
const isLength = (value: unknown): value is number => isInteger(value) && value >= 0
const optional = <T>(
	value: unknown,
	guard: (value: unknown) => value is T,
): value is T | undefined => value === undefined || guard(value)

/** Spec §6.1: added to a rejection when the schema declares a string `reason`. */
export const REJECTED_REASON = 'Rejected by the user'

/**
 * Spec §6.1: an interrupt with reason `tool_call` and a `toolCallId` (AG-UI concepts › Interrupts, "Tool-bound
 * interrupts"; the reason taxonomy: for `tool_call`, "`toolCallId` must be set").
 */
export const isApproval = (interrupt: Pick<Interrupt, 'reason' | 'toolCallId'>): boolean =>
	interrupt.reason === 'tool_call' && Boolean(interrupt.toolCallId)

const propertiesOf = (schema: unknown): Record<string, unknown> =>
	isRecord(schema) && isRecord(schema.properties) ? schema.properties : {}

const hasType = (node: unknown, type: string): boolean => isRecord(node) && node.type === type

/**
 * P5: the boolean property an approval sets. Frameworks name it differently (`approved` for Pydantic AI and AWS
 * Strands, `accepted` for Microsoft Agent Framework: research part2-hitl-state-files.md §1.3), so it is read from the
 * interrupt's own schema: its first required boolean property in the order of `properties`, else its first boolean
 * property, else the spec's `approved` (AG-UI concepts › Interrupts, "Approve with edits").
 */
export const approvalKey = (schema: unknown): string => {
	const properties = propertiesOf(schema)
	const required = isRecord(schema) && Array.isArray(schema.required) ? schema.required : []
	const booleans = Object.keys(properties).filter(name => hasType(properties[name], 'boolean'))
	return booleans.find(name => required.includes(name)) ?? booleans[0] ?? 'approved'
}

/**
 * P5: Approve (`true`) or Reject (`false`) in the interrupt's own schema's terms: the approval key alone, plus
 * REJECTED_REASON on a rejection when the schema declares a string `reason` (Pydantic AI 2.56 turns `approved: false`
 * with a `reason` into its denial message: research part2-hitl-state-files.md §2). "Denials are expressed inside the
 * payload … not as a separate status" (AG-UI concepts › Interrupts, "Resuming a run").
 */
export const approvalPayload = (schema: unknown, approved: boolean): Record<string, unknown> => {
	const key = approvalKey(schema)
	return !approved && hasType(propertiesOf(schema).reason, 'string')
		? { [key]: false, reason: REJECTED_REASON }
		: { [key]: approved }
}

interface FieldBase {
	name: string
	required: boolean
	title?: string
	description?: string
}

/** P7: one field of a flat responseSchema, in the order of `properties`. */
export type FlatField =
	| (FieldBase & { type: 'string'; default?: string; minLength?: number; maxLength?: number })
	| (FieldBase & {
			type: 'number' | 'integer'
			default?: number
			minimum?: number
			maximum?: number
	  })
	| (FieldBase & { type: 'boolean'; default?: boolean })
	| (FieldBase & { type: 'enum'; default?: string | number; options: (string | number)[] })

/** P7: the keywords the subset knows, at the top and per kind of property; any other puts a schema outside it. */
const SCHEMA_KEYWORDS = new Set([
	'$schema',
	'type',
	'title',
	'description',
	'properties',
	'required',
	'additionalProperties',
])
const ANNOTATIONS = ['type', 'title', 'description', 'default']
const PROPERTY_KEYWORDS: Record<
	'string' | 'number' | 'integer' | 'boolean' | 'enum',
	Set<string>
> = {
	string: new Set([...ANNOTATIONS, 'minLength', 'maxLength']),
	number: new Set([...ANNOTATIONS, 'minimum', 'maximum']),
	integer: new Set([...ANNOTATIONS, 'minimum', 'maximum']),
	boolean: new Set(ANNOTATIONS),
	enum: new Set([...ANNOTATIONS, 'enum']),
}

const onlyKeywords = (node: Record<string, unknown>, known: Set<string>): boolean =>
	Object.keys(node).every(key => known.has(key))

/**
 * P7: an enum of strings or numbers, at least one and none twice (JSON Schema Validation 2020-12 §6.1.2: the array
 * "SHOULD have at least one element. Elements in the array SHOULD be unique"), each of the declared `type` when one
 * is given; null otherwise.
 */
const enumOptions = (node: Record<string, unknown>): (string | number)[] | null => {
	const { enum: options, type } = node
	if (!Array.isArray(options) || options.length === 0) return null
	if (new Set(options).size !== options.length) return null
	const fits = (option: unknown) =>
		type === undefined
			? isString(option) || isNumber(option)
			: type === 'string'
				? isString(option)
				: type === 'number'
					? isNumber(option)
					: type === 'integer' && isInteger(option)
	return options.every(fits) ? options : null
}

const fieldOf = (name: string, node: unknown, required: boolean): FlatField | null => {
	if (!isRecord(node)) return null
	const { type, title, description, default: fallback } = node
	if (!optional(title, isString) || !optional(description, isString)) return null
	const base = { name, required, title, description }
	if (Object.hasOwn(node, 'enum')) {
		const options = onlyKeywords(node, PROPERTY_KEYWORDS.enum) ? enumOptions(node) : null
		if (!options) return null
		const chosen = options.find(option => option === fallback)
		// §9.2: a default "SHOULD be valid against the associated schema"; one the enum lacks is refused (P7).
		return fallback === undefined || chosen !== undefined
			? { ...base, type: 'enum', options, default: chosen }
			: null
	}
	switch (type) {
		case 'string': {
			const { minLength, maxLength } = node
			if (!onlyKeywords(node, PROPERTY_KEYWORDS.string)) return null
			if (!optional(fallback, isString)) return null
			if (!optional(minLength, isLength) || !optional(maxLength, isLength)) return null
			return { ...base, type, default: fallback, minLength, maxLength }
		}
		case 'number':
		case 'integer': {
			const { minimum, maximum } = node
			if (!onlyKeywords(node, PROPERTY_KEYWORDS[type])) return null
			if (!optional(fallback, type === 'integer' ? isInteger : isNumber)) return null
			// §6.2.2, §6.2.4: each bound "MUST be a number".
			if (!optional(minimum, isNumber) || !optional(maximum, isNumber)) return null
			return { ...base, type, default: fallback, minimum, maximum }
		}
		case 'boolean':
			if (!onlyKeywords(node, PROPERTY_KEYWORDS.boolean)) return null
			return optional(fallback, isBoolean) ? { ...base, type, default: fallback } : null
		default:
			// Nested objects, arrays, type arrays (['string', 'null']) and schemas without a type are outside the subset.
			return null
	}
}

/**
 * P7 (decision 62: "Types and bounds"): the fields of a flat schema, `{ type: 'object', properties, required?, title?,
 * description?, additionalProperties?: false, $schema? }` whose properties are each a string, number, integer or
 * boolean with their bounds, or an enum; null for anything else, so the card offers Cancel only (P8). `required` must
 * name properties (§6.5.3: "Elements of this array, if any, MUST be strings").
 */
export const flatFields = (schema: unknown): FlatField[] | null => {
	if (!isRecord(schema) || schema.type !== 'object' || !onlyKeywords(schema, SCHEMA_KEYWORDS))
		return null
	const { properties, required = [], additionalProperties, title, description, $schema } = schema
	if (!isRecord(properties) || !Array.isArray(required)) return null
	if (!required.every(name => isString(name) && Object.hasOwn(properties, name))) return null
	if (additionalProperties !== undefined && additionalProperties !== false) return null
	if (
		!optional(title, isString) ||
		!optional(description, isString) ||
		!optional($schema, isString)
	)
		return null
	const fields = Object.entries(properties).map(([name, node]) =>
		fieldOf(name, node, required.includes(name)),
	)
	return fields.every((field): field is FlatField => field !== null) ? fields : null
}

/** §6.3.1: a string's length is "the number of its characters as defined by RFC 8259", that is code points. */
const codePoints = (text: string): number => Array.from(text).length

const fits = (field: FlatField, value: unknown): boolean => {
	switch (field.type) {
		case 'string': {
			if (!isString(value)) return false
			const length = codePoints(value)
			return (
				(field.minLength === undefined || length >= field.minLength) &&
				(field.maxLength === undefined || length <= field.maxLength)
			)
		}
		case 'number':
		case 'integer': {
			const ofType = field.type === 'integer' ? isInteger : isNumber
			if (!ofType(value)) return false
			// §6.2.2, §6.2.4: both bounds are inclusive.
			return (
				(field.minimum === undefined || value >= field.minimum) &&
				(field.maximum === undefined || value <= field.maximum)
			)
		}
		case 'boolean':
			return isBoolean(value)
		case 'enum':
			return field.options.some(option => option === value)
	}
}

/**
 * P7: a form's payload is an object with only declared keys, each value of its field's type (never null) and within
 * its bounds, and every required key present.
 */
export const checkFlatPayload = (fields: readonly FlatField[], payload: unknown): boolean => {
	if (!isRecord(payload)) return false
	const byName = new Map(fields.map(field => [field.name, field]))
	const known = Object.entries(payload).every(([name, value]) => {
		const field = byName.get(name)
		return field !== undefined && fits(field, value)
	})
	return known && fields.every(field => !field.required || Object.hasOwn(payload, field.name))
}

/** How an interrupt is answered (spec §6.1, §6.3; P6, P8). */
export type AnswerKind =
	| { kind: 'approval' }
	| { kind: 'confirm' }
	| { kind: 'form'; fields: FlatField[] }
	| { kind: 'cancel' }

/**
 * Spec §6.1, §6.3: an approval answers Approve or Reject (P5); a `confirmation` without a `responseSchema` answers a
 * bare boolean (P6: the reason taxonomy's "`responseSchema` optional; boolean default"); a flat schema a form (P7);
 * anything else, including a `tool_call` without a `toolCallId`, only Cancel (P8). Unknown reasons are rendered, never
 * refused ("For unknown reasons, clients must not error", concepts › Interrupts, "Client routing").
 */
export const answerKindOf = (interrupt: Interrupt): AnswerKind => {
	if (isApproval(interrupt)) return { kind: 'approval' }
	if (interrupt.responseSchema === undefined)
		return interrupt.reason === 'confirmation' ? { kind: 'confirm' } : { kind: 'cancel' }
	const fields = flatFields(interrupt.responseSchema)
	return fields ? { kind: 'form', fields } : { kind: 'cancel' }
}

/**
 * P14: @ag-ui/client 1.0.2's rule, copied so the browser needs no AG-UI runtime (spec §9): its `isInterruptExpired`
 * (`src/interrupts/index.ts`) answers false without an `expiresAt`, else `new Date(expiresAt) <= now`. A value that
 * is no date gives an Invalid Date, which compares false: "a value that is not one leaves the interrupt looking
 * permanently unexpired" (@ag-ui/core 1.0.2, `Interrupt.expiresAt`). The server re-checks with the client's own
 * function.
 */
export const isExpired = (interrupt: Pick<Interrupt, 'expiresAt'>, now: Date): boolean =>
	interrupt.expiresAt !== undefined && new Date(interrupt.expiresAt) <= now

/** Two flat records hold the same keys with the same values. */
const sameRecord = (expected: Record<string, unknown>, actual: unknown): boolean =>
	isRecord(actual) &&
	Object.keys(actual).length === Object.keys(expected).length &&
	Object.entries(expected).every(
		([key, value]) => Object.hasOwn(actual, key) && actual[key] === value,
	)

/**
 * The server's check of a resolved entry's payload (spec §6.1, §6.3): an approval's is exactly one of approvalPayload's
 * two (P5), a confirm's a boolean (P6), a form's passes checkFlatPayload (P7); an interrupt that can only be cancelled
 * accepts none (P8).
 */
export const payloadAccepted = (interrupt: Interrupt, payload: unknown): boolean => {
	const answer = answerKindOf(interrupt)
	switch (answer.kind) {
		case 'approval':
			return [true, false].some(approved =>
				sameRecord(approvalPayload(interrupt.responseSchema, approved), payload),
			)
		case 'confirm':
			return isBoolean(payload)
		case 'form':
			return checkFlatPayload(answer.fields, payload)
		case 'cancel':
			return false
	}
}
