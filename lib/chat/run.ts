import 'server-only'

import type { Message, ResumeEntry } from '@ag-ui/core'

import type { SessionUser } from '@/lib/auth/session'
import {
	finishRun,
	continuedRun,
	loadThread,
	startRun,
	truncateStaleRun,
	type ConversationRecord,
	type RunKey,
} from '@/lib/data/conversations'
import { logActionError } from '@/lib/error-log'
import { errorResponse } from '@/lib/http/errors'
import type { ProviderId } from '@/lib/providers/ids'
import type { ProviderAppAccess } from '@/lib/providers/route'

import { activeRuns } from './active-runs'
import {
	UPSTREAM_STATUS,
	type ChatAdapter,
	type ChatTurnHandle,
	type ChatTurnOpened,
	type UpstreamErrorCode,
} from './adapter'
import { checkAnswers, openItemsOf } from './answers'
import { conversationNotFound, resolveConversation } from './route'
import type { RunBody } from './schemas'
import { RunSession } from './session'
import { createEventStream, SSE_HEADERS } from './stream'
import {
	errorToolMessage,
	threadForAgent,
	titleFrom,
	UNAVAILABLE_TOOL_CONTENT,
	UNAVAILABLE_TOOL_ERROR,
	unansweredToolCalls,
} from './thread'

/*
 * A run on the server (Part 2 spec §4.3): the checks, the store, the RunAgentInput, the upstream errors before any
 * stream, then the stream while the session persists (Task 10). Next's "Streaming in Route Handlers" answers a
 * `ReadableStream`; the run goes on while that response streams, writing into it, and closes it at the end.
 */

/** Spec §4.3 step 4 and plan call P5: the envelope's message per code ("The agent is restarting, try again"). */
export const UPSTREAM_MESSAGES: Record<UpstreamErrorCode, string> = {
	agent_auth_failed: 'The agent refused the hub’s credentials.',
	agent_not_found: 'The agent was not found.',
	agent_rejected_input: 'The agent refused the request.',
	provider_unreachable: 'The agent is restarting, try again.',
	upstream_error: 'The agent answered with an error.',
}

const ANSWER_PENDING = 'Answer the open question first.'
const ANSWERS_INVALID = 'The answers do not match what the conversation waits for.'
const RUN_IN_PROGRESS = 'A run is already in progress in this conversation.'

/** Spec §3.2 step 5: a run stored as running that this process does not hold was left by a crash; it becomes truncated. */
export const reconcileStaleRun = async (conversation: ConversationRecord): Promise<void> => {
	const runId = conversation.activeRunId
	if (runId && !activeRuns.has(runId))
		await truncateStaleRun({ conversationId: conversation.id, runId })
}

export interface RunTurnArgs {
	request: Request
	actor: SessionUser
	app: ProviderAppAccess<ProviderId>
	chat: ChatAdapter<ProviderId>
	body: RunBody
}

/** Spec §4.4: log lines carry the app, the run and a code, never content. */
const logRun = (appId: string, runId: string, code: string) =>
	console.error('runTurn:', { appId, runId, code })

/**
 * Spec §4.3. Step 1, the checks: the conversation is the actor's (§4.1); a run this process lost is truncated first
 * (§3.2 step 5); a message while something is open answers 409 answer_pending (decision 50), answers that do not cover
 * what is open 400 answers_invalid. Step 2, the store: the messages and the run in one transaction (startRun; an active
 * run answers 409 run_in_progress), a new conversation created with them. Steps 3–5 in streamRun.
 */
export const runTurn = async ({
	request,
	actor,
	app,
	chat,
	body,
}: RunTurnArgs): Promise<Response> => {
	let conversation: ConversationRecord | null = null
	if (body.conversationId) {
		const found = await resolveConversation(actor, app.id, body.conversationId)
		if (!found.ok) return found.response
		conversation = found.conversation
		await reconcileStaleRun(conversation)
	}
	const open = openItemsOf(conversation ? await continuedRun(conversation.id) : null)
	let resume: ResumeEntry[] | undefined
	let answers: Message[] = []
	if (body.answers) {
		const checked = checkAnswers(open, body.answers)
		if (!checked.ok) return errorResponse('answers_invalid', ANSWERS_INVALID, 400)
		resume = checked.resume
		answers = checked.toolMessages
	} else if (open.interrupts.length > 0) return errorResponse('answer_pending', ANSWER_PENDING, 409)

	// Plan call P4 (spec §6.2): a call to a tool the hub never advertised, left without a result, is answered with an error
	// tool message, so the next history is valid. The calls the answers cover, and a gated call an open interrupt names
	// (its result comes from the resumed run), are left alone.
	const rows = conversation ? await loadThread(conversation.id) : []
	const kept = new Set([
		...answers.flatMap(message => (message.role === 'tool' ? [message.toolCallId] : [])),
		...open.interrupts.flatMap(interrupt => (interrupt.toolCallId ? [interrupt.toolCallId] : [])),
	])
	const notAvailable = unansweredToolCalls(threadForAgent(rows))
		.filter(call => !kept.has(call.toolCallId))
		.map(call =>
			errorToolMessage(call.toolCallId, UNAVAILABLE_TOOL_ERROR, UNAVAILABLE_TOOL_CONTENT),
		)
	const text = body.message?.text
	const userMessage: Message[] =
		text === undefined ? [] : [{ id: crypto.randomUUID(), role: 'user', content: text }]
	const title = conversation ? conversation.title : titleFrom(text ?? '')

	// The run is held by this process before the database says it is active: a request that finds an activeRunId that
	// activeRuns does not hold truncates it as a crash's leftover (spec §3.2 step 5), so registering after startRun would
	// leave a window in which a live run is truncated. The ids are known beforehand (a new conversation's is made here).
	const runId = crypto.randomUUID()
	const conversationId = conversation ? conversation.id : crypto.randomUUID()
	const controller = new AbortController()
	activeRuns.register(runId, { conversationId, controller })
	let started: Awaited<ReturnType<typeof startRun>>
	try {
		started = await startRun(actor, {
			appId: app.id,
			conversation: conversation
				? { id: conversationId }
				: { id: conversationId, title, isNew: true },
			runId,
			messages: [...notAvailable, ...answers, ...userMessage],
			resume,
		})
	} catch (error) {
		activeRuns.release(runId)
		throw error
	}
	if (!started.ok) {
		activeRuns.release(runId)
		return started.code === 'run_in_progress'
			? errorResponse('run_in_progress', RUN_IN_PROGRESS, 409)
			: conversationNotFound()
	}
	return streamRun({
		request,
		actor,
		app,
		chat,
		key: started.key,
		controller,
		title,
		state: conversation?.state ?? {},
		resume,
	})
}

/**
 * Steps 3–5. The thread is read back from the store (§3.3), the rows just written included, and handed to the adapter
 * with the run's own AbortController, which the stop route (§4.5) and a disconnect abort through activeRuns. The session
 * writes `hub:run` before the adapter can report an event. A refusal before any stream (§4.3 step 4) answers the envelope
 * and stores the run failed, unless a stop caused it: then, as every other run, it is settled by the session (§4.5).
 */
const streamRun = async ({
	request,
	actor,
	app,
	chat,
	key,
	controller,
	title,
	state,
	resume,
}: Omit<RunTurnArgs, 'body'> & {
	key: RunKey
	controller: AbortController
	title: string
	state: unknown
	resume: ResumeEntry[] | undefined
}): Promise<Response> => {
	const out = createEventStream()
	let onDisconnect: (() => void) | undefined
	const detach = () => {
		if (onDisconnect) request.signal.removeEventListener('abort', onDisconnect)
	}
	let session: RunSession
	let handle: ChatTurnHandle
	let opened: ChatTurnOpened
	try {
		const messages = threadForAgent(await loadThread(key.conversationId))
		// The session seeds its write memory with the thread the agent is given, so no history row is written again (Task 10).
		session = new RunSession({ key, appId: app.id, title, out, history: messages })
		// Spec §4.5: the browser that goes away aborts the upstream request (the run is stored truncated). Next aborts
		// `request.signal` when the client disconnects: the docs are silent for Node Route Handlers; the source is
		// NextRequestAdapter (part2-proxy-stop-identity.md §6). A signal already aborted fires no event, so it is read first.
		onDisconnect = () => void activeRuns.stop(key.runId, key.conversationId, 'disconnect')
		if (request.signal.aborted) onDisconnect()
		else request.signal.addEventListener('abort', onDisconnect, { once: true })
		session.start()
		handle = chat.runTurn(
			{ settings: app.settings, secrets: app.secrets },
			{
				threadId: key.conversationId,
				runId: key.runId,
				messages,
				state,
				tools: [],
				resume,
				caller: { id: actor.id, source: actor.source, role: actor.role },
				abortController: controller,
			},
			session,
		)
		opened = await handle.opened
	} catch (error) {
		// An upstream request the adapter already started must not outlive the failure.
		controller.abort()
		detach()
		// The run is stored before it is released, as in settle: a concurrent request must not truncate it meanwhile.
		try {
			await finishRun(key, {
				status: 'failed',
				error: { code: 'internal_error', message: '' },
				custom: [],
			})
		} catch (finishError) {
			logActionError(finishError, 'runTurn')
		} finally {
			endStream(out, key.runId)
		}
		throw error
	}
	if (!opened.ok && activeRuns.reasonOf(key.runId) === undefined) {
		logRun(app.id, key.runId, opened.code)
		detach()
		try {
			await finishRun(key, {
				status: 'failed',
				error: { code: opened.code, message: UPSTREAM_MESSAGES[opened.code] },
				custom: [],
			})
		} finally {
			endStream(out, key.runId)
		}
		return errorResponse(opened.code, UPSTREAM_MESSAGES[opened.code], UPSTREAM_STATUS[opened.code])
	}
	void settle(handle, session, key, app.id, out, detach)
	return new Response(out.stream, { headers: SSE_HEADERS })
}

/** Closes the browser's stream first (an open one reschedules its keep-alive for good), then lets the process release the run. */
const endStream = (out: { close(): void }, runId: string): void => {
	try {
		out.close()
	} finally {
		activeRuns.release(runId)
	}
}

/**
 * The rest of the run while the response streams: once the adapter's run is over (`finished` never rejects), the session
 * decides its status, closes what is open, writes the end and the browser's last events (§3.2 steps 3–4, §4.5); then the
 * stream ends and the run is released. A failing end write is logged by code; the run stays stored as running, and once
 * released the next request truncates it (§3.2 step 5).
 */
const settle = async (
	handle: ChatTurnHandle,
	session: RunSession,
	key: RunKey,
	appId: string,
	out: { close(): void },
	detach: () => void,
): Promise<void> => {
	try {
		const { failed } = await handle.finished
		await session.finish({ failed, stopReason: activeRuns.reasonOf(key.runId) })
	} catch (error) {
		logRun(appId, key.runId, 'finish_failed')
		logActionError(error, 'runTurn')
	} finally {
		detach()
		endStream(out, key.runId)
	}
}
