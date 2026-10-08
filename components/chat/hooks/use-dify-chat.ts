import {
	useXChat,
	XRequest,
	type DefaultMessageInfo,
	type MessageInfo,
	type SSEOutput,
} from '@ant-design/x-sdk'
import type { TFunction } from 'i18next'
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'

import type { DifyApi } from '@/lib/dify/browser'
import type { HumanInputSubmission } from '@/lib/dify/types'

import workflowDataStorage, { useWorkflowStore } from '../persistence/workflow-data-storage'
import { DifyChatProvider } from '../provider/dify-chat-provider'
import { createDifyFetch, DifyRequestError } from '../provider/dify-fetch'
import { mapHistoryPage } from '../provider/history'
import { parseConversationKey } from '../provider/keys'
import {
	emptyAssistant,
	type DifyChatFile,
	type DifyChatInput,
	type DifyChatMessage,
	type MessageError,
	type WorkflowState,
} from '../provider/message'
import { getProvider } from '../provider/provider-cache'
import { ContinuationLostError, failureText, FormNotWaitingError, toDifyError } from './dify-errors'
import { nextPaging, prependLatestPage, prependOlder, type HistoryPaging } from './history-paging'

export const HISTORY_PAGE = 20

export interface SendParams {
	query: string
	inputs: Record<string, unknown>
	files: DifyChatFile[]
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
/** The latest `getDifyConversationId` given for each key; the key's cached provider reads it at send time. */
const difyIdReaders = new Map<string, () => string | undefined>()
/** The latest `onConversationId` given for each key; the key's cached provider calls it from its stream. */
const conversationIdSinks = new Map<string, (key: string, difyId: string) => void>()

/** One page of GET /messages; the browser client rejects with DifyRequestError on an HTTP error. */
const fetchPage = (difyApi: DifyApi, difyId: string, firstId?: string) =>
	difyApi.listMessages({ conversation_id: difyId, first_id: firstId, limit: HISTORY_PAGE })

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

/** Reads one stored item of a message after the store's first hydration (one shared wait). */
const storedItem = async (
	appId: string,
	conversationId: string,
	messageId: string,
	key: string,
) => {
	workflowsHydrated ??= waitForHydration(useWorkflowStore.persist, HYDRATION_BOUND_MS)
	await workflowsHydrated
	return workflowDataStorage.get({ appId, conversationId, messageId, key })
}

/**
 * Workflow nodes and the streamed reasoning for the history mapper (spec §4.10): neither is part of GET /messages.
 * The store is read after its first hydration: before it, a full reload would find nothing. The mapper tolerates a
 * failing read.
 */
const historyLoaders = (appId: string, conversationId: string) => ({
	loadWorkflow: async (messageId: string) =>
		(await storedItem(appId, conversationId, messageId, 'workflows')) as WorkflowState | undefined,
	loadReasoning: async (messageId: string) => {
		const reasoning = await storedItem(appId, conversationId, messageId, 'reasoning')
		return typeof reasoning === 'string' ? reasoning : undefined
	},
})

/** The latest history page of a conversation (its first load, or a retry of it); sets the key's cursor. */
const loadLatestPage = async (difyApi: DifyApi, appId: string, key: string, difyId: string) => {
	const page = await fetchPage(difyApi, difyId)
	setPaging(key, nextPaging(page))
	// Oldest first, as Dify answers (ADR-0017 note): the mapper keeps the order.
	return mapHistoryPage(page.data, historyLoaders(appId, difyId))
}

export type SendDecision = 'send' | 'queue' | 'ignore'

/**
 * One reply at a time per conversation. A send while this key's reply runs is ignored (Prompts and
 * regenerate are not blocked by the Sender). While the history loads, one send waits in the SDK's
 * queue (use-x-chat: queueRequest) and further ones are ignored until its reply has started: the SDK
 * sends everything queued at once, in a `setTimeout` after the history lands, which would run
 * concurrent streams on the key's one provider.
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
	if (isRequesting || queued) return 'ignore'
	return isDefaultMessagesRequesting ? 'queue' : 'send'
}

const toMessageInfo = (
	info: DefaultMessageInfo<DifyChatMessage>,
	index: number,
): MessageInfo<DifyChatMessage> => ({
	...info,
	id: info.id ?? `older_${index}`,
	status: info.status ?? 'success',
})

const toMessageError = (error: Error, t: TFunction, fallback: string): MessageError =>
	error instanceof DifyRequestError
		? { code: error.code, message: failureText(error, t, fallback), status: error.status }
		: { message: fallback }

/** The run waits on a form not answered on the resume stream: nothing failed, and the form is still open. */
const waitsOnForm = (message: DifyChatMessage, answeredToken: string | undefined) =>
	message.humanInput?.state === 'pending' && message.humanInput.formToken !== answeredToken

/**
 * useXChat's requestFallback (spec §4.5). A stopped reply keeps what it showed and is marked
 * `aborted` (use-x-chat skill, "Abort Request"); a failed one keeps it too (a streamed part, or the
 * paused HITL message of a resume, spec §4.6) and carries the error: Dify's text, or the generic one.
 * A resume (`resume`) that ends while its run waits on a form not answered on it (before the answer went out,
 * after Dify refused it, or at the next form) leaves the message as it is. A failed resume after Dify accepted
 * the answer (`answeredToken`) says the answer was sent rather than inviting a retry. `agentAnswer` is stream
 * bookkeeping and never stays on a finished message.
 */
export const fallbackMessage = (
	error: Error,
	current: DifyChatMessage | undefined,
	t: TFunction,
	resume?: { answeredToken?: string },
): DifyChatMessage => {
	const { agentAnswer: _agentAnswer, ...base } = current ?? emptyAssistant()
	if (resume && waitsOnForm(base, resume.answeredToken)) return base
	if (error.name === 'AbortError') return { ...base, aborted: true }
	const fallback = resume ? t('hitl.resume_failed') : t('common.request_failed_retry')
	return { ...base, error: toMessageError(error, t, fallback) }
}

/**
 * The Dify task a Stop ends (spec §4.5): none for a run that waits on a form, where only the stream closes. Nothing
 * runs on Dify then, and Dify's own chat posts no stop while paused (handleStop: `!pausedStateRef.current`).
 */
export const taskToStop = (message: DifyChatMessage | undefined): string | undefined =>
	message?.workflow?.status === 'paused' ? undefined : message?.ids.taskId

/** What answerInOrder takes from the hook: the conversation's state, its provider and the browser client. */
export interface AnswerDeps {
	/** A reply of this conversation streams (the key's provider has one XRequest). */
	isRequesting: boolean
	/** x-sdk's onReload with a resume: the paused message goes on from the run's events stream. */
	reload: (assistantId: string | number, resume: NonNullable<DifyChatInput['resume']>) => void
	provider: Pick<
		DifyChatProvider,
		'isPausedOn' | 'waitForPause' | 'endResume' | 'markAnswered' | 'continuationLost'
	>
	submit: (formToken: string, answer: HumanInputSubmission) => Promise<unknown>
}

/**
 * Answers a paused run's form (spec §4.6; the order is the ADR-0017 note of 2026-10-08) as Dify's own chat does
 * (web/app/components/base/chat/chat/hooks.ts in 1.17.1): the run's events stream opens first and the answer goes
 * out once Dify's replay reached the pause. Dify resumes the run as soon as it accepts the answer and sends the
 * events only to the listeners it has then, so a stream opened after the answer can miss them: the form then looks
 * unanswered and the node keeps running. When Dify refused an earlier answer the run still waits on the open stream
 * and this answer goes out on it. Resolves true once Dify accepted the answer, false when nothing was sent (no
 * token, or another reply streams). Rejects with the stream's failure, FormNotWaitingError when the replay shows no
 * pause on this form, Dify's refusal, or ContinuationLostError when Dify accepted the answer after the stream closed.
 */
export const answerInOrder = async (
	deps: AnswerDeps,
	assistantId: string | number,
	message: DifyChatMessage,
	answer: HumanInputSubmission,
): Promise<boolean> => {
	const form = message.humanInput
	const { provider } = deps
	if (!form?.formToken) return false
	if (!provider.isPausedOn(form.workflowRunId, form.formToken)) {
		if (deps.isRequesting) return false
		const paused = provider.waitForPause()
		try {
			deps.reload(assistantId, { workflowRunId: form.workflowRunId, message })
		} catch (error) {
			// x-sdk throws for a message its store no longer holds; nothing was requested.
			provider.endResume()
			throw error
		}
		const opened = await paused
		if (!opened.paused) throw opened.error ?? new FormNotWaitingError()
		// A run answered elsewhere may wait on its next form already: the replay put that one on screen.
		if (!provider.isPausedOn(form.workflowRunId, form.formToken)) throw new FormNotWaitingError()
	}
	await deps.submit(form.formToken, answer)
	provider.markAnswered(form.formToken)
	if (provider.continuationLost()) throw new ContinuationLostError()
	return true
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
		: getProvider(conversationKey, () => {
				const created: DifyChatProvider = new DifyChatProvider({
					request: XRequest<DifyChatInput, SSEOutput, DifyChatMessage>(
						`/api/dify/${encodeURIComponent(appId)}/chat-messages`,
						{
							manual: true,
							fetch: createDifyFetch(appId),
							params: { response_mode: 'streaming' },
							// The end of every request, whatever ended it (x-chat-provider skill, "callbacks": onError
							// includes AbortError); a resume stream's wait for its pause ends with it.
							callbacks: {
								onSuccess: () => created.endResume(),
								onError: error => created.endResume(error),
							},
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
					// The streamed reasoning (an LLM node with reasoning separation) is not in GET /messages either.
					onReasoningEnd: message => {
						const { conversationId, messageId } = message.ids
						if (conversationId && messageId && message.reasoning) {
							void workflowDataStorage.set({
								appId,
								conversationId,
								messageId,
								key: 'reasoning',
								value: message.reasoning,
							})
						}
					},
				})
				return created
			})

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
			fallbackMessage(
				error,
				messageInfo?.message ?? params.resume?.message,
				t,
				params.resume ? { answeredToken: provider?.answeredToken } : undefined,
			),
	})

	// The callbacks below stay stable and read the committed render's values here (React: refs are
	// written in effects, not during rendering).
	const latest = useRef({ chat, provider, conversationKey, difyApi, appId })
	useLayoutEffect(() => {
		latest.current = { chat, provider, conversationKey, difyApi, appId }
		if (!conversationKey) return
		difyIdReaders.set(conversationKey, getDifyConversationId)
		if (onConversationId) conversationIdSinks.set(conversationKey, onConversationId)
	})

	// Keys with a send waiting in the SDK's queue. Per hook instance, like that queue (use-x-chat keeps it in
	// a ref of the hook, `messageQueueRef`), so a flag never outlives the queue it stands for. The ref answers
	// `send` at once (two quick sends see the first); the state renders the view's guard (ADR-0017 note).
	const queuedRef = useRef(new Set<string>())
	const [queuedKeys, setQueuedKeys] = useState<ReadonlySet<string>>(() => new Set())
	// The queued send has left once its key requests. The SDK flushes the queue in a `setTimeout` after the
	// history lands, so clearing the flag when the history ends would let a second send through before it.
	useEffect(() => {
		if (!chat.isRequesting || !queuedRef.current.has(conversationKey)) return
		queuedRef.current.delete(conversationKey)
		setQueuedKeys(new Set(queuedRef.current))
	}, [chat.isRequesting, conversationKey])

	/** Sends, or queues while the history loads (sendDecision); false when the send was ignored. */
	const send = useCallback((params: SendParams) => {
		const { chat, conversationKey: key } = latest.current
		if (!key) return false
		const decision = sendDecision({
			isRequesting: chat.isRequesting,
			isDefaultMessagesRequesting: chat.isDefaultMessagesRequesting,
			queued: queuedRef.current.has(key),
		})
		if (decision === 'ignore') return false
		const request: Partial<DifyChatInput> = {
			query: params.query,
			inputs: params.inputs,
			files: params.files,
		}
		if (decision === 'queue') {
			queuedRef.current.add(key)
			setQueuedKeys(new Set(queuedRef.current))
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
		const taskId = taskToStop(reply?.message)
		if (taskId) await api.stopChat(taskId).catch(() => undefined)
	}, [])

	/** Answers a paused run's form in Dify's order (answerInOrder), on this conversation's chat and provider. */
	const answerForm = useCallback(
		(assistantId: string | number, message: DifyChatMessage, answer: HumanInputSubmission) => {
			const { chat, provider: current, difyApi: api } = latest.current
			if (!current) return Promise.resolve(false)
			return answerInOrder(
				{
					isRequesting: chat.isRequesting,
					reload: (id, resume) => chat.onReload(id, { resume }),
					provider: current,
					submit: (formToken, body) => api.submitHumanInput(formToken, body),
				},
				assistantId,
				message,
				answer,
			)
		},
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
			const older = await mapHistoryPage(page.data, historyLoaders(app, difyId))
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
		/** A send waits in the SDK's queue for this conversation's history; its reply has not started yet. */
		queued: queuedKeys.has(conversationKey),
		setMessage: chat.setMessage,
		setMessages: chat.setMessages,
		abort,
		send,
		stop,
		answerForm,
		loadEarlier,
		hasMore,
		historyError,
		retryHistory,
	}
}
