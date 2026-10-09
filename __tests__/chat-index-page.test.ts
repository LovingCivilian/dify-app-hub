import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireUser, listApps, redirect, redirectSignal } = vi.hoisted(() => ({
	requireUser: vi.fn(),
	listApps: vi.fn(),
	redirect: vi.fn(),
	redirectSignal: new Error('NEXT_REDIRECT'),
}))
vi.mock('@/lib/auth/session', () => ({ requireUser }))
vi.mock('@/lib/data/apps', () => ({ listApps }))
vi.mock('next/navigation', () => ({ redirect }))

import ChatIndexPage from '@/app/(user)/chat/page'

const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'user' as const }
const app = (id: string, enabled: boolean) => ({ id, enabled })

beforeEach(() => {
	requireUser.mockReset()
	listApps.mockReset()
	// redirect() ends the render by throwing (Next's `redirect` reference), so the mock throws too.
	redirect.mockReset().mockImplementation(() => {
		throw redirectSignal
	})
})

// Review Focus 1: `/chat` opens the first app the actor may use, never one the access rule hides.
describe('/chat page', () => {
	it('checks the session before it reads the apps', async () => {
		requireUser.mockRejectedValue(redirectSignal)
		await expect(ChatIndexPage()).rejects.toBe(redirectSignal)
		expect(listApps).not.toHaveBeenCalled()
	})

	it('reads the apps as the session actor and opens the first enabled one', async () => {
		requireUser.mockResolvedValue(actor)
		listApps.mockResolvedValue([app('a1', false), app('a2', true), app('a3', true)])
		await expect(ChatIndexPage()).rejects.toBe(redirectSignal)
		expect(listApps).toHaveBeenCalledWith(actor)
		expect(redirect).toHaveBeenCalledWith('/chat/a2')
	})

	it('sends the actor to /apps when no enabled app is visible to it', async () => {
		requireUser.mockResolvedValue(actor)
		listApps.mockResolvedValue([app('a1', false)])
		await expect(ChatIndexPage()).rejects.toBe(redirectSignal)
		expect(redirect).toHaveBeenCalledWith('/apps')
	})

	it('sends the actor to /apps when the rule leaves it no app', async () => {
		requireUser.mockResolvedValue(actor)
		listApps.mockResolvedValue([])
		await expect(ChatIndexPage()).rejects.toBe(redirectSignal)
		expect(redirect).toHaveBeenCalledWith('/apps')
	})
})
