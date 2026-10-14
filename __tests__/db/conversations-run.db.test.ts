import type { Message } from '@ag-ui/core'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', async () => {
	const { testDb } = await import('./database')
	return { getDb: () => testDb }
})

import { apps, conversationMessages, conversationRuns, conversations, users } from '@/db/schema'
import {
	errorToolMessage,
	STOPPED_TOOL_CONTENT,
	threadForAgent,
	UNAVAILABLE_TOOL_CONTENT,
	UNAVAILABLE_TOOL_ERROR,
} from '@/lib/chat/thread'
import {
	continuedRun,
	finishRun,
	findConversation,
	loadThread,
	readThreadPage,
	saveMessages,
	saveState,
	startRun,
	truncateStaleRun,
	type RunEnd,
	type RunKey,
} from '@/lib/data/conversations'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterEach(() => {
	vi.restoreAllMocks()
})
afterAll(() => pool.end())

const actorFor = (role: 'owner' | 'admin' | 'user' = 'user') => ({
	id: crypto.randomUUID(),
	email: `${crypto.randomUUID()}@example.com`,
	name: null,
	role,
	source: 'local' as const,
})
type Actor = ReturnType<typeof actorFor>

const insertAccount = (actor: Actor) =>
	testDb
		.insert(users)
		.values({ id: actor.id, email: actor.email, password: 'hash', role: actor.role })

const insertApp = async () => {
	const id = crypto.randomUUID()
	await testDb.insert(apps).values({ id, provider: 'dify', name: 'Tea', settings: {}, secrets: {} })
	return id
}

const userMessage = (content = 'Hello'): Message => ({
	id: crypto.randomUUID(),
	role: 'user',
	content,
})

/** A new conversation of `actor` in `appId`, started with one user message; answers its run key. */
const begin = async (actor: Actor, appId: string): Promise<RunKey> => {
	const result = await startRun(actor, {
		appId,
		conversation: { id: crypto.randomUUID(), title: 'Hello', isNew: true },
		runId: crypto.randomUUID(),
		messages: [userMessage()],
	})
	if (!result.ok) throw new Error(result.code)
	return result.key
}

/** The next run on an existing conversation. */
const next = (actor: Actor, appId: string, conversationId: string) =>
	startRun(actor, {
		appId,
		conversation: { id: conversationId },
		runId: crypto.randomUUID(),
		messages: [userMessage('Again')],
	})

const done = (key: RunKey) => finishRun(key, { status: 'succeeded', custom: [] })

describe('a run’s writes (Part 2 spec §3.2)', () => {
	let actor: Actor
	let appId: string
	beforeEach(async () => {
		actor = actorFor()
		await insertAccount(actor)
		appId = await insertApp()
	})

	it('starts a new conversation owned by the actor, with its run and the user message', async () => {
		const key = await begin(actor, appId)
		expect(await findConversation(actor, appId, key.conversationId)).toMatchObject({
			id: key.conversationId,
			appId,
			title: 'Hello',
			activeRunId: key.runId,
		})
		expect(await continuedRun(key.conversationId)).toMatchObject({
			id: key.runId,
			status: 'running',
			error: null,
			custom: [],
			finishedAt: null,
		})
		expect(await loadThread(key.conversationId)).toMatchObject([
			{ runId: key.runId, role: 'user', status: 'complete', body: { content: 'Hello' } },
		])
	})

	it('refuses a conversation that is not the actor’s, of another app, or deleted', async () => {
		const key = await begin(actor, appId)
		await done(key)
		const stranger = actorFor()
		await insertAccount(stranger)
		expect(await next(stranger, appId, key.conversationId)).toEqual({
			ok: false,
			code: 'conversation_not_found',
		})
		expect(await next(actor, await insertApp(), key.conversationId)).toEqual({
			ok: false,
			code: 'conversation_not_found',
		})
		await testDb
			.update(conversations)
			.set({ deletedAt: new Date() })
			.where(eq(conversations.id, key.conversationId))
		expect(await next(actor, appId, key.conversationId)).toEqual({
			ok: false,
			code: 'conversation_not_found',
		})
	})

	it('refuses a run while one is active (run_in_progress)', async () => {
		const key = await begin(actor, appId)
		expect(await next(actor, appId, key.conversationId)).toEqual({
			ok: false,
			code: 'run_in_progress',
		})
	})

	// PostgreSQL 18 "Explicit Locking", 13.3.2: FOR UPDATE makes the second transaction wait for the first, then read the
	// active run the first one set.
	it('starts one run at a time: of two at once, one is refused with run_in_progress', async () => {
		const key = await begin(actor, appId)
		await done(key)
		const results = await Promise.all([
			next(actor, appId, key.conversationId),
			next(actor, appId, key.conversationId),
		])
		expect(results.filter(result => result.ok)).toHaveLength(1)
		expect(results.filter(result => !result.ok)).toEqual([{ ok: false, code: 'run_in_progress' }])
	})

	it('upserts a message by its id: the seq and the first run stay, the body and the status change', async () => {
		const first = await begin(actor, appId)
		const id = crypto.randomUUID()
		await saveMessages(first, [
			{ message: { id, role: 'assistant', content: 'Hel' }, status: 'streaming' },
		])
		const [before] = (await loadThread(first.conversationId)).filter(row => row.messageId === id)
		await done(first)
		const second = await next(actor, appId, first.conversationId)
		if (!second.ok) throw new Error(second.code)
		await saveMessages(second.key, [
			{ message: { id, role: 'assistant', content: 'Hello there' }, status: 'complete' },
		])
		const [after] = (await loadThread(first.conversationId)).filter(row => row.messageId === id)
		expect(after).toEqual({
			...before,
			body: { id, role: 'assistant', content: 'Hello there' },
			status: 'complete',
		})
	})

	it('never stores a message the AG-UI schema refuses, and logs only its ids', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const key = await begin(actor, appId)
		await saveMessages(key, [
			{
				message: { id: 'bad', role: 'assistant', content: 5 } as unknown as Message,
				status: 'complete',
			},
		])
		expect((await loadThread(key.conversationId)).map(row => row.messageId)).not.toContain('bad')
		expect(log).toHaveBeenCalledWith('Conversation message refused:', {
			conversationId: key.conversationId,
			runId: key.runId,
		})
	})

	it('finishes a run once: closes its open messages, answers its cut-off calls, clears the active run', async () => {
		const key = await begin(actor, appId)
		const assistantId = crypto.randomUUID()
		await saveMessages(key, [
			{
				message: {
					id: assistantId,
					role: 'assistant',
					content: 'Checking',
					toolCalls: [
						{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{"ci' } },
					],
				},
				status: 'streaming',
			},
		])
		const [{ updatedAt: startedAt }] = await testDb
			.select({ updatedAt: conversations.updatedAt })
			.from(conversations)
			.where(eq(conversations.id, key.conversationId))
		const stopped = errorToolMessage('c1', 'stopped', STOPPED_TOOL_CONTENT)
		await finishRun(key, {
			status: 'cancelled',
			outcome: { type: 'cancelled' },
			custom: [{ name: 'run_cancelled', value: { reason: 'run_timeout' } }],
			close: { messageIds: [assistantId], toolMessages: [stopped] },
		})
		await finishRun(key, { status: 'failed', error: { message: 'late' }, custom: [] })
		const thread = await loadThread(key.conversationId)
		expect(thread.find(row => row.messageId === assistantId)?.status).toBe('incomplete')
		expect(thread.filter(row => row.role === 'tool')).toMatchObject([
			{ messageId: stopped.id, runId: key.runId, status: 'complete', body: stopped },
		])
		expect(await continuedRun(key.conversationId)).toMatchObject({
			status: 'cancelled',
			outcome: { type: 'cancelled' },
			error: null,
			custom: [{ name: 'run_cancelled', value: { reason: 'run_timeout' } }],
			finishedAt: expect.any(Date),
		})
		const conversation = await findConversation(actor, appId, key.conversationId)
		expect(conversation?.activeRunId).toBeNull()
		expect(conversation!.updatedAt.getTime()).toBeGreaterThanOrEqual(startedAt!.getTime())
	})

	// AG-UI "State": any JSON value, null included.
	it('stores the state the run left, null included', async () => {
		const key = await begin(actor, appId)
		await saveState(key, { steps: [{ description: 'Collect', status: 'pending' }] })
		expect((await findConversation(actor, appId, key.conversationId))?.state).toEqual({
			steps: [{ description: 'Collect', status: 'pending' }],
		})
		await saveState(key, null)
		expect((await findConversation(actor, appId, key.conversationId))?.state).toBeNull()
	})

	it('builds the agent’s thread from the store: no activity, each tool result after its call', async () => {
		const key = await begin(actor, appId)
		await saveMessages(key, [
			{
				message: {
					id: 'a1',
					role: 'assistant',
					toolCalls: [
						{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
					],
				},
				status: 'complete',
			},
			{ message: { id: 'a2', role: 'assistant', content: 'Done' }, status: 'complete' },
			{
				message: { id: 'act', role: 'activity', activityType: 'progress', content: { done: 1 } },
				status: 'complete',
			},
			{
				message: { id: 't1', role: 'tool', toolCallId: 'c1', content: '18 °C' },
				status: 'complete',
			},
		])
		expect(
			threadForAgent(await loadThread(key.conversationId))
				.map(m => m.id)
				.slice(1),
		).toEqual(['a1', 't1', 'a2'])
	})

	// Spec §3.2 step 5: a run stored as running that no process holds.
	it('truncates a run no process holds: its open messages, its cut-off calls, the active run', async () => {
		const key = await begin(actor, appId)
		await saveMessages(key, [
			{
				message: {
					id: 'a1',
					role: 'assistant',
					content: 'Half an ans',
					toolCalls: [
						{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } },
					],
				},
				status: 'streaming',
			},
		])
		await truncateStaleRun(key)
		const thread = await loadThread(key.conversationId)
		expect(thread.find(row => row.messageId === 'a1')?.status).toBe('incomplete')
		expect(thread.filter(row => row.role === 'tool').map(row => row.body)).toEqual([
			{
				id: expect.any(String),
				role: 'tool',
				toolCallId: 'c1',
				content: STOPPED_TOOL_CONTENT,
				error: 'stopped',
			},
		])
		expect((await continuedRun(key.conversationId))?.status).toBe('truncated')
		expect((await findConversation(actor, appId, key.conversationId))?.activeRunId).toBeNull()
	})

	it('skips a stored row the AG-UI schema refuses, and logs only where it is', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const key = await begin(actor, appId)
		const { rows } = await pool.query<{ seq: string }>(
			"INSERT INTO conversation_messages (conversation_id, run_id, message_id, role, body, status) VALUES ($1, $2, 'broken', 'assistant', '{\"role\":\"assistant\"}', 'complete') RETURNING seq",
			[key.conversationId, key.runId],
		)
		expect((await loadThread(key.conversationId)).map(row => row.messageId)).not.toContain('broken')
		expect(log).toHaveBeenCalledWith('Stored conversation message refused:', {
			conversationId: key.conversationId,
			seq: Number(rows[0]!.seq),
		})
	})
})

// Plan call P10 (decision 62): an answering run the agent never started keeps what it answered open.
describe('a run refused before its stream (plan call P10)', () => {
	let actor: Actor
	let appId: string
	beforeEach(async () => {
		actor = actorFor()
		await insertAccount(actor)
		appId = await insertApp()
	})

	const REFUSAL = {
		code: 'provider_unreachable',
		message: 'The agent is restarting, try again.',
		beforeStream: true,
	} as const
	const refusedEnd = (withdraw?: string[]): RunEnd => ({
		status: 'failed',
		error: REFUSAL,
		custom: [],
		...(withdraw ? { withdraw } : {}),
	})

	/** The next run on the conversation, started with the given messages (an answering run carries tool messages). */
	const answering = async (conversationId: string, messages: Message[]): Promise<RunKey> => {
		const result = await startRun(actor, {
			appId,
			conversation: { id: conversationId },
			runId: crypto.randomUUID(),
			messages,
		})
		if (!result.ok) throw new Error(result.code)
		return result.key
	}
	const askUserAnswer = (toolCallId: string): Message => ({
		id: crypto.randomUUID(),
		role: 'tool',
		toolCallId,
		content: 'Q: Which city?\nA: Paris',
	})
	/** A first run that asked with ask_user and ended; answers its key and the assistant message's id. */
	const asked = async () => {
		const key = await begin(actor, appId)
		const askingId = crypto.randomUUID()
		await saveMessages(key, [
			{
				message: {
					id: askingId,
					role: 'assistant',
					toolCalls: [
						{ id: 'call-1', type: 'function', function: { name: 'ask_user', arguments: '{}' } },
					],
				},
				status: 'complete',
			},
		])
		await done(key)
		return { key, askingId }
	}

	it('is passed over: continuedRun answers the run before it', async () => {
		const first = await begin(actor, appId)
		await finishRun(first, {
			status: 'interrupted',
			outcome: { type: 'interrupt', interrupts: [{ id: 'int-1', reason: 'input_required' }] },
			custom: [],
		})
		const refused = await answering(first.conversationId, [])
		await finishRun(refused, refusedEnd())
		expect(await continuedRun(first.conversationId)).toMatchObject({
			id: first.runId,
			status: 'interrupted',
			outcome: { type: 'interrupt', interrupts: [{ id: 'int-1', reason: 'input_required' }] },
		})
	})

	it('leaves runs without an error, or with an error without the flag, as the continued run', async () => {
		const key = await begin(actor, appId)
		expect((await continuedRun(key.conversationId))?.id).toBe(key.runId)
		await done(key)
		expect(await continuedRun(key.conversationId)).toMatchObject({ id: key.runId, error: null })
		const failed = await answering(key.conversationId, [userMessage('Again')])
		await finishRun(failed, {
			status: 'failed',
			error: { code: 'agent_rejected_input', message: 'The agent refused the request.' },
			custom: [],
		})
		expect(await continuedRun(key.conversationId)).toMatchObject({
			id: failed.runId,
			error: { code: 'agent_rejected_input', message: 'The agent refused the request.' },
		})
	})

	it('keeps the flag on the stored error and reads it back', async () => {
		const first = await begin(actor, appId)
		await done(first)
		const refused = await answering(first.conversationId, [])
		await finishRun(refused, refusedEnd())
		const [stored] = await testDb
			.select({ error: conversationRuns.error })
			.from(conversationRuns)
			.where(eq(conversationRuns.id, refused.runId))
		expect(stored?.error).toEqual(REFUSAL)
		const page = await readThreadPage(actor, appId, first.conversationId, { turns: 20 })
		expect(page?.runs.find(run => run.id === refused.runId)).toMatchObject({
			status: 'failed',
			error: REFUSAL,
		})
	})

	it('withdraws only the rows it names of this run, with the run’s end', async () => {
		const { key: first, askingId } = await asked()
		const answer = askUserAnswer('call-1')
		const unavailable = errorToolMessage('call-2', UNAVAILABLE_TOOL_ERROR, UNAVAILABLE_TOOL_CONTENT)
		const refused = await answering(first.conversationId, [unavailable, answer])
		// The first run's assistant message is named too: it is another run's row, so it stays.
		await finishRun(refused, refusedEnd([answer.id, askingId]))
		const ids = (await loadThread(first.conversationId)).map(row => row.messageId)
		expect(ids).not.toContain(answer.id)
		expect(ids).toContain(askingId)
		expect(ids).toContain(unavailable.id)
		expect(await continuedRun(first.conversationId)).toMatchObject({ id: first.runId })
		const conversation = await findConversation(actor, appId, first.conversationId)
		expect(conversation?.activeRunId).toBeNull()
		const page = await readThreadPage(actor, appId, first.conversationId, { turns: 20 })
		expect(page?.runs.find(run => run.id === refused.runId)?.status).toBe('failed')
	})

	// PostgreSQL 18 Glossary, "Atomicity": "either all its operations complete as a single unit or none do". A tool message
	// whose id is already stored breaks the end's last insert (UNIQUE (conversation_id, message_id)), so the withdrawal is
	// rolled back with the rest of the end.
	it('withdraws in the transaction that ends the run: an end that fails withdraws nothing', async () => {
		const { key: first, askingId } = await asked()
		const answer = askUserAnswer('call-1')
		const refused = await answering(first.conversationId, [answer])
		const clash = { ...askUserAnswer('call-9'), id: askingId }
		await expect(
			finishRun(refused, {
				...refusedEnd([answer.id]),
				close: { messageIds: [], toolMessages: [clash] },
			}),
		).rejects.toThrow()
		expect((await loadThread(first.conversationId)).map(row => row.messageId)).toContain(answer.id)
		expect((await continuedRun(first.conversationId))?.id).toBe(refused.runId)
		expect((await continuedRun(first.conversationId))?.status).toBe('running')
	})

	it('withdraws nothing from a run that has already ended', async () => {
		const { key: first } = await asked()
		const answer = askUserAnswer('call-1')
		const refused = await answering(first.conversationId, [answer])
		await done(refused)
		await finishRun(refused, refusedEnd([answer.id]))
		expect((await loadThread(first.conversationId)).map(row => row.messageId)).toContain(answer.id)
		expect(await continuedRun(first.conversationId)).toMatchObject({
			id: refused.runId,
			status: 'succeeded',
			error: null,
		})
	})
})

describe('the run tables, read back as written', () => {
	it('keeps the run row and the user message under the run’s id', async () => {
		const actor = actorFor()
		await insertAccount(actor)
		const key = await begin(actor, await insertApp())
		const runs = await testDb
			.select({ id: conversationRuns.id })
			.from(conversationRuns)
			.where(eq(conversationRuns.conversationId, key.conversationId))
		const messages = await testDb
			.select({ runId: conversationMessages.runId })
			.from(conversationMessages)
			.where(eq(conversationMessages.conversationId, key.conversationId))
		expect(runs).toEqual([{ id: key.runId }])
		expect(messages).toEqual([{ runId: key.runId }])
	})
})
