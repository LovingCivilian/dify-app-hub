import { DrizzleQueryError } from 'drizzle-orm'
import { DatabaseError } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import * as z from 'zod'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { fail, ok } from '@/lib/action-result'
import { invalidInput, toActionFailure } from '@/lib/action-failure'
import { AuthError } from '@/lib/auth/session'
import { DifyError } from '@/lib/providers/dify/errors'
import { describeError } from '@/lib/error-log'

describe('ActionResult helpers', () => {
	it('builds results', () => {
		expect(ok({ id: '1' })).toEqual({ ok: true, data: { id: '1' } })
		expect(fail('not_found')).toEqual({ ok: false, code: 'not_found' })
		expect(fail('invalid_input', { apiBase: ['Required'] })).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { apiBase: ['Required'] },
		})
	})
})

describe('toActionFailure', () => {
	let errorSpy: MockInstance<typeof console.error>
	beforeEach(() => {
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
	})
	afterEach(() => {
		errorSpy.mockRestore()
	})

	it('maps AuthError to its code and logs nothing (an expected outcome)', () => {
		expect(toActionFailure(new AuthError('forbidden'), 'x')).toEqual({
			ok: false,
			code: 'forbidden',
		})
		expect(errorSpy).not.toHaveBeenCalled()
	})
	it('maps any DifyError to provider_unreachable (the admin cannot fix Dify’s wording)', () => {
		expect(toActionFailure(new DifyError(401, 'unauthorized', 'bad key'), 'x')).toEqual({
			ok: false,
			code: 'provider_unreachable',
		})
	})
	it('logs the context with the status, code and message of a DifyError before mapping it', () => {
		toActionFailure(new DifyError(502, 'upstream_error', 'Dify answered 502'), 'syncApp')
		expect(errorSpy).toHaveBeenCalledTimes(1)
		expect(errorSpy).toHaveBeenCalledWith('syncApp:', {
			status: 502,
			code: 'upstream_error',
			message: 'Dify answered 502',
		})
	})
	it('logs and maps anything else to operation_failed', () => {
		const error = new Error('db down')
		expect(toActionFailure(error, 'createApp')).toEqual({ ok: false, code: 'operation_failed' })
		expect(errorSpy).toHaveBeenCalledTimes(1)
		expect(errorSpy).toHaveBeenCalledWith('createApp:', error)
	})

	describe('failure logging without secrets (Review Focus 3, decision g)', () => {
		const hash = '$2a$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQ'
		// node-postgres's server error: the refused value is in `detail` (pg-protocol `DatabaseError`).
		const cause = Object.assign(
			new DatabaseError(
				'duplicate key value violates unique constraint "users_email_key"',
				0,
				'error',
			),
			{
				code: '23505',
				constraint: 'users_email_key',
				detail: 'Key (lower(email))=(jane@example.com) already exists.',
			},
		)
		const queryError = new DrizzleQueryError(
			'insert into "users" …',
			['u1', 'Jane', 'jane@example.com', hash],
			cause,
		)

		it('describes a failed query by its SQLSTATE only', () => {
			expect(describeError(queryError)).toEqual({ name: 'DrizzleQueryError', code: '23505' })
			expect(describeError(cause)).toEqual({ name: 'error', code: '23505' })
			const plain = new Error('boom')
			expect(describeError(plain)).toBe(plain)
		})

		it('logs neither the parameters, the detail nor the message of a failed query', () => {
			expect(toActionFailure(queryError, 'createUserAction')).toEqual({
				ok: false,
				code: 'operation_failed',
			})
			const logged = JSON.stringify(errorSpy.mock.calls)
			expect(logged).not.toContain(hash)
			expect(logged).not.toContain('jane@example.com')
			expect(logged).toContain('23505')
		})

		// A refused connection carries Node's code (ECONNREFUSED) and pg's lost connection none (node_modules/pg/lib/client.js,
		// "Connection terminated unexpectedly"); either way the log keeps no parameter and no address.
		it('logs the code of a refused connection, never the parameters or the message', () => {
			const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
				code: 'ECONNREFUSED',
				errno: -111,
			})
			const refusedQuery = new DrizzleQueryError('update "users" …', ['Jane', hash, 'u1'], refused)
			expect(describeError(refusedQuery)).toStrictEqual({
				name: 'DrizzleQueryError',
				code: 'ECONNREFUSED',
			})
			expect(toActionFailure(refusedQuery, 'updateUserAction')).toEqual({
				ok: false,
				code: 'operation_failed',
			})
			const logged = JSON.stringify(errorSpy.mock.calls)
			expect(logged).not.toContain(hash)
			expect(logged).not.toContain('127.0.0.1')
			expect(logged).toContain('ECONNREFUSED')
		})

		it('keeps only a string code from the cause (a fixed label)', () => {
			const odd = Object.assign(new Error('x'), { code: { leaked: hash } })
			expect(describeError(new DrizzleQueryError('select …', [], odd))).toStrictEqual({
				name: 'DrizzleQueryError',
				code: undefined,
			})
		})

		// Spec §3.2's safety net: an id that reached a uuid column unchecked answers as an unknown one, and the log names
		// the action by its code only (the message quotes the id).
		it('answers not_found for a malformed id (22P02), logged by its code', () => {
			const malformed = new DrizzleQueryError(
				'delete from "dify_apps" where "dify_apps"."id" = $1',
				['abc'],
				Object.assign(new DatabaseError('invalid input syntax for type uuid: "abc"', 0, 'error'), {
					code: '22P02',
				}),
			)
			expect(toActionFailure(malformed, 'deleteAppAction')).toEqual({
				ok: false,
				code: 'not_found',
			})
			expect(errorSpy).toHaveBeenCalledWith('deleteAppAction:', {
				name: 'DrizzleQueryError',
				code: '22P02',
			})
		})

		it('builds invalid_input from a zod error', () => {
			const result = z.object({ email: z.email() }).safeParse({ email: 'nope' })
			expect(result.success).toBe(false)
			if (!result.success) {
				expect(invalidInput(result.error)).toEqual({
					ok: false,
					code: 'invalid_input',
					fieldErrors: { email: [expect.any(String)] },
				})
			}
		})
	})
})
