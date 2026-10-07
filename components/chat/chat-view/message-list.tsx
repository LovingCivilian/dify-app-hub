'use client'

import { Bubble, type BubbleListProps } from '@ant-design/x'
import { App, Button, Skeleton } from 'antd'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { toBubbleItems } from '../hooks/bubble-items'
import type { useDifyChat } from '../hooks/use-dify-chat'
import type { DifyChatMessage } from '../provider/message'
import styles from './chat-view.module.css'
import UserContent from './user-content'

/** Bubble.List's ref: the package root exports no ref type, so it is derived from the component. */
type BubbleListRef = React.ComponentRef<typeof Bubble.List>

/** What Bubble passes to `contentRender` and slot renderers next to the message. */
export interface BubbleInfo {
	status?: string
	key?: string | number
}

export interface MessageListProps {
	chat: ReturnType<typeof useDifyChat>
	/** The conversation shown, '' while there is none yet; each one opens at its latest message. */
	conversationKey: string
	/** An assistant bubble's content; keep it stable (useCallback): the role map, and so every bubble, follows it. */
	renderAssistant: (message: DifyChatMessage, info: BubbleInfo) => React.ReactNode
	/** An assistant bubble's footer (Bubble's `footer` slot); keep it stable for the same reason. */
	renderFooter?: (message: DifyChatMessage, info: BubbleInfo) => React.ReactNode
}

/** X Bubble.List over the conversation's messages, with "load earlier" above it (spec §5.2). */
export default function MessageList({
	chat,
	conversationKey,
	renderAssistant,
	renderFooter,
}: MessageListProps) {
	const { t } = useTranslation()
	const { message: toast } = App.useApp()
	const listRef = useRef<BubbleListRef>(null)

	// Stable role map (x-components: "keep roles stable"); no avatar slot on either role (cosmetic sweep 1, item 5).
	const role = useMemo<BubbleListProps['role']>(
		() => ({
			assistant: {
				placement: 'start',
				variant: 'borderless',
				contentRender: (content, info) => renderAssistant(content as DifyChatMessage, info),
				footer: renderFooter
					? (content, info) => renderFooter(content as DifyChatMessage, info)
					: undefined,
			},
			user: {
				placement: 'end',
				contentRender: content => <UserContent message={content as DifyChatMessage} />,
			},
		}),
		[renderAssistant, renderFooter],
	)

	const items = useMemo(() => toBubbleItems(chat.messages), [chat.messages])

	const loadEarlier = async () => {
		const firstKey = items[0]?.key
		try {
			await chat.loadEarlier()
		} catch {
			toast.error(t('common.request_failed_retry'))
			return
		}
		// The message that was first stays where the reader is instead of the list jumping (spec §5.2).
		if (firstKey !== undefined) {
			listRef.current?.scrollTo({ key: firstKey, block: 'start', behavior: 'instant' })
		}
	}

	if (!conversationKey || (chat.isDefaultMessagesRequesting && items.length === 0)) {
		return (
			<div className={styles.list}>
				<Skeleton
					active
					paragraph={{ rows: 4 }}
				/>
			</div>
		)
	}
	return (
		<div className={styles.list}>
			{chat.hasMore && (
				<div className={styles.loadEarlier}>
					<Button
						type="link"
						onClick={() => void loadEarlier()}
					>
						{t('chat.load_earlier')}
					</Button>
				</div>
			)}
			<Bubble.List
				key={conversationKey}
				ref={listRef}
				items={items}
				role={role}
				autoScroll
				className={styles.bubbleList}
			/>
		</div>
	)
}
