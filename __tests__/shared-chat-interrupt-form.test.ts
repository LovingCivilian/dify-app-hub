import type { Interrupt } from '@ag-ui/core'
import type { FormRule } from 'antd'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import { EMPTY_DRAFT, type AnswerDraft } from '@/components/shared-chat/answers'
import {
	fieldRules,
	initialValuesOf,
	interruptCardView,
	interruptTitleKey,
	payloadOf,
} from '@/components/shared-chat/interrupt-form'
import type { ResumeAnswer } from '@/components/shared-chat/provider/ag-ui-chat-provider'
import { checkFlatPayload, flatFields, type FlatField } from '@/lib/chat/interrupt-answers'
import en from '@/locales/en/translation.json'

const t = ((key: string, options?: { label?: string }) =>
	options?.label ? `t:${key}:${options.label}` : `t:${key}`) as unknown as TFunction

/** A dotted key's value in the English file, or undefined. */
const english = (key: string): unknown =>
	key
		.split('.')
		.reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en)

const FIELDS = flatFields({
	type: 'object',
	properties: {
		name: { type: 'string', title: 'Name', minLength: 2, maxLength: 40 },
		note: { type: 'string', default: 'none' },
		year: { type: 'integer', minimum: 2000 },
		ratio: { type: 'number', maximum: 1 },
		urgent: { type: 'boolean' },
		notify: { type: 'boolean', default: true },
		quarter: { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
	},
	required: ['name', 'year', 'quarter'],
})!
const field = (name: string): FlatField => FIELDS.find(item => item.name === name)!

describe('fieldRules (spec §6.3, plan call P7)', () => {
	it('requires a string with the form’s message, then checks its type and length', () => {
		expect(fieldRules(field('name'), t)).toEqual([
			{ required: true, whitespace: true, message: 't:form.field_required:Name' },
			{ type: 'string', min: 2, max: 40, transform: expect.any(Function) },
		])
	})

	it('reads a blank string as empty, so an optional blank passes and a required one is missing', () => {
		const [bounds] = fieldRules(field('note'), t) as { transform?: (value: unknown) => unknown }[]
		expect(bounds!.transform!('   ')).toBe('')
		expect(bounds!.transform!(' a ')).toBe(' a ')
		expect(bounds!.transform!(undefined)).toBeUndefined()
	})

	it('labels the message with the field’s name when it has no title', () => {
		expect(fieldRules(field('year'), t)[0]).toEqual({
			required: true,
			message: 't:form.field_required:year',
		})
	})

	it.each<[string, FormRule[]]>([
		[
			'year',
			[
				{ required: true, message: 't:form.field_required:year' },
				{ type: 'integer', min: 2000 },
			],
		],
		['ratio', [{ type: 'number', max: 1 }]],
		['urgent', [{ type: 'boolean' }]],
		[
			'quarter',
			[
				{ required: true, message: 't:form.field_required:quarter' },
				{ type: 'enum', enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
			],
		],
	])('gives %s its type and bounds', (name, rules) => {
		expect(fieldRules(field(name), t)).toEqual(rules)
	})
})

describe('initialValuesOf', () => {
	it('starts each field at its default, and a boolean without one at false', () => {
		expect(initialValuesOf(FIELDS)).toEqual({ note: 'none', urgent: false, notify: true })
	})
})

describe('payloadOf (plan call P7)', () => {
	it('drops undefined, null and blank optional strings, keeps false and 0, and only declared fields', () => {
		const payload = payloadOf(FIELDS, {
			name: 'Ada',
			note: '   ',
			year: 2026,
			ratio: null,
			urgent: false,
			notify: true,
			quarter: 'Q1',
			extra: 'ignored',
		})
		expect(payload).toEqual({ name: 'Ada', year: 2026, urgent: false, notify: true, quarter: 'Q1' })
		expect(checkFlatPayload(FIELDS, payload)).toBe(true)
		expect(payloadOf(FIELDS, { name: 'Ada', year: 0, quarter: 'Q2', note: '' })).toEqual({
			name: 'Ada',
			year: 0,
			quarter: 'Q2',
		})
	})
})

describe('interruptTitleKey', () => {
	it.each(['input_required', 'confirmation', 'tool_call'])('titles %s with a key', reason => {
		const key = interruptTitleKey(reason)
		expect(key).toBe(`shared_chat.interrupt.title_${reason}`)
		expect(english(key!)).toEqual(expect.any(String))
	})

	it.each(['mastra:tool_suspend', 'langgraph:interrupt', 'constructor', ''])(
		'shows %j as sent',
		reason => {
			expect(interruptTitleKey(reason)).toBeNull()
		},
	)
})

describe('interruptCardView (plan calls P13, P14)', () => {
	const NOW = new Date('2026-10-14T12:00:00Z')
	const PAST = '2026-10-14T11:00:00Z'
	const approval: Interrupt = {
		id: 'int-1',
		reason: 'tool_call',
		toolCallId: 'call-1',
		responseSchema: {
			type: 'object',
			properties: { accepted: { type: 'boolean' }, arguments: { type: 'object' } },
			required: ['accepted'],
		},
	}
	const confirmation: Interrupt = { id: 'int-2', reason: 'confirmation' }
	const form: Interrupt = {
		id: 'int-3',
		reason: 'input_required',
		responseSchema: { type: 'object', properties: { note: { type: 'string' } } },
	}
	const drafted = (...answers: ResumeAnswer[]): AnswerDraft => ({
		...EMPTY_DRAFT,
		resume: Object.fromEntries(answers.map(answer => [answer.interruptId, answer])),
	})

	it('offers the answer its kind allows while nothing is recorded', () => {
		expect(interruptCardView(approval, EMPTY_DRAFT, NOW)).toEqual({ kind: 'approval' })
		expect(interruptCardView(confirmation, EMPTY_DRAFT, NOW)).toEqual({ kind: 'confirm' })
		expect(interruptCardView(form, EMPTY_DRAFT, NOW)).toEqual({
			kind: 'form',
			fields: [{ name: 'note', required: false, type: 'string' }],
		})
	})

	it.each<[string, Interrupt, ResumeAnswer, string]>([
		[
			'an approval',
			approval,
			{ interruptId: 'int-1', status: 'resolved', payload: { accepted: true } },
			'shared_chat.answer.approved',
		],
		[
			'a rejection',
			approval,
			{ interruptId: 'int-1', status: 'resolved', payload: { accepted: false } },
			'shared_chat.answer.rejected',
		],
		[
			'a Yes',
			confirmation,
			{ interruptId: 'int-2', status: 'resolved', payload: true },
			'shared_chat.interrupt.yes',
		],
		[
			'a No',
			confirmation,
			{ interruptId: 'int-2', status: 'resolved', payload: false },
			'shared_chat.interrupt.no',
		],
		[
			// As the sent form's receipt reads (ADR-0035).
			'a form’s answer',
			form,
			{ interruptId: 'int-3', status: 'resolved', payload: { note: 'x' } },
			'shared_chat.answer.submitted',
		],
		[
			'a cancel',
			form,
			{ interruptId: 'int-3', status: 'cancelled' },
			'shared_chat.answer.cancelled',
		],
	])('shows %s recorded in the draft as its decision', (_name, interrupt, recorded, tagKey) => {
		expect(interruptCardView(interrupt, drafted(recorded), NOW)).toEqual({
			kind: 'decided',
			tagKey,
		})
		expect(english(tagKey)).toEqual(expect.any(String))
	})

	it('offers only Dismiss once expired, also over a resolved decision it can no longer take', () => {
		const expired = { ...confirmation, expiresAt: PAST }
		expect(interruptCardView(expired, EMPTY_DRAFT, NOW)).toEqual({ kind: 'expired' })
		expect(
			interruptCardView(
				expired,
				drafted({ interruptId: 'int-2', status: 'resolved', payload: true }),
				NOW,
			),
		).toEqual({ kind: 'expired' })
		expect(
			interruptCardView(expired, drafted({ interruptId: 'int-2', status: 'cancelled' }), NOW),
		).toEqual({ kind: 'decided', tagKey: 'shared_chat.answer.cancelled' })
	})

	it('reads the draft by own key only', () => {
		expect(interruptCardView({ ...confirmation, id: 'constructor' }, EMPTY_DRAFT, NOW)).toEqual({
			kind: 'confirm',
		})
	})
})
