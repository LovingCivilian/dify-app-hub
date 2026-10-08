import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock factories are hoisted above imports, so the mocks are created with vi.hoisted.
const { getServerSession, redirect } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	redirect: vi.fn((to: string) => {
		throw new Error(`NEXT_REDIRECT:${to}`)
	}),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth/options', () => ({ authOptions: { marker: true } }))

import {
	assertAdmin,
	AuthError,
	getCachedServerSession,
	redirectSignedInUser,
	requireActor,
	requireAdmin,
	requireAdminUser,
	requireUser,
	verifySession,
} from '@/lib/auth/session'

const live = { user: { id: 'u1', email: 'jane@example.com', name: 'Jane', role: 'admin' } }
const member = { user: { id: 'u2', email: 'joe@example.com', name: null, role: 'user' } }
const owner = { user: { id: 'u0', email: 'owner@example.com', name: 'Owner', role: 'owner' } }
// A revoked JWT (sessionVersion mismatch) still yields a session, but the session callback leaves user.id out.
const revoked = { user: { email: 'jane@example.com' } }

beforeEach(() => {
	getServerSession.mockReset()
	redirect.mockClear()
})

describe('verifySession', () => {
	it('returns the signed-in account', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(verifySession()).resolves.toEqual({
			id: 'u1',
			email: 'jane@example.com',
			name: 'Jane',
			role: 'admin',
		})
		expect(getServerSession).toHaveBeenCalledWith({ marker: true })
	})
	it('gives null for a name-less account a null name', async () => {
		getServerSession.mockResolvedValue({
			user: { id: 'u1', email: 'jane@example.com', role: 'admin' },
		})
		await expect(verifySession()).resolves.toEqual({
			id: 'u1',
			email: 'jane@example.com',
			name: null,
			role: 'admin',
		})
	})
	it('returns null for a revoked session, no session, or a session without an email', async () => {
		getServerSession.mockResolvedValue(revoked)
		await expect(verifySession()).resolves.toBeNull()
		getServerSession.mockResolvedValue(null)
		await expect(verifySession()).resolves.toBeNull()
		getServerSession.mockResolvedValue({ user: { id: 'u1' } })
		await expect(verifySession()).resolves.toBeNull()
	})
})

describe('verifySession and the role', () => {
	it('treats a session without a known role as no session', async () => {
		getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'jane@example.com' } })
		await expect(verifySession()).resolves.toBeNull()
		getServerSession.mockResolvedValue({
			user: { id: 'u1', email: 'jane@example.com', role: 'superuser' },
		})
		await expect(verifySession()).resolves.toBeNull()
	})
})

describe('requireAdminUser', () => {
	it('returns the owner or an admin (ADR-0024)', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(requireAdminUser()).resolves.toMatchObject({ id: 'u1', role: 'admin' })
		getServerSession.mockResolvedValue(owner)
		await expect(requireAdminUser()).resolves.toMatchObject({ id: 'u0', role: 'owner' })
		expect(redirect).not.toHaveBeenCalled()
	})
	it('sends a user-role account to /apps and a visitor without a session to /login', async () => {
		getServerSession.mockResolvedValue(member)
		await expect(requireAdminUser()).rejects.toThrow('NEXT_REDIRECT:/apps')
		getServerSession.mockResolvedValue(null)
		await expect(requireAdminUser()).rejects.toThrow('NEXT_REDIRECT:/login')
	})
})

describe('assertAdmin and requireAdmin', () => {
	it('lets the owner and an admin through', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(requireAdmin()).resolves.toMatchObject({ role: 'admin' })
		getServerSession.mockResolvedValue(owner)
		await expect(requireAdmin()).resolves.toMatchObject({ role: 'owner' })
		expect(() =>
			assertAdmin({ id: 'u0', email: 'owner@example.com', name: null, role: 'owner' }),
		).not.toThrow()
		expect(() =>
			assertAdmin({ id: 'u1', email: 'jane@example.com', name: null, role: 'admin' }),
		).not.toThrow()
	})
	it('throws AuthError(forbidden) for a user-role account and AuthError(unauthorized) without a session', async () => {
		getServerSession.mockResolvedValue(member)
		await expect(requireAdmin()).rejects.toMatchObject({ name: 'AuthError', code: 'forbidden' })
		expect(() =>
			assertAdmin({ id: 'u2', email: 'joe@example.com', name: null, role: 'user' }),
		).toThrow(AuthError)
		getServerSession.mockResolvedValue(revoked)
		await expect(requireAdmin()).rejects.toMatchObject({ code: 'unauthorized' })
		expect(redirect).not.toHaveBeenCalled()
	})
})

describe('requireUser', () => {
	it('returns the account for a live session', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(requireUser()).resolves.toMatchObject({ id: 'u1' })
		expect(redirect).not.toHaveBeenCalled()
	})
	it('redirects a visitor without a session, and a revoked one, to /login', async () => {
		getServerSession.mockResolvedValue(null)
		await expect(requireUser()).rejects.toThrow('NEXT_REDIRECT:/login')
		getServerSession.mockResolvedValue(revoked)
		await expect(requireUser()).rejects.toThrow('NEXT_REDIRECT:/login')
	})
})

describe('requireActor', () => {
	it('returns the account for a live session', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(requireActor()).resolves.toMatchObject({ email: 'jane@example.com' })
	})
	it('throws AuthError(unauthorized) without a live session', async () => {
		getServerSession.mockResolvedValue(revoked)
		const error = await requireActor().catch(e => e)
		expect(error).toBeInstanceOf(AuthError)
		expect(error).toMatchObject({ name: 'AuthError', code: 'unauthorized' })
		expect(redirect).not.toHaveBeenCalled()
	})
})

describe('redirectSignedInUser', () => {
	it('sends a signed-in visitor to /apps, or to the given path', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(redirectSignedInUser()).rejects.toThrow('NEXT_REDIRECT:/apps')
		await expect(redirectSignedInUser('/app-management')).rejects.toThrow(
			'NEXT_REDIRECT:/app-management',
		)
	})
	it('leaves a visitor without a session, or with a revoked one, on the page', async () => {
		getServerSession.mockResolvedValue(null)
		await redirectSignedInUser()
		getServerSession.mockResolvedValue(revoked)
		await redirectSignedInUser()
		expect(redirect).not.toHaveBeenCalled()
	})
})

describe('getCachedServerSession', () => {
	it('delegates to getServerSession with the auth options', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(getCachedServerSession()).resolves.toEqual(live)
		expect(getServerSession).toHaveBeenCalledWith({ marker: true })
	})
})
