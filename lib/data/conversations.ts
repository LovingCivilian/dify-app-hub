import 'server-only'

import type { Message } from '@ag-ui/core'
import { MessageSchema } from '@ag-ui/core/schemas'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import * as z from 'zod'

import { getDb } from '@/db'
import { conversationMessages, conversationRuns, conversations } from '@/db/schema'
import type { SessionUser } from '@/lib/auth/session'
import type { MessageRole, MessageStatus, RunStatus } from '@/lib/chat/statuses'
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

const runErrorSchema = z.object({ code: z.string().optional(), message: z.string() })
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

/** The conversation's newest run (spec §4.3 step 1 reads its open interrupts), or null before the first. */
export async function lastRun(conversationId: string): Promise<StoredRun | null> {
	const [row] = await getDb()
		.select(runColumns)
		.from(conversationRuns)
		.where(eq(conversationRuns.conversationId, conversationId))
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
}

/**
 * Spec §3.2 steps 3 and 4, in one transaction and once: the run row is ended only while it is still running (an UPDATE
 * … WHERE status = 'running' RETURNING, so a second call, or a stale-run check racing the run's own end, writes
 * nothing); then the rows `close` names become incomplete and its tool messages are added under the run; the
 * conversation's active run is cleared where it is still this one, and its last activity is touched.
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
