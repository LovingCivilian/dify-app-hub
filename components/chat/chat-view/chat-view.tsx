'use client'

import { MenuOutlined } from '@ant-design/icons'
import { useLocalStorageState } from 'ahooks'
import { Alert, App, Button, Layout, Typography, theme } from 'antd'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import UserShell from '@/components/shell/user-shell'
import type { IFile } from '@/lib/api'

import { useAppContext } from '../app-context'
import { useConversations } from '../hooks/use-conversations'
import { useDifyChat, type SendParams } from '../hooks/use-dify-chat'
import ChatSender, { type SenderRef } from './chat-sender'
import styles from './chat-view.module.css'
import ConversationDrawer from './conversation-drawer'
import ConversationSidebar from './conversation-sidebar'
import MessageList from './message-list'
import WidthToggle from './width-toggle'

/** The one literal width in the chat (X's full-page pattern gives its sider a literal width too). */
const SIDEBAR_WIDTH = 280

/** The chat page of a chat-like app (spec §5.1): sider or drawer with the conversations, the message column. */
export default function ChatView() {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { message: toast } = App.useApp()
	const { app, site, difyApi } = useAppContext()
	const searchParams = useSearchParams()
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

	const sendToChat = chat.send
	/** False when the chat ignored the send (a reply is running, or one is already queued). */
	const send = useCallback(
		async (text: string, extra: Partial<SendParams> = {}) =>
			sendToChat({
				query: text,
				inputs: extra.inputs ?? {},
				files: (extra.files ?? []) as IFile[],
			}),
		[sendToChat],
	)
	const postBack = useCallback((text: string) => void send(text), [send])

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
						<MessageList
							chat={chat}
							conversationKey={activeKey}
							// Answer buttons and forms post back only between replies (AnswerButton is disabled without it).
							onSend={chat.isRequesting ? undefined : postBack}
						/>
						<div className={styles.composer}>
							<ChatSender
								loading={chat.isRequesting}
								disabled={!activeKey}
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
