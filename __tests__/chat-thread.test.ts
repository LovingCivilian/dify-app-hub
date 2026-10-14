import type { Message } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { errorToolMessage, threadForAgent, titleFrom, unansweredToolCalls } from '@/lib/chat/thread'
import type { StoredMessage } from '@/lib/data/conversations'

const row = (seq: number, body: Message): StoredMessage => ({
	seq,
	messageId: body.id,
	runId: null,
	role: body.role,
	body,
	status: 'complete',
})

const user: Message = { id: 'u1', role: 'user', content: 'Weather in Paris?' }
const call: Message = {
	id: 'a1',
	role: 'assistant',
	toolCalls: [
		{
			id: 'c1',
			type: 'function',
			function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
		},
		{ id: 'c2', type: 'function', function: { name: 'get_time', arguments: '{}' } },
	],
}
const text: Message = { id: 'a2', role: 'assistant', content: 'Looking it up.' }
const result1: Message = { id: 't1', role: 'tool', toolCallId: 'c1', content: '18 °C' }
const result2: Message = { id: 't2', role: 'tool', toolCallId: 'c2', content: '10:00' }
const activity: Message = {
	id: 'act1',
	role: 'activity',
	activityType: 'progress',
	content: { done: 1 },
}

describe('threadForAgent (spec §3.3, plan call P7)', () => {
	it('drops activity messages, which the next run must not carry (AG-UI "Activity")', () => {
		expect(threadForAgent([row(1, user), row(2, activity), row(3, text)]).map(m => m.id)).toEqual([
			'u1',
			'a2',
		])
	})

	it('moves a tool result right after the call it answers, past text that came in between', () => {
		expect(
			threadForAgent([row(1, user), row(2, call), row(3, text), row(4, result1)]).map(m => m.id),
		).toEqual(['u1', 'a1', 't1', 'a2'])
	})

	it('keeps several results of one call message in their order', () => {
		expect(
			threadForAgent([row(1, call), row(2, text), row(3, result2), row(4, result1)]).map(m => m.id),
		).toEqual(['a1', 't2', 't1', 'a2'])
	})

	it('leaves a tool message whose call it cannot find where it is', () => {
		const stray: Message = { id: 't9', role: 'tool', toolCallId: 'c9', content: 'x' }
		expect(threadForAgent([row(1, user), row(2, stray), row(3, text)]).map(m => m.id)).toEqual([
			'u1',
			't9',
			'a2',
		])
	})
})

describe('unansweredToolCalls (spec §3.2 step 4, §6.2)', () => {
	it('lists the calls no tool message answers, in order, with their tool names', () => {
		expect(unansweredToolCalls([user, call, result1, text])).toEqual([
			{ toolCallId: 'c2', name: 'get_time' },
		])
		expect(unansweredToolCalls([user, call, result1, result2])).toEqual([])
	})
})

describe('errorToolMessage', () => {
	it('answers a call with a tool message carrying the error (AG-UI "Tool calls": "a failure is still an answer")', () => {
		const message = errorToolMessage('c1', 'stopped', 'Stopped.')
		expect(message).toEqual({
			id: expect.stringMatching(/^[0-9a-f-]{36}$/),
			role: 'tool',
			toolCallId: 'c1',
			content: 'Stopped.',
			error: 'stopped',
		})
	})
})

describe('titleFrom (spec §3.1)', () => {
	it('trims the text and folds its runs of white space into one space', () => {
		expect(titleFrom('  Plan the\n\n trip   ')).toBe('Plan the trip')
	})

	it('keeps at most 80 characters, never splitting a character made of two UTF-16 units', () => {
		const long = `${'a'.repeat(79)}😀😀`
		expect(titleFrom(long)).toBe(`${'a'.repeat(79)}😀`)
		expect(Array.from(titleFrom('b'.repeat(200)))).toHaveLength(80)
	})

	it('is empty for a message without text', () => {
		expect(titleFrom('   ')).toBe('')
	})
})
