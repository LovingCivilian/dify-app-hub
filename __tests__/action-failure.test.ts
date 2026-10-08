import { DrizzleQueryError } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import * as z from 'zod'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { fail, ok } from '@/lib/action-result'
import { describeError, invalidInput, toActionFailure } from '@/lib/action-failure'
import { AuthError } from '@/lib/auth/session'
import { DifyError } from '@/lib/dify/errors'

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
	it('maps any DifyError to dify_unreachable (the admin cannot fix Dify’s wording)', () => {
		expect(toActionFailure(new DifyError(401, 'unauthorized', 'bad key'), 'x')).toEqual({
			ok: false,
			code: 'dify_unreachable',
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
		const cause = Object.assign(
			new Error("Duplicate entry 'jane@example.com' for key 'users_email_key'"),
			{
				code: 'ER_DUP_ENTRY',
				errno: 1062,
			},
		)
		const queryError = new DrizzleQueryError(
			'insert into `users` …',
			['u1', 'Jane', 'jane@example.com', hash],
			cause,
		)

		it('describes a failed query by its driver code only', () => {
			expect(describeError(queryError)).toEqual({
				name: 'DrizzleQueryError',
				code: 'ER_DUP_ENTRY',
				errno: 1062,
			})
			expect(describeError(cause)).toEqual({ name: 'Error', code: 'ER_DUP_ENTRY', errno: 1062 })
			const plain = new Error('boom')
			expect(describeError(plain)).toBe(plain)
		})

		it('logs neither the parameters nor the message of a failed query', () => {
			expect(toActionFailure(queryError, 'createUserAction')).toEqual({
				ok: false,
				code: 'operation_failed',
			})
			const logged = JSON.stringify(errorSpy.mock.calls)
			expect(logged).not.toContain(hash)
			expect(logged).not.toContain('jane@example.com')
			expect(logged).toContain('ER_DUP_ENTRY')
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
