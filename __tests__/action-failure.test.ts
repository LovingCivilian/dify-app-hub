import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { fail, ok } from '@/lib/action-result'
import { toActionFailure } from '@/lib/action-failure'
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
})
