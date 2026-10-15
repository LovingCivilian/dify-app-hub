import type { Interrupt } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { answeredReceipt, fieldLabel, RECEIPT_MARKS } from '@/components/shared-chat/answer-receipt'
import { approvalPayload } from '@/lib/chat/interrupt-answers'
import en from '@/locales/en/translation.json'

/** A dotted key's value in the English file, or undefined. */
const english = (key: string): unknown =>
	key
		.split('.')
		.reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en)

const SCHEMA = {
	type: 'object',
	properties: { accepted: { type: 'boolean' }, reason: { type: 'string' } },
	required: ['accepted'],
}
/** An approval for a call the turn does not hold (plan call P8): its own card, with the schema's key. */
const unbound: Interrupt = {
	id: 'int-1',
	reason: 'tool_call',
	toolCallId: 'call-x',
	responseSchema: SCHEMA,
}
const confirm: Interrupt = { id: 'int-2', reason: 'confirmation', message: 'Proceed?' }
const form: Interrupt = {
	id: 'int-3',
	reason: 'input_required',
	message: 'Which region?',
	responseSchema: {
		type: 'object',
		properties: { region: { type: 'string' }, seats: { type: 'integer' } },
		required: ['region'],
	},
}
/** A reason the hub does not know, without a schema: it could only be cancelled (plan call P8). */
const other: Interrupt = { id: 'int-4', reason: 'policy_hold', message: 'On hold.' }

describe('answeredReceipt (what an answered interrupt’s card shows)', () => {
	it('shows Cancelled for a cancelled answer, whatever the interrupt', () => {
		for (const interrupt of [unbound, confirm, form, other])
			expect(answeredReceipt({ interrupt, status: 'cancelled' })).toEqual({
				mark: 'cancelled',
				values: { kind: 'empty' },
			})
	})

	it('reads an approval by its own schema’s key: Approved or Rejected', () => {
		const resolved = (approved: boolean) =>
			answeredReceipt({
				interrupt: unbound,
				status: 'resolved',
				payload: approvalPayload(SCHEMA, approved),
			}).mark
		expect(resolved(true)).toBe('approved')
		expect(resolved(false)).toBe('rejected')
	})

	it('shows Yes or No for a confirmation', () => {
		expect(answeredReceipt({ interrupt: confirm, status: 'resolved', payload: true }).mark).toBe(
			'yes',
		)
		expect(answeredReceipt({ interrupt: confirm, status: 'resolved', payload: false }).mark).toBe(
			'no',
		)
	})

	it('shows a form’s submitted values as indented JSON, and none for an empty answer', () => {
		expect(
			answeredReceipt({ interrupt: form, status: 'resolved', payload: { region: 'EU', seats: 2 } }),
		).toEqual({
			mark: 'submitted',
			values: { kind: 'code', code: '{\n  "region": "EU",\n  "seats": 2\n}', lang: 'json' },
		})
		expect(answeredReceipt({ interrupt: form, status: 'resolved', payload: {} })).toEqual({
			mark: 'submitted',
			values: { kind: 'empty' },
		})
	})

	it('shows any other resolved answer as Answered, an object payload with its values', () => {
		expect(answeredReceipt({ interrupt: other, status: 'resolved' })).toEqual({
			mark: 'answered',
			values: { kind: 'empty' },
		})
		expect(
			answeredReceipt({ interrupt: other, status: 'resolved', payload: { ok: true } }),
		).toEqual({
			mark: 'answered',
			values: { kind: 'code', code: '{\n  "ok": true\n}', lang: 'json' },
		})
	})

	it('words every mark through an existing English key, in the status colours', () => {
		for (const { key } of Object.values(RECEIPT_MARKS))
			expect(english(key)).toEqual(expect.any(String))
		expect(
			Object.fromEntries(Object.entries(RECEIPT_MARKS).map(([mark, { tone }]) => [mark, tone])),
		).toEqual({
			approved: 'success',
			rejected: 'danger',
			cancelled: 'secondary',
			yes: 'success',
			no: 'danger',
			submitted: 'success',
			answered: 'success',
		})
	})
})

describe('fieldLabel (a sent form’s values, labelled as the form labelled them)', () => {
	const titled: Interrupt = {
		...form,
		responseSchema: {
			type: 'object',
			properties: { region: { type: 'string', title: 'Region' }, seats: { type: 'integer' } },
		},
	}
	it('reads each value’s field title from the interrupt’s schema, else its name', () => {
		expect(fieldLabel(titled, 'region')).toBe('Region')
		expect(fieldLabel(titled, 'seats')).toBe('seats')
	})
	it('labels a key the schema does not name, or a schema that is no flat form, by the key itself', () => {
		expect(fieldLabel(titled, 'extra')).toBe('extra')
		// An agent string: an object's own property name such as `constructor` is no field.
		expect(fieldLabel(titled, 'constructor')).toBe('constructor')
		expect(fieldLabel(confirm, 'region')).toBe('region')
		expect(fieldLabel(other, 'region')).toBe('region')
	})
})
