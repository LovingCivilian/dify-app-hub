import type { BubbleItemType } from '@ant-design/x'
import type { MessageInfo } from '@ant-design/x-sdk'

import type { Turn } from '@/lib/chat/turn'

/** Nothing to render yet: no part, no open interrupt, and no run that ended in an error or a stop (all show in the bubble). */
const isEmpty = (turn: Turn) =>
	turn.parts.length === 0 &&
	turn.interrupts.length === 0 &&
	!turn.runs.some(run => run.error || run.outcome === 'cancelled' || run.outcome === 'truncated')

/**
 * x-components Pattern 3, as the Dify chat's toBubbleItems: `loading` only for a placeholder with nothing to show,
 * `streaming` only while the turn updates.
 */
export const toBubbleItems = (messages: MessageInfo<Turn>[]): BubbleItemType[] =>
	messages.map(({ id, message, status }) => ({
		key: id,
		role: message.role,
		content: message,
		loading: status === 'loading' && isEmpty(message),
		streaming: status === 'updating',
		status,
	}))
