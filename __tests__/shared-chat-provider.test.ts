import { describe, expect, it, vi } from 'vitest'

import {
	AgUiChatProvider,
	parseHubEvent,
} from '@/components/shared-chat/provider/ag-ui-chat-provider'
import { emptyAssistantTurn, HUB_RUN_EVENT, userTurn, type Turn } from '@/lib/chat/turn'

const chunk = (event: object) => ({ data: JSON.stringify(event) })

const makeProvider = (overrides: Partial<ConstructorParameters<typeof AgUiChatProvider>[0]> = {}) =>
	new AgUiChatProvider({
		// AbstractChatProvider only checks `manual`; no network is involved in these tests (as dify-chat-provider.test.ts).
		request: { manual: true, options: {} } as never,
		getConversationId: () => 'conv-1',
		onRun: vi.fn(),
		onState: vi.fn(),
		...overrides,
	})

const feed = (provider: AgUiChatProvider, chunks: { data?: string }[], origin?: Turn) => {
	let turn = origin
	for (const data of chunks) {
		turn = provider.transformMessage({
			originMessage: turn,
			chunk: data,
			chunks: [],
			status: 'updating',
			responseHeaders: new Headers(),
		})
	}
	return turn!
}

const hubRun = {
	type: 'CUSTOM',
	name: HUB_RUN_EVENT,
	value: { conversationId: 'conv-1', runId: 'r1', title: 'Hi' },
}

describe('AgUiChatProvider.transformParams (spec §4.2)', () => {
	it('sends the message with the conversation id once the conversation has one', () => {
		expect(makeProvider().transformParams({ message: { text: 'hi' } })).toEqual({
			conversationId: 'conv-1',
			message: { text: 'hi' },
		})
	})
	it('sends no conversation id for a new chat', () => {
		const provider = makeProvider({ getConversationId: () => undefined })
		expect(provider.transformParams({ message: { text: 'hi' } })).toEqual({
			message: { text: 'hi' },
		})
	})
	it('sends answers without a message, and never the client-only turn they continue', () => {
		const answers = { resume: [{ interruptId: 'int-1', status: 'cancelled' as const }] }
		const body = makeProvider().transformParams({ answers, continues: emptyAssistantTurn() })
		expect(body).toEqual({ conversationId: 'conv-1', answers })
		expect(body).not.toHaveProperty('continues')
		expect(body).not.toHaveProperty('message')
	})
})

describe('AgUiChatProvider.transformLocalMessage', () => {
	it('shows the user turn of a message, and none for answers', () => {
		const provider = makeProvider()
		expect(provider.transformLocalMessage({ message: { text: 'hi' } })).toEqual(
			userTurn('local', 'hi'),
		)
		expect(provider.transformLocalMessage({ answers: { resume: [] } })).toEqual([])
	})
})

describe('AgUiChatProvider.transformMessage (spec §5.2)', () => {
	it('reports hub:run and keeps the run id for Stop, until the next request', () => {
		const onRun = vi.fn()
		const provider = makeProvider({ onRun })
		provider.transformParams({ message: { text: 'hi' } })
		feed(provider, [chunk(hubRun)])
		expect(onRun).toHaveBeenCalledWith(hubRun.value)
		expect(provider.runId).toBe('r1')
		provider.transformParams({ message: { text: 'again' } })
		expect(provider.runId).toBeUndefined()
	})
	it('folds text events into one turn', () => {
		const turn = feed(makeProvider(), [
			chunk(hubRun),
			chunk({ type: 'RUN_STARTED', threadId: 'conv-1', runId: 'r1' }),
			chunk({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' }),
			chunk({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello ' }),
			chunk({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'world' }),
			chunk({ type: 'TEXT_MESSAGE_END', messageId: 'm1' }),
		])
		expect(turn.role).toBe('assistant')
		expect(turn.parts).toContainEqual({ kind: 'text', messageId: 'm1', text: 'Hello world' })
	})
	it('hands the state snapshot to the side store', () => {
		const onState = vi.fn()
		feed(makeProvider({ onState }), [chunk({ type: 'STATE_SNAPSHOT', snapshot: { steps: [] } })])
		expect(onState).toHaveBeenCalledWith({ steps: [] })
	})
	it('returns the origin for a chunk that is no event', () => {
		const origin = userTurn('m0', 'x')
		const provider = makeProvider()
		for (const data of [undefined, '', 'not json', '[1]', '{"type":3}', 'null']) {
			expect(
				provider.transformMessage({
					originMessage: origin,
					chunk: { data },
					chunks: [],
					status: 'updating',
					responseHeaders: new Headers(),
				}),
			).toBe(origin)
		}
	})
	it('starts an empty assistant turn when the stream ends without any chunk', () => {
		expect(
			makeProvider().transformMessage({
				chunk: undefined as never,
				chunks: [],
				status: 'success',
				responseHeaders: new Headers(),
			}),
		).toEqual(emptyAssistantTurn())
	})
	it('continues the given turn on a reload, whose first chunk has no origin (x-sdk onReload)', () => {
		const provider = makeProvider()
		const paused: Turn = {
			...emptyAssistantTurn(),
			parts: [{ kind: 'text', messageId: 'm1', text: 'Before the question.' }],
		}
		provider.transformParams({ answers: { resume: [] }, continues: paused })
		const turn = feed(provider, [
			chunk({ type: 'TEXT_MESSAGE_START', messageId: 'm2', role: 'assistant' }),
			chunk({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'After.' }),
		])
		expect(turn.parts[0]).toEqual({ kind: 'text', messageId: 'm1', text: 'Before the question.' })
		expect(turn.parts).toContainEqual({ kind: 'text', messageId: 'm2', text: 'After.' })
	})
	it('keeps streaming when a callback throws', () => {
		const provider = makeProvider({
			onRun: () => {
				throw new Error('list gone')
			},
		})
		expect(() => feed(provider, [chunk(hubRun)])).not.toThrow()
		expect(provider.runId).toBe('r1')
	})
})

describe('parseHubEvent', () => {
	it('reads one JSON event object with a string type', () => {
		expect(parseHubEvent('{"type":"RUN_STARTED","runId":"r1"}')).toEqual({
			type: 'RUN_STARTED',
			runId: 'r1',
		})
		expect(parseHubEvent('{"runId":"r1"}')).toBeNull()
		expect(parseHubEvent(' ')).toBeNull()
	})
})
