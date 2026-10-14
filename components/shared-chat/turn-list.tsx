'use client'

import { Bubble, type BubbleListProps } from '@ant-design/x'
import type { MessageInfo } from '@ant-design/x-sdk'
import { App, Button, Skeleton } from 'antd'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import styles from '@/components/chat/chat-view/chat-view.module.css'
import type { BubbleInfo } from '@/components/chat/chat-view/message-list'
import type { Turn } from '@/lib/chat/turn'

import { toBubbleItems } from './bubble-items'
import UserTurn from './user-turn'

/** Bubble.List's ref: the package root exports no ref type, so it is derived from the component. */
type BubbleListRef = React.ComponentRef<typeof Bubble.List>

export interface TurnListProps {
	messages: MessageInfo<Turn>[]
	/** The conversation shown, '' while there is none yet; each one opens at its latest turn. */
	conversationKey: string
	isDefaultMessagesRequesting: boolean
	hasMore: boolean
	/** Rejects when the page could not be loaded. */
	loadEarlier: () => Promise<void>
	/** The bubbles' reading width; the scroll box itself spans the region. */
	maxWidth: React.CSSProperties['maxWidth']
	/** An answer's content; keep it stable (useCallback): the role map, and so every bubble, follows it. */
	renderAssistant: (turn: Turn, info: BubbleInfo) => React.ReactNode
	renderFooter?: (turn: Turn, info: BubbleInfo) => React.ReactNode
}

/**
 * X Bubble.List over the conversation's turns, with "load earlier" above it: the Dify chat's MessageList for the shared
 * turn (spec §5.1; plan call P11), the same role map, widths, skeleton and scroll anchoring.
 */
export default function TurnList({
	messages,
	conversationKey,
	isDefaultMessagesRequesting,
	hasMore,
	loadEarlier,
	maxWidth,
	renderAssistant,
	renderFooter,
}: TurnListProps) {
	const { t } = useTranslation()
	const { message: toast } = App.useApp()
	const listRef = useRef<BubbleListRef>(null)

	// Stable role map (x-components: "keep roles stable"); no avatar slot on either role (the Dify chat's).
	const role = useMemo<BubbleListProps['role']>(
		() => ({
			assistant: {
				placement: 'start',
				variant: 'borderless',
				contentRender: (content, info) => renderAssistant(content as Turn, info),
				footer: renderFooter ? (content, info) => renderFooter(content as Turn, info) : undefined,
			},
			user: {
				placement: 'end',
				contentRender: content => <UserTurn turn={content as Turn} />,
			},
		}),
		[renderAssistant, renderFooter],
	)

	// One object per width, like the role map: Bubble.List hands it to every item on each render.
	const rowStyles = useMemo<BubbleListProps['styles']>(() => {
		const row = { maxWidth, marginInline: 'auto' }
		return { bubble: row, system: row, divider: row }
	}, [maxWidth])

	const items = useMemo(() => toBubbleItems(messages), [messages])

	const onLoadEarlier = async () => {
		const firstKey = items[0]?.key
		try {
			await loadEarlier()
		} catch {
			toast.error(t('common.request_failed_retry'))
			return
		}
		// The turn that was first stays where the reader is instead of the list jumping (the Dify chat's rule).
		if (firstKey !== undefined)
			listRef.current?.scrollTo({ key: firstKey, block: 'start', behavior: 'instant' })
	}

	if (!conversationKey || (isDefaultMessagesRequesting && items.length === 0)) {
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
			{hasMore && (
				<div className={styles.loadEarlier}>
					<Button
						type="link"
						onClick={() => void onLoadEarlier()}
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
				classNames={{ scroll: styles.scrollBox }}
				styles={rowStyles}
			/>
		</div>
	)
}
