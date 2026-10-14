import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	getAppAccess: vi.fn(),
	findConversation: vi.fn(),
	renameConversation: vi.fn(),
	softDeleteConversation: vi.fn(),
	stop: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession: m.getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/data/apps', () => ({ getAppAccess: m.getAppAccess }))
vi.mock('@/lib/data/conversations', () => ({
	findConversation: m.findConversation,
	renameConversation: m.renameConversation,
	softDeleteConversation: m.softDeleteConversation,
}))
vi.mock('@/lib/providers/registry', () => ({
	PROVIDERS: { dify: { hubHistory: false }, agui: { hubHistory: true } },
}))
vi.mock('@/lib/chat/active-runs', () => ({ activeRuns: { stop: m.stop } }))

import { deleteConversationAction, renameConversationAction } from '@/app/(user)/chat/actions'

const APP_ID = '0b1c2d3e-4f50-4a61-8b72-9c8dae0f1a2b'
const CONVERSATION_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const RUN_ID = '9c8dae0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f'
const user = { id: 'u1', email: 'jane@example.com', name: 'Jane', role: 'user', source: 'local' }
const actor = { id: 'u1', email: 'jane@example.com', name: 'Jane', role: 'user', source: 'local' }
const app = { id: APP_ID, enabled: true, provider: 'agui', settings: {}, secrets: {} }
const conversation = {
	id: CONVERSATION_ID,
	appId: APP_ID,
	title: 'Tea',
	state: {},
	activeRunId: null,
}

beforeEach(() => {
	for (const fn of Object.values(m)) fn.mockReset()
	m.getServerSession.mockResolvedValue({ user })
	m.getAppAccess.mockResolvedValue(app)
	m.findConversation.mockResolvedValue(conversation)
	m.renameConversation.mockResolvedValue(true)
	m.softDeleteConversation.mockResolvedValue(true)
})

describe('renameConversationAction (spec §4.2)', () => {
	it('stores the trimmed title and answers ok', async () => {
		expect(await renameConversationAction(APP_ID, CONVERSATION_ID, '  Tea time  ')).toEqual({
			ok: true,
			data: undefined,
		})
		expect(m.getAppAccess).toHaveBeenCalledWith(actor, APP_ID)
		expect(m.renameConversation).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID, 'Tea time')
	})

	// TITLE_MAX_LENGTH counts code points (spec §3.1), not zod's UTF-16 code units.
	it('takes 80 code points, emoji included, and refuses a blank title and 81 code points', async () => {
		expect((await renameConversationAction(APP_ID, CONVERSATION_ID, '😀'.repeat(80))).ok).toBe(true)
		for (const title of ['   ', 'x'.repeat(81), '😀'.repeat(81), 42])
			expect(await renameConversationAction(APP_ID, CONVERSATION_ID, title)).toMatchObject({
				ok: false,
				code: 'invalid_input',
				fieldErrors: { title: expect.any(Array) },
			})
		expect(m.renameConversation).toHaveBeenCalledTimes(1)
	})

	it('answers unauthorized signed out, and not_found for malformed ids, reading nothing', async () => {
		m.getServerSession.mockResolvedValue(null)
		expect(await renameConversationAction(APP_ID, CONVERSATION_ID, 'Tea')).toEqual({
			ok: false,
			code: 'unauthorized',
		})
		m.getServerSession.mockResolvedValue({ user })
		for (const [appId, conversationId] of [
			['nope', CONVERSATION_ID],
			[APP_ID, 'nope'],
		])
			expect(await renameConversationAction(appId, conversationId, 'Tea')).toEqual({
				ok: false,
				code: 'not_found',
			})
		expect(m.getAppAccess).not.toHaveBeenCalled()
	})

	it.each([
		['a missing app', null],
		['a disabled app', { ...app, enabled: false }],
		['an app whose conversations the hub does not keep', { ...app, provider: 'dify' }],
	])('answers not_found for %s, writing nothing', async (_case, found) => {
		m.getAppAccess.mockResolvedValue(found)
		expect(await renameConversationAction(APP_ID, CONVERSATION_ID, 'Tea')).toEqual({
			ok: false,
			code: 'not_found',
		})
		expect(m.renameConversation).not.toHaveBeenCalled()
	})

	it('answers not_found when the DAL finds no such conversation of the actor’s', async () => {
		m.renameConversation.mockResolvedValue(false)
		expect(await renameConversationAction(APP_ID, CONVERSATION_ID, 'Tea')).toEqual({
			ok: false,
			code: 'not_found',
		})
	})
})

describe('deleteConversationAction (spec §3.4, §4.2)', () => {
	it('soft-deletes the conversation and answers ok', async () => {
		expect(await deleteConversationAction(APP_ID, CONVERSATION_ID)).toEqual({
			ok: true,
			data: undefined,
		})
		expect(m.findConversation).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID)
		expect(m.softDeleteConversation).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID)
		expect(m.stop).not.toHaveBeenCalled()
	})

	// softDeleteConversation leaves a run alone (Task 7): the stop route's path stops it first (spec §4.5).
	it('stops an active run before it deletes the conversation', async () => {
		m.findConversation.mockResolvedValue({ ...conversation, activeRunId: RUN_ID })
		expect((await deleteConversationAction(APP_ID, CONVERSATION_ID)).ok).toBe(true)
		expect(m.stop).toHaveBeenCalledWith(RUN_ID, CONVERSATION_ID, 'stop')
		expect(m.stop.mock.invocationCallOrder[0]).toBeLessThan(
			m.softDeleteConversation.mock.invocationCallOrder[0],
		)
	})

	it('answers not_found for a conversation that is not the actor’s, or that the write misses', async () => {
		m.findConversation.mockResolvedValue(null)
		expect(await deleteConversationAction(APP_ID, CONVERSATION_ID)).toEqual({
			ok: false,
			code: 'not_found',
		})
		expect(m.softDeleteConversation).not.toHaveBeenCalled()
		m.findConversation.mockResolvedValue(conversation)
		m.softDeleteConversation.mockResolvedValue(false)
		expect(await deleteConversationAction(APP_ID, CONVERSATION_ID)).toEqual({
			ok: false,
			code: 'not_found',
		})
	})

	it('answers not_found for a disabled app and malformed ids, and unauthorized signed out', async () => {
		m.getAppAccess.mockResolvedValue({ ...app, enabled: false })
		expect(await deleteConversationAction(APP_ID, CONVERSATION_ID)).toEqual({
			ok: false,
			code: 'not_found',
		})
		expect(await deleteConversationAction(APP_ID, 'nope')).toEqual({ ok: false, code: 'not_found' })
		m.getServerSession.mockResolvedValue(null)
		expect(await deleteConversationAction(APP_ID, CONVERSATION_ID)).toEqual({
			ok: false,
			code: 'unauthorized',
		})
		expect(m.softDeleteConversation).not.toHaveBeenCalled()
	})

	it('answers operation_failed and logs the action when the DAL fails', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		m.softDeleteConversation.mockRejectedValue(new Error('db down'))
		expect(await deleteConversationAction(APP_ID, CONVERSATION_ID)).toEqual({
			ok: false,
			code: 'operation_failed',
		})
		expect(errorSpy).toHaveBeenCalledWith('deleteConversationAction:', expect.any(Error))
		errorSpy.mockRestore()
	})
})
