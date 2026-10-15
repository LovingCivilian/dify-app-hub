import { describe, expect, it } from 'vitest'

import { jsonRows, leafText } from '@/components/shared-chat/json-tree'

// The approved design of 2026-10-15 (json-tree brief, item 1): a tool card's JSON as antd Table tree data.
describe('jsonRows: leaves', () => {
	it('shows strings as they are and numbers as text', () => {
		expect(jsonRows({ city: 'Paris', days: 3, rate: 1.5 })).toEqual([
			{ key: '/city', name: 'city', value: 'Paris' },
			{ key: '/days', name: 'days', value: '3' },
			{ key: '/rate', name: 'rate', value: '1.5' },
		])
	})
	it('shows null as null and booleans as true and false', () => {
		expect(jsonRows({ note: null, urgent: true, sent: false })).toEqual([
			{ key: '/note', name: 'note', value: 'null' },
			{ key: '/urgent', name: 'urgent', value: 'true' },
			{ key: '/sent', name: 'sent', value: 'false' },
		])
	})
	it('joins an array of scalars by a comma, whatever their types', () => {
		expect(jsonRows({ to: ['ana@x.com', 'bo@x.com'], mixed: [1, 'a', null, true] })).toEqual([
			{ key: '/to', name: 'to', value: 'ana@x.com, bo@x.com' },
			{ key: '/mixed', name: 'mixed', value: '1, a, null, true' },
		])
	})
	it('shows an empty array as [] and an empty object as {}, with no rows below them', () => {
		expect(jsonRows({ tags: [], meta: {} })).toEqual([
			{ key: '/tags', name: 'tags', value: '[]' },
			{ key: '/meta', name: 'meta', value: '{}' },
		])
	})
	it('keeps markup and line breaks as text', () => {
		expect(jsonRows({ note: '<b>bold</b>\nnext' })).toEqual([
			{ key: '/note', name: 'note', value: '<b>bold</b>\nnext' },
		])
	})
})

describe('jsonRows: branches', () => {
	it('nests an object’s keys in their order under a {key, …} preview', () => {
		expect(jsonRows({ options: { urgent: true, channel: 'email', retry: { times: 2 } } })).toEqual([
			{
				key: '/options',
				name: 'options',
				value: '{urgent, channel, retry}',
				children: [
					{ key: '/options/urgent', name: 'urgent', value: 'true' },
					{ key: '/options/channel', name: 'channel', value: 'email' },
					{
						key: '/options/retry',
						name: 'retry',
						value: '{times}',
						children: [{ key: '/options/retry/times', name: 'times', value: '2' }],
					},
				],
			},
		])
	})
	it('nests an array of objects by index under an [n] preview', () => {
		expect(
			jsonRows({
				attachments: [
					{ name: 'plan.pdf', size: 1204 },
					{ name: 'map.png', size: 88 },
				],
			}),
		).toEqual([
			{
				key: '/attachments',
				name: 'attachments',
				value: '[2]',
				children: [
					{
						key: '/attachments/0',
						name: 0,
						value: '{name, size}',
						children: [
							{ key: '/attachments/0/name', name: 'name', value: 'plan.pdf' },
							{ key: '/attachments/0/size', name: 'size', value: '1204' },
						],
					},
					{
						key: '/attachments/1',
						name: 1,
						value: '{name, size}',
						children: [
							{ key: '/attachments/1/name', name: 'name', value: 'map.png' },
							{ key: '/attachments/1/size', name: 'size', value: '88' },
						],
					},
				],
			},
		])
	})
	it('nests an array with any item that is not a scalar, each item by index', () => {
		expect(jsonRows({ items: [7, [1, 2], {}, ['x', { y: null }]] })).toEqual([
			{
				key: '/items',
				name: 'items',
				value: '[4]',
				children: [
					{ key: '/items/0', name: 0, value: '7' },
					{ key: '/items/1', name: 1, value: '1, 2' },
					{ key: '/items/2', name: 2, value: '{}' },
					{
						key: '/items/3',
						name: 3,
						value: '[2]',
						children: [
							{ key: '/items/3/0', name: 0, value: 'x' },
							{
								key: '/items/3/1',
								name: 1,
								value: '{y}',
								children: [{ key: '/items/3/1/y', name: 'y', value: 'null' }],
							},
						],
					},
				],
			},
		])
	})
	it('cuts an object’s preview at 60 code points', () => {
		const keys = Array.from({ length: 12 }, (_, index) => `key_${index}`)
		const [row] = jsonRows({ wide: Object.fromEntries(keys.map(key => [key, 1])) })
		const whole = `{${keys.join(', ')}}`
		expect(Array.from(whole).length).toBeGreaterThan(60)
		expect(row?.value).toBe(`${Array.from(whole).slice(0, 60).join('')}…`)
		const emoji = jsonRows({ wide: { ['😀'.repeat(70)]: 1 } })[0]
		expect(emoji?.value).toBe(`{${'😀'.repeat(59)}…`)
		expect(Array.from(emoji?.value ?? '')).toHaveLength(61)
	})
})

describe('jsonRows: the top level and the row keys', () => {
	it('makes a top-level array’s items the rows, named by index, scalars included', () => {
		expect(jsonRows(['Paris', 'Rome'])).toEqual([
			{ key: '/0', name: 0, value: 'Paris' },
			{ key: '/1', name: 1, value: 'Rome' },
		])
		expect(jsonRows([{ city: 'Paris' }, null])).toEqual([
			{
				key: '/0',
				name: 0,
				value: '{city}',
				children: [{ key: '/0/city', name: 'city', value: 'Paris' }],
			},
			{ key: '/1', name: 1, value: 'null' },
		])
	})
	it('has no rows for an empty object or array', () => {
		expect(jsonRows({})).toEqual([])
		expect(jsonRows([])).toEqual([])
	})
	it('keys each row by its JSON Pointer (RFC 6901), never by its value', () => {
		// `~` is written `~0` and `/` is written `~1`, so a key with a slash cannot pass for a nested key.
		const rows = jsonRows({ 'a/b': 1, a: { b: 1 }, 'm~n': 1, '': 1 })
		expect(rows.map(row => row.key)).toEqual(['/a~1b', '/a', '/m~0n', '/'])
		expect(rows[1]?.children?.map(row => row.key)).toEqual(['/a/b'])
		// Equal values in different places keep different keys.
		expect(jsonRows([1, 1]).map(row => row.key)).toEqual(['/0', '/1'])
	})
})

// The one-level text the summary line shares with the rows (json-tree brief, item 4).
describe('leafText', () => {
	it.each([
		['a string', 'Paris', 'Paris'],
		['a number', 18, '18'],
		['null', null, 'null'],
		['a boolean', false, 'false'],
		['an array of scalars', ['a', 1, null], 'a, 1, null'],
		['an empty array', [], '[]'],
		['an empty object', {}, '{}'],
	])('reads %s as one row', (_label, value, text) => {
		expect(leafText(value)).toBe(text)
	})
	it.each([
		['an object with keys', { city: 'Paris' }],
		['an array with an object', [{ city: 'Paris' }]],
		['an array with an array', [[1]]],
	])('reads %s as a branch (null)', (_label, value) => {
		expect(leafText(value)).toBeNull()
	})
})
