import { describe, expect, it } from 'vitest'

import { toLiveRenderItem } from '@/components/chat/live-message'
import type { IAgentMessage } from '@/lib/api'
import { Roles } from '@/lib/core'
import { formatDateTime } from '@/libs/format-date'

const info = (overrides: Partial<{ id: string; status: string; message: IAgentMessage }> = {}) =>
	({
		id: 'msg_1',
		status: 'success',
		message: { content: 'Hello', id: 'message-1', createdAt: 1760000000 } as IAgentMessage,
		...overrides,
	}) as Parameters<typeof toLiveRenderItem>[0]

describe('toLiveRenderItem', () => {
	it('keeps the SDK id for the list and exposes the Dify id separately for feedback', () => {
		const item = toLiveRenderItem(info(), 'en')

		expect(item.id).toBe('msg_1')
		expect(item.messageId).toBe('message-1')
	})

	it('formats the creation time in the active language, like history messages', () => {
		expect(toLiveRenderItem(info(), 'en').created_at).toBe(formatDateTime(1760000000 * 1000, 'en'))
		expect(toLiveRenderItem(info(), 'ar').created_at).toBe(formatDateTime(1760000000 * 1000, 'ar'))
	})

	it('leaves the Dify id and time unset while the stream has not delivered them', () => {
		const item = toLiveRenderItem(info({ message: { content: '…' } as IAgentMessage }), 'en')

		expect(item.messageId).toBeUndefined()
		expect(item.created_at).toBeUndefined()
	})

	it('renders the local question as the user and everything else as the assistant', () => {
		expect(toLiveRenderItem(info({ status: 'local' }), 'en').role).toBe(Roles.USER)
		expect(toLiveRenderItem(info({ status: 'loading' }), 'en').role).toBe(Roles.AI)
		expect(toLiveRenderItem(info({ status: 'success' }), 'en').role).toBe(Roles.AI)
	})

	it('passes the message payload through', () => {
		const message = {
			content: 'Hello',
			error: 'boom',
			workflows: { status: 'finished' },
			agentThoughts: [],
			retrieverResources: [],
			files: [],
		} as unknown as IAgentMessage
		const item = toLiveRenderItem(info({ status: 'error', message }), 'en')

		expect(item).toMatchObject({
			status: 'error',
			content: 'Hello',
			error: 'boom',
			workflows: { status: 'finished' },
			agentThoughts: [],
			retrieverResources: [],
			files: [],
		})
	})
})
