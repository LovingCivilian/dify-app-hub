import type { MessageInfo } from '@ant-design/x-sdk'

import type { IAgentMessage, IMessageItem4Render } from '@/lib/api'
import { Roles } from '@/lib/core'
import { formatDateTime } from '@/libs/format-date'

/**
 * A message answered in this session, as the chat list renders it.
 *
 * `id` stays the SDK's own id (`msg_n`): list keys and the HITL continuation
 * map are keyed by it. The Dify message id and creation time come from the
 * stream (`message_id` / `created_at` on every event) and are exposed the same
 * way history messages expose them, so feedback and the footer work before a
 * reload.
 */
export const toLiveRenderItem = (
	item: MessageInfo<IAgentMessage>,
	language?: string,
): IMessageItem4Render => {
	const message = item.message
	return {
		id: String(item.id),
		messageId: message?.id,
		status: item.status,

		error: message?.error || '',
		workflows: message?.workflows,
		agentThoughts: message?.agentThoughts,
		retrieverResources: message?.retrieverResources,
		files: message?.files,
		content: message?.content,
		role: item.status === Roles.LOCAL ? Roles.USER : Roles.AI,
		created_at: message?.createdAt ? formatDateTime(message.createdAt * 1000, language) : undefined,
	} as IMessageItem4Render
}
