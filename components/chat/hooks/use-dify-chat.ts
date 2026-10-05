import {
	useXChat,
	XRequest,
	type DefaultMessageInfo,
	type MessageInfo,
	type SSEOutput,
} from '@ant-design/x-sdk'
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'

import type { IFile } from '@/lib/api'
import type { DifyApi } from '@/lib/dify-client'

import workflowDataStorage, { useWorkflowStore } from '../persistence/workflow-data-storage'
import { DifyChatProvider } from '../provider/dify-chat-provider'
import { createDifyFetch, DifyRequestError } from '../provider/dify-fetch'
import { mapHistoryPage, type HistoryMessage } from '../provider/history'
import { parseConversationKey } from '../provider/keys'
import {
	emptyAssistant,
	type DifyChatInput,
	type DifyChatMessage,
	type MessageError,
	type WorkflowState,
} from '../provider/message'
import { getProvider } from '../provider/provider-cache'
import { envelopeError, toDifyError } from './dify-errors'
import { nextPaging, prependLatestPage, prependOlder, type HistoryPaging } from './history-paging'

export const HISTORY_PAGE = 20

export interface SendParams {
	query: string
	inputs: Record<string, unknown>
	files: IFile[]
}

interface Options {
	appId: string
	/** The client conversation key, or '' while there is none yet (the list is still loading). */
	conversationKey: string
	getDifyConversationId: () => string | undefined
	/** A reply of `key` named its Dify conversation (DifyChatProviderOptions.onConversationId). */
	onConversationId?: (key: string, difyId: string) => void
	difyApi: DifyApi
	t: TFunction
}

/** GET /messages as `DifyApi.listMessages` returns it: the page, or Dify's error body on an HTTP error. */
interface MessagesAnswer {
	data?: HistoryMessage[]
	has_more?: boolean
}

// Per conversation key and module-global, like the SDK's message store they serve (use-x-chat:
// defaultMessages runs once per key per page session), so a remounted chat keeps them.
/** "Load earlier" cursor per key; with `historyErrors`, an external store for useSyncExternalStore (React reference). */
const paging = new Map<string, HistoryPaging>()
/** The failed first history load per key: `{ status, code?, message }`, `message` being Dify's text or ''. */
const historyErrors = new Map<string, DifyRequestError>()
const listeners = new Set<() => void>()
const notify = () => {
	for (const listener of listeners) listener()
}
const setPaging = (key: string, value: HistoryPaging) => {
	paging.set(key, value)
	notify()
}
const setHistoryError = (key: string, error: DifyRequestError | undefined) => {
	if (error) historyErrors.set(key, error)
	else historyErrors.delete(key)
	notify()
}
const subscribe = (listener: () => void) => {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}
/** Keys with an earlier page on the way (a second click asks for nothing). */
const pagesInFlight = new Set<string>()
/** Keys with a send waiting in the SDK's queue for their history. */
const queuedKeys = new Set<string>()
/** The latest `getDifyConversationId` given for each key; the key's cached provider reads it at send time. */
const difyIdReaders = new Map<string, () => string | undefined>()
/** The latest `onConversationId` given for each key; the key's cached provider calls it from its stream. */
const conversationIdSinks = new Map<string, (key: string, difyId: string) => void>()

/** A page without `data` is Dify's error body (DifyApi does not reject on an HTTP error). */
const fetchPage = async (difyApi: DifyApi, difyId: string, firstId?: string) => {
	const answer = (await difyApi.listMessages(difyId, { first_id: firstId, limit: HISTORY_PAGE })) as
		| MessagesAnswer
		| undefined
	if (!Array.isArray(answer?.data)) throw envelopeError(answer)
	return { ...answer, data: answer.data }
}

/** The zustand persist API the history loader waits on (zustand docs, "Persisting store data": API). */
interface PersistHydration {
	hasHydrated: () => boolean
	onFinishHydration: (listener: () => void) => () => void
}

/**
 * Resolves once a persisted store has read its storage: at once when `hasHydrated()`, otherwise on
 * `onFinishHydration` (subscribed first, as in the docs' `useHydration`). zustand calls no listener
 * when hydration fails (middleware `hydrate()` catch), so the wait ends at `boundMs` regardless.
 */
export const waitForHydration = (persist: PersistHydration, boundMs: number) =>
	new Promise<void>(resolve => {
		let timer: ReturnType<typeof setTimeout> | undefined
		const done = () => {
			clearTimeout(timer)
			unsubscribe()
			resolve()
		}
		const unsubscribe = persist.onFinishHydration(done)
		if (persist.hasHydrated()) done()
		else timer = setTimeout(done, boundMs)
	})

/** Longest wait for the workflow store's IndexedDB hydration before history renders without nodes. */
const HYDRATION_BOUND_MS = 3000
let workflowsHydrated: Promise<void> | undefined

/**
 * Workflow nodes for the history mapper (spec §4.10). The store is read after its first hydration
 * (one shared wait): before it, a full reload would find no nodes. The mapper tolerates a failing read.
 */
const workflowLoader = (appId: string, conversationId: string) => async (messageId: string) => {
	workflowsHydrated ??= waitForHydration(useWorkflowStore.persist, HYDRATION_BOUND_MS)
	await workflowsHydrated
	return (await workflowDataStorage.get({ appId, conversationId, messageId, key: 'workflows' })) as
		| WorkflowState
		| undefined
}

/** The latest history page of a conversation (its first load, or a retry of it); sets the key's cursor. */
const loadLatestPage = async (difyApi: DifyApi, appId: string, key: string, difyId: string) => {
	const page = await fetchPage(difyApi, difyId)
	setPaging(key, nextPaging(page))
	// Oldest first, as Dify answers (ADR-0017 note): the mapper keeps the order.
	return mapHistoryPage(page.data, { loadWorkflow: workflowLoader(appId, difyId) })
}

export type SendDecision = 'send' | 'queue' | 'ignore'

/**
 * One reply at a time per conversation. A send while this key's reply runs is ignored (Prompts and
 * regenerate are not blocked by the Sender). While the history loads, one send waits in the SDK's
 * queue (use-x-chat: queueRequest) and further ones are ignored: the SDK sends everything queued at
 * once when the history lands, which would run concurrent streams on the key's one provider.
 */
export const sendDecision = ({
	isRequesting,
	isDefaultMessagesRequesting,
	queued,
}: {
	isRequesting: boolean
	isDefaultMessagesRequesting: boolean
	queued: boolean
}): SendDecision => {
	if (isRequesting) return 'ignore'
	if (isDefaultMessagesRequesting) return queued ? 'ignore' : 'queue'
	return 'send'
}

const toMessageInfo = (
	info: DefaultMessageInfo<DifyChatMessage>,
	index: number,
): MessageInfo<DifyChatMessage> => ({
	...info,
	id: info.id ?? `older_${index}`,
	status: info.status ?? 'success',
})

const toMessageError = (error: Error, fallback: string): MessageError =>
	error instanceof DifyRequestError
		? {
				code: error.code,
				// HTTP/2 has no statusText, so an error without a body can arrive with an empty message.
				message: error.message || fallback,
				status: error.status,
			}
		: { message: fallback }

/**
 * useXChat's requestFallback (spec §4.5). A stopped reply keeps what it showed and is marked
 * `aborted` (use-x-chat skill, "Abort Request"); a failed one keeps it too (a streamed part, or the
 * paused HITL message of a resume, spec §4.6) and carries the error: Dify's text, or the generic one.
 * A failed resume (`resumed`) follows a form Dify already accepted, so its generic text says the
 * answer was sent rather than inviting a retry. `agentAnswer` is stream bookkeeping and never stays
 * on a finished message.
 */
export const fallbackMessage = (
	error: Error,
	current: DifyChatMessage | undefined,
	t: TFunction,
	resumed = false,
): DifyChatMessage => {
	const { agentAnswer: _agentAnswer, ...base } = current ?? emptyAssistant()
	if (error.name === 'AbortError') return { ...base, aborted: true }
	const fallback = resumed ? t('hitl.resume_failed') : t('common.request_failed_retry')
	return { ...base, error: toMessageError(error, fallback) }
}

/**
 * useXChat for one Dify conversation (spec §4.3): the key is the client conversation key, the
 * history is the SDK's async defaultMessages, a send during that load is queued (queueRequest),
 * and the per-key provider keeps a stream bound to the conversation it started in.
 */
export const useDifyChat = ({
	appId,
	conversationKey,
	getDifyConversationId,
	onConversationId,
	difyApi,
	t,
}: Options) => {
	// No provider (useXChat's `provider` is optional) and no key until there is a conversation: nothing is
	// cached for a placeholder key, and a send without one is ignored.
	const provider = !conversationKey
		? undefined
		: getProvider(
				conversationKey,
				() =>
					new DifyChatProvider({
						request: XRequest<DifyChatInput, SSEOutput, DifyChatMessage>(
							`/api/client/dify/${appId}/chat-messages`,
							{
								manual: true,
								fetch: createDifyFetch(appId),
								params: { response_mode: 'streaming' },
							},
						),
						getDifyConversationId: () => difyIdReaders.get(conversationKey)?.(),
						onConversationId: difyId =>
							conversationIdSinks.get(conversationKey)?.(conversationKey, difyId),
						onWorkflowUpdate: message => {
							const { conversationId, messageId } = message.ids
							if (conversationId && messageId && message.workflow) {
								void workflowDataStorage.set({
									appId,
									conversationId,
									messageId,
									key: 'workflows',
									value: message.workflow,
								})
							}
						},
					}),
			)

	const chat = useXChat<DifyChatMessage, DifyChatMessage, DifyChatInput, SSEOutput>({
		provider,
		conversationKey: conversationKey || undefined,
		defaultMessages: async ({ conversationKey: key = conversationKey }) => {
			const { difyId, temp } = parseConversationKey(key)
			if (temp || !difyId) return []
			try {
				return await loadLatestPage(difyApi, appId, key, difyId)
			} catch (error) {
				// A failed load must not look like an empty conversation: the store starts empty (the SDK
				// would do the same and only log), and the view shows this error with a retry.
				setHistoryError(key, toDifyError(error))
				return []
			}
		},
		// A resume keeps the paused message visible while the continuation connects (spec §4.6).
		requestPlaceholder: params => (params.resume ? params.resume.message : emptyAssistant()),
		// The SDK passes the request's params (use-x-chat API: requestFallback), so a resume is known here.
		requestFallback: (params, { error, messageInfo }) =>
			fallbackMessage(error, messageInfo?.message, t, Boolean(params.resume)),
	})

	// The callbacks below stay stable and read the committed render's values here (React: refs are
	// written in effects, not during rendering).
	const latest = useRef({ chat, conversationKey, difyApi, appId })
	useLayoutEffect(() => {
		latest.current = { chat, conversationKey, difyApi, appId }
		if (!conversationKey) return
		difyIdReaders.set(conversationKey, getDifyConversationId)
		if (onConversationId) conversationIdSinks.set(conversationKey, onConversationId)
	})

	// The SDK sends the queue when the history lands; a new send may wait again only after that.
	useEffect(() => {
		if (!chat.isDefaultMessagesRequesting) queuedKeys.delete(conversationKey)
	}, [chat.isDefaultMessagesRequesting, conversationKey])

	/** Sends, or queues while the history loads (sendDecision); false when the send was ignored. */
	const send = useCallback((params: SendParams) => {
		const { chat, conversationKey: key } = latest.current
		if (!key) return false
		const decision = sendDecision({
			isRequesting: chat.isRequesting,
			isDefaultMessagesRequesting: chat.isDefaultMessagesRequesting,
			queued: queuedKeys.has(key),
		})
		if (decision === 'ignore') return false
		const request: Partial<DifyChatInput> = {
			query: params.query,
			inputs: params.inputs,
			files: params.files,
		}
		if (decision === 'queue') {
			queuedKeys.add(key)
			chat.queueRequest(key, request)
		} else chat.onRequest(request)
		return true
	}, [])

	// XRequest's abort() reads an AbortController that exists only once a request has run.
	const abort = useCallback(() => {
		const { chat } = latest.current
		if (chat.isRequesting) chat.abort()
	}, [])

	/** Abort the stream, then tell Dify to stop the task (spec §4.5). */
	const stop = useCallback(async () => {
		const { chat, difyApi: api } = latest.current
		if (!chat.isRequesting) return
		const reply = chat.messages.findLast(
			m => m.message.role === 'assistant' && (m.status === 'loading' || m.status === 'updating'),
		)
		chat.abort()
		const taskId = reply?.message.ids.taskId
		if (taskId) await api.stopTask(taskId).catch(() => undefined)
	}, [])

	/** HITL continuation (spec §4.6): onReload updates the paused message from the resumed stream. */
	const resume = useCallback(
		(assistantId: string | number, workflowRunId: string, message: DifyChatMessage) =>
			latest.current.chat.onReload(assistantId, { resume: { workflowRunId, message } }),
		[],
	)

	/** Prepends the next older page; rejects with a DifyRequestError (message: Dify's text or ''). */
	const loadEarlier = useCallback(async () => {
		const { chat, conversationKey: key, difyApi: api, appId: app } = latest.current
		const { difyId } = parseConversationKey(key)
		const current = paging.get(key)
		if (!difyId || !current?.hasMore || pagesInFlight.has(key)) return
		// Taken now: this key's store, even if the user switches conversation while the page loads.
		const { setMessages } = chat
		pagesInFlight.add(key)
		try {
			const page = await fetchPage(api, difyId, current.firstId)
			const older = await mapHistoryPage(page.data, { loadWorkflow: workflowLoader(app, difyId) })
			setPaging(key, nextPaging(page, current))
			setMessages(prev => prependOlder(prev, older.map(toMessageInfo)))
		} catch (error) {
			throw toDifyError(error)
		} finally {
			pagesInFlight.delete(key)
		}
	}, [])

	/**
	 * Loads the latest page again after a failed first load (no rejection: a new failure is shown the
	 * same way). The SDK runs `defaultMessages` once per key, so this goes through the same page loader
	 * and the key's store setter; anything sent since the failure stays below the history (prependLatestPage).
	 */
	const retryHistory = useCallback(async () => {
		const { chat, conversationKey: key, difyApi: api, appId: app } = latest.current
		const { difyId } = parseConversationKey(key)
		if (!difyId || pagesInFlight.has(key)) return
		// Taken now: this key's store, even if the user switches conversation while the page loads.
		const { setMessages } = chat
		pagesInFlight.add(key)
		setHistoryError(key, undefined)
		try {
			const loaded = (await loadLatestPage(api, app, key, difyId)).map(toMessageInfo)
			setMessages(prev => prependLatestPage(prev, loaded))
		} catch (error) {
			setHistoryError(key, toDifyError(error))
		} finally {
			pagesInFlight.delete(key)
		}
	}, [])

	const hasMore = useSyncExternalStore(
		subscribe,
		() => paging.get(conversationKey)?.hasMore ?? false,
		() => false,
	)
	const historyError = useSyncExternalStore(
		subscribe,
		() => historyErrors.get(conversationKey),
		() => undefined,
	)

	return {
		messages: chat.messages,
		isRequesting: chat.isRequesting,
		isDefaultMessagesRequesting: chat.isDefaultMessagesRequesting,
		setMessage: chat.setMessage,
		setMessages: chat.setMessages,
		abort,
		send,
		stop,
		resume,
		loadEarlier,
		hasMore,
		historyError,
		retryHistory,
	}
}
