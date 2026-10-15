import type {
	ActivitySnapshotEvent,
	BaseEvent,
	ContentPart,
	CustomEvent,
	Interrupt,
	Message,
	ReasoningMessageContentEvent,
	ReasoningMessageStartEvent,
	RunErrorEvent,
	RunFinishedEvent,
	RunStartedEvent,
	TextMessageContentEvent,
	TextMessageStartEvent,
	ToolCallArgsEvent,
	ToolCallResultEvent,
	ToolCallStartEvent,
} from '@ag-ui/core'

import {
	readResume,
	withSentAnswers,
	type AnsweredInterrupt,
	type ApprovalDecision,
} from './sent-answers'
import {
	type MessageRole,
	type MessageStatus,
	type RunStatus,
	STOPPED_TOOL_ERROR,
} from './statuses'

/*
 * One X message per turn (Part 2 spec §5.2; spike "Browser side"; research `part2-x-mapping.md` §A): a user message, or
 * everything the agent answered to it, across the runs that continued it, as parts in arrival order. useXChat writes one
 * message per request (x-sdk 2.9.0 `es/x-chat/index.js`: one `updatingMsgId`), and assistant-ui, TanStack AI and X's own
 * AgentProvider demo group a run's output the same way. Client-safe: the browser folds events with `applyAgUiEvent`, the
 * server groups stored rows with `turnsFromMessages`. `@ag-ui/core` is imported for its types only (spec §9: the browser
 * bundle carries none of the AG-UI runtime), so event types are compared as strings.
 */

/**
 * Plan call P9 (2b's revision of 2a's P10): running while its run runs; waiting when the run ended (success or
 * interrupt) without its result, for an approval, an answer or the next run's `not_available` answer (AG-UI 1.0 "Tool
 * Calls", Frontend tools: the pending calls are "every tool call the run started that received no result", on an
 * interrupted run too); done with one; error for a tool message with an error; stopped when cut off.
 */
export type ToolStatus = 'running' | 'waiting' | 'done' | 'error' | 'stopped'

/** A turn's pieces, each keyed by its AG-UI id (spec §5.2): text and reasoning by message id, a tool call by its id. */
export type TurnPart =
	| { kind: 'text'; messageId: string; text: string }
	| { kind: 'reasoning'; messageId: string; text: string }
	| {
			kind: 'tool'
			toolCallId: string
			name: string
			args: string
			status: ToolStatus
			result?: string
			error?: string
			/** The sent answer to the approval that names this call (spec §6.1; lib/chat/sent-answers.ts). */
			decision?: ApprovalDecision
	  }
	| { kind: 'activity'; messageId: string; activityType: string; content: unknown }

/** A tool call's part: the ThoughtChain items, the hub's tool cards and the open items read it. */
export type ToolPart = Extract<TurnPart, { kind: 'tool' }>

/** What AG-UI said of a run (spec §5.2's second layer; X's own status is the transport's). */
export type RunOutcome = 'running' | 'success' | 'interrupt' | 'cancelled' | 'error' | 'truncated'

export interface TurnRun {
	runId: string
	outcome: RunOutcome
	error?: { code?: string; message: string }
	/** CUSTOM run_cancelled's reason, e.g. 'run_timeout' (spec §2.3). */
	cancelledReason?: string
}

/** One X message: a user message, or everything the agent answered to it across the runs that continued it (spec §5.2). */
export interface Turn {
	role: 'user' | 'assistant'
	parts: TurnPart[]
	runs: TurnRun[]
	/** The open interrupts of the turn's last run the agent started (spec §3.3, plan call P10). */
	interrupts: Interrupt[]
	/**
	 * The sent answers to interrupts no tool part of the turn shows, in the order sent (lib/chat/sent-answers.ts): an
	 * approval bound to one of its calls is that call's `decision` instead.
	 */
	answered: AnsweredInterrupt[]
}

/** The hub's first event on every run stream (spec §4.4): the browser learns the conversation and the run to stop. */
export const HUB_RUN_EVENT = 'hub:run'

export interface HubRunValue {
	conversationId: string
	runId: string
	title: string
}

/** The agent's time limit (spec §2.3, the owner's agent contract): CUSTOM run_cancelled, then RUN_FINISHED. */
export const RUN_CANCELLED_EVENT = 'run_cancelled'

export const emptyAssistantTurn = (): Turn => ({
	role: 'assistant',
	parts: [],
	runs: [],
	interrupts: [],
	answered: [],
})

export const userTurn = (messageId: string, text: string): Turn => ({
	role: 'user',
	parts: [{ kind: 'text', messageId, text }],
	runs: [],
	interrupts: [],
	answered: [],
})

/** A user message's, a tool result's or a tool message's content as text: a string as it is, else its text parts joined. */
export const contentText = (content: string | ContentPart[] | undefined): string => {
	if (typeof content === 'string') return content
	return (content ?? []).map(part => (part.type === 'text' ? part.text : '')).join('')
}

type PartOf<K extends TurnPart['kind']> = Extract<TurnPart, { kind: K }>

const keyOf = (part: TurnPart): string =>
	part.kind === 'tool' ? `tool:${part.toolCallId}` : `${part.kind}:${part.messageId}`

const upsertPart = (parts: TurnPart[], part: TurnPart): TurnPart[] => {
	const index = parts.findIndex(p => keyOf(p) === keyOf(part))
	return index === -1 ? [...parts, part] : parts.map((p, i) => (i === index ? part : p))
}

const updatePart = <K extends TurnPart['kind']>(
	parts: TurnPart[],
	kind: K,
	key: string,
	patch: (part: PartOf<K>) => PartOf<K>,
): TurnPart[] =>
	parts.map(part =>
		part.kind === kind && keyOf(part) === `${kind}:${key}` ? patch(part as PartOf<K>) : part,
	)

const patchLastRun = (turn: Turn, patch: (run: TurnRun) => TurnRun): TurnRun[] =>
	turn.runs.map((run, index) => (index === turn.runs.length - 1 ? patch(run) : run))

const pushRun = (turn: Turn, runId: string): Turn =>
	turn.runs.some(run => run.runId === runId)
		? turn
		: { ...turn, runs: [...turn.runs, { runId, outcome: 'running' }], interrupts: [] }

/**
 * A run's end settles its parts (plan call P9). A call without its result, still running or left waiting by an earlier
 * run of the turn, waits after a success or an interrupt and is stopped after a cancel or an error: the turn's last run
 * decides, as `turnsFromMessages` decides after a reload. An empty text part goes: Pydantic AI opens an empty text
 * message before its tool calls (spike), and the stored assistant message of it has no content, so the live turn and the
 * reloaded one agree.
 */
const settleParts = (parts: TurnPart[], tools: ToolStatus): TurnPart[] =>
	parts
		.filter(part => !(part.kind === 'text' && part.text === ''))
		.map(part =>
			part.kind === 'tool' && (part.status === 'running' || part.status === 'waiting')
				? { ...part, status: tools }
				: part,
		)

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The pure reducer the browser's provider runs per event (spec §5.2), grown from the spike's (Appendix D). A turn's run
 * opens on hub:run, or on RUN_STARTED when no hub:run came; a resumed run (2b) opens in the same turn. Text is kept for
 * assistant messages only; content for a message that never started as one is dropped (the client's verification lets
 * none through otherwise: src/verify/verify.ts). Events the turn does not show leave it as it is (the same object).
 */
export const applyAgUiEvent = (turn: Turn, event: BaseEvent): Turn => {
	switch (event.type as string) {
		case 'CUSTOM': {
			const { name, value } = event as CustomEvent
			if (name === HUB_RUN_EVENT && isRecord(value) && typeof value.runId === 'string')
				return pushRun(turn, value.runId)
			if (name === RUN_CANCELLED_EVENT && turn.runs.length) {
				const reason =
					isRecord(value) && typeof value.reason === 'string' ? value.reason : 'cancelled'
				return { ...turn, runs: patchLastRun(turn, run => ({ ...run, cancelledReason: reason })) }
			}
			return turn
		}
		case 'RUN_STARTED': {
			const last = turn.runs.at(-1)
			return last?.outcome === 'running' ? turn : pushRun(turn, (event as RunStartedEvent).runId)
		}
		case 'TEXT_MESSAGE_START': {
			const { messageId, role } = event as TextMessageStartEvent
			if (role !== undefined && role !== 'assistant') return turn
			return { ...turn, parts: upsertPart(turn.parts, { kind: 'text', messageId, text: '' }) }
		}
		case 'TEXT_MESSAGE_CONTENT': {
			const { messageId, delta } = event as TextMessageContentEvent
			return {
				...turn,
				parts: updatePart(turn.parts, 'text', messageId, part => ({
					...part,
					text: part.text + delta,
				})),
			}
		}
		case 'REASONING_MESSAGE_START': {
			const { messageId } = event as ReasoningMessageStartEvent
			return { ...turn, parts: upsertPart(turn.parts, { kind: 'reasoning', messageId, text: '' }) }
		}
		case 'REASONING_MESSAGE_CONTENT': {
			const { messageId, delta } = event as ReasoningMessageContentEvent
			return {
				...turn,
				parts: updatePart(turn.parts, 'reasoning', messageId, part => ({
					...part,
					text: part.text + delta,
				})),
			}
		}
		case 'TOOL_CALL_START': {
			const { toolCallId, toolCallName } = event as ToolCallStartEvent
			return {
				...turn,
				parts: upsertPart(turn.parts, {
					kind: 'tool',
					toolCallId,
					name: toolCallName,
					args: '',
					status: 'running',
				}),
			}
		}
		case 'TOOL_CALL_ARGS': {
			const { toolCallId, delta } = event as ToolCallArgsEvent
			return {
				...turn,
				parts: updatePart(turn.parts, 'tool', toolCallId, part => ({
					...part,
					args: part.args + delta,
				})),
			}
		}
		case 'TOOL_CALL_RESULT': {
			const { toolCallId, content } = event as ToolCallResultEvent
			return {
				...turn,
				parts: updatePart(turn.parts, 'tool', toolCallId, part => ({
					...part,
					result: contentText(content),
					status: 'done',
				})),
			}
		}
		case 'ACTIVITY_SNAPSHOT': {
			const { messageId, activityType, content } = event as ActivitySnapshotEvent
			return {
				...turn,
				parts: upsertPart(turn.parts, { kind: 'activity', messageId, activityType, content }),
			}
		}
		case 'RUN_FINISHED': {
			const { outcome } = event as RunFinishedEvent
			const cancelled = outcome?.type === 'cancelled' || Boolean(turn.runs.at(-1)?.cancelledReason)
			const next: RunOutcome = cancelled
				? 'cancelled'
				: outcome?.type === 'interrupt'
					? 'interrupt'
					: 'success'
			return {
				...turn,
				parts: settleParts(turn.parts, cancelled ? 'stopped' : 'waiting'),
				runs: patchLastRun(turn, run => ({ ...run, outcome: next })),
				interrupts: outcome?.type === 'interrupt' ? outcome.interrupts : [],
			}
		}
		case 'RUN_ERROR': {
			const { code, message } = event as RunErrorEvent
			return {
				...turn,
				parts: settleParts(turn.parts, 'stopped'),
				runs: patchLastRun(turn, run => ({
					...run,
					outcome: 'error',
					error: code === undefined ? { message } : { code, message },
				})),
				interrupts: [],
			}
		}
		default:
			return turn
	}
}

const RUN_OUTCOMES: Record<RunStatus, RunOutcome> = {
	running: 'running',
	succeeded: 'success',
	interrupted: 'interrupt',
	cancelled: 'cancelled',
	failed: 'error',
	truncated: 'truncated',
}
/** A stored run's status (spec §3.1) as the turn reads it. */
export const runOutcomeOf = (status: RunStatus): RunOutcome => RUN_OUTCOMES[status]

/** The fields of a stored message the grouping reads (lib/data/conversations.ts `StoredMessage`). */
export interface TurnMessageRow {
	messageId: string
	runId: string | null
	role: MessageRole
	body: Message
	status: MessageStatus
}
/** The fields of a stored run the grouping reads (lib/data/conversations.ts `StoredRun`). */
export interface TurnRunRow {
	id: string
	status: RunStatus
	outcome: unknown
	/** `beforeStream` (plan call P10): the agent never started this run, so it continues nothing. */
	error: { code?: string; message: string; beforeStream?: true } | null
	custom: { name: string; value: unknown }[]
	startedAt: Date
	/** The answers the run was started with (lib/data/conversations.ts `startRun`), read by `readResume`. */
	resume: unknown
}
/** A turn with its id (plan call P9): a user message's id, or `turn-<its first run id>`. */
export interface HistoryTurn {
	id: string
	turn: Turn
}

const cancelledReasonOf = (custom: TurnRunRow['custom']): string | undefined => {
	const record = custom.findLast(item => item.name === RUN_CANCELLED_EVENT)
	if (!record) return undefined
	return isRecord(record.value) && typeof record.value.reason === 'string'
		? record.value.reason
		: 'cancelled'
}

/** A stored error as the turn shows it, with RUN_ERROR's two fields (applyAgUiEvent); the refusal flag is the store's. */
const turnErrorOf = ({
	code,
	message,
}: NonNullable<TurnRunRow['error']>): NonNullable<TurnRun['error']> =>
	code === undefined ? { message } : { code, message }

const toTurnRun = (run: TurnRunRow): TurnRun => {
	const reason = cancelledReasonOf(run.custom)
	return {
		runId: run.id,
		outcome: runOutcomeOf(run.status),
		...(run.error ? { error: turnErrorOf(run.error) } : {}),
		...(reason ? { cancelledReason: reason } : {}),
	}
}

/**
 * Plan call P10: a run the agent never started (refused before its stream, or the hub failed before sending it) does not
 * continue its turn, so the turn's calls and open interrupts are what the run before it left; its error still shows.
 */
const continues = (run: TurnRunRow | undefined): run is TurnRunRow =>
	run !== undefined && run.error?.beforeStream !== true

const interruptsOf = (outcome: unknown): Interrupt[] =>
	isRecord(outcome) && outcome.type === 'interrupt' && Array.isArray(outcome.interrupts)
		? (outcome.interrupts as Interrupt[])
		: []

/**
 * The answers the turn's runs sent (lib/chat/sent-answers.ts), in run order: each answering run the agent started
 * answered the interrupts of the run it continued, the newest run before it the agent started (plan call P10), while
 * that run is interrupted, as the server read them when it checked the answers (lib/chat/answers.ts `openItemsOf`). A
 * run refused before its stream records nothing: its answers never reached the agent (decision 62).
 */
const withAnswersSent = (turn: Turn, runs: readonly TurnRunRow[]): Turn =>
	runs.reduce((recorded, run, index) => {
		if (!continues(run)) return recorded
		const resume = readResume(run.resume)
		if (resume.length === 0) return recorded
		const answeredRun = runs.slice(0, index).findLast(continues)
		const open = answeredRun?.status === 'interrupted' ? interruptsOf(answeredRun.outcome) : []
		return withSentAnswers(recorded, open, resume)
	}, turn)

/** Plan call P9: what a call without a tool message reads by how the turn's last run ended (applyAgUiEvent's settleParts). */
const TOOL_STATUS_AT_END: Record<RunOutcome, ToolStatus> = {
	running: 'running',
	success: 'waiting',
	interrupt: 'waiting',
	cancelled: 'stopped',
	error: 'stopped',
	truncated: 'stopped',
}

/**
 * One stored row into the turn's parts. An assistant record holds its text and its tool calls in separate fields with no
 * order between them, so a reload shows the text first (assistant-ui `fromAgUiMessages` does the same; spec §3.3). A tool
 * message lands on its call: a result, a stop (the session's `STOPPED_TOOL_ERROR`), or another error with its text.
 */
const foldRow = (parts: TurnPart[], body: Message): TurnPart[] => {
	switch (body.role) {
		case 'reasoning':
			return [...parts, { kind: 'reasoning', messageId: body.id, text: body.content }]
		case 'assistant': {
			const text: TurnPart[] = body.content
				? [{ kind: 'text', messageId: body.id, text: body.content }]
				: []
			const tools: TurnPart[] = (body.toolCalls ?? []).map(call => ({
				kind: 'tool',
				toolCallId: call.id,
				name: call.function.name,
				args: call.function.arguments,
				status: 'running',
			}))
			return [...parts, ...text, ...tools]
		}
		case 'tool': {
			const { error, toolCallId } = body
			const content = contentText(body.content)
			return updatePart(parts, 'tool', toolCallId, part => {
				if (error === undefined) return { ...part, status: 'done', result: content }
				if (error === STOPPED_TOOL_ERROR) return { ...part, status: 'stopped' }
				return { ...part, status: 'error', error: content || error }
			})
		}
		case 'activity':
			return [
				...parts,
				{
					kind: 'activity',
					messageId: body.id,
					activityType: body.activityType,
					content: body.content,
				},
			]
		default:
			return parts
	}
}

/**
 * The server's grouping of stored rows into turns (spec §3.3), since "nothing on the wire carries run identity"
 * (assistant-ui; research `part2-x-mapping.md` §C): a user turn per user message, then one assistant turn holding every
 * row up to the next user message, across the runs that resumed it. A call without a tool message reads how the turn's
 * last run ended, and the last turn carries the open interrupts while that run is interrupted, so they survive a reload;
 * that run is the last one the agent started (plan call P10), while every run, a refused one included, shows in `runs`.
 * The answers the turn's runs sent are recorded in it (`withAnswersSent`), as the browser recorded them when they went.
 */
export const turnsFromMessages = (
	rows: readonly TurnMessageRow[],
	runs: readonly TurnRunRow[],
): HistoryTurn[] => {
	const runById = new Map(runs.map(run => [run.id, run]))
	const startOf = (runId: string) =>
		runById.get(runId)?.startedAt.getTime() ?? Number.NEGATIVE_INFINITY
	// Each user message, then what answered it: its run ids in the order they appear, and the parts its rows fold into.
	const groups: { user?: TurnMessageRow; firstId: string; runIds: string[]; parts: TurnPart[] }[] =
		[]
	for (const row of rows) {
		// Developer and system messages are the agent's instructions, not part of any turn.
		if (row.body.role === 'developer' || row.body.role === 'system') continue
		if (row.body.role === 'user') {
			groups.push({
				user: row,
				firstId: row.messageId,
				runIds: row.runId ? [row.runId] : [],
				parts: [],
			})
			continue
		}
		if (!groups.length) groups.push({ firstId: row.messageId, runIds: [], parts: [] })
		const group = groups[groups.length - 1]
		if (row.body.role !== 'tool' && row.runId && !group.runIds.includes(row.runId))
			group.runIds.push(row.runId)
		group.parts = foldRow(group.parts, row.body)
	}
	// A run no row names belongs to the latest user message whose run started before it, so its error shows: an answers
	// run the agent refused before its stream, or a run that only tool rows carry (P4's `not_available` tool messages are
	// stored under the new run's id, before its user message, so a tool row does not name its run).
	const named = new Set(groups.flatMap(group => group.runIds))
	for (const run of runs) {
		if (named.has(run.id)) continue
		const group = groups.findLast(
			candidate =>
				candidate.user?.runId && startOf(candidate.user.runId) <= run.startedAt.getTime(),
		)
		group?.runIds.push(run.id)
	}
	const turns: HistoryTurn[] = []
	for (const group of groups) {
		const user = group.user
		if (user?.body.role === 'user')
			turns.push({
				id: user.messageId,
				turn: userTurn(user.messageId, contentText(user.body.content)),
			})
		const stored = [...group.runIds]
			.sort((a, b) => startOf(a) - startOf(b))
			.flatMap(id => {
				const run = runById.get(id)
				return run ? [run] : []
			})
		if (!stored.length && !group.parts.length) continue
		const continued = stored.findLast(continues)
		const atEnd = TOOL_STATUS_AT_END[continued ? runOutcomeOf(continued.status) : 'success']
		turns.push({
			id: `turn-${group.runIds[0] ?? group.firstId}`,
			turn: withAnswersSent(
				{
					role: 'assistant',
					parts: group.parts.map(part =>
						part.kind === 'tool' && part.status === 'running' ? { ...part, status: atEnd } : part,
					),
					runs: stored.map(toTurnRun),
					interrupts: [],
					answered: [],
				},
				stored,
			),
		})
	}
	const lastTurn = turns.at(-1)
	const continued = lastTurn?.turn.runs.map(run => runById.get(run.runId)).findLast(continues)
	if (lastTurn && continued?.status === 'interrupted')
		lastTurn.turn = { ...lastTurn.turn, interrupts: interruptsOf(continued.outcome) }
	return turns
}

/** A turn's text parts joined by a blank line: what Copy copies (spec §5.3). */
export const turnText = (turn: Turn): string =>
	turn.parts.flatMap(part => (part.kind === 'text' && part.text ? [part.text] : [])).join('\n\n')
