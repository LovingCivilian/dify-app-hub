import 'server-only'

import type { Message } from '@ag-ui/core'
import { MessageSchema } from '@ag-ui/core/schemas'
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import * as z from 'zod'

import { getDb } from '@/db'
import { conversationMessages, conversationRuns, conversations } from '@/db/schema'
import type { SessionUser } from '@/lib/auth/session'
import {
	PURGE_AFTER_DAYS,
	type MessageRole,
	type MessageStatus,
	type RunStatus,
} from '@/lib/chat/statuses'
import {
	errorToolMessage,
	STOPPED_TOOL_CONTENT,
	STOPPED_TOOL_ERROR,
	unansweredToolCalls,
} from '@/lib/chat/thread'

/*
 * The conversation store's Data Access Layer (Part 2 spec §3, ADR-0024, ADR-0033). The reads and writes a user reaches
 * take the verified actor first and match only the actor's own conversation of the app, not deleted (spec §4.1:
 * otherwise 404 conversation_not_found); a run's later writes are keyed by the RunKey that startRun answered after it
 * checked the actor, and the daily purge takes no actor, as the directory sync's writes do. Every message is checked
 * with @ag-ui/core's MessageSchema on every write and every read (spec §3.1), as the apps' documents are checked with
 * their provider's schemas (decision 17): never stored, never answered half-typed. A refusal is logged by where it is,
 * never by what it holds (OWASP Logging Cheat Sheet, "Data to exclude").
 */

export interface RunError {
	code?: string
	message: string
	/** P10: the agent never started this run (refused before its stream, or the hub failed before sending it). */
	beforeStream?: true
}

export interface CustomRecord {
	name: string
	value: unknown
}

export interface ConversationRecord {
	id: string
	appId: string
	title: string
	state: unknown
	activeRunId: string | null
	updatedAt: Date
}

export interface StoredRun {
	id: string
	status: RunStatus
	/** RUN_FINISHED.outcome as received. */
	outcome: unknown
	error: RunError | null
	custom: CustomRecord[]
	startedAt: Date
	finishedAt: Date | null
}

export interface StoredMessage {
	seq: number
	messageId: string
	runId: string | null
	role: MessageRole
	body: Message
	status: MessageStatus
}

/** The handle startRun answers; the run's later writes are keyed by it (the actor was verified at the start). */
export interface RunKey {
	conversationId: string
	runId: string
}

// zod 4 "Literals" (`z.literal(true)`) and "Objects" (an object drops keys it does not declare): the refusal flag reads
// back only as `true`, the one value the hub writes (plan call P10).
const runErrorSchema = z.object({
	code: z.string().optional(),
	message: z.string(),
	beforeStream: z.literal(true).optional(),
})
// zod 4 "Unknown": "As object properties, their keys are required, matching `{ a: any }` in TypeScript", which is
// CustomRecord's shape; AG-UI's CUSTOM event requires `value` too ("Events", CUSTOM).
const customSchema = z.array(z.object({ name: z.string(), value: z.unknown() }))

const readRunError = (value: unknown): RunError | null => {
	const parsed = runErrorSchema.safeParse(value)
	return parsed.success ? parsed.data : null
}

const readCustom = (value: unknown): CustomRecord[] => {
	const parsed = customSchema.safeParse(value)
	return parsed.success ? parsed.data : []
}

/**
 * Whether a value is an AG-UI 1.0 message (`@ag-ui/core/schemas` MessageSchema, which keeps fields it does not know,
 * `encryptedValue` included: its objects are `z.looseObject`). The value itself is kept, typed, when it passes.
 */
const asMessage = (value: unknown): Message | null =>
	MessageSchema.safeParse(value).success ? (value as Message) : null

const conversationColumns = {
	id: conversations.id,
	appId: conversations.appId,
	title: conversations.title,
	state: conversations.state,
	activeRunId: conversations.activeRunId,
	updatedAt: conversations.updatedAt,
}

const runColumns = {
	id: conversationRuns.id,
	status: conversationRuns.status,
	outcome: conversationRuns.outcome,
	error: conversationRuns.error,
	custom: conversationRuns.custom,
	startedAt: conversationRuns.startedAt,
	finishedAt: conversationRuns.finishedAt,
}

const messageColumns = {
	seq: conversationMessages.seq,
	messageId: conversationMessages.messageId,
	runId: conversationMessages.runId,
	role: conversationMessages.role,
	body: conversationMessages.body,
	status: conversationMessages.status,
}

type RunRow = Omit<StoredRun, 'error' | 'custom'> & { error: unknown; custom: unknown }

const toStoredRun = (row: RunRow): StoredRun => ({
	...row,
	error: readRunError(row.error),
	custom: readCustom(row.custom),
})

type MessageRow = Omit<StoredMessage, 'body'> & { body: unknown }

/** The rows whose body reads as an AG-UI message; another is skipped and logged by its place (spec §3.1). */
const readMessages = (conversationId: string, rows: readonly MessageRow[]): StoredMessage[] =>
	rows.flatMap(row => {
		const body = asMessage(row.body)
		if (body) return [{ ...row, body }]
		console.error('Stored conversation message refused:', { conversationId, seq: row.seq })
		return []
	})

/** The actor's own conversation of the app, not deleted (spec §4.1): the only conversation a user's request reaches. */
const ownedBy = (actor: Pick<SessionUser, 'id'>, appId: string, conversationId: string) =>
	and(
		eq(conversations.id, conversationId),
		eq(conversations.appId, appId),
		eq(conversations.userId, actor.id),
		isNull(conversations.deletedAt),
	)

/** The actor's conversation of this app, or null when it is missing, another's, of another app, or deleted. */
export async function findConversation(
	actor: SessionUser,
	appId: string,
	conversationId: string,
): Promise<ConversationRecord | null> {
	const [row] = await getDb()
		.select(conversationColumns)
		.from(conversations)
		.where(ownedBy(actor, appId, conversationId))
		.limit(1)
	return row ?? null
}

/**
 * The run the conversation continues from (spec §4.3 step 1 reads its open interrupts; plan call P10, decision 62): its
 * newest run the agent started, so a run refused before its stream is passed over and what it answered stays open; null
 * before the first. `error ->> 'beforeStream'` is the flag as text, and NULL when `error` is NULL or has no such key
 * (PostgreSQL 18 "JSON Functions and Operators", Table 9.47 and its note: the extraction operators "return NULL, rather
 * than failing"), which `coalesce` reads as not refused. The condition is a Drizzle `sql` template inside `and()`
 * (Drizzle "Magical sql operator": the column is mapped to its escaped name; the template holds no value).
 */
export async function continuedRun(conversationId: string): Promise<StoredRun | null> {
	const [row] = await getDb()
		.select(runColumns)
		.from(conversationRuns)
		.where(
			and(
				eq(conversationRuns.conversationId, conversationId),
				sql`coalesce(${conversationRuns.error} ->> 'beforeStream', 'false') <> 'true'`,
			),
		)
		.orderBy(desc(conversationRuns.startedAt), desc(conversationRuns.id))
		.limit(1)
	return row ? toStoredRun(row) : null
}

/** Every stored message of the conversation in `seq` order (spec §3.3: what the next RunAgentInput is built from). */
export async function loadThread(conversationId: string): Promise<StoredMessage[]> {
	const rows = await getDb()
		.select(messageColumns)
		.from(conversationMessages)
		.where(eq(conversationMessages.conversationId, conversationId))
		.orderBy(asc(conversationMessages.seq))
	return readMessages(conversationId, rows)
}

export interface StartRunInput {
	appId: string
	/** An existing conversation (already found for this actor), or a new one with the hub's id and the message's title. */
	conversation: { id: string } | { id: string; title: string; isNew: true }
	runId: string
	/** Inserted with run_id = runId, status complete, in this order: the answers' or the hub's tool messages, then the user message. */
	messages: Message[]
	resume?: unknown
}

export type StartRunResult =
	| { ok: true; key: RunKey }
	| { ok: false; code: 'run_in_progress' | 'conversation_not_found' }

/**
 * Spec §3.2 step 1, in one transaction: a new conversation is created owned by the actor; an existing one is locked
 * (PostgreSQL 18 "Explicit Locking", 13.3.2: FOR UPDATE "prevents them from being locked, modified or deleted by other
 * transactions until the current transaction ends"), so of two runs started at once the second reads the active run
 * the first set and is refused with run_in_progress. Then the given messages, one INSERT each in order, so their `seq`
 * follows the order given (an identity column draws from a sequence: PostgreSQL 18 "CREATE TABLE", "nextval"); the run
 * as running with the answers it was started with; the conversation's active run and last activity. A message the
 * AG-UI schema refuses is the hub's own fault here (the hub built it), so it throws before anything is written.
 */
export async function startRun(actor: SessionUser, input: StartRunInput): Promise<StartRunResult> {
	if (input.messages.some(message => !asMessage(message)))
		throw new Error('startRun: a message the hub built is not an AG-UI message')
	const conversationId = input.conversation.id
	const now = new Date()
	return getDb().transaction(async (tx): Promise<StartRunResult> => {
		if ('isNew' in input.conversation) {
			await tx.insert(conversations).values({
				id: conversationId,
				appId: input.appId,
				userId: actor.id,
				title: input.conversation.title,
				createdAt: now,
				updatedAt: now,
			})
		} else {
			const [locked] = await tx
				.select({ activeRunId: conversations.activeRunId })
				.from(conversations)
				.where(ownedBy(actor, input.appId, conversationId))
				.limit(1)
				.for('update')
			if (!locked) return { ok: false, code: 'conversation_not_found' }
			if (locked.activeRunId) return { ok: false, code: 'run_in_progress' }
		}
		await tx.insert(conversationRuns).values({
			id: input.runId,
			conversationId,
			status: 'running',
			resume: input.resume ?? null,
		})
		for (const message of input.messages)
			await tx.insert(conversationMessages).values({
				conversationId,
				runId: input.runId,
				messageId: message.id,
				role: message.role,
				body: message,
				status: 'complete',
				createdAt: now,
				updatedAt: now,
			})
		await tx
			.update(conversations)
			.set({ activeRunId: input.runId, updatedAt: now })
			.where(eq(conversations.id, conversationId))
		return { ok: true, key: { conversationId, runId: input.runId } }
	})
}

/**
 * Spec §3.2 step 2: each message upserted by its AG-UI id (PostgreSQL 18 "INSERT", ON CONFLICT … DO UPDATE, with
 * EXCLUDED for "the row proposed for insertion"; Drizzle "Upsert Query", `sql.raw(\`excluded.${column.name}\`)`). A new
 * message is numbered after the others; an existing one keeps its `seq` and the run that first wrote it, and takes the
 * new body and status. In one transaction, in the order given (the agent's message list), so one flush is all or
 * nothing. A message the AG-UI schema refuses is not written, and logged by the run's ids.
 */
export async function saveMessages(
	key: RunKey,
	rows: { message: Message; status: MessageStatus }[],
): Promise<void> {
	const accepted = rows.filter(({ message }) => {
		if (asMessage(message)) return true
		console.error('Conversation message refused:', {
			conversationId: key.conversationId,
			runId: key.runId,
		})
		return false
	})
	if (!accepted.length) return
	const now = new Date()
	await getDb().transaction(async tx => {
		for (const { message, status } of accepted)
			await tx
				.insert(conversationMessages)
				.values({
					conversationId: key.conversationId,
					runId: key.runId,
					messageId: message.id,
					role: message.role,
					body: message,
					status,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [conversationMessages.conversationId, conversationMessages.messageId],
					set: {
						body: sql.raw(`excluded.${conversationMessages.body.name}`),
						status: sql.raw(`excluded.${conversationMessages.status.name}`),
						updatedAt: sql.raw(`excluded.${conversationMessages.updatedAt.name}`),
					},
				})
	})
}

/**
 * Spec §3.2 step 2: the agent's state, written when it changes. AG-UI state is any JSON value, null included ("State");
 * Drizzle writes a JS null as SQL NULL, which the NOT NULL column refuses, so the value goes as JSON text cast to jsonb
 * (PostgreSQL 18 "JSON Types": `'null'::jsonb` is the JSON null).
 */
export async function saveState(key: RunKey, state: unknown): Promise<void> {
	await getDb()
		.update(conversations)
		.set({ state: sql`${JSON.stringify(state ?? null)}::jsonb` })
		.where(eq(conversations.id, key.conversationId))
}

export interface RunEnd {
	status: Exclude<RunStatus, 'running'>
	outcome?: unknown
	error?: RunError
	usage?: unknown
	custom: CustomRecord[]
	/** Stop, failure or truncation (spec §3.2 step 4): rows to mark incomplete, and the tool messages that answer cut-off calls. */
	close?: { messageIds: string[]; toolMessages: Message[] }
	/** P10: message ids this run carried that the agent never received; deleted with the run's end. */
	withdraw?: string[]
}

/**
 * Spec §3.2 steps 3 and 4, in one transaction and once: the run row is ended only while it is still running (an UPDATE
 * … WHERE status = 'running' RETURNING, so a second call, or a stale-run check racing the run's own end, writes
 * nothing); then the rows `withdraw` names are deleted, only this run's own (plan call P10: the answers of a run the
 * agent never started go, so their items stay open, and no request sees the run ended with them still stored); the rows
 * `close` names become incomplete and its tool messages are added under the run; the conversation's active run is
 * cleared where it is still this one, and its last activity is touched.
 */
export async function finishRun(key: RunKey, end: RunEnd): Promise<void> {
	const now = new Date()
	await getDb().transaction(async tx => {
		const ended = await tx
			.update(conversationRuns)
			.set({
				status: end.status,
				outcome: end.outcome ?? null,
				error: end.error ?? null,
				usage: end.usage ?? null,
				custom: end.custom,
				finishedAt: now,
			})
			.where(
				and(
					eq(conversationRuns.id, key.runId),
					eq(conversationRuns.conversationId, key.conversationId),
					eq(conversationRuns.status, 'running'),
				),
			)
			.returning({ id: conversationRuns.id })
		if (!ended.length) return
		const withdraw = end.withdraw ?? []
		// Drizzle "Delete" (`.delete(table).where(…)`) with `and`, `eq` and `inArray` (Drizzle "Filters").
		if (withdraw.length)
			await tx
				.delete(conversationMessages)
				.where(
					and(
						eq(conversationMessages.conversationId, key.conversationId),
						eq(conversationMessages.runId, key.runId),
						inArray(conversationMessages.messageId, withdraw),
					),
				)
		const messageIds = end.close?.messageIds ?? []
		if (messageIds.length)
			await tx
				.update(conversationMessages)
				.set({ status: 'incomplete', updatedAt: now })
				.where(
					and(
						eq(conversationMessages.conversationId, key.conversationId),
						inArray(conversationMessages.messageId, messageIds),
					),
				)
		for (const message of end.close?.toolMessages ?? [])
			await tx.insert(conversationMessages).values({
				conversationId: key.conversationId,
				runId: key.runId,
				messageId: message.id,
				role: message.role,
				body: message,
				status: 'complete',
				createdAt: now,
				updatedAt: now,
			})
		await tx
			.update(conversations)
			.set({ activeRunId: null, updatedAt: now })
			.where(
				and(eq(conversations.id, key.conversationId), eq(conversations.activeRunId, key.runId)),
			)
	})
}

/**
 * Spec §3.2 step 5: a run stored as running that no process holds (the server stopped mid-run) becomes truncated. What
 * it left open is closed as a stop closes it (step 4): its streaming rows become incomplete, and each call of its own
 * assistant messages without a result is answered as stopped. Calls of earlier runs are not this run's to answer.
 */
export async function truncateStaleRun(key: RunKey): Promise<void> {
	const thread = await loadThread(key.conversationId)
	const own = thread.filter(row => row.runId === key.runId)
	const ownCalls = new Set(
		own.flatMap(row =>
			row.body.role === 'assistant' ? (row.body.toolCalls ?? []).map(call => call.id) : [],
		),
	)
	await finishRun(key, {
		status: 'truncated',
		custom: [],
		close: {
			messageIds: own.filter(row => row.status === 'streaming').map(row => row.messageId),
			toolMessages: unansweredToolCalls(thread.map(row => row.body))
				.filter(call => ownCalls.has(call.toolCallId))
				.map(call => errorToolMessage(call.toolCallId, STOPPED_TOOL_ERROR, STOPPED_TOOL_CONTENT)),
		},
	})
}

/* ----- The browser's reads, rename and delete (spec §3.3, §3.4, §4.2) ----- */

/** Plan call P8: the list answers at most the newest 100 conversations a page (Dify's sidebar limit). */
export const LIST_PAGE_MAX = 100

/** Plan call P8: a history page holds the latest 20 user turns and what follows each. */
export const THREAD_PAGE_TURNS = 20

export interface ConversationListItem {
	id: string
	title: string
	/** ISO 8601 (Date.prototype.toISOString). */
	updatedAt: string
}

const listCursorSchema = z.tuple([z.iso.datetime(), z.uuid()])

/**
 * The list's keyset cursor (spec §4.2: "keyset-paged on `(updated_at, id)`"): the last item's two keys as JSON, in
 * base64url so the browser carries it as one opaque query value (Node.js "Buffer", 'base64url' encoding). A conversation's
 * `updated_at` always comes from a JS Date (db/schema/conversations.ts), so the millisecond ISO string is its exact value.
 */
export const encodeListCursor = (updatedAt: Date, id: string): string =>
	Buffer.from(JSON.stringify([updatedAt.toISOString(), id])).toString('base64url')

/** The cursor's two keys, or null for anything this module did not write (zod 4 `z.iso.datetime()`, `z.uuid()`). */
export const decodeListCursor = (value: string): { updatedAt: Date; id: string } | null => {
	let raw: unknown
	try {
		raw = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
	} catch {
		return null
	}
	const parsed = listCursorSchema.safeParse(raw)
	return parsed.success ? { updatedAt: new Date(parsed.data[0]), id: parsed.data[1] } : null
}

/**
 * The actor's conversations of the app, not deleted, newest first (spec §4.2), on the `(user_id, app_id, updated_at)`
 * index (spec §3.1). The keyset condition is a row comparison, `(updated_at, id) < (cursor)`, which compares left to
 * right (PostgreSQL 18 "Row Constructor Comparison"), so ties on `updated_at` go by id and no row is skipped or
 * repeated; one row more than the page tells whether another page follows. A cursor that does not decode answers an
 * empty page (the route refuses one first, Task 11).
 */
export async function listConversations(
	actor: SessionUser,
	appId: string,
	page: { cursor?: string; limit: number },
): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
	const limit = Math.min(Math.max(Math.trunc(page.limit), 1), LIST_PAGE_MAX)
	const after = page.cursor === undefined ? null : decodeListCursor(page.cursor)
	if (page.cursor !== undefined && !after) return { items: [], nextCursor: null }
	const rows = await getDb()
		.select({
			id: conversations.id,
			title: conversations.title,
			updatedAt: conversations.updatedAt,
		})
		.from(conversations)
		.where(
			and(
				eq(conversations.userId, actor.id),
				eq(conversations.appId, appId),
				isNull(conversations.deletedAt),
				after
					? sql`(${conversations.updatedAt}, ${conversations.id}) < (${after.updatedAt}::timestamptz, ${after.id}::uuid)`
					: undefined,
			),
		)
		.orderBy(desc(conversations.updatedAt), desc(conversations.id))
		.limit(limit + 1)
	const items = rows.slice(0, limit)
	const last = items.at(-1)
	return {
		items: items.map(row => ({
			id: row.id,
			title: row.title,
			updatedAt: row.updatedAt.toISOString(),
		})),
		nextCursor: rows.length > limit && last ? encodeListCursor(last.updatedAt, last.id) : null,
	}
}

export interface ThreadPage {
	conversation: ConversationRecord
	rows: StoredMessage[]
	runs: StoredRun[]
	/** The seq of the oldest user message shown, as a string; null when nothing is older (plan call P8). */
	cursor: string | null
}

/**
 * A page of the actor's conversation (spec §3.3, §4.2; plan call P8): the latest `turns` user messages before `before`
 * (a `seq`), and every row from the oldest of them on, so a page holds whole turns; the cursor names that oldest user
 * message while an older one exists. The runs are the ones started from that user message's run on (and before
 * `before`'s), message-less runs included, such as one the agent refused before its stream, so each turn shows every
 * run that answered it. Null when the conversation is not the actor's of this app, or deleted.
 */
export async function readThreadPage(
	actor: SessionUser,
	appId: string,
	conversationId: string,
	page: { before?: number; turns: number },
): Promise<ThreadPage | null> {
	const conversation = await findConversation(actor, appId, conversationId)
	if (!conversation) return null
	const db = getDb()
	const inConversation = eq(conversationMessages.conversationId, conversationId)
	const beforeCursor =
		page.before === undefined ? undefined : lt(conversationMessages.seq, page.before)
	const starts = await db
		.select({ seq: conversationMessages.seq })
		.from(conversationMessages)
		.where(and(inConversation, eq(conversationMessages.role, 'user'), beforeCursor))
		.orderBy(desc(conversationMessages.seq))
		.limit(page.turns + 1)
	const first = starts.slice(0, page.turns).at(-1)?.seq
	if (first === undefined) return { conversation, rows: [], runs: [], cursor: null }
	const rows = readMessages(
		conversationId,
		await db
			.select(messageColumns)
			.from(conversationMessages)
			.where(and(inConversation, gte(conversationMessages.seq, first), beforeCursor))
			.orderBy(asc(conversationMessages.seq)),
	)
	/** When the run of the user message at `seq` started; undefined when it has none. */
	const runStart = async (seq: number) => {
		const [row] = await db
			.select({ startedAt: conversationRuns.startedAt })
			.from(conversationMessages)
			.innerJoin(conversationRuns, eq(conversationRuns.id, conversationMessages.runId))
			.where(and(inConversation, eq(conversationMessages.seq, seq)))
			.limit(1)
		return row?.startedAt
	}
	const from = await runStart(first)
	const to = page.before === undefined ? undefined : await runStart(page.before)
	const runs = await db
		.select(runColumns)
		.from(conversationRuns)
		.where(
			and(
				eq(conversationRuns.conversationId, conversationId),
				from ? gte(conversationRuns.startedAt, from) : undefined,
				to ? lt(conversationRuns.startedAt, to) : undefined,
			),
		)
		.orderBy(asc(conversationRuns.startedAt), asc(conversationRuns.id))
	return {
		conversation,
		rows,
		runs: runs.map(toStoredRun),
		cursor: starts.length > page.turns ? String(first) : null,
	}
}

/**
 * Renames the actor's conversation (spec §4.2, a Server Action's write: Task 12 checks the title, at most
 * TITLE_MAX_LENGTH characters). Only the title: a rename is not activity, so `updated_at` stays (spec §3.1). False when
 * no such conversation is the actor's (node-postgres "Result": `rowCount` may be null).
 */
export async function renameConversation(
	actor: SessionUser,
	appId: string,
	conversationId: string,
	title: string,
): Promise<boolean> {
	const result = await getDb()
		.update(conversations)
		.set({ title: title.trim() })
		.where(ownedBy(actor, appId, conversationId))
	return (result.rowCount ?? 0) > 0
}

/**
 * The user's delete (spec §3.4; decision 49): sets `deleted_at`, so the conversation leaves the user's list at once;
 * its runs and messages stay for the admins' Logs (2c) until the purge. A second delete answers false.
 */
export async function softDeleteConversation(
	actor: SessionUser,
	appId: string,
	conversationId: string,
): Promise<boolean> {
	const result = await getDb()
		.update(conversations)
		.set({ deletedAt: new Date() })
		.where(ownedBy(actor, appId, conversationId))
	return (result.rowCount ?? 0) > 0
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The daily job's delete (spec §3.4; lib/chat/purge.ts runs it): conversations deleted more than PURGE_AFTER_DAYS
 * before `now`; their runs and messages go with them (ON DELETE CASCADE, PostgreSQL 18 "Foreign Keys"). `deleted_at <
 * cutoff` is never true for a NULL `deleted_at` (PostgreSQL 18 "Comparison Operators": a comparison with NULL yields
 * NULL), so a conversation that was not deleted is never purged. No actor: the system runs it, as the directory sync
 * writes. Answers how many were deleted.
 */
export async function purgeDeletedConversations(now: Date = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * DAY_MS)
	const result = await getDb().delete(conversations).where(lt(conversations.deletedAt, cutoff))
	return result.rowCount ?? 0
}
