import { describe, expect, it, vi } from 'vitest'

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
	it('maps AuthError to its code', () => {
		expect(toActionFailure(new AuthError('forbidden'), 'x')).toEqual({
			ok: false,
			code: 'forbidden',
		})
	})
	it('maps any DifyError to dify_unreachable (the admin cannot fix Dify’s wording)', () => {
		expect(toActionFailure(new DifyError(401, 'unauthorized', 'bad key'), 'x')).toEqual({
			ok: false,
			code: 'dify_unreachable',
		})
	})
	it('logs and maps anything else to operation_failed', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		expect(toActionFailure(new Error('db down'), 'createApp')).toEqual({
			ok: false,
			code: 'operation_failed',
		})
		expect(spy).toHaveBeenCalledWith('createApp:', expect.any(Error))
		spy.mockRestore()
	})
})
