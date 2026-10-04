import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock factories are hoisted above imports, so the mocks must be created with vi.hoisted.
const { getServerSession, redirect, redirectSignal, AdminShell } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	redirect: vi.fn(),
	// next's redirect() works by throwing; the sentinel stands in for that error.
	redirectSignal: new Error('NEXT_REDIRECT'),
	// AdminShell is a client component tree; the layout test only cares about the gate.
	AdminShell: () => null,
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/components/shell/admin-shell', () => ({ default: AdminShell }))

import AdminLayout from '@/app/(admin)/layout'
import UserLayout from '@/app/(user)/layout'

const page = 'page'

describe.each([
	// The (user) layout hands the page through untouched.
	['(user)', UserLayout, (rendered: unknown) => expect(rendered).toBe(page)],
	// The (admin) layout wraps the page in the admin shell.
	[
		'(admin)',
		AdminLayout,
		(rendered: unknown) =>
			expect(rendered).toMatchObject({ type: AdminShell, props: { children: page } }),
	],
] as const)('%s layout', (_group, Layout, expectRendered) => {
	beforeEach(() => {
		getServerSession.mockReset()
		redirect.mockReset()
		redirect.mockImplementation(() => {
			throw redirectSignal
		})
	})

	it('renders the page for a live session', async () => {
		getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'jane@example.com' } })
		expectRendered(await Layout({ children: page }))
		expect(redirect).not.toHaveBeenCalled()
	})

	it('redirects a visitor without a session to /login', async () => {
		getServerSession.mockResolvedValue(null)
		await expect(Layout({ children: page })).rejects.toBe(redirectSignal)
		expect(redirect).toHaveBeenCalledWith('/login')
	})

	it('redirects a revoked session (no user.id) to /login', async () => {
		getServerSession.mockResolvedValue({ user: { email: 'jane@example.com' } })
		await expect(Layout({ children: page })).rejects.toBe(redirectSignal)
		expect(redirect).toHaveBeenCalledWith('/login')
	})
})
