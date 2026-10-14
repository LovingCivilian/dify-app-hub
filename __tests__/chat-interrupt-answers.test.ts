import { isInterruptExpired } from '@ag-ui/client'
import type { Interrupt } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import {
	answerKindOf,
	approvalKey,
	approvalPayload,
	checkFlatPayload,
	flatFields,
	isApproval,
	isExpired,
	payloadAccepted,
	REJECTED_REASON,
	type FlatField,
} from '@/lib/chat/interrupt-answers'

// Each framework's approval schema as it sends it (research part2-hitl-state-files.md §1.3, §2).
const PYDANTIC_AI = {
	type: 'object',
	properties: {
		approved: { type: 'boolean' },
		editedArgs: { type: 'object' },
		reason: { type: 'string' },
	},
	required: ['approved'],
}
const MS_AGENT_FRAMEWORK = {
	type: 'object',
	properties: { accepted: { type: 'boolean' }, arguments: { type: 'object' } },
	required: ['accepted'],
}
const AWS_STRANDS = {
	type: 'object',
	properties: { approved: { type: 'boolean' } },
	required: ['approved'],
}

// AG-UI concepts › Interrupts, Examples, "Non-tool input request".
const QUARTERLY_FILING: Interrupt = {
	id: 'int-form',
	reason: 'input_required',
	message: 'Please provide the quarterly filing details.',
	responseSchema: {
		type: 'object',
		properties: {
			quarter: { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
			year: { type: 'integer', minimum: 2000 },
			revenue: { type: 'number' },
		},
		required: ['quarter', 'year', 'revenue'],
	},
	expiresAt: '2026-04-20T17:00:00Z',
}

const objectSchema = (
	properties: Record<string, unknown>,
	extra: Record<string, unknown> = {},
) => ({
	type: 'object',
	properties,
	...extra,
})

const approval = (responseSchema?: Record<string, unknown>): Interrupt => ({
	id: 'int-1',
	reason: 'tool_call',
	toolCallId: 'call-1',
	responseSchema,
})

describe('approvals (spec §6.1, plan call P5)', () => {
	it('knows an approval by its tool_call reason and toolCallId', () => {
		expect(isApproval({ reason: 'tool_call', toolCallId: 'call-1' })).toBe(true)
		expect(isApproval({ reason: 'tool_call' })).toBe(false)
		expect(isApproval({ reason: 'tool_call', toolCallId: '' })).toBe(false)
		// Google ADK confirms a tool call with reason `confirmation`: a confirm, not an approval (research §1.3).
		expect(isApproval({ reason: 'confirmation', toolCallId: 'call-1' })).toBe(false)
	})

	it.each([
		[
			'Pydantic AI',
			PYDANTIC_AI,
			'approved',
			{ approved: true },
			{ approved: false, reason: REJECTED_REASON },
		],
		[
			'Microsoft Agent Framework',
			MS_AGENT_FRAMEWORK,
			'accepted',
			{ accepted: true },
			{ accepted: false },
		],
		['AWS Strands', AWS_STRANDS, 'approved', { approved: true }, { approved: false }],
		['no schema (Mastra, ADK)', undefined, 'approved', { approved: true }, { approved: false }],
	])('answers %s in its own terms', (_name, schema, key, approve, reject) => {
		expect(approvalKey(schema)).toBe(key)
		expect(approvalPayload(schema, true)).toEqual(approve)
		expect(approvalPayload(schema, false)).toEqual(reject)
	})

	it('takes the first required boolean, else the first boolean, else `approved`', () => {
		expect(
			approvalKey(
				objectSchema(
					{ notify: { type: 'boolean' }, confirmed: { type: 'boolean' } },
					{ required: ['confirmed'] },
				),
			),
		).toBe('confirmed')
		expect(approvalKey(objectSchema({ note: { type: 'string' }, ok: { type: 'boolean' } }))).toBe(
			'ok',
		)
		expect(approvalKey(objectSchema({ note: { type: 'string' } }))).toBe('approved')
		expect(approvalKey('yes')).toBe('approved')
	})

	it('adds the reason only when the schema declares a string `reason`', () => {
		expect(
			approvalPayload(
				objectSchema({ approved: { type: 'boolean' }, reason: { type: 'integer' } }),
				false,
			),
		).toEqual({ approved: false })
		expect(approvalPayload(PYDANTIC_AI, true)).toEqual({ approved: true })
	})
})

describe('flatFields (plan call P7)', () => {
	it('reads the AG-UI quarterly-filing example as a form', () => {
		expect(flatFields(QUARTERLY_FILING.responseSchema)).toEqual([
			{ name: 'quarter', required: true, type: 'enum', options: ['Q1', 'Q2', 'Q3', 'Q4'] },
			{ name: 'year', required: true, type: 'integer', minimum: 2000 },
			{ name: 'revenue', required: true, type: 'number' },
		])
	})

	it('reads every keyword of the subset, in the order of `properties`', () => {
		const schema = objectSchema(
			{
				name: {
					type: 'string',
					title: 'Name',
					description: 'As on the invoice',
					default: 'Ada',
					minLength: 1,
					maxLength: 40,
				},
				count: { type: 'integer', default: 2, minimum: 1, maximum: 10 },
				ratio: { type: 'number', default: 0.5, maximum: 1 },
				urgent: { type: 'boolean', default: false },
				size: { enum: [1, 2, 3], default: 2 },
			},
			{
				$schema: 'https://json-schema.org/draft/2020-12/schema',
				title: 'Details',
				description: 'What the agent needs',
				required: ['name'],
				additionalProperties: false,
			},
		)
		expect(flatFields(schema)).toEqual<FlatField[]>([
			{
				name: 'name',
				required: true,
				type: 'string',
				title: 'Name',
				description: 'As on the invoice',
				default: 'Ada',
				minLength: 1,
				maxLength: 40,
			},
			{ name: 'count', required: false, type: 'integer', default: 2, minimum: 1, maximum: 10 },
			{ name: 'ratio', required: false, type: 'number', default: 0.5, maximum: 1 },
			{ name: 'urgent', required: false, type: 'boolean', default: false },
			{ name: 'size', required: false, type: 'enum', options: [1, 2, 3], default: 2 },
		])
	})

	it('reads an empty object schema as a form without fields', () => {
		expect(flatFields(objectSchema({}))).toEqual([])
	})

	it.each<[string, unknown]>([
		['a nested object', objectSchema({ address: { type: 'object' } })],
		['an array', objectSchema({ tags: { type: 'array', items: { type: 'string' } } })],
		['a type array', objectSchema({ name: { type: ['string', 'null'] } })],
		['a property without a type', objectSchema({ name: { title: 'Name' } })],
		['pattern', objectSchema({ code: { type: 'string', pattern: '^[A-Z]+$' } })],
		['format', objectSchema({ email: { type: 'string', format: 'email' } })],
		['const', objectSchema({ kind: { type: 'string', const: 'a' } })],
		['oneOf', objectSchema({ value: { oneOf: [{ type: 'string' }, { type: 'number' }] } })],
		['a bound of another type', objectSchema({ name: { type: 'string', minimum: 1 } })],
		['a negative length', objectSchema({ name: { type: 'string', maxLength: -1 } })],
		['a fractional length', objectSchema({ name: { type: 'string', minLength: 1.5 } })],
		['a bound that is no number', objectSchema({ year: { type: 'integer', minimum: '2000' } })],
		[
			'a required name that is no property',
			objectSchema({ name: { type: 'string' } }, { required: ['missing'] }),
		],
		[
			'a required list that is no array',
			objectSchema({ name: { type: 'string' } }, { required: 'name' }),
		],
		[
			'a string default on an integer',
			objectSchema({ year: { type: 'integer', default: '2026' } }),
		],
		[
			'a fractional default on an integer',
			objectSchema({ year: { type: 'integer', default: 2026.5 } }),
		],
		['a null default', objectSchema({ name: { type: 'string', default: null } })],
		['a default the enum lacks', objectSchema({ pick: { enum: ['a', 'b'], default: 'c' } })],
		['an enum with an object', objectSchema({ pick: { enum: ['a', { b: 1 }] } })],
		['an enum with null', objectSchema({ pick: { enum: ['a', null] } })],
		['an empty enum', objectSchema({ pick: { enum: [] } })],
		['an enum with a value twice', objectSchema({ pick: { enum: ['a', 'a'] } })],
		['an enum of another type', objectSchema({ pick: { type: 'string', enum: [1, 2] } })],
		['an enum with bounds', objectSchema({ pick: { enum: ['a'], minLength: 1 } })],
		['a non-string title', objectSchema({ name: { type: 'string', title: 7 } })],
		['a boolean property schema', objectSchema({ name: true })],
		['additionalProperties true', objectSchema({}, { additionalProperties: true })],
		[
			'additionalProperties as a schema',
			objectSchema({}, { additionalProperties: { type: 'string' } }),
		],
		['another top-level keyword', objectSchema({}, { $defs: {} })],
		['no properties', { type: 'object' }],
		['a non-object type', { type: 'string' }],
		['no schema object', 'yes'],
		['null', null],
	])('puts a schema with %s outside the subset', (_name, schema) => {
		expect(flatFields(schema)).toBeNull()
	})
})

describe('checkFlatPayload (plan call P7)', () => {
	const fields = flatFields(
		objectSchema(
			{
				code: { type: 'string', minLength: 2, maxLength: 3 },
				count: { type: 'integer', minimum: 1, maximum: 10 },
				ratio: { type: 'number' },
				urgent: { type: 'boolean' },
				size: { enum: ['S', 'M', 1] },
			},
			{ required: ['code', 'count'] },
		),
	)!

	it('accepts declared keys of their type within bounds, inclusive at both ends', () => {
		expect(checkFlatPayload(fields, { code: 'ab', count: 1 })).toBe(true)
		expect(
			checkFlatPayload(fields, { code: 'abc', count: 10, ratio: -0.5, urgent: false, size: 1 }),
		).toBe(true)
	})

	it('counts a string’s length in code points (JSON Schema Validation §6.3.1)', () => {
		expect('🔥🔥🔥'.length).toBe(6)
		expect(checkFlatPayload(fields, { code: '🔥🔥🔥', count: 2 })).toBe(true)
		expect(checkFlatPayload(fields, { code: '🔥', count: 2 })).toBe(false)
	})

	it.each<[string, unknown]>([
		['an unknown key', { code: 'ab', count: 1, extra: true }],
		['a null value', { code: 'ab', count: 1, ratio: null }],
		['a wrong type', { code: 'ab', count: '1' }],
		['a fraction for an integer', { code: 'ab', count: 1.5 }],
		['a string too short', { code: 'a', count: 1 }],
		['a string too long', { code: 'abcd', count: 1 }],
		['a number under the minimum', { code: 'ab', count: 0 }],
		['a number over the maximum', { code: 'ab', count: 11 }],
		['a value the enum lacks', { code: 'ab', count: 1, size: 'L' }],
		['a missing required key', { code: 'ab' }],
		['an array', [{ code: 'ab', count: 1 }]],
		['null', null],
		['a boolean', true],
	])('refuses %s', (_name, payload) => {
		expect(checkFlatPayload(fields, payload)).toBe(false)
	})
})

describe('answerKindOf (spec §6.1, §6.3; plan calls P6, P8)', () => {
	const flat = objectSchema({ confirmed: { type: 'boolean' } }, { required: ['confirmed'] })

	it('answers an approval with Approve and Reject, whatever its schema', () => {
		expect(answerKindOf(approval(PYDANTIC_AI))).toEqual({ kind: 'approval' })
		expect(answerKindOf(approval())).toEqual({ kind: 'approval' })
	})

	it('answers a confirmation without a schema with a bare boolean, and with a flat one by its form', () => {
		expect(answerKindOf({ id: 'c', reason: 'confirmation', message: 'Proceed?' })).toEqual({
			kind: 'confirm',
		})
		expect(answerKindOf({ id: 'c', reason: 'confirmation', responseSchema: flat })).toEqual({
			kind: 'form',
			fields: [{ name: 'confirmed', required: true, type: 'boolean' }],
		})
	})

	it('answers a flat input_required with its form', () => {
		expect(answerKindOf(QUARTERLY_FILING)).toEqual({
			kind: 'form',
			fields: flatFields(QUARTERLY_FILING.responseSchema),
		})
	})

	it('offers only Cancel for a schema outside the subset', () => {
		const nested = objectSchema({ address: { type: 'object' } })
		expect(answerKindOf({ id: 'i', reason: 'input_required', responseSchema: nested })).toEqual({
			kind: 'cancel',
		})
		expect(answerKindOf({ id: 'c', reason: 'confirmation', responseSchema: nested })).toEqual({
			kind: 'cancel',
		})
	})

	it('offers only Cancel without a schema on anything but a confirmation', () => {
		expect(answerKindOf({ id: 'i', reason: 'input_required' })).toEqual({ kind: 'cancel' })
		// Mastra names its approvals `mastra:tool_approval` and sends no schema (research §1.3).
		expect(answerKindOf({ id: 'm', reason: 'mastra:tool_approval' })).toEqual({ kind: 'cancel' })
	})

	it('reads a tool_call without a toolCallId as any other interrupt', () => {
		expect(answerKindOf({ id: 't', reason: 'tool_call' })).toEqual({ kind: 'cancel' })
		expect(answerKindOf({ id: 't', reason: 'tool_call', responseSchema: flat })).toEqual({
			kind: 'form',
			fields: [{ name: 'confirmed', required: true, type: 'boolean' }],
		})
	})
})

describe('isExpired (plan call P14)', () => {
	const NOW = new Date('2026-10-14T12:00:00Z')

	it.each<[string, string | undefined, boolean]>([
		['in the past', '2026-10-14T11:59:59Z', true],
		['exactly now', '2026-10-14T12:00:00Z', true],
		['in the future', '2026-10-14T12:00:01Z', false],
		['unparseable', 'soon', false],
		['absent', undefined, false],
	])('reads an expiresAt %s as @ag-ui/client 1.0.2 does', (_name, expiresAt, expected) => {
		const interrupt: Interrupt = { id: 'x', reason: 'confirmation', expiresAt }
		expect(isExpired(interrupt, NOW)).toBe(expected)
		expect(isInterruptExpired(interrupt, NOW)).toBe(expected)
	})
})

describe('payloadAccepted (the server’s check of a resolved entry)', () => {
	it('accepts exactly the two approval payloads', () => {
		const pydantic = approval(PYDANTIC_AI)
		expect(payloadAccepted(pydantic, { approved: true })).toBe(true)
		expect(payloadAccepted(pydantic, { approved: false, reason: REJECTED_REASON })).toBe(true)
		expect(payloadAccepted(pydantic, { approved: false })).toBe(false)
		expect(payloadAccepted(pydantic, { approved: true, editedArgs: { to: 'a@b.com' } })).toBe(false)
		expect(payloadAccepted(pydantic, { approved: false, reason: 'Other words' })).toBe(false)
		expect(payloadAccepted(pydantic, true)).toBe(false)
		expect(payloadAccepted(pydantic, undefined)).toBe(false)
		const microsoft = approval(MS_AGENT_FRAMEWORK)
		expect(payloadAccepted(microsoft, { accepted: false })).toBe(true)
		expect(payloadAccepted(microsoft, { approved: true })).toBe(false)
	})

	it('accepts a bare boolean for a confirmation without a schema', () => {
		const confirmation: Interrupt = { id: 'c', reason: 'confirmation' }
		expect(payloadAccepted(confirmation, true)).toBe(true)
		expect(payloadAccepted(confirmation, false)).toBe(true)
		expect(payloadAccepted(confirmation, { confirmed: true })).toBe(false)
		expect(payloadAccepted(confirmation, undefined)).toBe(false)
	})

	it('accepts a form’s payload that passes its schema', () => {
		expect(payloadAccepted(QUARTERLY_FILING, { quarter: 'Q1', year: 2026, revenue: 4200000 })).toBe(
			true,
		)
		expect(payloadAccepted(QUARTERLY_FILING, { quarter: 'Q5', year: 2026, revenue: 1 })).toBe(false)
		expect(payloadAccepted(QUARTERLY_FILING, { quarter: 'Q1', year: 1999, revenue: 1 })).toBe(false)
	})

	it('accepts no payload for an interrupt that can only be cancelled', () => {
		const cancelOnly: Interrupt = { id: 'i', reason: 'input_required' }
		expect(payloadAccepted(cancelOnly, undefined)).toBe(false)
		expect(payloadAccepted(cancelOnly, {})).toBe(false)
		expect(payloadAccepted(cancelOnly, true)).toBe(false)
	})
})
