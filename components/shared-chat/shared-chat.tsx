'use client'

import { MenuOutlined } from '@ant-design/icons'
import { useLocalStorageState } from 'ahooks'
import { Alert, App, Button, Layout, Typography, theme } from 'antd'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChatAppInfoContext } from '@/components/chat/chat-view/app-info-context'
import ChatSender, { type SenderRef } from '@/components/chat/chat-view/chat-sender'
import styles from '@/components/chat/chat-view/chat-view.module.css'
import ConversationDrawer from '@/components/chat/chat-view/conversation-drawer'
import ConversationSidebar, {
	ConversationList,
} from '@/components/chat/chat-view/conversation-sidebar'
import type { BubbleInfo } from '@/components/chat/chat-view/message-list'
import SiderCollapsed from '@/components/chat/chat-view/sider-collapsed'
import { useConversationMenu } from '@/components/chat/chat-view/use-conversation-menu'
import WidthToggle from '@/components/chat/chat-view/width-toggle'
import AppSider from '@/components/shell/app-sider'
import UserShell from '@/components/shell/user-shell'
import { hasOpenItems } from '@/lib/chat/open-items'
import type { Turn } from '@/lib/chat/turn'
import type { ChatAppDto } from '@/lib/data/apps'

import { createSharedChatApi } from './api'
import AssistantTurn from './assistant-turn'
import { useSharedChat } from './hooks/use-shared-chat'
import { useSharedConversations } from './hooks/use-shared-conversations'
import { requestFailureText } from './run-error'
import SharedWelcome from './shared-welcome'
import TurnFooter from './turn-footer'
import TurnList from './turn-list'

/** An AG-UI app's chat DTO: what ProviderChat hands this page (spec §2.2: no agent URL, audience or secret). */
export type AguiChatApp = Extract<ChatAppDto, { provider: 'agui' }>

/**
 * The shared chat (Part 2 spec §5): the Dify chat's page layout (UserShell, AppSider with the conversation sidebar or
 * its collapsed rail, the mobile ConversationDrawer, the reading-width toggle and the chat column's CSS Module), reused
 * as spec §5.1 lists, around the turn list and the X Sender. The app's name, description and icon reach the shared
 * sidebar pieces through ChatAppInfoContext (Task 14; React 19 renders a context as its own provider).
 */
export default function SharedChat({ app }: { app: AguiChatApp }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { message: toast } = App.useApp()
	const searchParams = useSearchParams()
	const api = useMemo(() => createSharedChatApi(app.id), [app.id])
	const senderRef = useRef<SenderRef>(null)
	const [drawerOpen, setDrawerOpen] = useState(false)
	// The sider's collapsed state and, when collapsed, the popover that holds the list (the Dify chat's).
	const [collapsed, setCollapsed] = useState(false)
	const [railListOpen, setRailListOpen] = useState(false)
	// The same preference as the Dify chat's toggle: one reading width for every chat.
	const [wide, setWide] = useLocalStorageState<boolean>('ai-app-hub-wide-screen', {
		defaultValue: false,
	})

	const list = useSharedConversations({
		appId: app.id,
		api,
		startNew: searchParams.get('isNewCvst') === '1',
	})
	// '' until the list has loaded: no conversation, so no provider and no sending (useSharedChat).
	const activeKey = list.activeKey
	const { getConversationId, markConversation, refresh } = list
	// useSharedChat keeps this reader under `activeKey` for as long as that conversation lives in the background, so it
	// is bound to this render's key (a const), never to "the active key" read later.
	const readConversationId = useCallback(
		() => getConversationId(activeKey),
		[getConversationId, activeKey],
	)
	const chat = useSharedChat({
		appId: app.id,
		conversationKey: activeKey,
		api,
		getConversationId: readConversationId,
		askUser: app.askUser,
		// The stream named its conversation (hub:run): the item keeps its key and takes the id and title (ADR-0017).
		onRun: (key, value) => markConversation(key, value.conversationId, value.title),
	})

	// When a reply ends the list is reloaded for its `updated_at` order (the Dify chat's rule).
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
		const reason = requestFailureText(list.error, t)
		toast.error(
			reason ? t('chat.fetch_list_failed', { error: reason }) : t('common.request_failed_retry'),
		)
	}, [list.error, t, toast])

	// Stable between renders: Bubble.List's role map follows them, and a new map re-renders every bubble.
	const renderAssistant = useCallback(
		(turn: Turn, info: BubbleInfo) => (
			<AssistantTurn
				turn={turn}
				status={info.status}
			/>
		),
		[],
	)
	const renderFooter = useCallback(
		(turn: Turn, info: BubbleInfo) => (
			<TurnFooter
				turn={turn}
				status={info.status}
			/>
		),
		[],
	)

	// Welcome while the conversation has no turns; never in place of a history that is loading or failed to load.
	const historyPending = chat.isDefaultMessagesRequesting && chat.messages.length === 0
	const showWelcome =
		Boolean(activeKey) && !historyPending && !chat.historyError && chat.messages.length === 0
	// Decision 50: an open approval, question or interrupt blocks the composer; its card answers it (spec §6).
	const waiting = hasOpenItems(chat.openItems) && !chat.isRequesting

	// The list's callbacks and menu are stable, so the memoised sidebar does not re-render per streamed chunk.
	const { setActiveKey, createTemp, rename, remove, canRename } = list
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
	// The menu's toast (Task 14's describeFailure): the hub's codes by their keys, else the generic text.
	const describeFailure = useCallback(
		(error: unknown) => requestFailureText(error, t, t('common.request_failed_retry')),
		[t],
	)
	const conversationMenu = useConversationMenu({ rename, remove, canRename, describeFailure })

	// A send queued for this conversation's history lives in the SDK's queue of this conversation: until its reply
	// starts, the list keeps it (ADR-0017 note of 2026-10-05).
	const locked = chat.queued
	const sidebarProps = {
		items: list.conversations,
		activeKey,
		onActiveChange: selectConversation,
		menu: conversationMenu,
		locked,
	}
	const createDisabled = list.hasEmptyTemp || locked

	// The reading width (the Dify chat's): antd's screenMD token, unbounded when wide.
	const readingStyle = { maxWidth: wide ? 'none' : token.screenMD }
	const bubbleWidth = wide ? 'none' : token.screenMD - 2 * token.padding - 2 * token.paddingXS

	const appInfo = useMemo(
		() => ({ id: app.id, name: app.name, description: app.description, hasIcon: app.hasIcon }),
		[app.id, app.name, app.description, app.hasIcon],
	)

	return (
		<ChatAppInfoContext value={appInfo}>
			<UserShell
				title={
					<Typography.Text
						strong
						ellipsis
					>
						{app.name}
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
					<AppSider
						collapsed={collapsed}
						onCollapse={setCollapsed}
					>
						{collapsed ? (
							<SiderCollapsed
								onCreate={createConversation}
								createDisabled={createDisabled}
								listOpen={railListOpen}
								onListOpenChange={setRailListOpen}
								list={<ConversationList {...sidebarProps} />}
							/>
						) : (
							<ConversationSidebar
								{...sidebarProps}
								onCreate={createConversation}
								createDisabled={createDisabled}
							/>
						)}
					</AppSider>
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
										description={requestFailureText(
											chat.historyError,
											t,
											t('common.request_failed_retry'),
										)}
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
								<SharedWelcome visible={showWelcome} />
							</div>
							<TurnList
								messages={chat.messages}
								conversationKey={activeKey}
								isDefaultMessagesRequesting={chat.isDefaultMessagesRequesting}
								hasMore={chat.hasMore}
								loadEarlier={chat.loadEarlier}
								maxWidth={bubbleWidth}
								renderAssistant={renderAssistant}
								renderFooter={renderFooter}
							/>
							<div
								className={`${styles.composer} ${styles.reading}`}
								style={readingStyle}
							>
								<ChatSender
									loading={chat.isRequesting}
									disabled={!activeKey || waiting}
									// The box says why it waits (spec §6.3's hint; plan call P3's 2a wording).
									placeholder={waiting ? t('shared_chat.answer_pending_hint') : undefined}
									senderRef={senderRef}
									onSend={text => chat.send(text)}
									onStop={() => void chat.stop()}
								/>
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
			</UserShell>
		</ChatAppInfoContext>
	)
}
