'use client'

import {
	useEffect,
	useImperativeHandle,
	useRef,
	type ReactNode,
	type Ref,
	type RefObject,
} from 'react'
import { StickToBottom, type StickToBottomContext } from 'use-stick-to-bottom'

import styles from './chat-view.module.css'

/** use-stick-to-bottom's `RETAIN_ANIMATION_DURATION_MS` (`dist/useStickToBottom.js`), which PR #43 passes too. */
const RETAIN_ANIMATION_DURATION_MS = 350

/**
 * The region's spring (use-stick-to-bottom `SpringAnimation`: `damping` 0.7, `stiffness` 0.05 and `mass` 1.25 by
 * default), twice as stiff as the library's: its velocity-based spring moves down one line in about 0.6 s by default
 * and about 0.23 s at 0.1, and trails a fast stream by half as much (the owner, 2026-10-15: "go with twice"). Every
 * smooth scroll of the region takes it: following the answer, a send, and the scroll box workaround below.
 */
const STIFFNESS = 0.1

/** What a chat asks of its scroll region. */
export interface ChatScrollHandle {
	/** Brings the reader to the latest message and follows it again, as after they send one. */
	scrollToBottom: () => void
}

/**
 * WORKAROUND for use-stick-to-bottom 1.1.6, issue #40 "scroll position drifts when scroll container height changes
 * (flex sibling resize)" (https://github.com/stackblitz-labs/use-stick-to-bottom/issues/40), fixed upstream by the
 * open PR #43 "re-anchor to bottom when the scroll container itself resizes"
 * (https://github.com/stackblitz-labs/use-stick-to-bottom/pull/43). Delete this once a release carries that fix.
 *
 * The library watches only the messages, so when something below the list grows (the composer as a long message is
 * typed, the plan panel, the question card) the scroll box shrinks and the newest lines slide out of view. This is
 * PR #43's second ResizeObserver, on the scroll box, through the library's own API (`contextRef`, its `state` and
 * `scrollToBottom`): a box that shrinks while the reader is at the bottom re-anchors there, as the library does when
 * the messages grow; a resize is recorded in `state.resizeDifference`, so the scroll event of the browser's clamp when
 * the box grows back is not taken for the reader scrolling up, which would stop the following.
 */
function useScrollBoxResize(context: RefObject<StickToBottomContext | null>) {
	useEffect(() => {
		const box = context.current?.scrollRef.current
		if (!box) return
		let previousHeight: number | undefined
		const observer = new ResizeObserver(([entry]) => {
			const current = context.current
			if (!current) return
			const { height } = entry.contentRect
			const difference = height - (previousHeight ?? height)
			previousHeight = height
			if (!difference) return
			const { state } = current
			state.resizeDifference = difference
			if (difference < 0 && state.isAtBottom)
				void current.scrollToBottom({
					// The region's spring (`resize`, as PR #43 takes): 'smooth' merges onto its options.
					animation: 'smooth',
					wait: true,
					preserveScrollPosition: true,
					duration: RETAIN_ANIMATION_DURATION_MS,
				})
			// As the library resets its own: after the scroll event of this resize has fired.
			requestAnimationFrame(() => {
				setTimeout(() => {
					if (state.resizeDifference === difference) state.resizeDifference = 0
				}, 1)
			})
		})
		observer.observe(box)
		return () => observer.disconnect()
	}, [context])
}

/**
 * ADR-0036. The chats' scroll region (the Dify chat's MessageList and the shared chat's TurnList), as AI Elements' `Conversation`
 * builds it (vercel/ai-elements `packages/elements/src/conversation.tsx`): use-stick-to-bottom's `StickToBottom` and
 * its `Content` (README "`<StickToBottom>` Component"), around a Bubble.List with `autoScroll` off. The messages flow
 * from the top, so a card or a thought that opens grows downwards and nothing above it moves; the region follows the
 * answer while the reader is at the bottom ("automatically sticks to the bottom … whilst new content is being added"),
 * lets go when they scroll up, comes back to it when they send (ChatScrollHandle), and opens each conversation at its
 * latest message (`initial`, at once; the caller keys the region by conversation). X's own `autoScroll` lays the list out bottom-up (`flex-direction: column-reverse`) and
 * holds it in place by script, which lost its place while a card opened in Firefox (the owner, 2026-10-15).
 */
export default function ChatScroll({
	children,
	ref,
}: {
	children: ReactNode
	/** The chat's handle (React 19: `ref` as a prop), for its send handler. */
	ref?: Ref<ChatScrollHandle>
}) {
	const context = useRef<StickToBottomContext>(null)
	useScrollBoxResize(context)
	// The library's README has the chat box scroll to the bottom when the user enters a message
	// (`useStickToBottomContext().scrollToBottom`); the chats' composers sit beside the region, so they reach it here.
	useImperativeHandle(
		ref,
		() => ({ scrollToBottom: () => void context.current?.scrollToBottom() }),
		[],
	)
	return (
		<StickToBottom
			className={styles.scrollRegion}
			initial="instant"
			resize="smooth"
			stiffness={STIFFNESS}
			contextRef={context}
		>
			<StickToBottom.Content scrollClassName={styles.scrollBox}>{children}</StickToBottom.Content>
		</StickToBottom>
	)
}
