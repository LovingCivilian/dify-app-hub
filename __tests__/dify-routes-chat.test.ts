import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess, client } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	client: {
		chatMessages: vi.fn(),
		stopChat: vi.fn(),
		listMessages: vi.fn(),
		getSuggested: vi.fn(),
		createFeedback: vi.fn(),
		listConversations: vi.fn(),
		deleteConversation: vi.fn(),
		renameConversation: vi.fn(),
	},
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))
vi.mock('@/lib/dify/client', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/dify/client')>()),
	difyClient: () => client,
}))

import { POST as chatMessages } from '@/app/api/dify/[appId]/chat-messages/route'
import { POST as stopChat } from '@/app/api/dify/[appId]/chat-messages/[taskId]/stop/route'
import { DELETE as deleteConversation } from '@/app/api/dify/[appId]/conversations/[conversationId]/route'
import { POST as renameConversation } from '@/app/api/dify/[appId]/conversations/[conversationId]/name/route'
import { GET as listConversations } from '@/app/api/dify/[appId]/conversations/route'
import { POST as feedback } from '@/app/api/dify/[appId]/messages/[messageId]/feedbacks/route'
import { GET as suggested } from '@/app/api/dify/[appId]/messages/[messageId]/suggested/route'
import { GET as listMessages } from '@/app/api/dify/[appId]/messages/route'
import { DifyError } from '@/lib/dify/errors'

/** The Dify end user: the account's id, never its email (ADR-0026). */
const USER = 'u1'
const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const actor = { id: USER, email: 'jane@example.com', name: null }
const access = { id: 'app-1', enabled: true, credentials: { apiBase: 'http://d/v1', apiKey: 'k' } }
const base = 'http://app/api/dify/app-1'
const json = (path: string, method: string, body: unknown) =>
	new NextRequest(`${base}${path}`, {
		method,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
const get = (path: string) => new NextRequest(`${base}${path}`)
const params = <P extends Record<string, string>>(extra?: P) => ({
	params: Promise.resolve({ appId: 'app-1', ...extra } as { appId: string } & P),
})

beforeEach(() => {
	verifySession.mockReset()
	verifySession.mockResolvedValue(actor)
	getAppAccess.mockReset()
	getAppAccess.mockResolvedValue(access)
	for (const fn of Object.values(client)) fn.mockReset()
})

describe('POST chat-messages', () => {
	it('validates, sets the user and passes the stream through', async () => {
		const upstream = new Response('data: {}\n\n', {
			status: 200,
			headers: { 'content-type': 'text/event-stream' },
		})
		client.chatMessages.mockResolvedValue(upstream)
		const request = json('/chat-messages', 'POST', {
			query: 'hi',
			inputs: {},
			response_mode: 'streaming',
			user: 'evil',
		})
		const response = await chatMessages(request, params())
		expect(client.chatMessages).toHaveBeenCalledWith(
			{ query: 'hi', inputs: {}, response_mode: 'streaming' },
			USER,
			expect.any(AbortSignal),
		)
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('text/event-stream')
		await expect(response.text()).resolves.toBe('data: {}\n\n')
	})
	it('answers 400 invalid_param for a bad body without calling Dify', async () => {
		const response = await chatMessages(json('/chat-messages', 'POST', { inputs: {} }), params())
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toMatchObject({ code: 'invalid_param' })
		expect(client.chatMessages).not.toHaveBeenCalled()
	})
	it('refuses without a session before reading the body', async () => {
		verifySession.mockResolvedValue(null)
		expect((await chatMessages(json('/chat-messages', 'POST', {}), params())).status).toBe(401)
	})
	it("answers Dify's envelope for a refused request", async () => {
		client.chatMessages.mockRejectedValue(
			new DifyError(400, 'not_chat_app', 'Please check your app mode.'),
		)
		const response = await chatMessages(
			json('/chat-messages', 'POST', { query: 'q', inputs: {} }),
			params(),
		)
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toEqual({
			code: 'not_chat_app',
			message: 'Please check your app mode.',
			status: 400,
		})
	})
})

describe('POST chat-messages/[taskId]/stop', () => {
	it("stops the task for the session user and answers Dify's body", async () => {
		client.stopChat.mockResolvedValue({ result: 'success' })
		const response = await stopChat(
			json('/chat-messages/t1/stop', 'POST', { user: 'evil' }),
			params({ taskId: 't1' }),
		)
		expect(client.stopChat).toHaveBeenCalledWith('t1', USER)
		await expect(response.json()).resolves.toEqual({ result: 'success' })
	})
})

describe('GET messages', () => {
	it('validates the query, adds the user and answers the page', async () => {
		client.listMessages.mockResolvedValue({ limit: 20, has_more: false, data: [] })
		const response = await listMessages(
			get(`/messages?conversation_id=${UUID}&limit=20&user=evil`),
			params(),
		)
		expect(client.listMessages).toHaveBeenCalledWith({ conversation_id: UUID, limit: 20 }, USER)
		await expect(response.json()).resolves.toEqual({ limit: 20, has_more: false, data: [] })
	})
	it('answers 400 for a missing conversation_id', async () => {
		expect((await listMessages(get('/messages'), params())).status).toBe(400)
		expect(client.listMessages).not.toHaveBeenCalled()
	})
})

describe('GET messages/[messageId]/suggested and POST feedbacks', () => {
	it('passes the message id and the user', async () => {
		client.getSuggested.mockResolvedValue({ result: 'success', data: ['a'] })
		await expect(
			(await suggested(get('/messages/m1/suggested'), params({ messageId: 'm1' }))).json(),
		).resolves.toEqual({ result: 'success', data: ['a'] })
		expect(client.getSuggested).toHaveBeenCalledWith('m1', USER)
		client.createFeedback.mockResolvedValue({ result: 'success' })
		const response = await feedback(
			json('/messages/m1/feedbacks', 'POST', { rating: 'like', content: '', user: 'evil' }),
			params({ messageId: 'm1' }),
		)
		expect(client.createFeedback).toHaveBeenCalledWith('m1', { rating: 'like', content: '' }, USER)
		await expect(response.json()).resolves.toEqual({ result: 'success' })
	})
	it('refuses a rating outside like, dislike, null', async () => {
		expect(
			(
				await feedback(
					json('/messages/m1/feedbacks', 'POST', { rating: 'meh' }),
					params({ messageId: 'm1' }),
				)
			).status,
		).toBe(400)
	})
})

describe('conversations', () => {
	it('lists with the validated query and the user', async () => {
		client.listConversations.mockResolvedValue({ limit: 100, has_more: false, data: [] })
		await listConversations(get('/conversations?limit=100&sort_by=-updated_at'), params())
		expect(client.listConversations).toHaveBeenCalledWith(
			{ limit: 100, sort_by: '-updated_at' },
			USER,
		)
	})
	it('deletes with 204 and no body', async () => {
		client.deleteConversation.mockResolvedValue(undefined)
		const response = await deleteConversation(
			new NextRequest(`${base}/conversations/${UUID}`, { method: 'DELETE' }),
			params({ conversationId: UUID }),
		)
		expect(client.deleteConversation).toHaveBeenCalledWith(UUID, USER)
		expect(response.status).toBe(204)
		expect(response.body).toBeNull()
	})
	it("renames and answers Dify's conversation; refuses an empty body", async () => {
		client.renameConversation.mockResolvedValue({ id: UUID, name: 'Tea' })
		const response = await renameConversation(
			json(`/conversations/${UUID}/name`, 'POST', { name: 'Tea' }),
			params({ conversationId: UUID }),
		)
		expect(client.renameConversation).toHaveBeenCalledWith(UUID, { name: 'Tea' }, USER)
		await expect(response.json()).resolves.toEqual({ id: UUID, name: 'Tea' })
		expect(
			(
				await renameConversation(
					json(`/conversations/${UUID}/name`, 'POST', {}),
					params({ conversationId: UUID }),
				)
			).status,
		).toBe(400)
	})
})

describe('path segments', () => {
	// A bare `.` or `..` collapses in fetch's URL parser (`/chat-messages/../stop` becomes `/stop`), so encoding is not
	// enough: every route with a segment refuses it before the body is read or Dify is called.
	const dotDot = '..'
	const refusals = [
		[
			'taskId',
			() => stopChat(json('/chat-messages/../stop', 'POST', {}), params({ taskId: dotDot })),
		],
		['messageId', () => suggested(get('/messages/../suggested'), params({ messageId: dotDot }))],
		[
			'messageId',
			() =>
				feedback(
					json('/messages/../feedbacks', 'POST', { rating: 'like' }),
					params({ messageId: dotDot }),
				),
		],
		[
			'conversationId',
			() =>
				deleteConversation(
					new NextRequest(`${base}/conversations/..`, { method: 'DELETE' }),
					params({ conversationId: dotDot }),
				),
		],
		[
			'conversationId',
			() =>
				renameConversation(
					json('/conversations/../name', 'POST', { name: 'Tea' }),
					params({ conversationId: dotDot }),
				),
		],
	] as const
	it.each(refusals)(
		'answers 400 invalid_param naming %s for ".." without calling Dify',
		async (name, call) => {
			const response = await call()
			expect(response.status).toBe(400)
			const body = await response.json()
			expect(body).toMatchObject({ code: 'invalid_param', status: 400 })
			expect(body.message).toContain(name)
			for (const fn of Object.values(client)) expect(fn).not.toHaveBeenCalled()
		},
	)
	it('validates the segment before the body is read: a malformed body behind a bad segment names the segment', async () => {
		const request = new NextRequest(`${base}/messages/../feedbacks`, {
			method: 'POST',
			body: 'not json',
		})
		const response = await feedback(request, params({ messageId: dotDot }))
		expect((await response.json()).message).toContain('messageId')
	})
})
