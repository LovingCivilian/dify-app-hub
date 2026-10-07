import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rows, limit } = vi.hoisted(() => {
	const limit = vi.fn()
	return { rows: { value: [] as unknown[] }, limit }
})
vi.mock('@/db', () => ({
	getDb: () => ({
		select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
	}),
}))
vi.mock('@/lib/auth/password', () => ({
	verifyPassword: (password: string, hash: string) => Promise.resolve(hash === `hash:${password}`),
}))

import type { JWT } from 'next-auth/jwt'

import { authOptions } from '@/lib/auth/options'

type JwtCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['jwt']>
type SessionCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['session']>
const jwt = authOptions.callbacks!.jwt as JwtCallback
const session = authOptions.callbacks!.session as SessionCallback

beforeEach(() => {
	limit.mockReset()
	limit.mockImplementation(() => Promise.resolve(rows.value))
})

describe('authOptions', () => {
	it('uses the JWT strategy and the app login page', () => {
		expect(authOptions.session).toEqual({ strategy: 'jwt' })
		expect(authOptions.pages).toEqual({ signIn: '/login' })
	})

	it('copies id and sessionVersion into the token at sign-in', async () => {
		const token = await jwt({
			token: {} as JWT,
			user: { id: 'u1', email: 'j@e.com', name: null, sessionVersion: 3 },
			account: null,
		} as never)
		expect(token).toMatchObject({ id: 'u1', sessionVersion: 3 })
	})

	it('keeps a token whose sessionVersion still matches the row', async () => {
		rows.value = [{ sessionVersion: 3 }]
		const token = await jwt({ token: { id: 'u1', sessionVersion: 3 } as JWT } as never)
		expect(token).toMatchObject({ id: 'u1', sessionVersion: 3 })
	})

	// ADR-0018's revocation rule: a password reset bumps sessionVersion; the token loses its id and the session
	// callback then sets none, which verifySession reads as "no live session".
	it('strips id and sessionVersion from a token whose version no longer matches, or whose user is gone', async () => {
		const signedIn = { id: 'u1', sessionVersion: 3, email: 'j@e.com', name: 'Jane' } as JWT
		rows.value = [{ sessionVersion: 4 }]
		expect(await jwt({ token: { ...signedIn } } as never)).toEqual({
			email: 'j@e.com',
			name: 'Jane',
		})
		rows.value = []
		expect(await jwt({ token: { ...signedIn } } as never)).toEqual({
			email: 'j@e.com',
			name: 'Jane',
		})
	})

	it('sets session.user.id only from a token that has one', async () => {
		const withId = await session({
			session: { user: { email: 'j@e.com' }, expires: '' },
			token: { id: 'u1' } as JWT,
		} as never)
		expect(withId.user).toMatchObject({ id: 'u1', email: 'j@e.com' })
		const without = await session({
			session: { user: { email: 'j@e.com' }, expires: '' },
			token: {} as JWT,
		} as never)
		expect(without.user).not.toHaveProperty('id')
	})
})
