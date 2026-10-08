import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock factories are hoisted above imports, so the mock must be created with vi.hoisted.
const { getServerSession, redirect, hasAccounts } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	redirect: vi.fn(),
	hasAccounts: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/data/setup', () => ({ hasAccounts }))

import ForgotPasswordLayout from '@/app/(auth)/forgot-password/layout'
import LoginLayout from '@/app/(auth)/login/layout'

// Server layouts are plain async functions, so they can be called directly.
const layouts = [
	['/login', LoginLayout],
	['/forgot-password', ForgotPasswordLayout],
] as const

describe.each(layouts)('%s layout', (_path, Layout) => {
	const children = 'page'

	beforeEach(() => {
		getServerSession.mockReset()
		redirect.mockReset()
		hasAccounts.mockReset()
		hasAccounts.mockResolvedValue(true)
	})

	it('sends a signed-in visitor to /apps', async () => {
		getServerSession.mockResolvedValue({
			user: { id: 'u1', email: 'jane@example.com', role: 'admin' },
		})
		await Layout({ children })
		expect(redirect).toHaveBeenCalledWith('/apps')
	})

	it('renders the page for a visitor without a session', async () => {
		getServerSession.mockResolvedValue(null)
		await expect(Layout({ children })).resolves.toBe(children)
		expect(redirect).not.toHaveBeenCalled()
	})
})

describe('/login layout on a fresh install (charter §4.2)', () => {
	it('sends the visitor to /init before reading the session', async () => {
		getServerSession.mockReset()
		hasAccounts.mockResolvedValue(false)
		redirect.mockImplementation((to: string) => {
			throw new Error(`NEXT_REDIRECT:${to}`)
		})
		await expect(LoginLayout({ children: 'page' })).rejects.toThrow('NEXT_REDIRECT:/init')
		expect(getServerSession).not.toHaveBeenCalled()
	})
})
