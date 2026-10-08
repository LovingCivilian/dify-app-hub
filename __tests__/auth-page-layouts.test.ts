import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock factories are hoisted above imports, so the mock must be created with vi.hoisted.
const { getServerSession, redirect } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	redirect: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

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
	})

	it('sends a signed-in visitor to /apps', async () => {
		getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'jane@example.com' } })
		await Layout({ children })
		expect(redirect).toHaveBeenCalledWith('/apps')
	})

	it('renders the page for a visitor without a session', async () => {
		getServerSession.mockResolvedValue(null)
		await expect(Layout({ children })).resolves.toBe(children)
		expect(redirect).not.toHaveBeenCalled()
	})
})
