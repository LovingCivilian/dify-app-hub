import type { Interrupt } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { EMPTY_DRAFT, type AnswerDraft } from '@/components/shared-chat/answers'
import { flatFields } from '@/components/shared-chat/flat-fields'
import {
	approvalView,
	askUserView,
	toolDetail,
	toolFooter,
	toolSummary,
} from '@/components/shared-chat/tool-view-data'
import { inputHint } from '@/components/shared-chat/turn-parts'
import { approvalPayload } from '@/lib/chat/interrupt-answers'
import type { TurnOpenItems } from '@/lib/chat/open-items'
import type { ToolPart } from '@/lib/chat/turn'

const ARGS = JSON.stringify({
	questions: [{ question: 'Which city?', options: ['Paris', 'Rome'] }, { question: 'When?' }],
})

const call = (patch: Partial<ToolPart> = {}): ToolPart => ({
	kind: 'tool',
	toolCallId: 'c1',
	name: 'ask_user',
	args: ARGS,
	status: 'waiting',
	...patch,
})

describe('askUserView (spec §6.2, plan call P3)', () => {
	it('lists the questions while the call waits, and after its run was stopped', () => {
		for (const status of ['waiting', 'stopped'] as const)
			expect(askUserView(call({ status }))).toEqual({
				kind: 'questions',
				questions: ['Which city?', 'When?'],
			})
	})
	it('shows the transcript once answered, as it was sent', () => {
		const result = 'Q: Which city?\nA: Paris\n\nQ: When?\nA: (skipped)'
		expect(askUserView(call({ status: 'done', result }))).toEqual({
			kind: 'transcript',
			text: result,
		})
	})
	it('keeps a result over arguments of another shape (an agent tool of the same name)', () => {
		expect(askUserView(call({ status: 'done', args: '{"prompt":"x"}', result: 'ok' }))).toEqual({
			kind: 'transcript',
			text: 'ok',
		})
	})
	it('reads arguments that fail the schema as an invalid question, answered or not', () => {
		const invalid = JSON.stringify({ questions: [] })
		for (const status of ['waiting', 'stopped', 'error'] as const)
			expect(askUserView(call({ status, args: invalid, error: 'invalid_arguments' }))).toEqual({
				kind: 'invalid',
			})
		expect(askUserView(call({ args: '{"questions": [{"question": "Wh' }))).toEqual({
			kind: 'invalid',
		})
	})
	it('waits for arguments that are still streaming', () => {
		expect(askUserView(call({ status: 'running', args: '{"questions": [{"quest' }))).toEqual({
			kind: 'pending',
		})
	})
	it('shows an error answer with its text', () => {
		expect(
			askUserView(call({ status: 'error', error: 'This tool is not available here.' })),
		).toEqual({ kind: 'error', text: 'This tool is not available here.' })
	})
})

describe('approvalView (spec §6.1, plan calls P5, P13, P14)', () => {
	// Microsoft Agent Framework's field (spec §6.1): the schema decides the payload, not a fixed `approved`.
	const SCHEMA = {
		type: 'object',
		properties: { accepted: { type: 'boolean' }, reason: { type: 'string' } },
		required: ['accepted'],
	}
	const NOW = new Date('2026-10-14T12:00:00Z')
	const approval = (patch: Partial<Interrupt> = {}): Interrupt => ({
		id: 'i1',
		reason: 'tool_call',
		toolCallId: 'c1',
		message: 'Send the email?',
		responseSchema: SCHEMA,
		...patch,
	})
	const decided = (entry: Omit<AnswerDraft['resume'][string], 'interruptId'>): AnswerDraft => ({
		...EMPTY_DRAFT,
		resume: { i1: { interruptId: 'i1', ...entry } },
	})

	it('is open until it has a decision or expires', () => {
		expect(approvalView(approval(), { draft: EMPTY_DRAFT, now: NOW })).toEqual({ kind: 'open' })
		expect(
			approvalView(approval({ expiresAt: '2026-10-14T12:00:01Z' }), {
				draft: EMPTY_DRAFT,
				now: NOW,
			}),
		).toEqual({ kind: 'open' })
	})
	it('is expired from its expiresAt on (`new Date(expiresAt) <= now`)', () => {
		for (const expiresAt of ['2026-10-14T12:00:00Z', '2026-10-14T11:00:00Z'])
			expect(approvalView(approval({ expiresAt }), { draft: EMPTY_DRAFT, now: NOW })).toEqual({
				kind: 'expired',
			})
	})
	it("reads Approve and Reject from the schema's own property", () => {
		const approved = decided({ status: 'resolved', payload: approvalPayload(SCHEMA, true) })
		const rejected = decided({ status: 'resolved', payload: approvalPayload(SCHEMA, false) })
		expect(approvalView(approval(), { draft: approved, now: NOW })).toEqual({
			kind: 'decided',
			decision: 'approved',
		})
		expect(approvalView(approval(), { draft: rejected, now: NOW })).toEqual({
			kind: 'decided',
			decision: 'rejected',
		})
	})
	it('reads a schema-less approval by the recommended `approved`', () => {
		const draft = decided({ status: 'resolved', payload: approvalPayload(undefined, true) })
		expect(approvalView(approval({ responseSchema: undefined }), { draft, now: NOW })).toEqual({
			kind: 'decided',
			decision: 'approved',
		})
	})
	it('shows a Dismiss as cancelled, even once expired', () => {
		const draft = decided({ status: 'cancelled' })
		expect(
			approvalView(approval({ expiresAt: '2026-10-14T11:00:00Z' }), { draft, now: NOW }),
		).toEqual({ kind: 'decided', decision: 'cancelled' })
	})
	it('offers Dismiss again for an Approve or Reject recorded before it expired', () => {
		const draft = decided({ status: 'resolved', payload: approvalPayload(SCHEMA, true) })
		expect(
			approvalView(approval({ expiresAt: '2026-10-14T11:00:00Z' }), { draft, now: NOW }),
		).toEqual({ kind: 'expired' })
	})
	it('reads the draft by own key only', () => {
		expect(approvalView(approval({ id: 'constructor' }), { draft: EMPTY_DRAFT, now: NOW })).toEqual(
			{
				kind: 'open',
			},
		)
	})
})

describe('toolFooter (spec §6.1, plan call P13)', () => {
	const gated: ToolPart = { ...call(), name: 'send_email', toolCallId: 'c7', args: '{}' }
	const approval: Interrupt = { id: 'i1', reason: 'tool_call', toolCallId: 'c7' }
	const asked = call({ toolCallId: 'c8' })

	it('puts Approve and Reject on the call an open approval names', () => {
		const open: TurnOpenItems = { interrupts: [approval], questions: [] }
		expect(toolFooter(gated, { open, draft: EMPTY_DRAFT })).toEqual({
			kind: 'approval',
			interrupt: approval,
		})
	})
	it('ignores an interrupt that is not an approval, and a call no open item names', () => {
		const input: Interrupt = { id: 'i2', reason: 'input_required', toolCallId: 'c7' }
		expect(
			toolFooter(gated, { open: { interrupts: [input], questions: [] }, draft: EMPTY_DRAFT }),
		).toBeNull()
		expect(
			toolFooter(call({ toolCallId: 'c1' }), {
				open: { interrupts: [approval], questions: [asked] },
				draft: EMPTY_DRAFT,
			}),
		).toBeNull()
	})
	it('reads an open question with drafted answers as answered, and one without as nothing', () => {
		const open: TurnOpenItems = { interrupts: [approval], questions: [asked] }
		const draft: AnswerDraft = {
			...EMPTY_DRAFT,
			tools: { c8: { toolCallId: 'c8', content: 'Q: Which city?\nA: Paris' } },
		}
		expect(toolFooter(asked, { open, draft })).toEqual({ kind: 'answered' })
		expect(toolFooter(asked, { open, draft: EMPTY_DRAFT })).toBeNull()
	})
})

// The flat-object rule the activity card and the tool cards share (2b's plan call P17).
describe('flatFields', () => {
	it('reads a flat object’s entries in their order, each value as text', () => {
		expect(flatFields({ city: 'Paris', days: 3, metric: true, note: null })).toEqual([
			{ key: 'city', value: 'Paris' },
			{ key: 'days', value: '3' },
			{ key: 'metric', value: 'true' },
			{ key: 'note', value: 'null' },
		])
	})
	it('reads an empty object as no fields', () => {
		expect(flatFields({})).toEqual([])
	})
	it.each([
		['a nested object', { filter: { city: 'Paris' } }],
		['an object with an array value', { cities: ['Paris'] }],
		['an array', ['Paris', 'Rome']],
		['a string', 'Paris'],
		['a number', 3],
		['null', null],
		['nothing', undefined],
	])('reads %s as no flat object', (_label, value) => {
		expect(flatFields(value)).toBeNull()
	})
})

// The approved design (2026-10-15), A.1: the card's summary line.
describe('toolSummary', () => {
	it('shows flat arguments as key: value pairs joined by a middle dot, values as text', () => {
		expect(toolSummary('{"city": "Paris", "days": 3, "metric": true, "note": null}')).toBe(
			'city: Paris · days: 3 · metric: true · note: null',
		)
	})
	it('keeps the pairs on one line and cuts them at 60 code points', () => {
		expect(toolSummary(JSON.stringify({ message: 'Closed on Friday.\nOpen on Monday.' }))).toBe(
			'message: Closed on Friday. Open on Monday.',
		)
		const long = toolSummary(JSON.stringify({ message: '😀'.repeat(70) }))
		expect(long).toBe(`message: ${'😀'.repeat(51)}…`)
		expect(Array.from(long)).toHaveLength(61)
	})
	it('shows nothing for an empty object', () => {
		expect(toolSummary('{}')).toBe('')
		expect(toolSummary('{ }')).toBe('')
	})
	it.each([
		['nested arguments', '{"filter": {"city": "Paris"}}'],
		['an array', '["Paris", "Rome"]'],
		['arguments still streaming', '{"city": '],
		['a JSON string', '"Paris"'],
	])('keeps the input hint for %s', (_label, args) => {
		expect(toolSummary(args)).toBe(inputHint(args))
	})
})

// A.2: what each part of the expanded card renders as.
describe('toolDetail', () => {
	it('reads a flat object as fields, values as text', () => {
		expect(toolDetail('{"city": "Paris", "temperature_c": 18, "cloudy": true}')).toEqual({
			kind: 'fields',
			items: [
				{ key: 'city', value: 'Paris' },
				{ key: 'temperature_c', value: '18' },
				{ key: 'cloudy', value: 'true' },
			],
		})
	})
	it('reads an empty object, an empty text and blank text as nothing to show', () => {
		for (const text of ['{}', '', '  \n']) expect(toolDetail(text)).toEqual({ kind: 'empty' })
	})
	it('keeps nested objects and arrays as JSON indented by two spaces', () => {
		expect(toolDetail('{"city":"Paris","hours":[9,17]}')).toEqual({
			kind: 'json',
			text: '{\n  "city": "Paris",\n  "hours": [\n    9,\n    17\n  ]\n}',
		})
		expect(toolDetail('["Paris","Rome"]')).toEqual({
			kind: 'json',
			text: '[\n  "Paris",\n  "Rome"\n]',
		})
	})
	it('shows text that is not JSON as sent: a plain-text result, or arguments still streaming', () => {
		expect(toolDetail('Deleted report.pdf.\nNothing else changed.')).toEqual({
			kind: 'text',
			text: 'Deleted report.pdf.\nNothing else changed.',
		})
		expect(toolDetail('{"city": ')).toEqual({ kind: 'text', text: '{"city": ' })
	})
	it('shows a JSON string as its text, and any other JSON scalar as sent', () => {
		expect(toolDetail('"Deleted report.pdf."')).toEqual({
			kind: 'text',
			text: 'Deleted report.pdf.',
		})
		expect(toolDetail('18')).toEqual({ kind: 'text', text: '18' })
		expect(toolDetail('null')).toEqual({ kind: 'text', text: 'null' })
	})
	it('keeps markup as text for the card to render as text', () => {
		expect(toolDetail('<b>bold</b>')).toEqual({ kind: 'text', text: '<b>bold</b>' })
		expect(toolDetail('{"note": "<b>bold</b>"}')).toEqual({
			kind: 'fields',
			items: [{ key: 'note', value: '<b>bold</b>' }],
		})
	})
})
