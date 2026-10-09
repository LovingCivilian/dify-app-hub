import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

// The fake chain keeps the condition each query passes to where(), so a test can render it (below).
const { rows, limit, where } = vi.hoisted(() => {
	const limit = vi.fn()
	const where = vi.fn((_condition: unknown) => ({ limit }))
	return { rows: { value: [] as unknown[] }, limit, where }
})
vi.mock('@/db', () => ({
	getDb: () => ({
		select: () => ({ from: () => ({ where }) }),
	}),
}))
// The fixed hash an unknown email is checked against is a stand-in here; __tests__/auth-password.test.ts pins the real one.
const { verifyPassword, noAccountHash } = vi.hoisted(() => ({
	verifyPassword: vi.fn(),
	noAccountHash: 'hash:no-account',
}))
vi.mock('@/lib/auth/password', () => ({ verifyPassword, UNKNOWN_ACCOUNT_HASH: noAccountHash }))

import { DrizzleQueryError, type SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import type { JWT } from 'next-auth/jwt'

import { users } from '@/db/schema'
import { authOptions, authorizeCredentials } from '@/lib/auth/options'

type JwtCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['jwt']>
type SessionCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['session']>
const jwt = authOptions.callbacks!.jwt as JwtCallback
const session = authOptions.callbacks!.session as SessionCallback

/** A condition the code passed to where(), rendered on a select from users built on drizzle.mock() (no connection). */
const renderWhere = (condition: unknown) =>
	drizzle
		.mock()
		.select({ id: users.id })
		.from(users)
		.where(condition as SQL)
		.toSQL()

/** Both deactivation markers empty: an active account (ADR-0027). */
const live = { adminDeactivatedAt: null, directoryDeactivatedAt: null }

const row = {
	id: 'u1',
	email: 'jane@example.com',
	name: 'Jane',
	role: 'admin',
	password: 'hash:right-password',
	sessionVersion: 3,
	...live,
}

beforeEach(() => {
	limit.mockReset()
	limit.mockImplementation(() => Promise.resolve(rows.value))
	where.mockClear()
	verifyPassword.mockReset()
	verifyPassword.mockImplementation((password: string, hash: string) =>
		Promise.resolve(hash === `hash:${password}`),
	)
})

describe('authOptions', () => {
	it('uses the JWT strategy and the app login page', () => {
		expect(authOptions.session).toEqual({ strategy: 'jwt' })
		expect(authOptions.pages).toEqual({ signIn: '/login' })
	})
})

// B1 follow-up (follow-ups.md, Tests): nothing called authorize.
describe('authorizeCredentials', () => {
	it('refuses missing credentials without a query', async () => {
		expect(await authorizeCredentials(undefined)).toBeNull()
		expect(await authorizeCredentials({ email: '', password: 'x' })).toBeNull()
		expect(await authorizeCredentials({ email: 'jane@example.com', password: '' })).toBeNull()
		expect(limit).not.toHaveBeenCalled()
	})

	it('refuses an unknown email and a wrong password', async () => {
		rows.value = []
		expect(await authorizeCredentials({ email: 'nobody@example.com', password: 'x' })).toBeNull()
		rows.value = [row]
		expect(
			await authorizeCredentials({ email: 'jane@example.com', password: 'wrong-password' }),
		).toBeNull()
	})

	// OWASP Authentication Cheat Sheet, "Authentication Responses": no "quick exit". An unknown email runs the same
	// bcrypt check as a wrong password, against a fixed hash, and is refused whatever that check answers.
	it('runs the password check for an unknown email too, and refuses it', async () => {
		rows.value = []
		verifyPassword.mockResolvedValue(true)
		expect(await authorizeCredentials({ email: 'nobody@example.com', password: 'x' })).toBeNull()
		expect(verifyPassword).toHaveBeenCalledTimes(1)
		expect(verifyPassword).toHaveBeenCalledWith('x', noAccountHash)
	})

	it('answers the account without its hash, with its role and session version', async () => {
		rows.value = [row]
		expect(
			await authorizeCredentials({ email: 'jane@example.com', password: 'right-password' }),
		).toEqual({
			id: 'u1',
			email: 'jane@example.com',
			name: 'Jane',
			role: 'admin',
			sessionVersion: 3,
		})
		// The hash checked is the row of the email given: the lookup is by email, with that email as its only parameter.
		expect(where).toHaveBeenCalledTimes(1)
		const { sql, params } = renderWhere(where.mock.calls[0]![0])
		expect(sql).toMatch(/ where `users`\.`email` = \?$/)
		expect(params).toEqual(['jane@example.com'])
	})

	// Spec §5 and §7.3: refused after the password check, with the same answer as a wrong password; the reason is
	// logged by account id, never by email (decision b).
	it('refuses an account an admin or the directory deactivated, after the password check, and logs its id', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		try {
			for (const markers of [
				{ adminDeactivatedAt: new Date(), directoryDeactivatedAt: null },
				{ adminDeactivatedAt: null, directoryDeactivatedAt: new Date() },
			]) {
				rows.value = [{ ...row, ...markers }]
				expect(
					await authorizeCredentials({ email: 'jane@example.com', password: 'right-password' }),
				).toBeNull()
			}
			expect(warn).toHaveBeenCalledTimes(2)
			expect(warn).toHaveBeenCalledWith('authorizeCredentials: sign-in refused', {
				reason: 'account_inactive',
				userId: 'u1',
			})
			expect(JSON.stringify(warn.mock.calls)).not.toMatch(/jane@example\.com|right-password|hash:/)
		} finally {
			warn.mockRestore()
		}
	})

	it('answers a wrong password on a deactivated account without telling it is deactivated', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		try {
			rows.value = [{ ...row, adminDeactivatedAt: new Date() }]
			expect(
				await authorizeCredentials({ email: 'jane@example.com', password: 'wrong-password' }),
			).toBeNull()
			expect(warn).not.toHaveBeenCalled()
		} finally {
			warn.mockRestore()
		}
	})
})

// A failure inside authorize() becomes next-auth's error URL: "If you throw an Error, the user will be sent to the
// error page with the error message as a query parameter" (next-auth Credentials provider), and with
// `redirect: false` the login request's answer carries it. Drizzle's message holds the SQL and its parameters, the
// typed email among them (final review M-8).
describe('authorizeCredentials on a failure', () => {
	let errorSpy: MockInstance<typeof console.error>
	beforeEach(() => {
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
	})
	afterEach(() => {
		errorSpy.mockRestore()
	})

	const credentials = { email: 'jane@example.com', password: 'right-password' }
	const expectNothingLeaks = (thrown: unknown) => {
		expect(thrown).toBeInstanceOf(Error)
		const { message } = thrown as Error
		// next-auth's catch-all sign-in error code (next-auth Pages, "Error codes": Default), not CredentialsSignin,
		// so the form does not answer a failing service with "check your email and password".
		expect(message).toBe('Default')
		expect(message).not.toContain('jane@example.com')
		expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('jane@example.com')
	}

	it('throws a fixed message for a failed query, and logs only its name, code and errno', async () => {
		const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), {
			code: 'ECONNREFUSED',
			errno: -111,
		})
		limit.mockRejectedValueOnce(
			new DrizzleQueryError(
				'select `id`, `password` from `users` where `users`.`email` = ? limit ?',
				['jane@example.com', 1],
				cause,
			),
		)
		const thrown = await authorizeCredentials(credentials).catch((error: unknown) => error)
		expectNothingLeaks(thrown)
		expect((thrown as Error).message).not.toMatch(/select|users|password/i)
		expect(errorSpy).toHaveBeenCalledTimes(1)
		expect(errorSpy).toHaveBeenCalledWith('authorizeCredentials:', {
			name: 'DrizzleQueryError',
			code: 'ECONNREFUSED',
			errno: -111,
		})
	})

	it('throws the same fixed message when the password check fails', async () => {
		rows.value = [row]
		verifyPassword.mockRejectedValueOnce(new Error('Illegal arguments: string, undefined'))
		expectNothingLeaks(await authorizeCredentials(credentials).catch((error: unknown) => error))
		expect(errorSpy).toHaveBeenCalledTimes(1)
	})
})

describe('jwt callback', () => {
	it('copies id, role and sessionVersion into the token at sign-in', async () => {
		const token = await jwt({
			token: {} as JWT,
			user: { id: 'u1', email: 'jane@example.com', name: null, role: 'user', sessionVersion: 3 },
			account: null,
		} as never)
		expect(token).toMatchObject({ id: 'u1', role: 'user', sessionVersion: 3 })
	})

	// Review Focus 4: the row is the truth for what an admin can change while the session lives.
	it('refreshes role, email and name from the row while the version matches', async () => {
		rows.value = [
			{ sessionVersion: 3, role: 'user', email: 'new@example.com', name: 'New', ...live },
		]
		const token = await jwt({
			token: {
				id: 'u1',
				sessionVersion: 3,
				role: 'admin',
				email: 'old@example.com',
				name: 'Old',
			} as JWT,
		} as never)
		expect(token).toMatchObject({
			id: 'u1',
			sessionVersion: 3,
			role: 'user',
			email: 'new@example.com',
			name: 'New',
		})
	})

	// Review Focus 1 and 4 rest on this row: the lookup is by the token's id, not by anything else the token holds.
	it("looks the account up by the token's id", async () => {
		rows.value = [
			{ sessionVersion: 3, role: 'user', email: 'jane@example.com', name: null, ...live },
		]
		await jwt({
			token: { id: 'u1', sessionVersion: 3, role: 'admin', email: 'old@example.com' } as JWT,
		} as never)
		expect(where).toHaveBeenCalledTimes(1)
		const { sql, params } = renderWhere(where.mock.calls[0]![0])
		expect(sql).toMatch(/ where `users`\.`id` = \?$/)
		expect(params).toEqual(['u1'])
	})

	it('gives a token issued before roles existed its role on first use', async () => {
		rows.value = [
			{ sessionVersion: 0, role: 'admin', email: 'jane@example.com', name: null, ...live },
		]
		const token = await jwt({ token: { id: 'u1', sessionVersion: 0 } as JWT } as never)
		expect(token).toMatchObject({ id: 'u1', role: 'admin' })
	})

	// ADR-0018's revocation rule: the token loses id, sessionVersion and role; the session callback then sets none.
	// Review Focus 5: the version-moved row (markers empty) is also a reactivated account; an old token stays refused
	// after reactivation because deactivation moved sessionVersion (spec §5).
	it('strips id, sessionVersion and role when the version moved or the user is gone', async () => {
		const signedIn = {
			id: 'u1',
			sessionVersion: 3,
			role: 'admin',
			email: 'jane@example.com',
			name: 'Jane',
		} as JWT
		rows.value = [
			{ sessionVersion: 4, role: 'admin', email: 'jane@example.com', name: 'Jane', ...live },
		]
		expect(await jwt({ token: { ...signedIn } } as never)).toEqual({
			email: 'jane@example.com',
			name: 'Jane',
		})
		rows.value = []
		expect(await jwt({ token: { ...signedIn } } as never)).toEqual({
			email: 'jane@example.com',
			name: 'Jane',
		})
	})

	// Spec §5: a row an admin or the directory deactivated is refused at the token's next use, like a revoked one.
	it('strips id, sessionVersion and role from the token of a deactivated account', async () => {
		const signedIn = {
			id: 'u1',
			sessionVersion: 3,
			role: 'user',
			email: 'jane@example.com',
			name: 'Jane',
		} as JWT
		for (const markers of [
			{ adminDeactivatedAt: new Date(), directoryDeactivatedAt: null },
			{ adminDeactivatedAt: null, directoryDeactivatedAt: new Date() },
		]) {
			rows.value = [
				{ sessionVersion: 3, role: 'user', email: 'jane@example.com', name: 'Jane', ...markers },
			]
			expect(await jwt({ token: { ...signedIn } } as never)).toEqual({
				email: 'jane@example.com',
				name: 'Jane',
			})
		}
	})

	it('leaves a token without an id alone, without a query', async () => {
		expect(await jwt({ token: { email: 'jane@example.com' } as JWT } as never)).toEqual({
			email: 'jane@example.com',
		})
		expect(limit).not.toHaveBeenCalled()
	})
})

describe('session callback', () => {
	// Review Focus 4: the session's email is the token's, which the jwt callback refreshed from the row.
	it('forwards the refreshed email and name from the token', async () => {
		const result = await session({
			session: { user: { email: 'old@example.com', name: 'Old' }, expires: '' },
			token: { id: 'u1', role: 'user', email: 'new@example.com', name: 'New' } as JWT,
		} as never)
		expect(result.user).toMatchObject({ email: 'new@example.com', name: 'New' })
	})

	// A name the row cleared (the column is nullable) reaches the session as null, not as the default user's.
	it('forwards a cleared name as null', async () => {
		const result = await session({
			session: { user: { email: 'jane@example.com', name: 'Old' }, expires: '' },
			token: { id: 'u1', role: 'user', email: 'jane@example.com', name: null } as JWT,
		} as never)
		expect(result.user).toMatchObject({ name: null })
	})

	it('sets user.id and user.role only from a token that has both', async () => {
		const withBoth = await session({
			session: { user: { email: 'jane@example.com' }, expires: '' },
			token: { id: 'u1', role: 'user', email: 'jane@example.com' } as JWT,
		} as never)
		expect(withBoth.user).toMatchObject({ id: 'u1', role: 'user', email: 'jane@example.com' })
		for (const token of [{}, { id: 'u1' }, { role: 'admin' }]) {
			const without = await session({
				session: { user: { email: 'jane@example.com' }, expires: '' },
				token: token as JWT,
			} as never)
			expect(without.user).not.toHaveProperty('id')
			expect(without.user).not.toHaveProperty('role')
		}
	})
})
