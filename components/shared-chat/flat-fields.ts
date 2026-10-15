/*
 * The flat-object rule 2b's plan call P17 wrote for the activity card (activity-view.ts); the tool cards show their
 * JSON as code blocks instead (tool-view-data.ts `toolDetail`). Pure and client-safe; the card puts the fields into
 * text nodes, never HTML (spec §6.4).
 */

/** One entry of a flat object, its value as text. */
export interface Field {
	key: string
	value: string
}

type Scalar = string | number | boolean | null

const isScalarEntry = (entry: [string, unknown]): entry is [string, Scalar] =>
	entry[1] === null || ['string', 'number', 'boolean'].includes(typeof entry[1])

/**
 * P17: a flat object's entries in their order, each value as `String(value)`: an object, not an array, whose every
 * value is a string, number, boolean or null. An empty object has none (`[]`); anything else is not a flat object
 * (null).
 */
export const flatFields = (value: unknown): Field[] | null => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
	const entries = Object.entries(value)
	return entries.every(isScalarEntry)
		? entries.map(([key, scalar]) => ({ key, value: String(scalar) }))
		: null
}
