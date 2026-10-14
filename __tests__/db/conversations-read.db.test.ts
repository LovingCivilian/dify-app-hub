import type { Message } from '@ag-ui/core'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', async () => {
	const { testDb } = await import('./database')
	return { getDb: () => testDb }
})

import { apps, conversationMessages, conversationRuns, conversations, users } from '@/db/schema'
import {
	decodeListCursor,
	encodeListCursor,
	findConversation,
	listConversations,
	purgeDeletedConversations,
	readThreadPage,
	renameConversation,
	softDeleteConversation,
} from '@/lib/data/conversations'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterAll(() => pool.end())

const DAY_MS = 24 * 60 * 60 * 1000

const actorFor = () => ({
	id: crypto.randomUUID(),
	email: `${crypto.randomUUID()}@example.com`,
	name: null,
	role: 'user' as const,
	source: 'local' as const,
})
type Actor = ReturnType<typeof actorFor>

const insertAccount = async (actor: Actor) => {
	await testDb
		.insert(users)
		.values({ id: actor.id, email: actor.email, password: 'hash', role: 'user' })
	return actor
}

const insertApp = async () => {
	const id = crypto.randomUUID()
	await testDb.insert(apps).values({ id, provider: 'dify', name: 'Tea', settings: {}, secrets: {} })
	return id
}

/** A conversation written as the store writes one, with the given last activity. */
const insertConversation = async (
	actor: Actor,
	appId: string,
	over: Partial<typeof conversations.$inferInsert> = {},
) => {
	const id = over.id ?? crypto.randomUUID()
	await testDb
		.insert(conversations)
		.values({ id, appId, userId: actor.id, title: 'Chat', updatedAt: new Date(), ...over })
	return id
}

const insertRun = async (conversationId: string, startedAt: Date) => {
	const id = crypto.randomUUID()
	await testDb
		.insert(conversationRuns)
		.values({ id, conversationId, status: 'succeeded', startedAt, finishedAt: startedAt })
	return id
}

const insertMessage = async (conversationId: string, runId: string, body: Message) => {
	const [row] = await testDb
		.insert(conversationMessages)
		.values({
			conversationId,
			runId,
			messageId: body.id,
			role: body.role,
			body,
			status: 'complete',
		})
		.returning({ seq: conversationMessages.seq })
	return row!.seq
}

/** One turn: a run started at `startedAt`, its user message and the assistant's answer. Answers the user message's seq. */
const insertTurn = async (conversationId: string, startedAt: Date, text: string) => {
	const runId = await insertRun(conversationId, startedAt)
	const seq = await insertMessage(conversationId, runId, {
		id: crypto.randomUUID(),
		role: 'user',
		content: text,
	})
	await insertMessage(conversationId, runId, {
		id: crypto.randomUUID(),
		role: 'assistant',
		content: `Re: ${text}`,
	})
	return { runId, seq }
}

describe('the conversation list (spec §4.2)', () => {
	it('lists the actor’s conversations of the app, newest first, without deleted ones or others’', async () => {
		const actor = await insertAccount(actorFor())
		const stranger = await insertAccount(actorFor())
		const appId = await insertApp()
		const otherApp = await insertApp()
		const now = Date.now()
		const old = await insertConversation(actor, appId, { updatedAt: new Date(now - 3000) })
		const recent = await insertConversation(actor, appId, { updatedAt: new Date(now - 1000) })
		await insertConversation(actor, appId, { deletedAt: new Date() })
		await insertConversation(stranger, appId)
		await insertConversation(actor, otherApp)
		const page = await listConversations(actor, appId, { limit: 100 })
		expect(page.items.map(item => item.id)).toEqual([recent, old])
		expect(page.items[0]).toEqual({
			id: recent,
			title: 'Chat',
			updatedAt: new Date(now - 1000).toISOString(),
		})
		expect(page.nextCursor).toBeNull()
	})

	// PostgreSQL 18 "Row Constructor Comparison": (a, b) < (c, d) compares left to right, so equal updated_at values are
	// ordered by id and no conversation is skipped or repeated across pages.
	it('pages with a keyset cursor on (updated_at, id): every conversation once, ties by id', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const tie = new Date(Date.now() - 5000)
		const ids = [
			await insertConversation(actor, appId, { updatedAt: tie }),
			await insertConversation(actor, appId, { updatedAt: tie }),
			await insertConversation(actor, appId, { updatedAt: new Date(tie.getTime() - 1) }),
		]
		const first = await listConversations(actor, appId, { limit: 2 })
		expect(first.nextCursor).not.toBeNull()
		const second = await listConversations(actor, appId, { cursor: first.nextCursor!, limit: 2 })
		expect(second.nextCursor).toBeNull()
		const seen = [...first.items, ...second.items].map(item => item.id)
		const tied = ids.slice(0, 2).sort().reverse()
		expect(seen).toEqual([...tied, ids[2]])
	})

	it('answers an empty page for a cursor that does not decode, and decodes its own cursors', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		await insertConversation(actor, appId)
		expect(await listConversations(actor, appId, { cursor: 'not-a-cursor', limit: 10 })).toEqual({
			items: [],
			nextCursor: null,
		})
		const at = new Date('2026-10-14T10:00:00.123Z')
		const id = crypto.randomUUID()
		expect(decodeListCursor(encodeListCursor(at, id))).toEqual({ updatedAt: at, id })
		expect(decodeListCursor(Buffer.from('["yesterday","x"]').toString('base64url'))).toBeNull()
	})
})

describe('a page of history (spec §3.3, plan call P8)', () => {
	it('answers the latest turns from a user message on, and a cursor to the older ones', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		const base = Date.now() - 60_000
		const turn1 = await insertTurn(conversationId, new Date(base), 'one')
		const turn2 = await insertTurn(conversationId, new Date(base + 1000), 'two')
		// A run that wrote no message (refused before its stream) after the second turn's.
		const silent = await insertRun(conversationId, new Date(base + 1500))
		const turn3 = await insertTurn(conversationId, new Date(base + 2000), 'three')

		const latest = await readThreadPage(actor, appId, conversationId, { turns: 2 })
		expect(latest?.cursor).toBe(String(turn2.seq))
		expect(latest?.rows.map(row => row.body.role)).toEqual([
			'user',
			'assistant',
			'user',
			'assistant',
		])
		expect(latest?.rows[0]!.seq).toBe(turn2.seq)
		expect(latest?.runs.map(run => run.id)).toEqual([turn2.runId, silent, turn3.runId])
		expect(latest?.conversation.id).toBe(conversationId)

		const older = await readThreadPage(actor, appId, conversationId, {
			before: Number(latest!.cursor),
			turns: 2,
		})
		expect(older?.cursor).toBeNull()
		expect(older?.rows.map(row => row.seq)).toEqual([turn1.seq, turn1.seq + 1])
		expect(older?.runs.map(run => run.id)).toEqual([turn1.runId])
	})

	it('answers null for another account’s conversation, another app’s, or a deleted one', async () => {
		const actor = await insertAccount(actorFor())
		const stranger = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		const deleted = await insertConversation(actor, appId, { deletedAt: new Date() })
		expect(await readThreadPage(stranger, appId, conversationId, { turns: 20 })).toBeNull()
		expect(await readThreadPage(actor, await insertApp(), conversationId, { turns: 20 })).toBeNull()
		expect(await readThreadPage(actor, appId, deleted, { turns: 20 })).toBeNull()
	})

	it('answers an empty page for a conversation without messages', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		expect(await readThreadPage(actor, appId, conversationId, { turns: 20 })).toMatchObject({
			rows: [],
			runs: [],
			cursor: null,
		})
	})
})

describe('rename and delete (spec §4.2, §3.4)', () => {
	it('renames the actor’s conversation, trimmed, and leaves its last activity as it was', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const updatedAt = new Date(Date.now() - 10_000)
		const id = await insertConversation(actor, appId, { updatedAt })
		expect(await renameConversation(actor, appId, id, '  Trip plans ')).toBe(true)
		expect(await findConversation(actor, appId, id)).toMatchObject({
			title: 'Trip plans',
			updatedAt,
		})
	})

	it('renames and deletes nothing of another account, another app, or already deleted', async () => {
		const actor = await insertAccount(actorFor())
		const stranger = await insertAccount(actorFor())
		const appId = await insertApp()
		const id = await insertConversation(actor, appId)
		expect(await renameConversation(stranger, appId, id, 'Mine')).toBe(false)
		expect(await softDeleteConversation(stranger, appId, id)).toBe(false)
		expect(await renameConversation(actor, await insertApp(), id, 'Mine')).toBe(false)
		expect(await softDeleteConversation(actor, appId, id)).toBe(true)
		expect(await softDeleteConversation(actor, appId, id)).toBe(false)
		expect(await renameConversation(actor, appId, id, 'Mine')).toBe(false)
	})

	it('soft-deletes: the conversation leaves the list at once, its runs and messages stay', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const updatedAt = new Date(Date.now() - 10_000)
		const id = await insertConversation(actor, appId, { updatedAt })
		await insertTurn(id, new Date(), 'hello')
		expect(await softDeleteConversation(actor, appId, id)).toBe(true)
		expect((await listConversations(actor, appId, { limit: 100 })).items).toEqual([])
		expect(await findConversation(actor, appId, id)).toBeNull()
		const [row] = await testDb
			.select({ deletedAt: conversations.deletedAt, updatedAt: conversations.updatedAt })
			.from(conversations)
			.where(eq(conversations.id, id))
		expect(row?.deletedAt).toBeInstanceOf(Date)
		expect(row?.updatedAt).toEqual(updatedAt)
		const messages = await testDb
			.select({ seq: conversationMessages.seq })
			.from(conversationMessages)
			.where(eq(conversationMessages.conversationId, id))
		expect(messages).toHaveLength(2)
	})
})

describe('the purge (spec §3.4)', () => {
	it('deletes conversations deleted more than 30 days ago, with their runs and messages, and counts them', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const now = new Date('2026-11-20T03:00:00Z')
		const expired = await insertConversation(actor, appId, {
			deletedAt: new Date(now.getTime() - 31 * DAY_MS),
		})
		await insertTurn(expired, new Date(now.getTime() - 40 * DAY_MS), 'old')
		const recent = await insertConversation(actor, appId, {
			deletedAt: new Date(now.getTime() - 29 * DAY_MS),
		})
		const live = await insertConversation(actor, appId)
		expect(await purgeDeletedConversations(now)).toBe(1)
		const left = await testDb.select({ id: conversations.id }).from(conversations)
		expect(left.map(row => row.id).sort()).toEqual([recent, live].sort())
		const { rows } = await pool.query<{ runs: string; messages: string }>(
			'SELECT (SELECT count(*) FROM conversation_runs WHERE conversation_id = $1) AS runs, (SELECT count(*) FROM conversation_messages WHERE conversation_id = $1) AS messages',
			[expired],
		)
		expect(rows[0]).toEqual({ runs: '0', messages: '0' })
	})
})
