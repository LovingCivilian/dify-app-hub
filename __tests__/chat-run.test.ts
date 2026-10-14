import type { Message } from '@ag-ui/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type FakeSession = {
	args: Record<string, unknown>
	start: ReturnType<typeof vi.fn>
	finish: ReturnType<typeof vi.fn>
}

const { dal, sessions } = vi.hoisted(() => ({
	dal: {
		findConversation: vi.fn(),
		lastRun: vi.fn(),
		loadThread: vi.fn(),
		startRun: vi.fn(),
		finishRun: vi.fn(),
		truncateStaleRun: vi.fn(),
	},
	sessions: [] as FakeSession[],
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession: vi.fn(),
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess: vi.fn() }))
vi.mock('@/lib/providers/registry', () => ({ chatAdapterOf: () => undefined }))
vi.mock('@/lib/data/conversations', () => dal)
// The session is Task 10's (persistence and the browser's events); here it records how the run drives it.
vi.mock('@/lib/chat/session', () => ({
	RunSession: class {
		args: Record<string, unknown>
		start = vi.fn()
		finish = vi.fn(async () => ({ status: 'succeeded', custom: [] }))
		event = vi.fn()
		messages = vi.fn()
		state = vi.fn()
		constructor(args: Record<string, unknown>) {
			this.args = args
			sessions.push(this as unknown as FakeSession)
		}
	},
}))

import { activeRuns } from '@/lib/chat/active-runs'
import { UPSTREAM_STATUS, type UpstreamErrorCode } from '@/lib/chat/adapter'
import { runTurn, UPSTREAM_MESSAGES } from '@/lib/chat/run'
import { SSE_HEADERS } from '@/lib/chat/stream'
import { threadForAgent, UNAVAILABLE_TOOL_CONTENT, UNAVAILABLE_TOOL_ERROR } from '@/lib/chat/thread'

const APP_ID = '0b1c2d3e-4f50-4a61-8b72-9c8dae0f1a2b'
const CONVERSATION_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const actor = {
	id: 'u1',
	email: 'jane@example.com',
	name: null,
	role: 'user' as const,
	source: 'local' as const,
}
const app = {
	id: APP_ID,
	enabled: true,
	provider: 'agui' as const,
	settings: { agentUrl: 'http://agent/agents/a', audience: 'a' },
	secrets: { jwtSecret: 'x'.repeat(32) },
}
const conversation = {
	id: CONVERSATION_ID,
	appId: APP_ID,
	title: 'Earlier',
	state: { steps: [] },
	activeRunId: null as string | null,
	updatedAt: new Date('2026-10-14T10:00:00Z'),
}
const row = (seq: number, body: Message) => ({
	seq,
	messageId: body.id,
	runId: 'r0',
	role: body.role,
	body,
	status: 'complete' as const,
})
const userRow = (seq: number, id: string, text: string) =>
	row(seq, { id, role: 'user', content: text })
const callRow = (seq: number, ...ids: string[]) =>
	row(seq, {
		id: `a${seq}`,
		role: 'assistant',
		toolCalls: ids.map(id => ({
			id,
			type: 'function',
			function: { name: 'lookup', arguments: '{}' },
		})),
	})
const interrupted = (interrupts: unknown[]) => ({
	id: 'r0',
	status: 'interrupted',
	outcome: { type: 'interrupt', interrupts },
	error: null,
	custom: [],
	startedAt: new Date(),
	finishedAt: new Date(),
})

const chat = { runTurn: vi.fn() }
const opens = (opened: unknown, finished: Promise<unknown> = Promise.resolve({ failed: false })) =>
	chat.runTurn.mockReturnValue({ opened: Promise.resolve(opened), finished })
const run = (body: Record<string, unknown>, signal?: AbortSignal) =>
	runTurn({
		request: new Request(`http://hub/api/apps/${APP_ID}/runs`, { method: 'POST', signal }),
		actor,
		app,
		chat,
		body,
	})
const envelope = async (response: Response) => ({
	status: response.status,
	body: await response.json(),
})
const started = () => dal.startRun.mock.calls[0][1]
const adapterInput = () => chat.runTurn.mock.calls[0][1]

beforeEach(() => {
	for (const fn of Object.values(dal)) fn.mockReset()
	chat.runTurn.mockReset()
	sessions.length = 0
	dal.findConversation.mockResolvedValue(conversation)
	dal.lastRun.mockResolvedValue(null)
	dal.loadThread.mockResolvedValue([])
	dal.finishRun.mockResolvedValue(undefined)
	dal.startRun.mockImplementation(
		async (_actor: unknown, input: { conversation: { id: string }; runId: string }) => ({
			ok: true,
			key: { conversationId: input.conversation.id, runId: input.runId },
		}),
	)
})

// Spec §4.3 steps 2–5: store, build, run, stream.
describe('runTurn: a run that opens', () => {
	it('starts a new conversation titled by the message, and streams the run', async () => {
		opens({ ok: true })
		const response = await run({ message: { text: 'Plan my week' } })
		expect(dal.findConversation).not.toHaveBeenCalled()
		expect(started()).toMatchObject({
			appId: APP_ID,
			conversation: { title: 'Plan my week', isNew: true },
			messages: [{ role: 'user', content: 'Plan my week' }],
		})
		const key = { conversationId: started().conversation.id, runId: started().runId }
		expect(response.status).toBe(200)
		for (const [name, value] of new Headers(SSE_HEADERS))
			expect(response.headers.get(name)).toBe(value)
		const [session] = sessions
		expect(session.args).toMatchObject({ key, appId: APP_ID, title: 'Plan my week' })
		expect(session.start).toHaveBeenCalledTimes(1)
		expect(session.start.mock.invocationCallOrder[0]).toBeLessThan(
			chat.runTurn.mock.invocationCallOrder[0],
		)
		// Plan call P1: the caller is the account's id, source and role, nothing else of the session.
		expect(chat.runTurn).toHaveBeenCalledWith(
			{ settings: app.settings, secrets: app.secrets },
			expect.objectContaining({
				threadId: key.conversationId,
				runId: key.runId,
				state: {},
				tools: [],
				resume: undefined,
				caller: { id: 'u1', source: 'local', role: 'user' },
			}),
			session,
		)
		// The session's history is the very array the agent gets as its messages (Task 10: no history row is written again).
		expect(session.args.history).toBe(adapterInput().messages)
		await vi.waitFor(() =>
			expect(session.finish).toHaveBeenCalledWith({ failed: false, stopReason: undefined }),
		)
		expect(session.finish).toHaveBeenCalledTimes(1)
		expect(await response.text()).toBe('')
		expect(activeRuns.has(key.runId)).toBe(false)
	})

	it('continues a conversation with its title and state, from the stored thread', async () => {
		opens({ ok: true })
		const before = [userRow(1, 'm1', 'Earlier')]
		const after = [...before, userRow(2, 'm2', 'And next')]
		dal.loadThread.mockResolvedValueOnce(before).mockResolvedValueOnce(after)
		await run({ conversationId: CONVERSATION_ID, message: { text: 'And next' } })
		expect(dal.findConversation).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID)
		expect(started().conversation).toEqual({ id: CONVERSATION_ID })
		expect(sessions[0].args).toMatchObject({ title: 'Earlier' })
		expect(adapterInput()).toMatchObject({
			state: { steps: [] },
			messages: threadForAgent(after),
		})
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())
	})

	it('answers a conversation the actor cannot reach as unknown, storing nothing', async () => {
		dal.findConversation.mockResolvedValue(null)
		expect(
			await envelope(await run({ conversationId: CONVERSATION_ID, message: { text: 'hi' } })),
		).toEqual({
			status: 404,
			body: { code: 'conversation_not_found', message: 'No such conversation.', status: 404 },
		})
		expect(dal.startRun).not.toHaveBeenCalled()
	})

	// The run is held before the database calls it active, so a concurrent reconcile never truncates a live run.
	it('holds the run in activeRuns from before startRun until the stream ends', async () => {
		opens({ ok: true })
		let heldAtStart: boolean | undefined
		let heldAtThread: boolean | undefined
		dal.startRun.mockImplementation(
			async (_actor: unknown, input: { conversation: { id: string }; runId: string }) => {
				heldAtStart = activeRuns.has(input.runId)
				return { ok: true, key: { conversationId: input.conversation.id, runId: input.runId } }
			},
		)
		dal.loadThread.mockImplementation(async () => {
			heldAtThread = activeRuns.has(started().runId)
			return []
		})
		await run({ message: { text: 'hi' } })
		expect(heldAtStart).toBe(true)
		expect(heldAtThread).toBe(true)
		await vi.waitFor(() => expect(activeRuns.has(started().runId)).toBe(false))
	})

	it('leaves nothing registered when startRun refuses or throws', async () => {
		let runId = ''
		dal.startRun.mockImplementation(async (_actor: unknown, input: { runId: string }) => {
			runId = input.runId
			return { ok: false, code: 'run_in_progress' }
		})
		await run({ message: { text: 'hi' } })
		expect(runId).not.toBe('')
		expect(activeRuns.has(runId)).toBe(false)
		dal.startRun.mockImplementation(async (_actor: unknown, input: { runId: string }) => {
			runId = input.runId
			throw new Error('db down')
		})
		await expect(run({ message: { text: 'hi' } })).rejects.toThrow('db down')
		expect(activeRuns.has(runId)).toBe(false)
	})

	it('aborts the upstream request when the adapter throws after starting it', async () => {
		chat.runTurn.mockImplementation(() => {
			throw new Error('adapter broke')
		})
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		await expect(run({ message: { text: 'hi' } })).rejects.toThrow('adapter broke')
		errorSpy.mockRestore()
		expect(adapterInput().abortController.signal.aborted).toBe(true)
		expect(activeRuns.has(started().runId)).toBe(false)
	})

	// Spec §3.2 step 5: a run stored as running that no process holds is truncated when the next request finds it.
	it('truncates a run this process does not hold, but not one it holds', async () => {
		opens({ ok: true })
		dal.findConversation.mockResolvedValue({ ...conversation, activeRunId: 'r-old' })
		await run({ conversationId: CONVERSATION_ID, message: { text: 'hi' } })
		expect(dal.truncateStaleRun).toHaveBeenCalledWith({
			conversationId: CONVERSATION_ID,
			runId: 'r-old',
		})
		expect(dal.truncateStaleRun.mock.invocationCallOrder[0]).toBeLessThan(
			dal.lastRun.mock.invocationCallOrder[0],
		)
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())

		dal.truncateStaleRun.mockReset()
		activeRuns.register('r-live', {
			conversationId: CONVERSATION_ID,
			controller: new AbortController(),
		})
		dal.findConversation.mockResolvedValue({ ...conversation, activeRunId: 'r-live' })
		await run({ conversationId: CONVERSATION_ID, message: { text: 'hi' } })
		expect(dal.truncateStaleRun).not.toHaveBeenCalled()
		activeRuns.release('r-live')
	})
})

// Spec §4.3 step 1 (decision 50; plan call P3).
describe('runTurn: what the conversation waits for', () => {
	const approval = { id: 'int-1', reason: 'tool_call', toolCallId: 'call-1' }

	it('refuses a message while an interrupt is open, storing nothing', async () => {
		dal.lastRun.mockResolvedValue(interrupted([approval]))
		expect(
			await envelope(await run({ conversationId: CONVERSATION_ID, message: { text: 'hi' } })),
		).toEqual({
			status: 409,
			body: { code: 'answer_pending', message: 'Answer the open question first.', status: 409 },
		})
		expect(dal.startRun).not.toHaveBeenCalled()
	})

	it('refuses answers that do not match what is open', async () => {
		dal.lastRun.mockResolvedValue(interrupted([approval]))
		const response = await run({
			conversationId: CONVERSATION_ID,
			answers: { resume: [{ interruptId: 'int-9', status: 'resolved' }] },
		})
		expect(await envelope(response)).toEqual({
			status: 400,
			body: {
				code: 'answers_invalid',
				message: 'The answers do not match what the conversation waits for.',
				status: 400,
			},
		})
		expect(dal.startRun).not.toHaveBeenCalled()
	})

	it('resumes with the answers, and leaves the gated call to the agent', async () => {
		opens({ ok: true })
		dal.lastRun.mockResolvedValue(interrupted([approval]))
		dal.loadThread.mockResolvedValue([
			userRow(1, 'm1', 'Delete it'),
			callRow(2, 'call-1', 'call-2'),
		])
		const resume = [{ interruptId: 'int-1', status: 'resolved', payload: { approved: true } }]
		await run({ conversationId: CONVERSATION_ID, answers: { resume } })
		expect(started().resume).toEqual(resume)
		// call-2 is a call to a tool the hub never advertised (plan call P4); call-1 is the one the approval gates.
		expect(started().messages).toEqual([
			expect.objectContaining({
				role: 'tool',
				toolCallId: 'call-2',
				error: UNAVAILABLE_TOOL_ERROR,
				content: UNAVAILABLE_TOOL_CONTENT,
			}),
		])
		expect(adapterInput().resume).toEqual(resume)
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())
	})

	it('answers an unanswered call to a tool the hub never advertised before the user message', async () => {
		opens({ ok: true })
		dal.loadThread.mockResolvedValue([userRow(1, 'm1', 'Look it up'), callRow(2, 'call-9')])
		await run({ conversationId: CONVERSATION_ID, message: { text: 'Go on' } })
		expect(started().messages).toEqual([
			expect.objectContaining({
				role: 'tool',
				toolCallId: 'call-9',
				error: UNAVAILABLE_TOOL_ERROR,
				content: UNAVAILABLE_TOOL_CONTENT,
			}),
			expect.objectContaining({ role: 'user', content: 'Go on' }),
		])
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())
	})

	it('answers 409 when the conversation already runs', async () => {
		dal.startRun.mockResolvedValue({ ok: false, code: 'run_in_progress' })
		expect(
			await envelope(await run({ conversationId: CONVERSATION_ID, message: { text: 'hi' } })),
		).toEqual({
			status: 409,
			body: {
				code: 'run_in_progress',
				message: 'A run is already in progress in this conversation.',
				status: 409,
			},
		})
		expect(chat.runTurn).not.toHaveBeenCalled()
	})
})

// Spec §4.3 step 4 and plan call P5: the agent's refusal before any stream is the hub's envelope, not a stream.
describe('runTurn: an agent that refuses before the stream', () => {
	it.each(Object.entries(UPSTREAM_STATUS) as [UpstreamErrorCode, number][])(
		'answers %s with %i, stores the run failed and logs the code only',
		async (code, status) => {
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
			opens({ ok: false, code }, Promise.resolve({ failed: true }))
			const response = await run({ message: { text: 'hi' } })
			expect(await envelope(response)).toEqual({
				status,
				body: { code, message: UPSTREAM_MESSAGES[code], status },
			})
			const key = { conversationId: started().conversation.id, runId: started().runId }
			expect(dal.finishRun).toHaveBeenCalledWith(key, {
				status: 'failed',
				error: { code, message: UPSTREAM_MESSAGES[code] },
				custom: [],
			})
			expect(errorSpy).toHaveBeenCalledWith('runTurn:', { appId: APP_ID, runId: key.runId, code })
			expect(sessions[0].finish).not.toHaveBeenCalled()
			expect(activeRuns.has(key.runId)).toBe(false)
			errorSpy.mockRestore()
		},
	)

	it('stores the run failed before it releases it', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const held: boolean[] = []
		dal.finishRun.mockImplementation(async (key: { runId: string }) => {
			held.push(activeRuns.has(key.runId))
		})
		opens({ ok: false, code: 'provider_unreachable' }, Promise.resolve({ failed: true }))
		await run({ message: { text: 'hi' } })
		expect(held).toEqual([true])
		expect(activeRuns.has(started().runId)).toBe(false)
		errorSpy.mockRestore()
	})

	it('stores the run failed and rethrows when the hub cannot hand it to the agent', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		dal.loadThread.mockRejectedValueOnce(new Error('db down'))
		await expect(run({ message: { text: 'hi' } })).rejects.toThrow('db down')
		expect(dal.finishRun).toHaveBeenCalledWith(
			{ conversationId: started().conversation.id, runId: started().runId },
			{ status: 'failed', error: { code: 'internal_error', message: '' }, custom: [] },
		)
		expect(chat.runTurn).not.toHaveBeenCalled()
		expect(activeRuns.has(started().runId)).toBe(false)
		errorSpy.mockRestore()
	})

	it('stores the run failed before it releases it when the hand-over throws', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const held: boolean[] = []
		dal.finishRun.mockImplementation(async (key: { runId: string }) => {
			held.push(activeRuns.has(key.runId))
		})
		chat.runTurn.mockImplementation(() => {
			throw new Error('adapter broke')
		})
		await expect(run({ message: { text: 'hi' } })).rejects.toThrow('adapter broke')
		expect(held).toEqual([true])
		expect(activeRuns.has(started().runId)).toBe(false)
		errorSpy.mockRestore()
	})
})

// Spec §4.5: a browser that goes away aborts the upstream request; the run is stored as truncated (Task 10's finish).
describe('runTurn: a browser that leaves', () => {
	it('aborts the upstream request mid-stream and settles the run as a disconnect', async () => {
		let end!: (value: { failed: boolean }) => void
		opens({ ok: true }, new Promise(resolve => (end = resolve)))
		const browser = new AbortController()
		const response = await run({ message: { text: 'hi' } }, browser.signal)
		expect(response.status).toBe(200)
		browser.abort()
		expect(adapterInput().abortController.signal.aborted).toBe(true)
		end({ failed: false })
		await vi.waitFor(() =>
			expect(sessions[0].finish).toHaveBeenCalledWith({ failed: false, stopReason: 'disconnect' }),
		)
	})

	// The browser knows the run id only from hub:run, inside the stream: before the agent answers, closing the request is
	// its only stop. The adapter's refusal is then the stop's doing, not the agent's: no envelope, no failed write.
	it('settles a run stopped before the agent answered as that stop, not as a failure', async () => {
		chat.runTurn.mockImplementation(
			(_app: unknown, input: { abortController: AbortController }) => {
				const aborted = new Promise<void>(resolve =>
					input.abortController.signal.addEventListener('abort', () => resolve(), { once: true }),
				)
				return {
					opened: aborted.then(() => ({ ok: false, code: 'provider_unreachable' })),
					finished: aborted.then(() => ({ failed: false })),
				}
			},
		)
		const browser = new AbortController()
		const pending = run({ message: { text: 'hi' } }, browser.signal)
		await vi.waitFor(() => expect(chat.runTurn).toHaveBeenCalled())
		browser.abort()
		const response = await pending
		expect(response.status).toBe(200)
		await vi.waitFor(() =>
			expect(sessions[0].finish).toHaveBeenCalledWith({ failed: false, stopReason: 'disconnect' }),
		)
		expect(dal.finishRun).not.toHaveBeenCalled()
	})
})
