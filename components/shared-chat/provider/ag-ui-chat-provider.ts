import { AbstractChatProvider } from '@ant-design/x-sdk'
import type { ChatProviderConfig, SSEOutput, TransformMessage } from '@ant-design/x-sdk'
import type { BaseEvent } from '@ag-ui/core'

import {
	applyAgUiEvent,
	emptyAssistantTurn,
	HUB_RUN_EVENT,
	userTurn,
	type HubRunValue,
	type Turn,
} from '@/lib/chat/turn'

import { withToolAnswers } from '../answers'

/**
 * An answer to one open interrupt (AG-UI 1.0 interrupt-resume: `{ interruptId, status, payload? }`); a `confirmation`
 * without a `responseSchema` is answered with a bare boolean (plan call P6).
 */
export interface ResumeAnswer {
	interruptId: string
	status: 'resolved' | 'cancelled'
	payload?: Record<string, unknown> | boolean
}

/** An answer to one `ask_user` call (spec §6.2): its transcript, or '' for a call with invalid arguments (P3). */
export interface ToolAnswer {
	toolCallId: string
	content: string
}

/** The run route's body (spec §4.2), plus one client-only field that transformParams never sends. */
export interface SharedChatInput {
	conversationId?: string
	message?: { text: string }
	answers?: { resume?: ResumeAnswer[]; toolResults?: ToolAnswer[] }
	/** The turn answers continue (x-sdk onReload): never sent; transformParams merges the tool answers into it (P11). */
	continues?: Turn
}

export interface AgUiChatProviderOptions {
	request: ChatProviderConfig<SharedChatInput, SSEOutput, Turn>['request']
	/** The server's id of this provider's conversation, once it has one (`hub:run`, or the list). */
	getConversationId: () => string | undefined
	/** The stream named its conversation and run (spec §4.4: `hub:run` comes first). */
	onRun: (value: HubRunValue) => void
	/** The agent's state after it changed (spec §4.4: the hub sends snapshots only). */
	onState: (state: unknown) => void
}

/** One AG-UI event as the run route sends it (spec §4.4): one JSON object per SSE `data:` line, with a string `type`. */
export type WireEvent = { type: string } & Record<string, unknown>

/**
 * XRequest's SSE parser hands each `data:` value as a string (x-sdk 2.9.0 `es/x-stream`); a keep-alive comment never
 * reaches here. Anything that is not one JSON object with a string `type` is no event (the shape `@ag-ui/client`'s
 * transport checks too, `src/transform/http.ts`).
 */
export const parseHubEvent = (data: unknown): WireEvent | null => {
	if (typeof data !== 'string' || !data.trim()) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(data)
	} catch {
		return null
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
	return typeof (parsed as { type?: unknown }).type === 'string' ? (parsed as WireEvent) : null
}

/**
 * The shared chat's x-sdk provider (spec §5.2; the `x-chat-provider` skill: only the three transforms, never a `request`
 * method, never a `status`). One X message per turn: `transformMessage` folds each AG-UI event into the turn with the
 * pure reducer `applyAgUiEvent`. The hub's server already ran `@ag-ui/client`'s compatibility boundary and folded the
 * deltas (spec §4.4), so the browser needs neither that client nor a JSON Patch library (spec §9).
 */
export class AgUiChatProvider extends AbstractChatProvider<Turn, SharedChatInput, SSEOutput> {
	private resumeBase: Turn | null = null
	private currentRunId: string | undefined
	private readonly getConversationId: () => string | undefined
	private readonly onRun: (value: HubRunValue) => void
	private readonly onState: (state: unknown) => void

	constructor({ request, getConversationId, onRun, onState }: AgUiChatProviderOptions) {
		super({ request })
		this.getConversationId = getConversationId
		this.onRun = onRun
		this.onState = onState
	}

	/** The run the stream on screen belongs to (spec §5.2: Stop names it), from `hub:run`. */
	get runId(): string | undefined {
		return this.currentRunId
	}

	transformParams(requestParams: Partial<SharedChatInput>): SharedChatInput {
		this.currentRunId = undefined
		// The SDK passes no originMessage on a reload's first chunk (part2-x-mapping.md §1.2); keep the turn to extend it,
		// with the ask_user answers merged in (spec §6.2). Merged when the request starts and shown from its first chunk:
		// the placeholder is the turn as it was, so a request refused before its stream leaves the questions unanswered
		// (plan call P11).
		const { continues, answers } = requestParams
		this.resumeBase = continues ? withToolAnswers(continues, answers?.toolResults ?? []) : null
		const conversationId = this.getConversationId()
		const body: SharedChatInput = conversationId ? { conversationId } : {}
		if (answers) body.answers = answers
		else body.message = { text: requestParams.message?.text ?? '' }
		return body
	}

	transformLocalMessage(requestParams: Partial<SharedChatInput>): Turn | Turn[] {
		// Answers continue the turn on screen (x-sdk onReload discards local messages anyway).
		if (requestParams.answers) return []
		// The server mints the stored message's id; the page session's bubble has its own X id.
		return userTurn('local', requestParams.message?.text ?? '')
	}

	transformMessage(info: TransformMessage<Turn, SSEOutput>): Turn {
		const origin = info.originMessage ?? this.resumeBase ?? emptyAssistantTurn()
		const event = parseHubEvent(info.chunk?.data)
		if (!event) return origin
		if (event.type === 'CUSTOM' && event.name === HUB_RUN_EVENT) {
			const value = event.value as HubRunValue
			this.currentRunId = value.runId
			try {
				this.onRun(value)
			} catch {
				// Bookkeeping outside the turn must not end the stream (XRequest's catch would replace the bubble), the
				// Dify provider's rule.
			}
		} else if (event.type === 'STATE_SNAPSHOT') {
			try {
				this.onState(event.snapshot)
			} catch {
				// Same rule.
			}
		}
		// The wire is untyped JSON; the run route sent AG-UI events (spec §4.4), and the reducer narrows them by `type`.
		return applyAgUiEvent(origin, event as unknown as BaseEvent)
	}
}
