import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createOwner } = vi.hoisted(() => ({ createOwner: vi.fn() }))
vi.mock('@/lib/data/setup', () => ({ createOwner }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { createOwnerAction } from '@/app/init/actions'

const input = { name: 'Owner', email: 'owner@example.com', password: 'password-1' }

// A block body: vitest runs a function returned from beforeEach as cleanup, and mockReset() returns the mock.
beforeEach(() => {
	createOwner.mockReset()
})
afterEach(() => {
	vi.restoreAllMocks()
})

describe('createOwnerAction (charter §4.2: no session exists yet; ADR-0024: first run creates the owner)', () => {
	it('hands the DAL the parsed input only: no role or other key from the client', async () => {
		createOwner.mockResolvedValue({ ok: true, data: undefined })
		expect(
			await createOwnerAction({ ...input, confirmPassword: 'password-1', role: 'user' }),
		).toEqual({ ok: true, data: undefined })
		expect(createOwner).toHaveBeenCalledWith(input)
	})

	it('passes forbidden through once setup is done (Review Focus 5)', async () => {
		createOwner.mockResolvedValue({ ok: false, code: 'forbidden' })
		expect(await createOwnerAction(input)).toEqual({ ok: false, code: 'forbidden' })
	})

	it('answers invalid_input without asking the DAL', async () => {
		const result = await createOwnerAction({ ...input, password: 'short' })
		expect(result).toMatchObject({ ok: false, code: 'invalid_input' })
		expect(createOwner).not.toHaveBeenCalled()
	})

	it('answers operation_failed for an unexpected throw, and logs it', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		createOwner.mockRejectedValue(new Error('database down'))
		expect(await createOwnerAction(input)).toEqual({ ok: false, code: 'operation_failed' })
		expect(errorSpy).toHaveBeenCalled()
	})
})
