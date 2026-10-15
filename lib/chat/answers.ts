import 'server-only'

import { buildResumeArray, isInterruptExpired } from '@ag-ui/client'
import type { Interrupt, Message, ResumeEntry } from '@ag-ui/core'
import { InterruptSchema } from '@ag-ui/core/schemas'

import type { StoredRun } from '@/lib/data/conversations'

import { ASK_USER_TOOL_NAME, parseAskUserArgs, type AskUserArgs } from './ask-user'
import type { HubToolName } from './hub-tools'
import { payloadAccepted } from './interrupt-answers'
import type { RunBody } from './schemas'
import { INVALID_QUESTION_CONTENT, INVALID_QUESTION_ERROR } from './statuses'
import { errorToolMessage, unansweredToolCalls } from './thread'

/** An unanswered call to the hub's own ask_user tool (spec §6.2): the conversation waits for its answer. */
export interface OpenQuestion {
	toolCallId: string
	/** null when the call's arguments fail askUserArgsSchema (P3). */
	args: AskUserArgs | null
}

/** What a conversation waits for (spec §4.3 step 1): the continued run's open interrupts and the open ask_user calls. */
export type OpenItems = { interrupts: Interrupt[]; questions: OpenQuestion[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The open interrupts (spec §3.3): those of the continued run (plan call P10: the newest run the agent started) when it
 * ended on an interrupt, read from the stored `RUN_FINISHED.outcome` (2a stores it as received) with the protocol's own
 * schema (`@ag-ui/core/schemas` `InterruptSchema`); an entry it refuses is left out, so a stored value never reaches the
 * agent unread. If every stored interrupt fails the schema, nothing is open: a message is accepted and answers get
 * answers_invalid.
 */
const openInterrupts = (run: StoredRun | null): Interrupt[] => {
	if (!run || run.status !== 'interrupted' || !isRecord(run.outcome)) return []
	const listed = Array.isArray(run.outcome.interrupts) ? run.outcome.interrupts : []
	return listed.flatMap(entry => {
		const parsed = InterruptSchema.safeParse(entry)
		return parsed.success ? [parsed.data] : []
	})
}

/**
 * Spec §4.3 step 1, decision 62: the continued run's open interrupts, and the thread's unanswered ask_user calls while
 * the app advertises the tool. AG-UI "Tool calls" › Frontend tools: a run ends with a frontend call unanswered, and
 * without `pendingToolCallIds` (which @ag-ui/client 1.0.2 strips: the spike) the consumer derives them, "every tool call
 * the run started that received no result". Every run the hub starts first answers each call left before it (the
 * answers, plan call P4's not-available answers, a stop's error), so the thread's unanswered calls are the continued
 * run's. The arguments are untrusted ("validated against the tool's declared parameter schema", same page, Security):
 * a call whose arguments fail stays open with `args: null` (P3). While the switch is off no call is open, and the next
 * run answers it as not available (decision 62's fourth answer).
 */
export const openItemsOf = (
	run: StoredRun | null,
	thread: readonly Message[],
	hubTools: readonly HubToolName[],
): OpenItems => ({
	interrupts: openInterrupts(run),
	questions: hubTools.includes(ASK_USER_TOOL_NAME)
		? unansweredToolCalls(thread)
				.filter(call => call.name === ASK_USER_TOOL_NAME)
				.map(call => ({ toolCallId: call.toolCallId, args: parseAskUserArgs(call.args) }))
		: [],
})

/** Whether anything is open (the server's twin of lib/chat/open-items.ts's hasOpenItems). */
export const anyOpen = (open: OpenItems): boolean =>
	open.interrupts.length > 0 || open.questions.length > 0

type Answers = NonNullable<RunBody['answers']>

const hasDuplicates = (ids: readonly string[]): boolean => new Set(ids).size !== ids.length

/** Spec §6.2: an open question answered with what the browser sent, the template's Q/A transcript (P3), as is. */
const answerMessage = (toolCallId: string, content: string): Message => ({
	id: crypto.randomUUID(),
	role: 'tool',
	toolCallId,
	content,
})

/**
 * Spec §4.3 step 1: the answers cover every open item exactly once, or the run is refused (400 answers_invalid).
 *
 * - Answers to nothing are refused: they would start a run with nothing new in it. An id given twice is refused first
 *   (a record would keep one of them).
 * - Interrupts: "The resume list MUST cover every interrupt of the run being continued", and "A consumer MUST reject a
 *   resuming input that leaves an interrupt uncovered before the run starts" (AG-UI "Interrupt and resume");
 *   @ag-ui/client's `buildResumeArray` builds `resume[]` in the interrupts' order and throws for a missing or unknown
 *   id, so with no open interrupt any entry is unknown. An interrupt the consumer judges expired "can no longer be
 *   answered" but can be abandoned (same page): `isInterruptExpired` is the client's rule. A resolved payload must be
 *   one the hub's cards build ("Clients should validate before submitting", AG-UI Concepts › Interrupts, contract rule
 *   6): `payloadAccepted` (plan calls P5–P8).
 * - Questions: the tool results name exactly the open questions ("A thread that continues MUST answer every one of
 *   them first", AG-UI "Tool calls" › Frontend tools). Each becomes a tool message, in the questions' order; a question
 *   whose arguments failed is answered with the hub's error, whatever content came (P3: "a failure is still an answer,
 *   as a tool message with `error` set", same page).
 */
export const checkAnswers = (
	open: OpenItems,
	answers: Answers,
	now: Date = new Date(),
): { ok: true; resume: ResumeEntry[]; toolMessages: Message[] } | { ok: false } => {
	const entries = answers.resume ?? []
	const results = answers.toolResults ?? []
	if (!anyOpen(open)) return { ok: false }
	if (
		hasDuplicates(entries.map(entry => entry.interruptId)) ||
		hasDuplicates(results.map(result => result.toolCallId))
	)
		return { ok: false }
	let resume: ResumeEntry[]
	try {
		resume = buildResumeArray(
			open.interrupts,
			Object.fromEntries(
				entries.map(entry => [
					entry.interruptId,
					entry.status === 'resolved'
						? { status: entry.status, payload: entry.payload }
						: { status: entry.status },
				]),
			),
		)
	} catch {
		return { ok: false }
	}
	const interruptOf = new Map(open.interrupts.map(interrupt => [interrupt.id, interrupt]))
	const refused = entries.some(entry => {
		if (entry.status === 'cancelled') return false
		const interrupt = interruptOf.get(entry.interruptId)
		return (
			!interrupt || isInterruptExpired(interrupt, now) || !payloadAccepted(interrupt, entry.payload)
		)
	})
	if (refused || results.length !== open.questions.length) return { ok: false }
	const contentOf = new Map(results.map(result => [result.toolCallId, result.content]))
	const toolMessages: Message[] = []
	for (const question of open.questions) {
		const content = contentOf.get(question.toolCallId)
		if (content === undefined) return { ok: false }
		toolMessages.push(
			question.args
				? answerMessage(question.toolCallId, content)
				: errorToolMessage(question.toolCallId, INVALID_QUESTION_ERROR, INVALID_QUESTION_CONTENT),
		)
	}
	return { ok: true, resume, toolMessages }
}
