import { DrizzleQueryError } from 'drizzle-orm'
import { DatabaseError } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { AuthError } from '@/lib/auth/session'
import {
	errorResponse,
	errorResponseFrom,
	forbiddenResponse,
	isErrorBody,
	ProviderError,
} from '@/lib/http/errors'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

describe('isErrorBody', () => {
	it('accepts the envelope and nothing else', () => {
		expect(isErrorBody({ code: 'not_found', message: 'Nope', status: 404 })).toBe(true)
		expect(isErrorBody({ code: 'not_found', message: 'Nope' })).toBe(false)
		expect(isErrorBody({ error: 'x' })).toBe(false)
		expect(isErrorBody('nope')).toBe(false)
		expect(isErrorBody(null)).toBe(false)
	})
})

describe('errorResponse and errorResponseFrom', () => {
	it('answers the envelope with the status', async () => {
		const response = errorResponse('app_not_found', 'No such app.', 404)
		expect(response.status).toBe(404)
		await expect(response.json()).resolves.toEqual({
			code: 'app_not_found',
			message: 'No such app.',
			status: 404,
		})
	})
	// Part 1 spec §11: the neutral answer reads any provider's error without importing the provider.
	it('turns a ProviderError into its envelope', async () => {
		const response = errorResponseFrom(
			new ProviderError(429, 'too_many_requests', 'Slow down'),
			'test',
		)
		expect(response.status).toBe(429)
		await expect(response.json()).resolves.toEqual({
			code: 'too_many_requests',
			message: 'Slow down',
			status: 429,
		})
	})
	it('turns an AuthError into 401 or 403', async () => {
		expect(errorResponseFrom(new AuthError('unauthorized'), 'test').status).toBe(401)
		expect(errorResponseFrom(new AuthError('forbidden'), 'test').status).toBe(403)
	})
	// One definition of the role refusal (charter §4.2): the routes' own check and a thrown AuthError answer alike.
	it("answers an AuthError('forbidden') exactly as forbiddenResponse()", async () => {
		const thrown = errorResponseFrom(new AuthError('forbidden'), 'test')
		const direct = forbiddenResponse()
		expect(thrown.status).toBe(direct.status)
		expect(await thrown.json()).toEqual(await direct.json())
	})
	it('logs anything else and answers 500 internal_error without the message', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const response = errorResponseFrom(new Error('secret detail'), 'POST chat')
		expect(response.status).toBe(500)
		await expect(response.json()).resolves.toEqual({
			code: 'internal_error',
			message: 'Internal Server Error',
			status: 500,
		})
		expect(spy).toHaveBeenCalledWith('POST chat:', expect.any(Error))
		spy.mockRestore()
	})

	// Part 0 spec §3.4: a DrizzleQueryError carries the SQL and its params, which are never logged; a database that does
	// not answer (the access lookup inside the route guard) is logged by its name and code only.
	it('logs a failed query by its name and code on the 500 path, never its SQL, parameters or address', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
			code: 'ECONNREFUSED',
			errno: -111,
		})
		const failed = new DrizzleQueryError(
			'select "access_mode" from "apps" where "apps"."id" = $1 limit $2',
			['6a3f0c1e-2b4d-4e5f-8a9b-0c1d2e3f4a5b', 1],
			refused,
		)
		const response = errorResponseFrom(failed, 'GET /api/dify/[appId]/parameters')
		expect(response.status).toBe(500)
		await expect(response.json()).resolves.toEqual({
			code: 'internal_error',
			message: 'Internal Server Error',
			status: 500,
		})
		expect(spy).toHaveBeenCalledWith('GET /api/dify/[appId]/parameters:', {
			name: 'DrizzleQueryError',
			code: 'ECONNREFUSED',
		})
		const logged = JSON.stringify(spy.mock.calls)
		for (const value of [
			'6a3f0c1e-2b4d-4e5f-8a9b-0c1d2e3f4a5b',
			'127.0.0.1',
			'select',
			'access_mode',
		])
			expect(logged).not.toContain(value)
		spy.mockRestore()
	})

	// Part 0 spec §3.2's safety net: an id that reached a uuid column unchecked answers as an unknown app, never a 500,
	// and is logged by its code only (the message quotes the id).
	it('answers a malformed id (22P02) as app_not_found', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const malformed = new DrizzleQueryError(
			'select "id" from "apps" where "apps"."id" = $1 limit $2',
			['abc', 1],
			Object.assign(new DatabaseError('invalid input syntax for type uuid: "abc"', 0, 'error'), {
				code: '22P02',
			}),
		)
		const response = errorResponseFrom(malformed, 'GET /api/dify/[appId]/parameters')
		expect(response.status).toBe(404)
		await expect(response.json()).resolves.toEqual({
			code: 'app_not_found',
			message: 'No such app.',
			status: 404,
		})
		expect(spy).toHaveBeenCalledWith('GET /api/dify/[appId]/parameters:', {
			name: 'DrizzleQueryError',
			code: '22P02',
		})
		expect(JSON.stringify(spy.mock.calls)).not.toContain('abc')
		spy.mockRestore()
	})
})
