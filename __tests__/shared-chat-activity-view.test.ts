import { describe, expect, it } from 'vitest'

import { ACTIVITY_JSON_MAX, activityView } from '@/components/shared-chat/activity-view'

// 2b's plan call P17: a flat object as antd Descriptions.
describe('activityView: fields', () => {
	it('shows a flat object’s entries in their order, each value as text', () => {
		expect(activityView({ query: 'tea', found: 3, done: false, error: null })).toEqual({
			kind: 'fields',
			items: [
				{ key: 'query', value: 'tea' },
				{ key: 'found', value: '3' },
				{ key: 'done', value: 'false' },
				{ key: 'error', value: 'null' },
			],
		})
	})
	// Spec §6.4 caps the content at 10 KB in every view: a flat object shows as fields only while its JSON fits.
	it('shows a flat object whose JSON fits the cap as fields, and one over it as cut JSON', () => {
		const atCap = { note: 'x'.repeat(ACTIVITY_JSON_MAX - 16) }
		expect(JSON.stringify(atCap, null, 2)).toHaveLength(ACTIVITY_JSON_MAX)
		expect(activityView(atCap)).toEqual({
			kind: 'fields',
			items: [{ key: 'note', value: atCap.note }],
		})
		const overCap = { note: `${atCap.note}x` }
		const view = activityView(overCap)
		expect(view).toEqual({
			kind: 'json',
			text: JSON.stringify(overCap, null, 2).slice(0, ACTIVITY_JSON_MAX),
			truncated: true,
		})
	})
	it('keeps markup in a value as text for the card to render as text', () => {
		expect(activityView({ note: '<b>bold</b>' })).toEqual({
			kind: 'fields',
			items: [{ key: 'note', value: '<b>bold</b>' }],
		})
	})
})

// P17: anything else as indented JSON in CodeHighlighter.
describe('activityView: JSON', () => {
	it('shows a nested object as JSON indented by two spaces', () => {
		expect(activityView({ query: 'tea', results: [{ title: 'Green' }] })).toEqual({
			kind: 'json',
			text: '{\n  "query": "tea",\n  "results": [\n    {\n      "title": "Green"\n    }\n  ]\n}',
			truncated: false,
		})
	})
	it.each([
		['an empty object', {}, '{}'],
		['an array of scalars', ['a', 1], '[\n  "a",\n  1\n]'],
		['a string', 'Searching', '"Searching"'],
		['a number', 3, '3'],
		['null', null, 'null'],
		['no content', undefined, 'null'],
	])('shows %s as JSON', (_label, content, text) => {
		expect(activityView(content)).toEqual({ kind: 'json', text, truncated: false })
	})
	it('keeps JSON of exactly the limit, and cuts one character more at the limit', () => {
		// A JSON string's text is its characters between two quotes.
		const fits = activityView('x'.repeat(ACTIVITY_JSON_MAX - 2))
		expect(fits).toEqual({
			kind: 'json',
			text: `"${'x'.repeat(ACTIVITY_JSON_MAX - 2)}"`,
			truncated: false,
		})
		const over = activityView('x'.repeat(ACTIVITY_JSON_MAX - 1))
		expect(over).toEqual({
			kind: 'json',
			text: `"${'x'.repeat(ACTIVITY_JSON_MAX - 1)}`,
			truncated: true,
		})
	})
	it('counts the limit in code points and never splits a surrogate pair', () => {
		const view = activityView({ items: ['😀'.repeat(ACTIVITY_JSON_MAX)] })
		expect(view.kind).toBe('json')
		if (view.kind !== 'json') return
		expect(view.truncated).toBe(true)
		expect(Array.from(view.text)).toHaveLength(ACTIVITY_JSON_MAX)
		expect(view.text.isWellFormed()).toBe(true)
		expect(view.text.length).toBeGreaterThan(ACTIVITY_JSON_MAX)
	})
	it('reads deeply nested content without throwing', () => {
		let content: unknown = 'leaf'
		for (let depth = 0; depth < 100; depth += 1) content = { child: content }
		expect(activityView(content).kind).toBe('json')
	})
})
