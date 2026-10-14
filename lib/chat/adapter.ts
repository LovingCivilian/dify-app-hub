import 'server-only'

import type { BaseEvent, Message, ResumeEntry, Tool } from '@ag-ui/core'

import type { ProviderCaller } from '@/lib/providers/caller'
import type { ProviderId } from '@/lib/providers/ids'
import type { ProviderSecrets, ProviderSettings } from '@/lib/providers/schemas'

/*
 * The shared chat's seam toward a provider (Part 2 spec §4.1): the run route (lib/chat/run.ts) builds one turn's input
 * from the store, the provider's adapter runs it and reports AG-UI events to a sink, and the run session
 * (lib/chat/session.ts) stores and forwards them. AG-UI's adapter is lib/providers/agui/chat.ts; Part 3 adds Dify's
 * translating one. The browser contract stays AG-UI either way (decision 52).
 */

/** What a provider's chat adapter is given for one turn (spec §4.1, §4.3 step 3). */
export interface ChatTurnInput {
	/** The conversation id: the AG-UI threadId (spec §3.1). */
	threadId: string
	/** Minted by the hub, never reused (spec §3.1). */
	runId: string
	/** The stored thread as threadForAgent() built it (lib/chat/thread.ts): seq order, no activity messages. */
	messages: Message[]
	state: unknown
	/** 2a: always [] (plan call P4). */
	tools: Tool[]
	resume?: ResumeEntry[]
	caller: ProviderCaller
	/** Owned by the run session; aborting it closes the upstream request (spec §4.5). */
	abortController: AbortController
}

/** Where an adapter reports the run (the run session implements it). */
export interface ChatTurnSink {
	/** Each event after the client's compatibility boundary, enforcement and verification, before it is applied. */
	event(event: BaseEvent): void
	/** The thread's whole message list after an event changed it. */
	messages(messages: readonly Message[]): void
	/** The thread's state after an event changed it. */
	state(state: unknown): void
}

export type UpstreamErrorCode =
	| 'agent_auth_failed'
	| 'agent_not_found'
	| 'agent_rejected_input'
	| 'provider_unreachable'
	| 'upstream_error'

/** Spec §4.3 step 4 and plan call P5: each code's HTTP status toward the browser. */
export const UPSTREAM_STATUS: Record<UpstreamErrorCode, number> = {
	agent_auth_failed: 502,
	agent_not_found: 502,
	agent_rejected_input: 502,
	provider_unreachable: 503,
	upstream_error: 502,
}

export type ChatTurnOpened = { ok: true } | { ok: false; code: UpstreamErrorCode }

export interface ChatTurnHandle {
	/** Settles once the agent answered: with a stream (ok), or with why not (spec §4.3 step 4). Never rejects. */
	opened: Promise<ChatTurnOpened>
	/** Settles when the run is over, however it ended. `failed` when the stream broke with an error that is not an abort. Never rejects. */
	finished: Promise<{ failed: boolean }>
}

export interface ChatAdapter<P extends ProviderId> {
	runTurn(
		app: { settings: ProviderSettings<P>; secrets: ProviderSecrets<P> },
		input: ChatTurnInput,
		sink: ChatTurnSink,
	): ChatTurnHandle
}
