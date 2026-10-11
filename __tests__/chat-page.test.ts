import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireUser, getChatApp, ChatWorkspace, AppUnavailable, redirectSignal } = vi.hoisted(
	() => ({
		requireUser: vi.fn(),
		getChatApp: vi.fn(),
		ChatWorkspace: () => null,
		AppUnavailable: () => null,
		redirectSignal: new Error('NEXT_REDIRECT'),
	}),
)
vi.mock('@/lib/auth/session', () => ({ requireUser }))
vi.mock('@/lib/data/apps', () => ({ getChatApp }))
vi.mock('@/components/chat/chat-workspace', () => ({ default: ChatWorkspace }))
vi.mock('@/components/chat/app-unavailable', () => ({ default: AppUnavailable }))

import AppChatPage from '@/app/(user)/chat/[appId]/page'

const actor = { id: 'u1', email: 'jane@example.com', name: null }
const app = {
	id: '3b241101-e2bb-4255-8caf-4136c566a962',
	name: 'Tea',
	mode: 'chat',
	description: '',
	enabled: true,
	icon: null,
	settings: {
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
		annotationEnabled: false,
	},
}
const props = {
	params: Promise.resolve({ appId: '3b241101-e2bb-4255-8caf-4136c566a962' }),
	searchParams: Promise.resolve({}),
}

beforeEach(() => {
	requireUser.mockReset()
	getChatApp.mockReset()
})

describe('/chat/[appId] page', () => {
	it('checks the session before it reads the app', async () => {
		requireUser.mockRejectedValue(redirectSignal)
		await expect(AppChatPage(props as never)).rejects.toBe(redirectSignal)
		expect(getChatApp).not.toHaveBeenCalled()
	})
	it('hands the workspace the chat DTO, keyed by the app', async () => {
		requireUser.mockResolvedValue(actor)
		getChatApp.mockResolvedValue(app)
		const page = await AppChatPage(props as never)
		expect(getChatApp).toHaveBeenCalledWith(actor, '3b241101-e2bb-4255-8caf-4136c566a962')
		expect(page).toMatchObject({
			type: ChatWorkspace,
			key: '3b241101-e2bb-4255-8caf-4136c566a962',
			props: { app },
		})
		expect(JSON.stringify(page.props)).not.toContain('apiBase')
	})
	it('renders the missing and the disabled states instead of the workspace', async () => {
		requireUser.mockResolvedValue(actor)
		getChatApp.mockResolvedValue(null)
		expect(await AppChatPage(props as never)).toMatchObject({
			type: AppUnavailable,
			props: { reason: 'missing' },
		})
		getChatApp.mockResolvedValue({ ...app, enabled: false })
		expect(await AppChatPage(props as never)).toMatchObject({
			type: AppUnavailable,
			props: { reason: 'disabled' },
		})
	})
	// Spec §3.2: a malformed id is the missing state, as an unknown app is, and reaches no query (22P02).
	it('renders the missing state for a malformed id without reading the app', async () => {
		requireUser.mockResolvedValue(actor)
		const malformed = {
			params: Promise.resolve({ appId: 'not-a-uuid' }),
			searchParams: Promise.resolve({}),
		}
		expect(await AppChatPage(malformed as never)).toMatchObject({
			type: AppUnavailable,
			props: { reason: 'missing' },
		})
		expect(getChatApp).not.toHaveBeenCalled()
	})
})
