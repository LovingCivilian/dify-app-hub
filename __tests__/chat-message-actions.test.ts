import type { MessageInfo } from '@ant-design/x-sdk'
import { describe, expect, it } from 'vitest'

import {
	footerActions,
	questionOf,
	regenerateRequest,
	suggestionTarget,
	unansweredKeys,
} from '@/components/chat/chat-view/message-actions'
import { emptyAssistant, type DifyChatMessage } from '@/components/chat/provider/message'

const answer = (extra: Partial<DifyChatMessage> = {}): DifyChatMessage => ({
	...emptyAssistant(),
	content: 'Echo: hi',
	ids: { messageId: 'm-1', conversationId: 'c-1' },
	createdAt: 1_760_000_000,
	...extra,
})
const user = (content: string, extra: Partial<DifyChatMessage> = {}): DifyChatMessage => ({
	role: 'user',
	content,
	ids: {},
	...extra,
})
const none = { annotation: false, tts: false, hasQuestion: true }

// Spec §5.2 (footer), §4.7 and §10 (PRs #7/#8): which actions an assistant bubble offers.
describe('footerActions', () => {
	it('renders nothing for a user message, a placeholder or a reply that is still streaming', () => {
		expect(footerActions(user('hi'), 'success', none)).toBeUndefined()
		expect(footerActions(answer(), 'loading', none)).toBeUndefined()
		expect(footerActions(answer(), 'updating', none)).toBeUndefined()
	})

	it('offers regenerate, copy, feedback and the time on a finished answer', () => {
		expect(footerActions(answer(), 'success', none)).toStrictEqual({
			regenerate: true,
			copy: true,
			annotate: false,
			feedback: true,
			tts: false,
			time: true,
		})
	})

	it('hides feedback until the answer has its Dify message id', () => {
		expect(footerActions(answer({ ids: {} }), 'success', none)?.feedback).toBe(false)
	})

	it('hides feedback on an answer that failed, live or from the history', () => {
		// A request that failed (requestFallback) keeps no id; a stream `error` event keeps the id it had.
		expect(
			footerActions(answer({ ids: {}, error: { message: '' } }), 'error', none)?.feedback,
		).toBe(false)
		expect(
			footerActions(answer({ error: { message: 'The model is unavailable.' } }), 'success', none)
				?.feedback,
		).toBe(false)
	})

	it('keeps feedback on a stopped answer, which Dify keeps', () => {
		expect(footerActions(answer({ aborted: true }), 'abort', none)?.feedback).toBe(true)
	})

	it('offers annotation and text-to-speech only when the app enables them and there is text', () => {
		const enabled = { annotation: true, tts: true, hasQuestion: true }
		expect(footerActions(answer(), 'success', enabled)).toMatchObject({ annotate: true, tts: true })
		expect(footerActions(answer({ content: '' }), 'success', enabled)).toMatchObject({
			copy: false,
			annotate: false,
			tts: false,
			regenerate: true,
		})
	})

	it('offers regenerate only when a user turn precedes the answer', () => {
		expect(footerActions(answer(), 'success', { ...none, hasQuestion: false })?.regenerate).toBe(
			false,
		)
	})

	it('shows no time without a creation time (a request that failed before any event)', () => {
		expect(footerActions(answer({ createdAt: undefined }), 'success', none)?.time).toBe(false)
	})
})

const info = (id: string, message: DifyChatMessage): MessageInfo<DifyChatMessage> => ({
	id,
	message,
	status: 'success',
})

// Spec §4.7: regenerate is a new turn with the preceding user message's text and files.
describe('regenerateRequest', () => {
	it("takes the text of the user turn the answer replies to, not a later one's", () => {
		const messages = [
			info('u1', user('first')),
			info('a1', answer()),
			info('u2', user('second')),
			info('a2', answer()),
		]
		expect(regenerateRequest(messages, 'a1')).toStrictEqual({ query: 'first', files: [] })
		expect(regenerateRequest(messages, 'a2')).toStrictEqual({ query: 'second', files: [] })
	})

	it('sends uploaded files again by their upload id and remote files by their URL', () => {
		const messages = [
			info(
				'u1',
				user('look', {
					files: [
						{
							id: 'f1',
							type: 'image',
							url: '',
							belongsTo: 'user',
							uploadFileId: 'up-1',
							filename: 'look.png',
						},
						{ id: 'f2', type: 'document', url: 'https://example.com/a.pdf', belongsTo: 'user' },
						// Nothing to send it again with.
						{ id: 'f3', type: 'image', url: '', belongsTo: 'user' },
					],
				}),
			),
			info('a1', answer()),
		]
		expect(regenerateRequest(messages, 'a1')).toStrictEqual({
			query: 'look',
			files: [
				// The name goes along for the new user bubble (the request leaves it out).
				{
					type: 'image',
					transfer_method: 'local_file',
					upload_file_id: 'up-1',
					filename: 'look.png',
				},
				{ type: 'document', transfer_method: 'remote_url', url: 'https://example.com/a.pdf' },
			],
		})
	})

	it('is the question annotation starts from too', () => {
		const messages = [info('u1', user('first')), info('a1', answer())]
		expect(questionOf(messages, 'a1')).toBe(messages[0].message)
	})

	it('is undefined for an unknown key or an answer without a user turn before it', () => {
		const messages = [info('a0', answer()), info('u1', user('first')), info('a1', answer())]
		expect(regenerateRequest(messages, 'missing')).toBeUndefined()
		expect(regenerateRequest(messages, 'a0')).toBeUndefined()
	})
})

describe('unansweredKeys', () => {
	it('lists the answers before the first user turn, as strings', () => {
		const messages: MessageInfo<DifyChatMessage>[] = [
			{ id: 0, message: answer(), status: 'success' },
			{ id: 'a1', message: answer(), status: 'success' },
			{ id: 'u1', message: user('first'), status: 'success' },
			{ id: 'a2', message: answer(), status: 'success' },
		]
		expect(unansweredKeys(messages)).toStrictEqual(['0', 'a1'])
	})

	it('is empty when every answer follows a question, and lists all answers without any', () => {
		expect(
			unansweredKeys([
				{ id: 'u1', message: user('first'), status: 'success' },
				{ id: 'a1', message: answer(), status: 'success' },
			]),
		).toStrictEqual([])
		expect(unansweredKeys([{ id: 'a1', message: answer(), status: 'success' }])).toStrictEqual([
			'a1',
		])
	})
})

// Spec §4.7: next-question suggestions follow the reply that just ended.
describe('suggestionTarget', () => {
	const form = (state: 'pending' | 'filled' | 'expired') => ({
		state,
		formToken: 'token-1',
		formContent: '',
		inputs: [],
		actions: [],
		defaults: {},
		expiresAt: 1_760_000_000,
		workflowRunId: 'run-1',
	})

	it("follows the last answer's Dify message id", () => {
		expect(suggestionTarget(answer())).toBe('m-1')
	})
	it('has none without an answer, or for one that was stopped or failed', () => {
		expect(suggestionTarget(undefined)).toBeUndefined()
		expect(suggestionTarget(answer({ aborted: true }))).toBeUndefined()
		expect(suggestionTarget(answer({ error: { message: 'boom' } }))).toBeUndefined()
	})
	// A paused run waits on its human input form: questions under it would compete with the form.
	it('has none while the answer waits on a human input form, and follows it once the form is done', () => {
		expect(suggestionTarget(answer({ humanInput: form('pending') }))).toBeUndefined()
		expect(suggestionTarget(answer({ humanInput: form('filled') }))).toBe('m-1')
		expect(suggestionTarget(answer({ humanInput: form('expired') }))).toBe('m-1')
	})
})
