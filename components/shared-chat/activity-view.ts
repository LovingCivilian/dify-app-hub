import { flatFields, type Field } from './flat-fields'

/*
 * An activity message's content as its card shows it (Part 2 spec §6.4; 2b's plan call P17): a flat object as antd
 * Descriptions, anything else as indented JSON in X CodeHighlighter; spec §6.4 caps the content at 10 KB, so content
 * whose JSON is longer shows as that JSON, cut, whatever its shape. AG-UI 1.0 "Activity": the content
 * "is an object, not text" and `activityType` is an open string a consumer "MUST tolerate", so every type renders alike,
 * read-only (research `part2-hitl-state-files.md`, Implications C.2). Pure and client-safe: the card puts what this
 * answers into text nodes, never HTML (spec §6.4).
 */

/** Spec §6.4's 10 KB cap on the JSON view, in characters counted as code points (as P7 counts lengths). */
export const ACTIVITY_JSON_MAX = 10_240

export type ActivityView =
	| { kind: 'fields'; items: Field[] }
	| { kind: 'json'; text: string; truncated: boolean }

/**
 * The first `max` code points of `text`, or null when it has no more. A code point is one or two UTF-16 units, so a text
 * of at most `max` units fits; otherwise the string iterator, which yields code points (ECMAScript
 * `String.prototype[Symbol.iterator]`), finds the cut, so no surrogate pair is split.
 */
const cutAt = (text: string, max: number): string | null => {
	if (text.length <= max) return null
	let count = 0
	let end = 0
	for (const char of text) {
		if (count === max) return text.slice(0, end)
		count += 1
		end += char.length
	}
	return null
}

/**
 * P17: content whose indented JSON is longer than ACTIVITY_JSON_MAX as that JSON, cut; otherwise a flat object with at
 * least one key as fields (flat-fields.ts, values as `String(value)`) and anything else, an empty object too, as the
 * whole JSON.
 */
export const activityView = (content: unknown): ActivityView => {
	// JSON.stringify answers undefined, not text, for undefined (ECMA-262 SerializeJSONProperty): a missing content reads
	// as JSON's null, as JSON.stringify writes an undefined array element.
	const text = content === undefined ? 'null' : JSON.stringify(content, null, 2)
	const cut = cutAt(text, ACTIVITY_JSON_MAX)
	if (cut !== null) return { kind: 'json', text: cut, truncated: true }
	const fields = flatFields(content)
	return fields && fields.length > 0
		? { kind: 'fields', items: fields }
		: { kind: 'json', text, truncated: false }
}
