import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { apps, conversationMessages, conversationRuns, conversations, users } from '@/db/schema'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterAll(() => pool.end())

/** A query's refusal as the driver reported it (the helper of schema.db.test.ts: DrizzleQueryError's `cause`, or the DatabaseError itself). */
const refusal = async (query: PromiseLike<unknown>) => {
	const error: unknown = await query.then(
		() => null,
		(caught: unknown) => caught,
	)
	const fields = (value: unknown) => value as { code?: string; constraint?: string } | undefined
	const driver = error instanceof Error && error.cause ? fields(error.cause) : fields(error)
	return { code: driver?.code, constraint: driver?.constraint }
}

/** An account, an app and a conversation of that account in that app, with one run. */
const seed = async () => {
	const userId = crypto.randomUUID()
	const appId = crypto.randomUUID()
	const conversationId = crypto.randomUUID()
	const runId = crypto.randomUUID()
	await testDb
		.insert(users)
		.values({ id: userId, email: `${userId}@example.com`, password: 'hash', role: 'user' })
	await testDb.insert(apps).values({
		id: appId,
		provider: 'dify',
		name: 'Tea',
		settings: {},
		secrets: {},
	})
	await testDb.insert(conversations).values({ id: conversationId, appId, userId, title: 'Hello' })
	await testDb.insert(conversationRuns).values({ id: runId, conversationId, status: 'running' })
	return { userId, appId, conversationId, runId }
}

const message = (conversationId: string, runId: string | null, messageId: string) => ({
	conversationId,
	runId,
	messageId,
	role: 'user' as const,
	body: { id: messageId, role: 'user', content: 'hi' },
	status: 'complete' as const,
})

const countIn = async (table: 'conversations' | 'conversation_runs' | 'conversation_messages') =>
	Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n)

describe('the conversation store (Part 2 spec §3.1)', () => {
	it('gives a conversation its defaults: an empty title, an empty state and no active run', async () => {
		const userId = crypto.randomUUID()
		const appId = crypto.randomUUID()
		await testDb
			.insert(users)
			.values({ id: userId, email: `${userId}@example.com`, password: 'hash', role: 'user' })
		await testDb
			.insert(apps)
			.values({ id: appId, provider: 'dify', name: 'Tea', settings: {}, secrets: {} })
		const id = crypto.randomUUID()
		await testDb.insert(conversations).values({ id, appId, userId })
		const [row] = await testDb.select().from(conversations).where(eq(conversations.id, id))
		expect(row).toMatchObject({ title: '', state: {}, activeRunId: null, deletedAt: null })
	})

	it('numbers messages in the order they are written (seq, spec §3.1)', async () => {
		const { conversationId, runId } = await seed()
		for (const id of ['m1', 'm2', 'm3'])
			await testDb.insert(conversationMessages).values(message(conversationId, runId, id))
		const rows = await testDb
			.select({ seq: conversationMessages.seq, messageId: conversationMessages.messageId })
			.from(conversationMessages)
			.orderBy(conversationMessages.seq)
		expect(rows.map(row => row.messageId)).toEqual(['m1', 'm2', 'm3'])
		expect(rows[0]!.seq).toBeLessThan(rows[1]!.seq)
		expect(rows[1]!.seq).toBeLessThan(rows[2]!.seq)
	})

	// PostgreSQL 18 "CREATE TABLE", GENERATED ALWAYS AS IDENTITY: a user value is taken only with OVERRIDING SYSTEM
	// VALUE; otherwise SQLSTATE 428C9 generated_always (Appendix A).
	it('refuses a seq the caller chose', async () => {
		const { conversationId } = await seed()
		expect(
			await refusal(
				pool.query(
					"INSERT INTO conversation_messages (seq, conversation_id, message_id, role, body, status) VALUES (1, $1, 'm1', 'user', '{}', 'complete')",
					[conversationId],
				),
			),
		).toEqual({ code: '428C9', constraint: undefined })
	})

	it('holds one row per message id in a conversation, and the same id in another conversation', async () => {
		const first = await seed()
		const second = await seed()
		await testDb
			.insert(conversationMessages)
			.values(message(first.conversationId, first.runId, 'm1'))
		await testDb
			.insert(conversationMessages)
			.values(message(second.conversationId, second.runId, 'm1'))
		expect(
			await refusal(
				testDb
					.insert(conversationMessages)
					.values(message(first.conversationId, first.runId, 'm1')),
			),
		).toEqual({ code: '23505', constraint: 'conversation_messages_conversation_id_message_id_key' })
	})

	it.each([
		[
			'a run status',
			(ids: Awaited<ReturnType<typeof seed>>) =>
				testDb.insert(conversationRuns).values({
					id: crypto.randomUUID(),
					conversationId: ids.conversationId,
					status: 'paused' as never,
				}),
			'conversation_runs_status_check',
		],
		[
			'a message role',
			(ids: Awaited<ReturnType<typeof seed>>) =>
				testDb
					.insert(conversationMessages)
					.values({ ...message(ids.conversationId, ids.runId, 'm9'), role: 'bot' as never }),
			'conversation_messages_role_check',
		],
		[
			'a message status',
			(ids: Awaited<ReturnType<typeof seed>>) =>
				testDb
					.insert(conversationMessages)
					.values({ ...message(ids.conversationId, ids.runId, 'm9'), status: 'draft' as never }),
			'conversation_messages_status_check',
		],
	])('refuses %s it does not know (23514)', async (_name, insert, constraint) => {
		const ids = await seed()
		expect(await refusal(insert(ids))).toEqual({ code: '23514', constraint })
	})

	// Spec §3.4: deleting an app or an account removes its conversations at once, with their runs and messages.
	it('removes an app’s conversations, runs and messages with the app', async () => {
		const { appId, conversationId, runId } = await seed()
		await testDb.insert(conversationMessages).values(message(conversationId, runId, 'm1'))
		await testDb.delete(apps).where(eq(apps.id, appId))
		expect([
			await countIn('conversations'),
			await countIn('conversation_runs'),
			await countIn('conversation_messages'),
		]).toEqual([0, 0, 0])
	})

	it('removes an account’s conversations, runs and messages with the account', async () => {
		const { userId, conversationId, runId } = await seed()
		await testDb.insert(conversationMessages).values(message(conversationId, runId, 'm1'))
		await testDb.delete(users).where(eq(users.id, userId))
		expect([
			await countIn('conversations'),
			await countIn('conversation_runs'),
			await countIn('conversation_messages'),
		]).toEqual([0, 0, 0])
	})
})
