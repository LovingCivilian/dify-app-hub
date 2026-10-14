import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	runTurn: vi.fn(),
	reconcileStaleRun: vi.fn(),
	findConversation: vi.fn(),
	listConversations: vi.fn(),
	readThreadPage: vi.fn(),
	decodeListCursor: vi.fn(),
	turnsFromMessages: vi.fn(),
	stop: vi.fn(),
	chat: { runTurn: vi.fn() },
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession: m.verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess: m.getAppAccess }))
vi.mock('@/lib/providers/registry', () => ({
	chatAdapterOf: (provider: string) => (provider === 'agui' ? m.chat : undefined),
}))
vi.mock('@/lib/chat/run', () => ({ runTurn: m.runTurn, reconcileStaleRun: m.reconcileStaleRun }))
vi.mock('@/lib/data/conversations', () => ({
	LIST_PAGE_MAX: 100,
	THREAD_PAGE_TURNS: 20,
	decodeListCursor: m.decodeListCursor,
	findConversation: m.findConversation,
	listConversations: m.listConversations,
	readThreadPage: m.readThreadPage,
}))
vi.mock('@/lib/chat/turn', () => ({ turnsFromMessages: m.turnsFromMessages }))
vi.mock('@/lib/chat/active-runs', () => ({ activeRuns: { stop: m.stop } }))

import { GET as getConversation } from '@/app/api/apps/[appId]/conversations/[conversationId]/route'
import { POST as stopRun } from '@/app/api/apps/[appId]/conversations/[conversationId]/runs/[runId]/stop/route'
import { GET as listConversations } from '@/app/api/apps/[appId]/conversations/route'
import { POST as postRun } from '@/app/api/apps/[appId]/runs/route'

const APP_ID = '0b1c2d3e-4f50-4a61-8b72-9c8dae0f1a2b'
const CONVERSATION_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const RUN_ID = '9c8dae0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f'
const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'user', source: 'local' }
const agui = {
	id: APP_ID,
	enabled: true,
	provider: 'agui',
	settings: { agentUrl: 'http://agent/agents/a', audience: 'a' },
	secrets: { jwtSecret: 'x'.repeat(32) },
}
const conversation = {
	id: CONVERSATION_ID,
	appId: APP_ID,
	title: 'Tea',
	state: { a: 1 },
	activeRunId: null,
}
const base = `http://hub/api/apps/${APP_ID}`
const ctx = <P extends Record<string, string>>(extra?: P) => ({
	params: Promise.resolve({ appId: APP_ID, ...extra } as { appId: string } & P),
})
const post = (path: string, body: unknown) =>
	new NextRequest(`${base}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
const read = async (response: Response) => ({
	status: response.status,
	body: await response.json(),
})

beforeEach(() => {
	for (const fn of [
		m.verifySession,
		m.getAppAccess,
		m.runTurn,
		m.reconcileStaleRun,
		m.findConversation,
		m.listConversations,
		m.readThreadPage,
		m.decodeListCursor,
		m.turnsFromMessages,
		m.stop,
	])
		fn.mockReset()
	m.verifySession.mockResolvedValue(actor)
	m.getAppAccess.mockResolvedValue(agui)
	m.findConversation.mockResolvedValue(conversation)
})

describe('POST runs', () => {
	it('answers 401 signed out and 404 for an app without the shared chat, running nothing', async () => {
		m.verifySession.mockResolvedValue(null)
		expect((await postRun(post('/runs', { message: { text: 'hi' } }), ctx())).status).toBe(401)
		m.verifySession.mockResolvedValue(actor)
		m.getAppAccess.mockResolvedValue({ ...agui, provider: 'dify' })
		expect(await read(await postRun(post('/runs', { message: { text: 'hi' } }), ctx()))).toEqual({
			status: 404,
			body: { code: 'app_not_found', message: 'No such app.', status: 404 },
		})
		expect(m.runTurn).not.toHaveBeenCalled()
	})
	it('refuses a body with both a message and answers', async () => {
		const body = {
			conversationId: CONVERSATION_ID,
			message: { text: 'hi' },
			answers: { resume: [] },
		}
		expect(await read(await postRun(post('/runs', body), ctx()))).toEqual({
			status: 400,
			body: { code: 'invalid_param', message: 'Invalid request: message', status: 400 },
		})
		expect(m.runTurn).not.toHaveBeenCalled()
	})
	it('hands the guard’s actor, app and adapter and the checked body to runTurn, and answers its response', async () => {
		const streamed = new Response('data: {}\n\n', {
			headers: { 'content-type': 'text/event-stream' },
		})
		m.runTurn.mockResolvedValue(streamed)
		const request = post('/runs', { message: { text: 'hi' } })
		expect(await postRun(request, ctx())).toBe(streamed)
		expect(m.runTurn).toHaveBeenCalledWith({
			request,
			actor,
			app: agui,
			chat: m.chat,
			body: { message: { text: 'hi' } },
		})
	})
	it('answers a logged 500 envelope when the run throws', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		m.runTurn.mockRejectedValue(new Error('boom'))
		expect((await postRun(post('/runs', { message: { text: 'hi' } }), ctx())).status).toBe(500)
		expect(errorSpy).toHaveBeenCalledWith('POST /api/apps/[appId]/runs:', expect.any(Error))
		errorSpy.mockRestore()
	})
})

describe('GET conversations', () => {
	it('lists the actor’s conversations of the app, newest first, uncached', async () => {
		const page = {
			items: [{ id: CONVERSATION_ID, title: 'Tea', updatedAt: '2026-10-14T10:00:00.000Z' }],
			nextCursor: null,
		}
		m.listConversations.mockResolvedValue(page)
		const response = await listConversations(new NextRequest(`${base}/conversations`), ctx())
		expect(await read(response)).toEqual({ status: 200, body: page })
		expect(response.headers.get('cache-control')).toBe('private, no-store')
		expect(m.listConversations).toHaveBeenCalledWith(actor, APP_ID, {
			cursor: undefined,
			limit: 100,
		})
	})
	it('passes on a cursor the DAL reads', async () => {
		m.decodeListCursor.mockReturnValue({ updatedAt: new Date(), id: CONVERSATION_ID })
		m.listConversations.mockResolvedValue({ items: [], nextCursor: null })
		await listConversations(new NextRequest(`${base}/conversations?cursor=abc`), ctx())
		expect(m.decodeListCursor).toHaveBeenCalledWith('abc')
		expect(m.listConversations).toHaveBeenCalledWith(actor, APP_ID, { cursor: 'abc', limit: 100 })
	})
	it('refuses an empty cursor, and one the DAL cannot read', async () => {
		expect(
			(await listConversations(new NextRequest(`${base}/conversations?cursor=`), ctx())).status,
		).toBe(400)
		m.decodeListCursor.mockReturnValue(null)
		expect(
			await read(
				await listConversations(new NextRequest(`${base}/conversations?cursor=bad`), ctx()),
			),
		).toEqual({
			status: 400,
			body: { code: 'invalid_param', message: 'Invalid request: cursor', status: 400 },
		})
		expect(m.listConversations).not.toHaveBeenCalled()
	})
})

describe('GET conversations/[conversationId]', () => {
	const get = (query = '') => new NextRequest(`${base}/conversations/${CONVERSATION_ID}${query}`)
	const notFound = {
		status: 404,
		body: { code: 'conversation_not_found', message: 'No such conversation.', status: 404 },
	}
	it('answers the latest turns, after a stale run is reconciled', async () => {
		const page = { conversation, rows: ['rows'], runs: ['runs'], cursor: '12' }
		m.readThreadPage.mockResolvedValue(page)
		m.turnsFromMessages.mockReturnValue(['turns'])
		const response = await getConversation(
			get('?before=42'),
			ctx({ conversationId: CONVERSATION_ID }),
		)
		expect(await read(response)).toEqual({
			status: 200,
			body: { id: CONVERSATION_ID, title: 'Tea', state: { a: 1 }, turns: ['turns'], cursor: '12' },
		})
		expect(m.reconcileStaleRun).toHaveBeenCalledWith(conversation)
		expect(m.readThreadPage).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID, {
			before: 42,
			turns: 20,
		})
		expect(m.turnsFromMessages).toHaveBeenCalledWith(['rows'], ['runs'])
		expect(response.headers.get('cache-control')).toBe('private, no-store')
	})
	it('answers a malformed or foreign conversation as unknown', async () => {
		expect(await read(await getConversation(get(), ctx({ conversationId: 'nope' })))).toEqual(
			notFound,
		)
		m.findConversation.mockResolvedValue(null)
		expect(
			await read(await getConversation(get(), ctx({ conversationId: CONVERSATION_ID }))),
		).toEqual(notFound)
		expect(m.readThreadPage).not.toHaveBeenCalled()
	})
	it('refuses a cursor that is no positive integer', async () => {
		expect(
			(await getConversation(get('?before=abc'), ctx({ conversationId: CONVERSATION_ID }))).status,
		).toBe(400)
	})
})

describe('POST …/runs/[runId]/stop', () => {
	const stop = (conversationId: string, runId: string) =>
		stopRun(
			new NextRequest(`${base}/conversations/${conversationId}/runs/${runId}/stop`, {
				method: 'POST',
			}),
			ctx({ conversationId, runId }),
		)
	it('stops the run of the actor’s conversation and answers 204', async () => {
		const response = await stop(CONVERSATION_ID, RUN_ID)
		expect(response.status).toBe(204)
		expect(m.stop).toHaveBeenCalledWith(RUN_ID, CONVERSATION_ID, 'stop')
	})
	// Spec §4.2: 204 also when the run has already ended; a malformed id names no run of this process.
	it('answers 204 for a run id that is no UUID, stopping nothing', async () => {
		expect((await stop(CONVERSATION_ID, 'nope')).status).toBe(204)
		expect(m.stop).not.toHaveBeenCalled()
	})
	it('answers 404 for a conversation that is not the actor’s, and 401 signed out', async () => {
		m.findConversation.mockResolvedValue(null)
		expect((await stop(CONVERSATION_ID, RUN_ID)).status).toBe(404)
		m.verifySession.mockResolvedValue(null)
		expect((await stop(CONVERSATION_ID, RUN_ID)).status).toBe(401)
		expect(m.stop).not.toHaveBeenCalled()
	})
})
