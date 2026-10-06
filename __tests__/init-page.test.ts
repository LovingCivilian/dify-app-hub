import { beforeEach, describe, expect, it, vi } from 'vitest'

const { hasUsers, redirect, redirectSignal, AuthCard, InitForm } = vi.hoisted(() => ({
	hasUsers: vi.fn(),
	redirect: vi.fn(),
	redirectSignal: new Error('NEXT_REDIRECT'),
	AuthCard: () => null,
	InitForm: () => null,
}))
vi.mock('@/lib/data/users', () => ({ hasUsers }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/components/shell/auth-card', () => ({ default: AuthCard }))
vi.mock('@/components/auth/init-form', () => ({ default: InitForm }))

import InitPage from '@/app/init/page'

describe('/init page', () => {
	beforeEach(() => {
		hasUsers.mockReset()
		redirect.mockReset()
		redirect.mockImplementation(() => {
			throw redirectSignal
		})
	})

	it('redirects to /login once an admin exists, before any form renders', async () => {
		hasUsers.mockResolvedValue(true)
		await expect(InitPage()).rejects.toBe(redirectSignal)
		expect(redirect).toHaveBeenCalledWith('/login')
	})

	it('renders the setup form inside the auth card on an empty database', async () => {
		hasUsers.mockResolvedValue(false)
		expect(await InitPage()).toMatchObject({
			type: AuthCard,
			props: { children: { type: InitForm } },
		})
		expect(redirect).not.toHaveBeenCalled()
	})
})
