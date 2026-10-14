import { describe, expect, it } from 'vitest'

import {
	conversationsQuerySchema,
	MESSAGE_TEXT_MAX,
	runBodySchema,
	threadQuerySchema,
} from '@/lib/chat/schemas'

const ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const resolved = { interruptId: 'int-1', status: 'resolved', payload: { approved: true } }

// Spec §4.2: exactly one of message and answers; answers continue a conversation; the text is 1–32,000 characters.
describe('runBodySchema', () => {
	it.each([
		['a first message', { message: { text: 'hi' } }],
		['a message in a conversation', { conversationId: ID, message: { text: 'hi' } }],
		['answers in a conversation', { conversationId: ID, answers: { resume: [resolved] } }],
		[
			'a cancelled answer without a payload',
			{ conversationId: ID, answers: { resume: [{ interruptId: 'int-1', status: 'cancelled' }] } },
		],
		['a message of the longest length', { message: { text: 'x'.repeat(MESSAGE_TEXT_MAX) } }],
	])('takes %s', (_case, body) => {
		expect(runBodySchema.safeParse(body).success).toBe(true)
	})

	it.each([
		['neither a message nor answers', {}],
		[
			'both a message and answers',
			{ conversationId: ID, message: { text: 'hi' }, answers: { resume: [resolved] } },
		],
		['answers without a conversation', { answers: { resume: [resolved] } }],
		['an empty text', { message: { text: '' } }],
		['a blank text', { message: { text: '  \n ' } }],
		['a text over 32,000 characters', { message: { text: 'x'.repeat(MESSAGE_TEXT_MAX + 1) } }],
		['a conversation id that is no UUID', { conversationId: 'nope', message: { text: 'hi' } }],
		[
			'an unknown answer status',
			{ conversationId: ID, answers: { resume: [{ ...resolved, status: 'maybe' }] } },
		],
		[
			'a payload that is no object',
			{ conversationId: ID, answers: { resume: [{ ...resolved, payload: [true] }] } },
		],
		[
			'more than 50 answers',
			{ conversationId: ID, answers: { resume: Array.from({ length: 51 }, () => resolved) } },
		],
		[
			'a tool result over 32,000 characters',
			{
				conversationId: ID,
				answers: { toolResults: [{ toolCallId: 'c1', content: 'x'.repeat(MESSAGE_TEXT_MAX + 1) }] },
			},
		],
	])('refuses %s', (_case, body) => {
		expect(runBodySchema.safeParse(body).success).toBe(false)
	})

	// zod 4 "Objects": unknown keys are stripped by default, so 2c's attachmentIds sent early change nothing.
	it('drops keys it does not know, and keeps the text as typed', () => {
		expect(runBodySchema.parse({ message: { text: ' hi ' }, attachmentIds: [ID] })).toEqual({
			message: { text: ' hi ' },
		})
	})
})

describe('the query schemas', () => {
	it('reads the history cursor as a positive safe integer', () => {
		expect(threadQuerySchema.parse({ before: '42' })).toEqual({ before: 42 })
		expect(threadQuerySchema.parse({ before: '9007199254740991' })).toEqual({
			before: Number.MAX_SAFE_INTEGER,
		})
		expect(threadQuerySchema.parse({})).toEqual({})
		for (const before of [
			'0',
			'-1',
			'1.5',
			'abc',
			'12345678901234567',
			// 16 digits, above 2^53 - 1: not a safe integer.
			'9999999999999999',
			'9007199254740992',
		])
			expect(threadQuerySchema.safeParse({ before }).success).toBe(false)
	})
	it('takes a list cursor of 1–200 characters, or none', () => {
		expect(conversationsQuerySchema.parse({})).toEqual({})
		expect(conversationsQuerySchema.parse({ cursor: 'abc' })).toEqual({ cursor: 'abc' })
		expect(conversationsQuerySchema.safeParse({ cursor: '' }).success).toBe(false)
		expect(conversationsQuerySchema.safeParse({ cursor: 'x'.repeat(201) }).success).toBe(false)
	})
})
