import 'server-only'

import {
	EventType,
	type ActivityDeltaEvent,
	type ActivitySnapshotEvent,
	type BaseEvent,
	type CustomEvent,
	type Message,
	type ReasoningEndEvent,
	type ReasoningMessageEndEvent,
	type ReasoningMessageStartEvent,
	type ReasoningStartEvent,
	type RunErrorEvent,
	type RunFinishedEvent,
	type StateSnapshotEvent,
	type TextMessageEndEvent,
	type TextMessageStartEvent,
	type ToolCallEndEvent,
	type ToolCallResultEvent,
	type ToolCallStartEvent,
} from '@ag-ui/core'

import {
	finishRun,
	saveMessages,
	saveState,
	type CustomRecord,
	type RunEnd,
	type RunError,
	type RunKey,
} from '@/lib/data/conversations'
import { describeError, logActionError } from '@/lib/error-log'

import type { ChatTurnSink } from './adapter'
import type { StopReason } from './active-runs'
import type { MessageStatus } from './statuses'
import { errorToolMessage, STOPPED_TOOL_CONTENT, STOPPED_TOOL_ERROR } from './thread'
import { HUB_RUN_EVENT, RUN_CANCELLED_EVENT, type HubRunValue } from './turn'

/** Spec §3.2 step 2: while text streams, rows are written at most this often (PostgreSQL rewrites a whole row per update). */
export const SAVE_INTERVAL_MS = 2_000

/** The browser's text for a stream that broke off (plan call P6); the turn shows the code's localised title. */
export const BROKEN_STREAM_TEXT = 'The agent stopped answering.'

/**
 * Never sent to the browser (spec §4.4): RAW is provider-native, REASONING_ENCRYPTED_VALUE stays in the stored message for
 * the agent, MESSAGES_SNAPSHOT is folded on the server, and the state and activity deltas go out as the snapshots the
 * client's own JSON Patch produced (`state()`, `messages()`).
 */
const NOT_FORWARDED: ReadonlySet<string> = new Set([
	EventType.RAW,
	EventType.REASONING_ENCRYPTED_VALUE,
	EventType.MESSAGES_SNAPSHOT,
	EventType.STATE_SNAPSHOT,
	EventType.STATE_DELTA,
	EventType.ACTIVITY_DELTA,
])

/** Spec §3.2 step 2: a message's row is written when it starts, when its tool result arrives (at the next message list). */
const SAVE_AT_NEXT_LIST: ReadonlySet<string> = new Set([
	EventType.TEXT_MESSAGE_START,
	EventType.REASONING_MESSAGE_START,
	EventType.TOOL_CALL_START,
	EventType.TOOL_CALL_RESULT,
	EventType.ACTIVITY_SNAPSHOT,
	EventType.ACTIVITY_DELTA,
	EventType.REASONING_ENCRYPTED_VALUE,
	EventType.MESSAGES_SNAPSHOT,
])

/** …and when it ends: an end event changes no message (the client applies none), so the rows are written at once. */
const SAVE_NOW: ReadonlySet<string> = new Set([
	EventType.TEXT_MESSAGE_END,
	EventType.REASONING_MESSAGE_END,
	EventType.TOOL_CALL_END,
])

/** The event that ended the run, if one came (spec §2.3, the agent's answers; AG-UI lifecycle). */
type Terminal =
	| { kind: 'finished'; event: RunFinishedEvent }
	| { kind: 'error'; error: RunError; usage?: unknown }

/** The hub's names are its own: a producer's CUSTOM event under `hub:` never reaches the browser (spec §4.4). */
const isHubEvent = (name: string) => name.startsWith('hub:')

/**
 * One run's bookkeeping between the provider's adapter and the browser (spec §3.2, §4.4, §4.5). The adapter reports each
 * event before the client applies it (`event`), the whole message list after each change (`messages`) and the state
 * after each change (`state`) — the AgentSubscriber hooks `onEvent`, `onMessagesChanged` and `onStateChanged`
 * (docs.ag-ui.com, "AbstractAgent" › subscribers; @ag-ui/client 1.0.2 src/agent/agent.ts `processApplyEvents`). The
 * session forwards what the browser reads, writes the rows from the client's own list (not `newMessages`, which misses a
 * message updated under an existing id: spike), and at the end decides the run's status.
 */
export class RunSession implements ChatTurnSink {
	private readonly key: RunKey
	private readonly appId: string
	private readonly title: string
	private readonly out: { write(event: BaseEvent): void }
	private readonly now: () => number
	/** The last row written per message id: its body and status as JSON, so only a changed row is written again. */
	private readonly written = new Map<string, string>()
	private latest: readonly Message[] = []
	private saveDue = false
	private lastSave: number
	/** Rows and state are written one after another (PostgreSQL applies them in the order they leave). */
	private queue: Promise<void> = Promise.resolve()
	/**
	 * Set once `finish` has begun: a report that comes later is ignored, so the run's end is its last write. saveMessages
	 * upserts (lib/data/conversations.ts), and a row written after finishRun marked it incomplete would reopen it.
	 */
	private ended = false
	private terminal: Terminal | undefined
	private readonly custom: CustomRecord[] = []
	private readonly openText = new Set<string>()
	private readonly openReasoningMessages = new Set<string>()
	private readonly openReasoning = new Set<string>()
	/** Tool calls this run started, by id: whether their arguments are still streaming. */
	private readonly toolCalls = new Map<string, { argsOpen: boolean }>()
	private readonly answered = new Set<string>()
	/** Activity messages a delta changed: their snapshot goes out with the next message list. */
	private readonly activityDue = new Set<string>()

	constructor(args: {
		key: RunKey
		appId: string
		title: string
		/** The thread the agent was given (lib/chat/thread.ts threadForAgent): its rows are stored already. */
		history: readonly Message[]
		out: { write(event: BaseEvent): void }
		now?: () => number
	}) {
		this.key = args.key
		this.appId = args.appId
		this.title = args.title
		this.out = args.out
		this.now = args.now ?? Date.now
		this.lastSave = this.now()
		for (const message of args.history) this.written.set(message.id, rowJson(message, 'complete'))
	}

	/** Spec §4.4: the first event names the run and its conversation, so the browser can stop it. */
	start(): void {
		const value: HubRunValue = {
			conversationId: this.key.conversationId,
			runId: this.key.runId,
			title: this.title,
		}
		this.out.write({ type: EventType.CUSTOM, name: HUB_RUN_EVENT, value } as CustomEvent)
	}

	event(event: BaseEvent): void {
		if (this.ended) return
		this.track(event)
		if (this.forwards(event)) this.out.write(withoutRaw(event))
		if (SAVE_NOW.has(event.type)) this.save()
		else if (SAVE_AT_NEXT_LIST.has(event.type)) this.saveDue = true
	}

	messages(messages: readonly Message[]): void {
		if (this.ended) return
		this.latest = messages
		for (const id of this.activityDue) {
			const activity = messages.find(message => message.id === id)
			if (activity?.role === 'activity')
				this.out.write({
					type: EventType.ACTIVITY_SNAPSHOT,
					messageId: activity.id,
					activityType: activity.activityType,
					content: activity.content,
					replace: true,
				} as ActivitySnapshotEvent)
		}
		this.activityDue.clear()
		if (this.saveDue || this.now() - this.lastSave >= SAVE_INTERVAL_MS) this.save()
	}

	state(state: unknown): void {
		if (this.ended) return
		this.out.write({ type: EventType.STATE_SNAPSHOT, snapshot: state } as StateSnapshotEvent)
		this.enqueue(() => saveState(this.key, state))
	}

	/**
	 * The run is over (the adapter's `finished` settled). A terminal event from the agent decides the status; without one,
	 * the hub's Stop is a cancelled run, which the hub as the browser's producer closes in order (AG-UI lifecycle,
	 * "Cancelled runs"; CopilotKit's finaliser), the browser leaving is a truncated run, and anything else a failure (plan
	 * call P6). A stop, a failure or a truncation marks open rows incomplete and answers each cut-off tool call (spec §3.2
	 * step 4), so the next RunAgentInput is valid history. `failed` (the adapter saw the stream break) only names the
	 * failure in the log: without a terminal event the run failed either way.
	 */
	async finish({
		failed,
		stopReason,
	}: {
		failed: boolean
		stopReason?: StopReason
	}): Promise<RunEnd> {
		this.save()
		this.ended = true
		const end = this.decide(stopReason)
		if (end.status === 'cancelled' && !this.terminal) this.closeForBrowser()
		if (end.status === 'failed' && !this.terminal)
			this.out.write({
				type: EventType.RUN_ERROR,
				code: 'upstream_error',
				message: BROKEN_STREAM_TEXT,
			} as RunErrorEvent)
		if (end.status === 'cancelled' || end.status === 'failed' || end.status === 'truncated')
			end.close = this.closeLists()
		await this.queue
		// A batch that failed above was forgotten: this save writes its rows once more, and nothing else (the rows are
		// unchanged since the save at the top, so every other row matches what was written).
		this.save()
		await this.queue
		// Spec §4.4: a log line carries the app, the run and a code, never content. The agent's code for its RUN_ERROR;
		// otherwise whether the stream broke or ended without a terminal event (plan call P6; both stored upstream_error).
		if (end.status === 'failed') {
			const code = this.terminal ? end.error?.code : failed ? 'stream_broken' : 'stream_ended'
			console.error('Chat run failed:', { appId: this.appId, runId: this.key.runId, code })
		}
		try {
			await finishRun(this.key, end)
		} catch (error) {
			// The run stays `running` with no process holding it: the next request truncates it (spec §3.2 step 5).
			logActionError(error, 'RunSession.finish')
		}
		return end
	}

	private track(event: BaseEvent): void {
		switch (event.type) {
			case EventType.TEXT_MESSAGE_START:
				this.openText.add((event as TextMessageStartEvent).messageId)
				break
			case EventType.TEXT_MESSAGE_END:
				this.openText.delete((event as TextMessageEndEvent).messageId)
				break
			case EventType.REASONING_START:
				this.openReasoning.add((event as ReasoningStartEvent).messageId)
				break
			case EventType.REASONING_END:
				this.openReasoning.delete((event as ReasoningEndEvent).messageId)
				break
			case EventType.REASONING_MESSAGE_START:
				this.openReasoningMessages.add((event as ReasoningMessageStartEvent).messageId)
				break
			case EventType.REASONING_MESSAGE_END:
				this.openReasoningMessages.delete((event as ReasoningMessageEndEvent).messageId)
				break
			case EventType.TOOL_CALL_START:
				this.toolCalls.set((event as ToolCallStartEvent).toolCallId, { argsOpen: true })
				break
			case EventType.TOOL_CALL_END: {
				const call = this.toolCalls.get((event as ToolCallEndEvent).toolCallId)
				if (call) call.argsOpen = false
				break
			}
			case EventType.TOOL_CALL_RESULT:
				this.answered.add((event as ToolCallResultEvent).toolCallId)
				break
			case EventType.ACTIVITY_DELTA:
				this.activityDue.add((event as ActivityDeltaEvent).messageId)
				break
			case EventType.CUSTOM: {
				const { name, value } = event as CustomEvent
				if (!isHubEvent(name)) this.custom.push({ name, value })
				break
			}
			case EventType.RUN_FINISHED:
				this.terminal = { kind: 'finished', event: event as RunFinishedEvent }
				break
			case EventType.RUN_ERROR: {
				const { code, message, usage } = event as RunErrorEvent
				// @ag-ui/client's own RUN_ERROR for an aborted request (src/transform/http.ts) is the hub's stop, not the agent's.
				if (code !== 'abort')
					this.terminal = {
						kind: 'error',
						error: code === undefined ? { message } : { code, message },
						usage,
					}
				break
			}
		}
	}

	private forwards(event: BaseEvent): boolean {
		if (NOT_FORWARDED.has(event.type)) return false
		if (event.type === EventType.RUN_ERROR) return (event as RunErrorEvent).code !== 'abort'
		if (event.type === EventType.CUSTOM) return !isHubEvent((event as CustomEvent).name)
		return true
	}

	private decide(stopReason: StopReason | undefined): RunEnd {
		const terminal = this.terminal
		const custom = this.custom
		if (terminal?.kind === 'finished') {
			const { outcome, usage } = terminal.event
			// Spec §2.3: an agent's time limit ends with CUSTOM run_cancelled, then RUN_FINISHED; the run is cancelled.
			const cancelled =
				outcome?.type === 'cancelled' || custom.some(c => c.name === RUN_CANCELLED_EVENT)
			return {
				status: cancelled
					? 'cancelled'
					: outcome?.type === 'interrupt'
						? 'interrupted'
						: 'succeeded',
				// Spec §3.1: RUN_FINISHED.outcome as received; an absent outcome means success (AG-UI lifecycle) and is stored null.
				outcome: outcome ?? null,
				...(usage ? { usage } : {}),
				custom,
			}
		}
		if (terminal?.kind === 'error')
			return {
				status: 'failed',
				error: terminal.error,
				...(terminal.usage ? { usage: terminal.usage } : {}),
				custom,
			}
		if (stopReason === 'stop')
			return { status: 'cancelled', outcome: { type: 'cancelled' }, custom }
		if (stopReason === 'disconnect') return { status: 'truncated', custom }
		// No terminal event: a stream that broke (`failed`) or ended without one; failed either way (plan call P6).
		return {
			status: 'failed',
			error: { code: 'upstream_error', message: BROKEN_STREAM_TEXT },
			custom,
		}
	}

	/** Spec §4.5: what the hub closes toward the browser after its own Stop, then the cancelled outcome. */
	private closeForBrowser(): void {
		for (const [toolCallId, call] of this.toolCalls)
			if (call.argsOpen)
				this.out.write({ type: EventType.TOOL_CALL_END, toolCallId } as ToolCallEndEvent)
		for (const messageId of this.openText)
			this.out.write({ type: EventType.TEXT_MESSAGE_END, messageId } as TextMessageEndEvent)
		for (const messageId of this.openReasoningMessages)
			this.out.write({
				type: EventType.REASONING_MESSAGE_END,
				messageId,
			} as ReasoningMessageEndEvent)
		for (const messageId of this.openReasoning)
			this.out.write({ type: EventType.REASONING_END, messageId } as ReasoningEndEvent)
		this.out.write({
			type: EventType.RUN_FINISHED,
			threadId: this.key.conversationId,
			runId: this.key.runId,
			outcome: { type: 'cancelled' },
		} as RunFinishedEvent)
	}

	private closeLists(): NonNullable<RunEnd['close']> {
		const open = new Set([...this.openText, ...this.openReasoningMessages])
		for (const message of this.latest)
			if (
				message.role === 'assistant' &&
				message.toolCalls?.some(call => this.toolCalls.get(call.id)?.argsOpen)
			)
				open.add(message.id)
		const cutOff = [...this.toolCalls.keys()].filter(id => !this.answered.has(id))
		return {
			messageIds: [...open],
			toolMessages: cutOff.map(id =>
				errorToolMessage(id, STOPPED_TOOL_ERROR, STOPPED_TOOL_CONTENT),
			),
		}
	}

	/** A row is streaming while its text, reasoning or one of its tool calls' arguments are open (spec §3.1 `status`). */
	private statusOf(message: Message): MessageStatus {
		if (this.openText.has(message.id) || this.openReasoningMessages.has(message.id))
			return 'streaming'
		if (
			message.role === 'assistant' &&
			message.toolCalls?.some(call => this.toolCalls.get(call.id)?.argsOpen)
		)
			return 'streaming'
		return 'complete'
	}

	private save(): void {
		this.saveDue = false
		this.lastSave = this.now()
		const sent = new Map<string, string>()
		const rows = this.latest.flatMap(message => {
			const status = this.statusOf(message)
			const json = rowJson(message, status)
			if (this.written.get(message.id) === json) return []
			this.written.set(message.id, json)
			sent.set(message.id, json)
			return [{ message, status }]
		})
		if (rows.length)
			this.enqueue(
				() => saveMessages(this.key, rows),
				() => {
					// A batch that did not land is forgotten, so the next save (at worst finish's) writes its rows again: a
					// tool result stored without its assistant call would make the next run's input invalid.
					for (const [id, json] of sent) if (this.written.get(id) === json) this.written.delete(id)
				},
			)
	}

	private enqueue(write: () => Promise<void>, onFail: () => void): void {
		this.queue = this.queue.then(write).catch(error => {
			// A failed write leaves the stream going; its rows are retried by the next save, and the run's end is written at finish.
			onFail()
			console.error('RunSession.save:', {
				appId: this.appId,
				runId: this.key.runId,
				code: describeError(error),
			})
		})
	}
}

const rowJson = (message: Message, status: MessageStatus) => JSON.stringify([message, status])

/** `rawEvent` is the provider-native event a producer may attach (@ag-ui/core BaseEvent): like RAW, it stays on the server. */
const withoutRaw = (event: BaseEvent): BaseEvent => {
	if (!('rawEvent' in event)) return event
	const { rawEvent: _raw, ...rest } = event
	return rest as BaseEvent
}
