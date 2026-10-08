import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, changeOwnPassword } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	changeOwnPassword: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/data/users', () => ({ changeOwnPassword }))

import { changePasswordAction } from '@/app/actions'

const member = { id: 'u2', email: 'joe@example.com', name: null, role: 'user' }
const input = { currentPassword: 'old-password-1', newPassword: 'new-password-1' }

beforeEach(() => {
	getServerSession.mockReset()
	changeOwnPassword.mockReset()
	getServerSession.mockResolvedValue({ user: member })
})

describe('changePasswordAction', () => {
	it('lets any signed-in role change their own password', async () => {
		changeOwnPassword.mockResolvedValue({ ok: true, data: undefined })
		expect(await changePasswordAction({ ...input, id: 'someone-else' })).toEqual({
			ok: true,
			data: undefined,
		})
		// No target id is read from the client: the DAL gets the verified actor and the two passwords.
		expect(changeOwnPassword).toHaveBeenCalledWith(member, input)
	})

	it('answers unauthorized without a live session', async () => {
		getServerSession.mockResolvedValue(null)
		expect(await changePasswordAction(input)).toEqual({ ok: false, code: 'unauthorized' })
		expect(changeOwnPassword).not.toHaveBeenCalled()
	})

	it('answers invalid_input for a short new password without asking the DAL', async () => {
		expect(await changePasswordAction({ ...input, newPassword: 'short' })).toMatchObject({
			ok: false,
			code: 'invalid_input',
		})
		expect(changeOwnPassword).not.toHaveBeenCalled()
	})

	it('answers invalid_input for a new password past 72 bytes without asking the DAL', async () => {
		expect(await changePasswordAction({ ...input, newPassword: 'x'.repeat(73) })).toMatchObject({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { newPassword: expect.any(Array) },
		})
		expect(changeOwnPassword).not.toHaveBeenCalled()
	})

	it('takes a current password of any length, as sign-in does (one set before the 72-byte cap)', async () => {
		changeOwnPassword.mockResolvedValue({ ok: true, data: undefined })
		const longCurrent = { ...input, currentPassword: 'x'.repeat(129) }
		expect(await changePasswordAction(longCurrent)).toEqual({ ok: true, data: undefined })
		expect(changeOwnPassword).toHaveBeenCalledWith(member, longCurrent)
	})

	it('passes the DAL refusal of a wrong current password through', async () => {
		const refusal = {
			ok: false,
			code: 'invalid_input',
			fieldErrors: { currentPassword: ['incorrect'] },
		}
		changeOwnPassword.mockResolvedValue(refusal)
		expect(await changePasswordAction(input)).toEqual(refusal)
	})
})
