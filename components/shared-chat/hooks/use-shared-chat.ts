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
import { createQueuedSends, type QueuedSends } from '@/components/chat/hooks/queued-sends'
import { emptyAssistantTurn, type HubRunValue, type Turn } from '@/lib/chat/turn'
import type { RequestError } from '@/lib/http/browser'

import { decide, EMPTY_DRAFT, withoutAnswer, type AnswerDraft, type ItemAnswer } from '../answers'
import type { SharedChatApi } from '../api'
import { createHubFetch, runsUrl } from '../hub-fetch'
import { parseConversationKey } from '../keys'
import { AgUiChatProvider, type SharedChatInput } from '../provider/ag-ui-chat-provider'
import { getProvider } from '../provider-cache'
import {
	fallbackTurn,
	openItemsOf,
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
	/** The app's ask_user switch now (spec §6.2): its waiting calls are open items only while it is on (decision 62). */
	askUser: boolean
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
/** The decisions so far per key (spec §5.2: "the pending answers"; plan call P13), until the last open item has one. */
const drafts = new Map<string, AnswerDraft>()
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
const setDraft = (key: string, draft: AnswerDraft) => {
	drafts.set(key, draft)
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
/** The latest hook's queued-send `clear` for each key; the key's cached provider calls it when a reply ends (#68). */
const queuedClearers = new Map<string, QueuedSends['clear']>()

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
	askUser,
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
							// The end of every request, whatever ended it (x-chat-provider skill, "callbacks": onError
							// includes AbortError): the key's queued send no longer waits, whichever conversation is on
							// screen (#68; x-sdk 2.9.0 AbstractChatProvider.injectRequest calls these after useXChat's own
							// handlers, for every key).
							callbacks: {
								onSuccess: () => queuedClearers.get(conversationKey)?.(conversationKey),
								onError: () => queuedClearers.get(conversationKey)?.(conversationKey),
							},
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

	// Keys with a send waiting in the SDK's queue, per hook instance like that queue (useDifyChat's rule, the same
	// queued-sends.ts): `has` answers `send` at once, the state renders the view's guard.
	const [queuedKeys, setQueuedKeys] = useState<ReadonlySet<string>>(() => new Set())
	const [queued] = useState(() => createQueuedSends(setQueuedKeys))

	// The callbacks below stay stable and read the committed render's values here (React: refs are written in effects,
	// not during rendering).
	const latest = useRef({ chat, provider, conversationKey, api, askUser })
	useLayoutEffect(() => {
		latest.current = { chat, provider, conversationKey, api, askUser }
		if (!conversationKey) return
		conversationIdReaders.set(conversationKey, getConversationId)
		if (onRun) runSinks.set(conversationKey, onRun)
		queuedClearers.set(conversationKey, queued.clear)
	})

	// The queued send has left once its key requests (useDifyChat's rule); a reply that ends while another conversation
	// is on screen clears its key from the provider's callbacks (#68).
	useEffect(() => {
		if (chat.isRequesting) queued.clear(conversationKey)
	}, [chat.isRequesting, conversationKey, queued])

	/** Sends, or queues while the history loads (sendDecision); false when the send was ignored. */
	const send = useCallback(
		(text: string) => {
			const { chat, conversationKey: key } = latest.current
			if (!key) return false
			const decision = sendDecision({
				isRequesting: chat.isRequesting,
				isDefaultMessagesRequesting: chat.isDefaultMessagesRequesting,
				queued: queued.has(key),
			})
			if (decision === 'ignore') return false
			const request: Partial<SharedChatInput> = { message: { text } }
			if (decision === 'queue') {
				queued.add(key)
				chat.queueRequest(key, request)
			} else chat.onRequest(request)
			return true
		},
		[queued],
	)

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

	/**
	 * One card's decision (spec §6; decision 62's third answer; plan call P13): kept in the key's draft until every open
	 * item has one, then all of them go at once through `onReload`, which continues the turn in place (spike, "Browser
	 * side": approvals, ask-user and input_required continue one turn). The draft is emptied before the request, so a
	 * failed one leaves the cards to start over, and `decide` ignores a decision while a request runs, so one decision
	 * never sends twice.
	 */
	const answer = useCallback((item: ItemAnswer) => {
		const { chat, provider: current, conversationKey: key, askUser: advertised } = latest.current
		const last = chat.messages.at(-1)
		if (!key || !last) return
		const decision = decide({
			open: openItemsOf(chat.messages, advertised),
			// The draft as it is now, not as a render saw it: a card may record several decisions in one handler.
			draft: drafts.get(key) ?? EMPTY_DRAFT,
			answer: item,
			// The request's own flag turns at once when onReload runs it (x-request API, XRequestClass `isRequesting`);
			// the hook's turns with the next render.
			isRequesting: chat.isRequesting || Boolean(current?.request.isRequesting),
			// Read when the card is clicked (an event handler, not a render): a resolved decision for an interrupt that
			// expired since then no longer counts (P14).
			now: new Date(),
		})
		if (decision.action === 'ignore') return
		if (decision.action === 'keep') {
			setDraft(key, decision.draft)
			return
		}
		setDraft(key, EMPTY_DRAFT)
		chat.onReload(last.id, { answers: decision.body, continues: last.message })
	}, [])

	/** "Change" (plan call P13): forgets an item's decision, until the answers have gone. */
	const retract = useCallback((itemId: string) => {
		const { chat, conversationKey: key } = latest.current
		if (!key || chat.isRequesting) return
		setDraft(key, withoutAnswer(drafts.get(key) ?? EMPTY_DRAFT, itemId))
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
	const draft = useSyncExternalStore(
		subscribe,
		() => drafts.get(conversationKey) ?? EMPTY_DRAFT,
		() => EMPTY_DRAFT,
	)
	const openItems = useMemo(() => openItemsOf(chat.messages, askUser), [chat.messages, askUser])

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
		/** What the last turn waits for (spec §3.3, §6); while anything is open the Sender is disabled (decision 50). */
		openItems,
		/** The decisions so far for those items (plan call P13). */
		draft,
		answer,
		retract,
	}
}
