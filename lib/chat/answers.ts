import 'server-only'

import { buildResumeArray, isInterruptExpired } from '@ag-ui/client'
import type { Interrupt, Message, ResumeEntry } from '@ag-ui/core'
import { InterruptSchema } from '@ag-ui/core/schemas'

import type { StoredRun } from '@/lib/data/conversations'

import type { RunBody } from './schemas'

/** What a conversation waits for (spec §4.3 step 1): 2a, its last run's open interrupts; 2b adds the hub's own tool calls. */
export type OpenItems = { interrupts: Interrupt[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The open interrupts (spec §3.3): those of the last run when it ended on an interrupt, read from the stored
 * `RUN_FINISHED.outcome` (Task 5 stores it as received) with the protocol's own schema (`@ag-ui/core/schemas`
 * `InterruptSchema`); an entry it refuses is left out, so a stored value never reaches the agent unread.
 */
export const openItemsOf = (run: StoredRun | null): OpenItems => {
	if (!run || run.status !== 'interrupted' || !isRecord(run.outcome)) return { interrupts: [] }
	// If every stored interrupt fails the schema, nothing is open: a message is accepted and answers get answers_invalid (safe: Task 10 stores the outcome as received).
	const listed = Array.isArray(run.outcome.interrupts) ? run.outcome.interrupts : []
	return {
		interrupts: listed.flatMap(entry => {
			const parsed = InterruptSchema.safeParse(entry)
			return parsed.success ? [parsed.data] : []
		}),
	}
}

type Answers = NonNullable<RunBody['answers']>

/**
 * Spec §4.3 step 1: the answers must cover every open item, with no unknown or expired id. AG-UI: "The resume list MUST
 * cover every interrupt"; @ag-ui/client's `buildResumeArray` builds `resume[]` in the interrupts' order and throws for a
 * missing or unknown id, and `isInterruptExpired` is its expiry rule (an expired interrupt can only be cancelled, as its
 * `runAgent` enforces). An id given twice is refused first (a record would keep one of them). Plan call P4: 2a has no
 * open tool calls, so any tool result names an unknown call. Answers to nothing are refused: they would start a run
 * with nothing new in it.
 */
export const checkAnswers = (
	open: OpenItems,
	answers: Answers,
	now: Date = new Date(),
): { ok: true; resume: ResumeEntry[]; toolMessages: Message[] } | { ok: false } => {
	const entries = answers.resume ?? []
	if (open.interrupts.length === 0 || (answers.toolResults ?? []).length > 0) return { ok: false }
	if (new Set(entries.map(entry => entry.interruptId)).size !== entries.length) return { ok: false }
	const responses = Object.fromEntries(
		entries.map(entry => [
			entry.interruptId,
			entry.status === 'resolved'
				? { status: entry.status, payload: entry.payload }
				: { status: entry.status },
		]),
	)
	let resume: ResumeEntry[]
	try {
		resume = buildResumeArray(open.interrupts, responses)
	} catch {
		return { ok: false }
	}
	const expiredAnswered = open.interrupts.some(
		interrupt =>
			isInterruptExpired(interrupt, now) && responses[interrupt.id]?.status !== 'cancelled',
	)
	return expiredAnswered ? { ok: false } : { ok: true, resume, toolMessages: [] }
}
