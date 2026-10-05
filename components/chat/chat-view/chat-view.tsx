'use client'

import { MenuOutlined } from '@ant-design/icons'
import { Prompts } from '@ant-design/x'
import { useLocalStorageState } from 'ahooks'
import { Alert, App, Button, Form, Layout, Typography, theme } from 'antd'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import UserShell from '@/components/shell/user-shell'
import type { IFile } from '@/lib/api'
import { unParseGzipString } from '@/lib/helpers'

import { useAppContext } from '../app-context'
import { useConversations } from '../hooks/use-conversations'
import { useDifyChat, type SendParams } from '../hooks/use-dify-chat'
import { useSuggestions } from '../hooks/use-suggestions'
import { parseConversationKey } from '../provider/keys'
import type { DifyChatMessage } from '../provider/message'
import AssistantContent from './assistant-content'
import ChatSender, { type SenderRef } from './chat-sender'
import styles from './chat-view.module.css'
import ConversationDrawer from './conversation-drawer'
import ConversationSidebar from './conversation-sidebar'
import InputsCollapse from './inputs-collapse'
import { useInputsValid } from './inputs-form'
import { decodeSenderText, inputFields, resolveInitialInputs } from './inputs-values'
import MessageList, { type BubbleInfo } from './message-list'
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
	const { getDifyId, markDifyId, refresh } = list
	const chat = useDifyChat({
		appId: app.id,
		conversationKey: activeKey,
		getDifyConversationId: () => getDifyId(activeKey),
		// A new chat's reply named its Dify conversation, whichever conversation is on screen by then; the
		// server lists it already, so its name shows now rather than when the reply ends.
		onConversationId: (key, difyId) => {
			if (getDifyId(key) === difyId) return
			markDifyId(key, difyId)
			void refresh()
		},
		difyApi,
		t,
	})

	// The conversation parameters (spec §5.2). A conversation is unsent until Dify has named it (its key stays
	// the same); its parameters can be edited until then, and afterwards only when the app allows it.
	const activeItem = list.conversations.find(c => c.key === activeKey)
	const hasInputs = inputFields(parameters.user_input_form).length > 0
	const allowUpdate = Boolean(app.inputParams?.enableUpdateAfterCvstStarts)
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
		const urlValues: Record<string, unknown> = {}
		const globalParams: Record<string, unknown> = {}
		if (!seeded) {
			seededKeys.add(key)
			const decode = (variable: string, raw: string | null | undefined) => {
				if (!raw) return undefined
				const { error, data } = unParseGzipString(raw)
				if (error) {
					toast.error(
						t('form.decompress_failed', {
							name: variable,
							error: error instanceof Error ? error.message : String(error),
						}),
					)
					return undefined
				}
				return data
			}
			for (const { variable } of inputFields(parameters.user_input_form)) {
				const fromUrl = searchParams.get(variable)
				if (fromUrl) urlValues[variable] = decode(variable, fromUrl)
				else globalParams[variable] = decode(variable, keptParams[variable])
			}
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

	// When a reply ends the list is reloaded for the name Dify generated meanwhile (spec §4.4).
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

	// Next-question suggestions follow the reply that just ended (spec §4.7), not a stopped or failed one.
	const lastAssistant = chat.messages.findLast(m => m.message.role === 'assistant')?.message
	const suggestions = useSuggestions({
		enabled: Boolean(parameters.suggested_questions_after_answer?.enabled),
		difyApi,
		conversationKey: activeKey,
		lastMessageId:
			lastAssistant?.error || lastAssistant?.aborted ? undefined : lastAssistant?.ids.messageId,
		isRequesting: chat.isRequesting,
	})

	const sendToChat = chat.send
	const clearSuggestions = suggestions.clear
	/**
	 * False when nothing was sent: the required parameters are missing (the form shows which), or the chat
	 * ignored the send (a reply is running, or one is already queued).
	 */
	const send = useCallback(
		async (text: string, extra: Partial<SendParams> = {}) => {
			if (hasInputs && !inputsLocked) {
				try {
					await inputsForm.validateFields()
				} catch {
					toast.error(t('chat.inputs_required'))
					return false
				}
			}
			const inputs = hasInputs ? inputsForm.getFieldsValue(true) : {}
			const sent = sendToChat({
				query: text,
				inputs: extra.inputs ?? inputs,
				files: (extra.files ?? []) as IFile[],
			})
			if (sent) {
				clearSuggestions()
				// The conversation keeps what was sent, which the form may only hold from a link or a default.
				if (hasInputs) setInputs(activeKey, inputs)
			}
			return sent
		},
		[
			activeKey,
			clearSuggestions,
			hasInputs,
			inputsForm,
			inputsLocked,
			sendToChat,
			setInputs,
			t,
			toast,
		],
	)
	const postBack = useCallback((text: string) => void send(text), [send])
	// Answer buttons and forms post back only between replies (AnswerButton is disabled without it).
	const answerSend = chat.isRequesting ? undefined : postBack
	// Stable between renders: Bubble.List's role map follows it, and a new map re-renders every bubble.
	const renderAssistant = useCallback(
		(message: DifyChatMessage, info: BubbleInfo) => (
			<AssistantContent
				message={message}
				info={info}
				onSend={answerSend}
			/>
		),
		[answerSend],
	)

	// Welcome while the conversation has no messages, or always when the app asks for it (spec §5.2); never
	// in place of a history that is loading or failed to load.
	const historyPending = chat.isDefaultMessagesRequesting && chat.messages.length === 0
	const showWelcome =
		Boolean(activeKey) &&
		!historyPending &&
		!chat.historyError &&
		(app.extConfig?.conversation?.openingStatement?.displayMode === 'always' ||
			chat.messages.length === 0)

	const sidebar = (
		<ConversationSidebar
			items={list.conversations}
			activeKey={activeKey}
			onActiveChange={key => {
				list.setActiveKey(key)
				setDrawerOpen(false)
			}}
			onCreate={() => {
				list.createTemp()
				setDrawerOpen(false)
			}}
			createDisabled={list.hasEmptyTemp}
		/>
	)

	return (
		<UserShell
			title={
				<Typography.Text
					strong
					ellipsis
				>
					{site.title || app.info.name}
				</Typography.Text>
			}
			extra={
				<WidthToggle
					wide={Boolean(wide)}
					onChange={setWide}
				/>
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
					width={SIDEBAR_WIDTH}
					theme="light"
					className={styles.sider}
				>
					{sidebar}
				</Layout.Sider>
				<Layout.Content>
					<div
						className={styles.column}
						// The reading width is antd's screenMD token, unbounded when wide (spec §5.1).
						style={{ maxWidth: wide ? 'none' : token.screenMD }}
					>
						{chat.historyError && (
							// The spacing sits on a wrapper: antd's Alert resets its own margin.
							<div className={styles.historyAlert}>
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
						<div className={styles.top}>
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
							renderAssistant={renderAssistant}
						/>
						{suggestions.suggestions.length > 0 && !chat.isRequesting && (
							<div className={styles.suggestions}>
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
						<div className={styles.composer}>
							<ChatSender
								loading={chat.isRequesting}
								// The deep link's `sender_text` prefills the box (spec §4.7).
								initialValue={decodeSenderText(searchParams.get('sender_text'))}
								disabled={!activeKey || !inputsValid}
								senderRef={senderRef}
								onSend={send}
								onStop={() => void chat.stop()}
							/>
						</div>
						<Typography.Text
							type="secondary"
							className={styles.disclaimer}
						>
							{site.custom_disclaimer || t('system.default_disclaimer_content')}
						</Typography.Text>
					</div>
				</Layout.Content>
			</Layout>
			<ConversationDrawer
				open={drawerOpen}
				onClose={() => setDrawerOpen(false)}
			>
				{sidebar}
			</ConversationDrawer>
		</UserShell>
	)
}
