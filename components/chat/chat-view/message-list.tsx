'use client'

import { Bubble, type BubbleListProps } from '@ant-design/x'
import { App, Button, Skeleton } from 'antd'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { toBubbleItems } from '../hooks/bubble-items'
import type { useDifyChat } from '../hooks/use-dify-chat'
import type { DifyChatMessage } from '../provider/message'
import ChatScroll, { type ChatScrollHandle } from './chat-scroll'
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
	/** The bubbles' reading width (the chat column's `readingStyle`); the scroll box itself spans the region. */
	maxWidth: React.CSSProperties['maxWidth']
	/** An assistant bubble's content; keep it stable (useCallback): the role map, and so every bubble, follows it. */
	renderAssistant: (message: DifyChatMessage, info: BubbleInfo) => React.ReactNode
	/** An assistant bubble's footer (Bubble's `footer` slot); keep it stable for the same reason. */
	renderFooter?: (message: DifyChatMessage, info: BubbleInfo) => React.ReactNode
	/** The scroll region's handle, for the chat's send (chat-scroll.tsx). */
	scrollRef: React.RefObject<ChatScrollHandle | null>
}

/** X Bubble.List over the conversation's messages, with "load earlier" above it (spec §5.2). */
export default function MessageList({
	chat,
	conversationKey,
	maxWidth,
	renderAssistant,
	renderFooter,
	scrollRef,
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

	// One object per width, like the role map: Bubble.List hands it to every item on each render.
	const rowStyles = useMemo<BubbleListProps['styles']>(() => {
		// The reading width replaces X's own gap: Bubble.List pads a start bubble's end and an end bubble's start by 15 %
		// (`es/bubble/style/list.js`), a share of the whole list's width, so inside a row capped at the reading width the
		// content got narrower as the window got wider (the owner, 2026-10-15). While the row is capped, its padding is 0;
		// wide (no cap) keeps X's gap.
		const row = {
			maxWidth,
			marginInline: 'auto',
			...(maxWidth === 'none' ? {} : { paddingInline: 0 }),
		}
		// X's own scroll box (`scroll`) is no scroll container while ChatScroll scrolls (chat-scroll.tsx): left `overflow-y:
		// auto`, it is where use-stick-to-bottom's wheel handler stops looking for the region's box, so a wheel up over the
		// messages would not let go of a streaming answer.
		return { bubble: row, system: row, divider: row, scroll: { overflow: 'visible' } }
	}, [maxWidth])

	const items = useMemo(() => toBubbleItems(chat.messages), [chat.messages])

	const loadEarlier = async () => {
		const firstKey = items[0]?.key
		// The reader goes up: the region lets go of the bottom first (chat-scroll.tsx `stopScroll`).
		scrollRef.current?.stopScroll()
		try {
			await chat.loadEarlier()
		} catch {
			toast.error(t('common.request_failed_retry'))
			return
		}
		// The message that was first stays where the reader is instead of the list jumping (spec §5.2): Bubble.List's
		// `scrollTo` with a key scrolls it into view (`scrollIntoView`), which scrolls ChatScroll's box.
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
			{/* Each conversation opens at its latest message (ChatScroll's `initial`, keyed by the conversation). */}
			<ChatScroll
				key={conversationKey}
				ref={scrollRef}
			>
				<Bubble.List
					ref={listRef}
					items={items}
					role={role}
					// ChatScroll scrolls and follows the answer; X's own auto-scroll is off (chat-scroll.tsx).
					autoScroll={false}
					// Bubble.List's semantic slots (ListSemanticType): `bubble`, `system` and `divider` are the roots of the
					// three bubble kinds (BubbleListItem), centred at the reading width (cosmetic sweep 1, item 1).
					styles={rowStyles}
				/>
			</ChatScroll>
		</div>
	)
}
