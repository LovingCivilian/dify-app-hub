import type { BubbleItemType } from '@ant-design/x'
import type { MessageInfo } from '@ant-design/x-sdk'

import type { DifyChatMessage } from '../provider/message'

/**
 * Nothing to render yet. Bubble shows only its loading dots while `loading` is set (Bubble.js
 * `renderContent`), and the SDK marks a resumed HITL message `loading` with our placeholder, the
 * paused message itself (x-chat `onReload`): its workflow and form must stay visible meanwhile.
 */
const isEmpty = (message: DifyChatMessage) =>
	!message.content && !message.workflow && !message.humanInput && !message.thoughts?.length

/**
 * x-components Pattern 3: `loading` only for a placeholder with nothing to show (the pattern's
 * `!content` guard), `streaming` only while the reply updates.
 */
export const toBubbleItems = (messages: MessageInfo<DifyChatMessage>[]): BubbleItemType[] =>
	messages.map(({ id, message, status }) => ({
		key: id,
		role: message.role,
		content: message,
		loading: status === 'loading' && isEmpty(message),
		streaming: status === 'updating',
		status,
	}))
