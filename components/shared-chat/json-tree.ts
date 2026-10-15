import { inputHint } from './turn-parts'

/*
 * A tool card's JSON as rows of an antd Table with tree data (the approved design of 2026-10-15, json-tree brief item 1;
 * antd 6.6.5 Table "Tree data": "Display tree structure data in Table when there is field key `children` in
 * dataSource"). Pure and client-safe: the card puts every name and value into text nodes, never HTML.
 */

/** One row of the tree table. antd reads `key` as the row key (`rowKey` defaults to `key`) and `children` as its rows. */
export interface JsonRow {
	/** The value's JSON Pointer (RFC 6901): unique in its document and stable across renders, never the value. */
	key: string
	/** The object key, or the array index. */
	name: string | number
	/** A leaf's value as text, or a branch's collapsed preview (`{key1, key2}`, `[n]`). */
	value: string
	/** A branch's rows: one per key, in key order, or one per item. Leaves have none. */
	children?: JsonRow[]
}

/** A value that sits in one row, as text, or null for a value whose rows nest (a branch). */
export const leafText = (value: unknown): string | null => {
	// JSON's scalars: a string as it is, a number, true, false and null as JSON writes them.
	if (typeof value !== 'object' || value === null) return String(value)
	if (Array.isArray(value)) {
		if (value.length === 0) return '[]'
		return value.every(item => typeof item !== 'object' || item === null)
			? value.map(String).join(', ')
			: null
	}
	return Object.keys(value).length === 0 ? '{}' : null
}

/**
 * RFC 6901 §3: a reference token writes `~` as `~0` and `/` as `~1`, so a key holding a slash never reads as a deeper
 * path, and §4's array index is the item's decimal index.
 */
const pointer = (parent: string, name: string | number): string =>
	`${parent}/${String(name).replaceAll('~', '~0').replaceAll('/', '~1')}`

/** A branch's collapsed preview: an array's length, or an object's keys cut like the input hint (60 code points). */
const preview = (value: object): string =>
	Array.isArray(value) ? `[${value.length}]` : inputHint(`{${Object.keys(value).join(', ')}}`)

const entriesOf = (value: object): [string | number, unknown][] =>
	Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value)

const rowsOf = (value: object, parent: string): JsonRow[] =>
	entriesOf(value).map(([name, item]) => {
		const key = pointer(parent, name)
		const text = leafText(item)
		// leafText answers text for every value that is not an object, so a branch is a non-empty object or array.
		return text === null
			? { key, name, value: preview(item as object), children: rowsOf(item as object, key) }
			: { key, name, value: text }
	})

/** The table's rows: a top-level object's keys, or a top-level array's items named by index (none when it is empty). */
export const jsonRows = (value: object): JsonRow[] => rowsOf(value, '')
