import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess, findConversation, chat } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	findConversation: vi.fn(),
	chat: { runTurn: vi.fn() },
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))
vi.mock('@/lib/data/conversations', () => ({ findConversation }))
// The registry as the guard reads it: Dify has no chat adapter until Part 3, AG-UI has one (spec §4.1).
vi.mock('@/lib/providers/registry', () => ({
	chatAdapterOf: (provider: string) => (provider === 'agui' ? chat : undefined),
}))

import { resolveChatRoute, resolveConversation } from '@/lib/chat/route'

const APP_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const CONVERSATION_ID = '9c8dae0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f'
const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'user', source: 'local' }
const params = (appId = APP_ID) => Promise.resolve({ appId })
const app = {
	id: APP_ID,
	enabled: true,
	provider: 'agui',
	settings: { agentUrl: 'http://agent/agents/a', audience: 'a' },
	secrets: { jwtSecret: 'x'.repeat(32) },
}
const refusal = async (resolved: { ok: boolean; response?: Response }) => {
	expect(resolved.ok).toBe(false)
	return { status: resolved.response!.status, body: await resolved.response!.json() }
}
const appNotFound = {
	status: 404,
	body: { code: 'app_not_found', message: 'No such app.', status: 404 },
}

beforeEach(() => {
	verifySession.mockReset()
	getAppAccess.mockReset()
	findConversation.mockReset()
})

// Spec §4.1: the session → the id → the app as the actor may see it → enabled → a provider with a chat adapter.
describe('resolveChatRoute', () => {
	it('answers 401 before it looks at the id or the app', async () => {
		verifySession.mockResolvedValue(null)
		expect(await refusal(await resolveChatRoute(params('not-a-uuid')))).toEqual({
			status: 401,
			body: { code: 'unauthorized', message: 'Sign in required.', status: 401 },
		})
		expect(getAppAccess).not.toHaveBeenCalled()
	})
	it('answers a malformed id and an app the read does not return as unknown', async () => {
		verifySession.mockResolvedValue(actor)
		expect(await refusal(await resolveChatRoute(params('not-a-uuid')))).toEqual(appNotFound)
		expect(getAppAccess).not.toHaveBeenCalled()
		getAppAccess.mockResolvedValue(null)
		expect(await refusal(await resolveChatRoute(params()))).toEqual(appNotFound)
		expect(getAppAccess).toHaveBeenCalledWith(actor, APP_ID)
	})
	it('answers 403 app_disabled for a disabled app, before the adapter check', async () => {
		verifySession.mockResolvedValue(actor)
		for (const provider of ['agui', 'dify']) {
			getAppAccess.mockResolvedValue({ ...app, enabled: false, provider })
			expect(await refusal(await resolveChatRoute(params()))).toEqual({
				status: 403,
				body: { code: 'app_disabled', message: 'This app is disabled.', status: 403 },
			})
		}
	})
	it('answers an app whose provider has no chat adapter as unknown', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue({ ...app, provider: 'dify' })
		expect(await refusal(await resolveChatRoute(params()))).toEqual(appNotFound)
	})
	it('hands back the actor, the app and its adapter', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(app)
		expect(await resolveChatRoute(params())).toEqual({ ok: true, actor, app, chat })
	})
	it('answers a logged 500 envelope when a read throws', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockRejectedValue(new Error('db down'))
		expect(await refusal(await resolveChatRoute(params()))).toEqual({
			status: 500,
			body: { code: 'internal_error', message: 'Internal Server Error', status: 500 },
		})
		expect(errorSpy).toHaveBeenCalledWith('resolveChatRoute:', expect.any(Error))
		errorSpy.mockRestore()
	})
})

// Spec §4.1: a conversation must belong to the actor, match the app and not be deleted (findConversation's WHERE).
describe('resolveConversation', () => {
	const notFound = {
		status: 404,
		body: { code: 'conversation_not_found', message: 'No such conversation.', status: 404 },
	}
	it('answers a malformed id as unknown without reading it', async () => {
		expect(await refusal(await resolveConversation(actor as never, APP_ID, 'nope'))).toEqual(
			notFound,
		)
		expect(findConversation).not.toHaveBeenCalled()
	})
	it('answers a conversation the read does not return as unknown', async () => {
		findConversation.mockResolvedValue(null)
		expect(
			await refusal(await resolveConversation(actor as never, APP_ID, CONVERSATION_ID)),
		).toEqual(notFound)
		expect(findConversation).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID)
	})
	it('hands back the conversation', async () => {
		const conversation = {
			id: CONVERSATION_ID,
			appId: APP_ID,
			title: 't',
			state: {},
			activeRunId: null,
		}
		findConversation.mockResolvedValue(conversation)
		expect(await resolveConversation(actor as never, APP_ID, CONVERSATION_ID)).toEqual({
			ok: true,
			conversation,
		})
	})
})
