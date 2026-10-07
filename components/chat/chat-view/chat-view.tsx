'use client'

import { MenuFoldOutlined, MenuOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import { Prompts } from '@ant-design/x'
import { useLocalStorageState } from 'ahooks'
import { Alert, App, Button, Form, Layout, Typography, theme } from 'antd'
import { useSearchParams } from 'next/navigation'
import {
	useCallback,
	useEffect,
	useEffectEvent,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import UserShell from '@/components/shell/user-shell'

import { useAppContext } from '../app-context'
import {
	feedbackError,
	humanInputFailureText,
	humanInputSubmitError,
	toDifyError,
} from '../hooks/dify-errors'
import { useConversations } from '../hooks/use-conversations'
import { useDifyChat, type SendParams } from '../hooks/use-dify-chat'
import { useSpeechToText } from '../hooks/use-speech-to-text'
import { useSuggestions } from '../hooks/use-suggestions'
import HumanInputForm from '../message/human-input-form'
import { parseConversationKey } from '../provider/keys'
import type { DifyChatMessage } from '../provider/message'
import AnnotationDrawer from './annotation-drawer'
import AssistantContent from './assistant-content'
import ChatSender, { type SenderRef } from './chat-sender'
import styles from './chat-view.module.css'
import ConversationDrawer from './conversation-drawer'
import ConversationSidebar, { ConversationList } from './conversation-sidebar'
import InputsCollapse from './inputs-collapse'
import { useInputsValid } from './inputs-form'
import { allowsLocalUpload } from './file-types'
import {
	apiInputs,
	decodeLinkInputs,
	decodeSenderText,
	inputFields,
	pendingFileInputs,
	resolveInitialInputs,
} from './inputs-values'
import { questionOf, regenerateRequest, suggestionTarget, unansweredKeys } from './message-actions'
import MessageFooter, { type FeedbackRating } from './message-footer'
import MessageList, { type BubbleInfo } from './message-list'
import { useSenderAttachments } from './sender-attachments'
import SiderCollapsed from './sider-collapsed'
import { useConversationMenu } from './use-conversation-menu'
import WelcomePanel from './welcome-panel'
import WidthToggle from './width-toggle'

/** The one literal width in the chat (X's full-page pattern gives its sider a literal width too). */
const SIDEBAR_WIDTH = 280

/** `?isKeepAll=true`: the link's other values (`<variable>=<gzip>`) stay for the page session, whatever the URL does later. */
const keptParamsOf = (params: URLSearchParams): Record<string, string> =>
	params.get('isKeepAll') === 'true'
		? Object.fromEntries([...params.entries()].filter(([name]) => name !== 'isKeepAll'))
		: {}

/** The chat page of a chat-like app (spec §5.1): sider or drawer with the conversations, the message column. */
export default function ChatView() {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { message: toast } = App.useApp()
	const { app, site, parameters, difyApi } = useAppContext()
	const searchParams = useSearchParams()
	const [keptParams] = useState(() => keptParamsOf(searchParams))
	const [inputsForm] = Form.useForm<Record<string, unknown>>()
	const senderRef = useRef<SenderRef>(null)
	const [drawerOpen, setDrawerOpen] = useState(false)
	// The sider's collapsed state and, when collapsed, the popover that holds the list (spec §5.1).
	const [collapsed, setCollapsed] = useState(false)
	const [railListOpen, setRailListOpen] = useState(false)
	const [wide, setWide] = useLocalStorageState<boolean>('dify-app-hub-wide-screen', {
		defaultValue: false,
	})

	const list = useConversations({
		appId: app.id,
		difyApi,
		startNew: searchParams.get('isNewCvst') === '1',
	})
	// '' until the list has loaded: no conversation, so no provider and no sending (useDifyChat).
	const activeKey = list.activeKey
	const { getDifyId, markDifyId, refresh, generateName } = list
	const chat = useDifyChat({
		appId: app.id,
		conversationKey: activeKey,
		getDifyConversationId: () => getDifyId(activeKey),
		// A new chat's reply created its Dify conversation, whichever conversation is on screen by then:
		// the app asks Dify for the generated name (the message was sent with auto_generate_name false,
		// cosmetic sweep 1 item 3), then reloads the list, which the server lists already.
		onConversationId: (key, difyId) => {
			if (getDifyId(key) === difyId) return
			markDifyId(key, difyId)
			void generateName(key).then(refresh)
		},
		difyApi,
		t,
	})

	// The conversation parameters (spec §5.2). A conversation is unsent until Dify has named it (its key stays
	// the same); its parameters can be edited until then, and afterwards only when the app allows it.
	const activeItem = list.conversations.find(c => c.key === activeKey)
	const hasInputs = inputFields(parameters.user_input_form).length > 0
	const allowUpdate = app.settings.enableUpdateAfterConversationStarts
	const unsent = !activeKey || (parseConversationKey(activeKey).temp && !activeItem?.difyId)
	const inputsLocked = !unsent && !allowUpdate
	// A locked form cannot be fixed by the user, so only an editable one holds sending back.
	const inputsValid = useInputsValid(inputsForm, hasInputs && !inputsLocked)

	// Each conversation opens with its values (resolveInitialInputs). The link's values apply once per
	// conversation: the first open seeds them and stores the result on the conversation, after which what
	// is stored or typed wins (the old form used a link value once and rewrote the URL). The stored inputs
	// are read from the store itself, so a repeated run (React StrictMode runs effects twice) finds the
	// seeding it just did. An Effect Event (React: "Separating Events from Effects") reads the URL and the
	// conversation as they are when it changes; a later edit must not reset the form, so only the key triggers it.
	const [seededKeys] = useState(() => new Set<string>())
	const getInputs = list.getInputs
	const setInputs = list.setInputs
	const openInputs = useEffectEvent((key: string) => {
		const seeded = seededKeys.has(key)
		let urlValues: Record<string, unknown> = {}
		let globalParams: Record<string, unknown> = {}
		if (!seeded) {
			seededKeys.add(key)
			const report = (variable: string, error: unknown) =>
				toast.error(
					t('form.decompress_failed', {
						name: variable,
						error: error instanceof Error ? error.message : String(error),
					}),
				)
			const form = parameters.user_input_form
			urlValues = decodeLinkInputs(form, variable => searchParams.get(variable), report)
			// The kept values fill the inputs the URL itself does not carry.
			globalParams = decodeLinkInputs(
				form,
				variable => (searchParams.get(variable) ? undefined : keptParams[variable]),
				report,
			)
		}
		const values = resolveInitialInputs({
			form: parameters.user_input_form,
			urlValues,
			globalParams,
			conversationInputs: getInputs(key),
			isTemp: unsent,
			allowUpdate,
			seeded,
		})
		inputsForm.setFieldsValue(values)
		if (!seeded) setInputs(key, values)
	})
	useEffect(() => {
		if (activeKey && hasInputs) openInputs(activeKey)
	}, [activeKey, hasInputs])

	// When a reply ends the list is reloaded for its `updated_at` order (spec §4.4); the name arrives
	// through `generateName` when the conversation id does, and this reload is the fallback that shows
	// the server's name if that call failed (ADR-0017 note of 2026-10-07).
	const wasRequesting = useRef(false)
	useEffect(() => {
		if (wasRequesting.current && !chat.isRequesting) void refresh()
		wasRequesting.current = chat.isRequesting
	}, [chat.isRequesting, refresh])

	useEffect(() => {
		if (activeKey) senderRef.current?.focus()
	}, [activeKey])

	useEffect(() => {
		if (!list.error) return
		toast.error(
			list.error.message
				? t('chat.fetch_list_failed', { error: list.error.message })
				: t('common.request_failed_retry'),
		)
	}, [list.error, t, toast])

	// Next-question suggestions follow the reply that just ended (spec §4.7), not a stopped or failed one, nor
	// one whose run waits on a human input form.
	const lastAssistant = chat.messages.findLast(m => m.message.role === 'assistant')?.message
	const suggestions = useSuggestions({
		enabled: Boolean(parameters.suggested_questions_after_answer?.enabled),
		difyApi,
		conversationKey: activeKey,
		lastMessageId: suggestionTarget(lastAssistant),
		isRequesting: chat.isRequesting,
	})

	// The Sender's attachments and speech input, each when the app turns it on (spec §4.7, §5.2): files only
	// as local uploads, the one way the attachments offer.
	const fileUpload = parameters.file_upload
	const attachments = useSenderAttachments({
		enabled:
			Boolean(fileUpload?.enabled) && allowsLocalUpload(fileUpload?.allowed_file_upload_methods),
		senderRef,
	})
	// X Sender's ref inserts text at the cursor (Sender Ref `insert`) and reports it through onChange.
	const insertText = useCallback((text: string) => senderRef.current?.insert(text), [])
	const speech = useSpeechToText({
		enabled: Boolean(parameters.speech_to_text?.enabled),
		onText: insertText,
	})

	const sendToChat = chat.send
	const clearSuggestions = suggestions.clear
	const {
		files: attachedFiles,
		ready: attachmentsReady,
		uploading: attachmentsUploading,
		reset: resetAttachments,
	} = attachments
	const userInputForm = parameters.user_input_form
	/**
	 * False when nothing was sent: a file (attached, or in a file input) is still uploading or failed, the
	 * required parameters are missing (the form shows which), or the chat ignored the send (a reply is
	 * running, or one is already queued); the Sender then keeps its text. A send without its own files takes
	 * the attached ones, which go once it was taken.
	 */
	const send = useCallback(
		async (text: string, extra: Partial<SendParams> = {}) => {
			const withAttachments = extra.files === undefined
			const values = hasInputs ? inputsForm.getFieldsValue(true) : {}
			// apiInputs would drop a file input's unfinished files, and `required` accepts them.
			const pending =
				extra.inputs === undefined
					? pendingFileInputs(userInputForm, values)
					: { uploading: [], failed: [] }
			const waiting = (withAttachments && attachmentsUploading) || pending.uploading.length > 0
			const failed =
				(withAttachments && !attachmentsReady && !attachmentsUploading) || pending.failed.length > 0
			if (waiting || failed) {
				toast.error(t(waiting ? 'sender.wait_for_uploads' : 'sender.remove_failed_uploads'))
				return false
			}
			if (hasInputs && !inputsLocked) {
				try {
					await inputsForm.validateFields()
				} catch {
					toast.error(t('chat.inputs_required'))
					return false
				}
			}
			const sent = sendToChat({
				query: text,
				// File inputs go as Dify's file objects (OpenAPI InputFileObject), stored ones included.
				inputs: extra.inputs ?? apiInputs(userInputForm, values),
				files: extra.files ?? attachedFiles,
			})
			if (sent) {
				clearSuggestions()
				if (withAttachments) resetAttachments()
				// The conversation keeps what was sent, which the form may only hold from a link or a default.
				if (hasInputs) setInputs(activeKey, values)
			}
			return sent
		},
		[
			activeKey,
			attachedFiles,
			attachmentsReady,
			attachmentsUploading,
			clearSuggestions,
			hasInputs,
			inputsForm,
			inputsLocked,
			resetAttachments,
			sendToChat,
			setInputs,
			t,
			toast,
			userInputForm,
		],
	)
	const postBack = useCallback((text: string) => void send(text), [send])
	// Answer buttons and forms post back only between replies (AnswerButton is disabled without it).
	const answerSend = chat.isRequesting ? undefined : postBack

	// The bubble whose human input form is being submitted, until its continuation has started (spec §4.6).
	const [hitlSubmitting, setHitlSubmitting] = useState<string | number>()
	const resume = chat.resume
	/**
	 * Submits a paused run's form, then resumes the run into the same message (spec §4.6 steps 2–3). A
	 * refused form (Dify's message, or the generic text) and a resume that cannot start (x-sdk's
	 * `onReload` throws for a message the store does not hold) are reported here, each in its own words
	 * (humanInputFailureText); the form stays submittable. A resumed stream that fails keeps the paused
	 * message with its error (requestFallback, `hitl.resume_failed` without Dify's text).
	 */
	const submitHumanInput = useCallback(
		async (
			key: string | number,
			message: DifyChatMessage,
			inputs: Record<string, unknown>,
			actionId: string,
		) => {
			const form = message.humanInput
			if (!form?.formToken) return
			setHitlSubmitting(key)
			let accepted = false
			try {
				// DifyApi resolves an HTTP error with the proxy's answer instead of rejecting. Its body type
				// predates file inputs, which take file mappings (OpenAPI, POST /form/human_input), and still
				// requires `user`, which the proxy route replaces with the session's (Task 13 drops the old type).
				const answer: unknown = await difyApi.submitHumanInput(form.formToken, {
					inputs: inputs as Record<string, string>,
					action: actionId,
					user: '',
				})
				const refused = humanInputSubmitError(answer)
				if (refused) throw refused
				accepted = true
				resume(key, form.workflowRunId, message)
			} catch (error) {
				toast.error(humanInputFailureText(error, accepted, t))
			} finally {
				setHitlSubmitting(undefined)
			}
		},
		[difyApi, resume, t, toast],
	)

	// Stable between renders: Bubble.List's role map follows it, and a new map re-renders every bubble.
	const renderAssistant = useCallback(
		(message: DifyChatMessage, info: BubbleInfo) => {
			const form = message.humanInput
			const key = info.key
			return (
				<AssistantContent
					message={message}
					info={info}
					onSend={answerSend}
					extra={
						form && key !== undefined ? (
							<HumanInputForm
								// One antd Form per form: a later form in the same message starts afresh.
								key={`${form.workflowRunId}:${form.nodeId ?? ''}:${form.formToken}`}
								humanInput={form}
								// Also while the resumed run connects and streams, until the form is filled.
								submitting={
									hitlSubmitting === key || info.status === 'loading' || info.status === 'updating'
								}
								onSubmit={(inputs, actionId) => submitHumanInput(key, message, inputs, actionId)}
							/>
						) : undefined
					}
				/>
			)
		},
		[answerSend, hitlSubmitting, submitHumanInput],
	)

	// The footer's callbacks stay stable while a reply streams (a new one would rebuild Bubble.List's role
	// map, and so every bubble, per chunk): they read the messages and the store's setter of the committed
	// render here (React: refs are written in effects, read in event handlers).
	const latest = useRef({ messages: chat.messages, setMessage: chat.setMessage })
	useLayoutEffect(() => {
		latest.current = { messages: chat.messages, setMessage: chat.setMessage }
	})

	/** A new turn with the question's text and files and the current inputs (spec §4.7), not onReload. */
	const regenerate = useCallback(
		(key: string | number) => {
			const request = regenerateRequest(latest.current.messages, key)
			if (request) void send(request.query, { files: request.files })
		},
		[send],
	)

	/**
	 * Rates an answer by its Dify message id (spec §4.7): shown at once, taken back if Dify refuses
	 * (DifyApi resolves the refusal; feedbackError reads it) with Dify's text or the generic one.
	 */
	const feedback = useCallback(
		async (
			key: string | number,
			message: DifyChatMessage,
			rating: FeedbackRating,
			reason?: string,
		) => {
			const messageId = message.ids.messageId
			if (!messageId) return
			// Taken now: this conversation's store, even if the user switches while the request runs.
			const { setMessage } = latest.current
			const previous = message.feedback ?? null
			setMessage(key, info => ({ message: { ...info.message, feedback: rating } }))
			try {
				const answer: unknown = await difyApi.createMessageFeedback({
					messageId,
					rating,
					content: reason ?? '',
				})
				// The button's state is the confirmation (spec §4.7): no toast on success.
				const refused = feedbackError(answer)
				if (refused) throw refused
			} catch (error) {
				// Unless another rating replaced this one meanwhile.
				setMessage(key, info => ({
					message: {
						...info.message,
						feedback: info.message.feedback === rating ? previous : info.message.feedback,
					},
				}))
				toast.error(toDifyError(error).message || t('common.request_failed_retry'))
			}
		},
		[difyApi, t, toast],
	)

	// One annotation drawer for the page, opened with the answer and the question it replies to.
	const [annotation, setAnnotation] = useState({ open: false, question: '', answer: '' })
	const annotate = useCallback((key: string | number) => {
		const { messages } = latest.current
		setAnnotation({
			open: true,
			question: questionOf(messages, key)?.content ?? '',
			answer: messages.find(m => m.id === key)?.message.content ?? '',
		})
	}, [])

	// Answers no user turn precedes cannot be regenerated. Joined into a string, the list changes the
	// callback below only when it changes itself, not with every streamed chunk.
	const unanswered = unansweredKeys(chat.messages).join('\n')
	const unansweredSet = useMemo(
		() => new Set(unanswered ? unanswered.split('\n') : []),
		[unanswered],
	)
	// Stable while a reply streams; it changes when one starts or ends (the actions wait meanwhile).
	const isRequesting = chat.isRequesting
	const renderFooter = useCallback(
		(message: DifyChatMessage, info: BubbleInfo) =>
			info.key === undefined ? null : (
				<MessageFooter
					message={message}
					messageKey={info.key}
					status={info.status}
					hasQuestion={!unansweredSet.has(String(info.key))}
					disabled={isRequesting}
					onRegenerate={regenerate}
					onFeedback={feedback}
					onAnnotate={annotate}
				/>
			),
		[annotate, feedback, isRequesting, regenerate, unansweredSet],
	)

	// Welcome while the conversation has no messages, or always when the app asks for it (spec §5.2); never
	// in place of a history that is loading or failed to load.
	const historyPending = chat.isDefaultMessagesRequesting && chat.messages.length === 0
	const showWelcome =
		Boolean(activeKey) &&
		!historyPending &&
		!chat.historyError &&
		(app.settings.openingStatementDisplayMode === 'always' || chat.messages.length === 0)

	// The list's callbacks and menu are stable, so the memoised sidebar does not re-render per streamed chunk.
	const { setActiveKey, createTemp, rename, remove } = list
	const closeDrawer = useCallback(() => setDrawerOpen(false), [])
	const selectConversation = useCallback(
		(key: string) => {
			setActiveKey(key)
			setDrawerOpen(false)
			setRailListOpen(false)
		},
		[setActiveKey],
	)
	const createConversation = useCallback(() => {
		createTemp()
		setDrawerOpen(false)
		setRailListOpen(false)
	}, [createTemp])
	const conversationMenu = useConversationMenu({ rename, remove, getDifyId })

	// The collapse toggle sits at the top of the sider (end of the app info row; under the icon when
	// collapsed): the bottom-left corner is where Next's dev indicator floats and covers a click target. It
	// discloses the sider, named by its id (WAI-ARIA disclosure pattern: aria-expanded, aria-controls).
	const siderId = useId()
	const siderToggle = useMemo(
		() => (
			<Button
				type="text"
				icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
				aria-label={collapsed ? t('chat.sidebar_open') : t('chat.sidebar_close')}
				title={collapsed ? t('chat.sidebar_open') : t('chat.sidebar_close')}
				aria-expanded={!collapsed}
				aria-controls={siderId}
				onClick={() => setCollapsed(value => !value)}
			/>
		),
		[collapsed, siderId, t],
	)
	// A send queued for this conversation's history lives in the SDK's queue of this conversation, which only
	// the conversation on screen sends: until its reply starts, the list keeps it (ADR-0017 note of 2026-10-05).
	const locked = chat.queued
	const sidebarProps = {
		items: list.conversations,
		activeKey,
		onActiveChange: selectConversation,
		menu: conversationMenu,
		locked,
	}
	const createDisabled = list.hasEmptyTemp || locked

	// The reading width (spec §5.1): antd's screenMD token, unbounded when wide; the column itself spans
	// the content region so the message list scrolls at its edge (cosmetic sweep 1, item 1). The wrappers
	// are border-box (antd's reset) with the column's old inline padding, so their content is the token
	// minus the two paddings; X's scroll content insets every bubble by paddingXS on each side
	// (es/bubble/style/list.js), so a bubble gets that content width minus the inset and keeps the same
	// 8 px inside the Sender's edges in every width, as before the sweep.
	const readingStyle = { maxWidth: wide ? 'none' : token.screenMD }
	const bubbleWidth = wide ? 'none' : token.screenMD - 2 * token.padding - 2 * token.paddingXS

	return (
		<UserShell
			title={
				<Typography.Text
					strong
					ellipsis
				>
					{site.title || app.name}
				</Typography.Text>
			}
			extra={
				// Below md the column already spans the viewport: the toggle shows from md up (CSS, as the sider).
				<span className={styles.desktopOnly}>
					<WidthToggle
						wide={Boolean(wide)}
						onChange={setWide}
					/>
				</span>
			}
			mobileMenu={
				<Button
					type="text"
					icon={<MenuOutlined />}
					aria-label={t('system.menu')}
					title={t('system.menu')}
					onClick={() => setDrawerOpen(true)}
				/>
			}
		>
			<Layout
				className={styles.layout}
				hasSider
			>
				<Layout.Sider
					id={siderId}
					width={SIDEBAR_WIDTH}
					theme="light"
					className={styles.sider}
					collapsible
					collapsed={collapsed}
					collapsedWidth={token.controlHeightLG * 2}
					// Our own toggle (top of the sider) replaces antd's trigger bar.
					trigger={null}
				>
					{collapsed ? (
						<SiderCollapsed
							onCreate={createConversation}
							createDisabled={createDisabled}
							toggle={siderToggle}
							listOpen={railListOpen}
							onListOpenChange={setRailListOpen}
							list={<ConversationList {...sidebarProps} />}
						/>
					) : (
						<ConversationSidebar
							{...sidebarProps}
							onCreate={createConversation}
							createDisabled={createDisabled}
							action={siderToggle}
						/>
					)}
				</Layout.Sider>
				<Layout.Content>
					<div className={styles.column}>
						{chat.historyError && (
							// The spacing sits on a wrapper: antd's Alert resets its own margin.
							<div
								className={`${styles.historyAlert} ${styles.reading}`}
								style={readingStyle}
							>
								<Alert
									type="error"
									showIcon
									title={t('chat.history_load_failed')}
									description={chat.historyError.message || t('common.request_failed_retry')}
									action={
										<Button
											size="small"
											onClick={() => void chat.retryHistory()}
										>
											{t('chat.retry')}
										</Button>
									}
								/>
							</div>
						)}
						<div
							className={`${styles.top} ${styles.reading}`}
							style={readingStyle}
						>
							<WelcomePanel
								visible={showWelcome}
								disabled={chat.isRequesting}
								onPrompt={text => void send(text)}
							/>
							<InputsCollapse
								form={inputsForm}
								conversationKey={activeKey}
								// An edit during a reply would be stored but not sent.
								disabled={!activeKey || inputsLocked || chat.isRequesting}
								onValuesChange={values => setInputs(activeKey, values)}
							/>
						</div>
						<MessageList
							chat={chat}
							conversationKey={activeKey}
							maxWidth={bubbleWidth}
							renderAssistant={renderAssistant}
							renderFooter={renderFooter}
						/>
						{suggestions.suggestions.length > 0 && !chat.isRequesting && (
							<div
								className={`${styles.suggestions} ${styles.reading}`}
								style={readingStyle}
							>
								<Prompts
									wrap
									title={t('chat.suggested_questions')}
									items={suggestions.suggestions.map((question, index) => ({
										key: String(index),
										label: question,
									}))}
									onItemClick={info => void send(String(info.data.label))}
								/>
							</div>
						)}
						<div
							className={`${styles.composer} ${styles.reading}`}
							style={readingStyle}
						>
							<ChatSender
								loading={chat.isRequesting}
								// The deep link's `sender_text` prefills the box (spec §4.7).
								initialValue={decodeSenderText(searchParams.get('sender_text'))}
								disabled={!activeKey || !inputsValid}
								// The box says why it waits while the required parameters are missing.
								placeholder={activeKey && !inputsValid ? t('chat.inputs_required') : undefined}
								senderRef={senderRef}
								onSend={send}
								onStop={() => void chat.stop()}
								header={attachments.header}
								prefix={attachments.prefix}
								onPasteFile={attachments.onPasteFile}
								allowSpeech={speech.allowSpeech}
								transcribing={speech.transcribing}
							/>
						</div>
						<div
							className={styles.reading}
							style={readingStyle}
						>
							<Typography.Text
								type="secondary"
								className={styles.disclaimer}
							>
								{site.custom_disclaimer || t('system.default_disclaimer_content')}
							</Typography.Text>
						</div>
					</div>
				</Layout.Content>
			</Layout>
			<ConversationDrawer
				open={drawerOpen}
				onClose={closeDrawer}
			>
				<ConversationSidebar
					{...sidebarProps}
					onCreate={createConversation}
					createDisabled={createDisabled}
				/>
			</ConversationDrawer>
			{app.settings.annotationEnabled && (
				<AnnotationDrawer
					open={annotation.open}
					question={annotation.question}
					answer={annotation.answer}
					onClose={() => setAnnotation(current => ({ ...current, open: false }))}
				/>
			)}
		</UserShell>
	)
}
