import { useXChat, XRequest, type SSEOutput } from '@ant-design/x-sdk'
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'

import { prependOlder } from '@/components/chat/hooks/history-paging'
import { emptyAssistantTurn, type HubRunValue, type Turn } from '@/lib/chat/turn'
import type { RequestError } from '@/lib/http/browser'

import type { SharedChatApi } from '../api'
import { createHubFetch, runsUrl } from '../hub-fetch'
import { parseConversationKey } from '../keys'
import { AgUiChatProvider, type SharedChatInput } from '../provider/ag-ui-chat-provider'
import { getProvider } from '../provider-cache'
import {
	fallbackTurn,
	openInterruptsOf,
	prependLatestTurns,
	sendDecision,
	toMessageInfo,
	toRequestError,
} from './chat-helpers'

interface Options {
	appId: string
	/** The client conversation key, or '' while there is none yet (the list is still loading). */
	conversationKey: string
	api: SharedChatApi
	/** The server's id of the conversation on screen, if it has one (the list holds it). */
	getConversationId: () => string | undefined
	/** A stream of `key` named its conversation and run (`hub:run`), whichever conversation is on screen by then. */
	onRun?: (key: string, value: HubRunValue) => void
}

// Per conversation key and module-global, like the SDK's message store they serve (use-x-chat: defaultMessages runs
// once per key per page session), so a remounted chat keeps them; read through useSyncExternalStore (React reference),
// as useDifyChat's side store.
/** "Load earlier" cursor per key (plan call P8); null once nothing is older. */
const cursors = new Map<string, string | null>()
/** The failed first history load per key. */
const historyErrors = new Map<string, RequestError>()
/** The agent's state per key (spec §5.2: the side store holds it; 2b's plan panel reads it). */
const states = new Map<string, unknown>()
const listeners = new Set<() => void>()
const notify = () => {
	for (const listener of listeners) listener()
}
const setCursor = (key: string, cursor: string | null) => {
	cursors.set(key, cursor)
	notify()
}
const setHistoryError = (key: string, error: RequestError | undefined) => {
	if (error) historyErrors.set(key, error)
	else historyErrors.delete(key)
	notify()
}
const setStateOf = (key: string, state: unknown) => {
	states.set(key, state)
	notify()
}
const subscribe = (listener: () => void) => {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}
/** Keys with a page on the way (a second click asks for nothing). */
const pagesInFlight = new Set<string>()
/** The latest `getConversationId` given for each key; the key's cached provider reads it at send time. */
const conversationIdReaders = new Map<string, () => string | undefined>()
/** The latest `onRun` given for each key; the key's cached provider calls it from its stream. */
const runSinks = new Map<string, (key: string, value: HubRunValue) => void>()

/** The latest page of a conversation (its first load, or a retry of it); sets the key's cursor and state. */
const loadLatestPage = async (api: SharedChatApi, key: string, conversationId: string) => {
	const page = await api.getConversation(conversationId)
	setCursor(key, page.cursor)
	setStateOf(key, page.state)
	return page.turns.map(toMessageInfo)
}

/**
 * useXChat for one shared-chat conversation (spec §5.2, built like useDifyChat): the key is the client conversation
 * key; the history is the SDK's async `defaultMessages` (the server's turns, spec §3.3); a send during that load is
 * queued (`queueRequest`); the per-key provider keeps a stream bound to the conversation it started in; Stop asks the
 * hub's stop route to end the run in place (spec §4.5) and aborts the fetch only when that request fails.
 */
export const useSharedChat = ({
	appId,
	conversationKey,
	api,
	getConversationId,
	onRun,
}: Options) => {
	// No provider (useXChat's `provider` is optional) and no key until there is a conversation: nothing is cached for a
	// placeholder key, and a send without one is ignored.
	const provider = !conversationKey
		? undefined
		: getProvider(
				conversationKey,
				() =>
					new AgUiChatProvider({
						request: XRequest<SharedChatInput, SSEOutput, Turn>(runsUrl(appId), {
							manual: true,
							fetch: createHubFetch(appId),
						}),
						getConversationId: () => conversationIdReaders.get(conversationKey)?.(),
						onRun: value => runSinks.get(conversationKey)?.(conversationKey, value),
						onState: state => setStateOf(conversationKey, state),
					}),
			)

	const chat = useXChat<Turn, Turn, SharedChatInput, SSEOutput>({
		provider,
		conversationKey: conversationKey || undefined,
		defaultMessages: async ({ conversationKey: key = conversationKey }) => {
			const { conversationId, temp } = parseConversationKey(key)
			if (temp || !conversationId) return []
			try {
				return await loadLatestPage(api, key, conversationId)
			} catch (error) {
				// A failed load must not look like an empty conversation: the store starts empty (the SDK would do the same
				// and only log), and the view shows this error with a retry.
				setHistoryError(key, toRequestError(error))
				return []
			}
		},
		// Answers continue the turn on screen, which stays visible while the continuation connects (spec §5.2).
		requestPlaceholder: params => params.continues ?? emptyAssistantTurn(),
		// The SDK passes the request's params (use-x-chat API: requestFallback), so the continued turn is known here.
		requestFallback: (params, { error, messageInfo }) =>
			fallbackTurn(error, messageInfo?.message ?? params.continues),
	})

	// The callbacks below stay stable and read the committed render's values here (React: refs are written in effects,
	// not during rendering).
	const latest = useRef({ chat, provider, conversationKey, api })
	useLayoutEffect(() => {
		latest.current = { chat, provider, conversationKey, api }
		if (!conversationKey) return
		conversationIdReaders.set(conversationKey, getConversationId)
		if (onRun) runSinks.set(conversationKey, onRun)
	})

	// Keys with a send waiting in the SDK's queue, per hook instance like that queue (useDifyChat's rule): the ref
	// answers `send` at once, the state renders the view's guard.
	const queuedRef = useRef(new Set<string>())
	const [queuedKeys, setQueuedKeys] = useState<ReadonlySet<string>>(() => new Set())
	useEffect(() => {
		if (!chat.isRequesting || !queuedRef.current.has(conversationKey)) return
		queuedRef.current.delete(conversationKey)
		setQueuedKeys(new Set(queuedRef.current))
	}, [chat.isRequesting, conversationKey])

	/** Sends, or queues while the history loads (sendDecision); false when the send was ignored. */
	const send = useCallback((text: string) => {
		const { chat, conversationKey: key } = latest.current
		if (!key) return false
		const decision = sendDecision({
			isRequesting: chat.isRequesting,
			isDefaultMessagesRequesting: chat.isDefaultMessagesRequesting,
			queued: queuedRef.current.has(key),
		})
		if (decision === 'ignore') return false
		const request: Partial<SharedChatInput> = { message: { text } }
		if (decision === 'queue') {
			queuedRef.current.add(key)
			setQueuedKeys(new Set(queuedRef.current))
			chat.queueRequest(key, request)
		} else chat.onRequest(request)
		return true
	}, [])

	/**
	 * Spec §4.5 and §5.2: the hub's stop route aborts the agent and ends the stream with `RUN_FINISHED` cancelled, so the
	 * turn finishes in place ("Stopped"). Only when there is no run to name yet, or that request fails, is the fetch
	 * aborted (XRequest's abort; the turn then moves to the end, ADR-0017's note, and the server stores it truncated).
	 */
	const stop = useCallback(async () => {
		const { chat, provider: current, conversationKey: key, api: client } = latest.current
		if (!chat.isRequesting) return
		const runId = current?.runId
		const conversationId =
			conversationIdReaders.get(key)?.() ?? parseConversationKey(key).conversationId
		if (runId && conversationId) {
			try {
				await client.stopRun(conversationId, runId)
				return
			} catch {
				// Falls through: the stream is closed from this side instead.
			}
		}
		// XRequest's abort() reads an AbortController that exists only once a request has run (useDifyChat's guard).
		if (latest.current.chat.isRequesting) latest.current.chat.abort()
	}, [])

	/** Prepends the next older page (plan call P8); rejects with a RequestError. */
	const loadEarlier = useCallback(async () => {
		const { chat, conversationKey: key, api: client } = latest.current
		const { conversationId } = parseConversationKey(key)
		const cursor = cursors.get(key)
		if (!conversationId || !cursor || pagesInFlight.has(key)) return
		// Taken now: this key's store, even if the user switches conversation while the page loads.
		const { setMessages } = chat
		pagesInFlight.add(key)
		try {
			const page = await client.getConversation(conversationId, cursor)
			setCursor(key, page.cursor)
			setMessages(previous => prependOlder(previous, page.turns.map(toMessageInfo)))
		} catch (error) {
			throw toRequestError(error)
		} finally {
			pagesInFlight.delete(key)
		}
	}, [])

	/** Loads the latest page again after a failed first load; what was sent since stays below it (prependLatestTurns). */
	const retryHistory = useCallback(async () => {
		const { chat, conversationKey: key, api: client } = latest.current
		const { conversationId } = parseConversationKey(key)
		if (!conversationId || pagesInFlight.has(key)) return
		const { setMessages } = chat
		pagesInFlight.add(key)
		setHistoryError(key, undefined)
		try {
			const loaded = await loadLatestPage(client, key, conversationId)
			setMessages(previous => prependLatestTurns(previous, loaded))
		} catch (error) {
			setHistoryError(key, toRequestError(error))
		} finally {
			pagesInFlight.delete(key)
		}
	}, [])

	const hasMore = useSyncExternalStore(
		subscribe,
		() => Boolean(cursors.get(conversationKey)),
		() => false,
	)
	const historyError = useSyncExternalStore(
		subscribe,
		() => historyErrors.get(conversationKey),
		() => undefined,
	)
	const state = useSyncExternalStore(
		subscribe,
		() => states.get(conversationKey),
		() => undefined,
	)
	const openInterrupts = useMemo(() => openInterruptsOf(chat.messages), [chat.messages])

	return {
		messages: chat.messages,
		isRequesting: chat.isRequesting,
		isDefaultMessagesRequesting: chat.isDefaultMessagesRequesting,
		/** A send waits in the SDK's queue for this conversation's history; its reply has not started yet. */
		queued: queuedKeys.has(conversationKey),
		send,
		stop,
		loadEarlier,
		hasMore,
		historyError,
		retryHistory,
		/** The agent's last state (spec §5.2); 2b's plan panel reads it. */
		state,
		/** The last turn's open interrupts (spec §3.3); while any is open the Sender is disabled (plan call P3). */
		openInterrupts,
	}
}
