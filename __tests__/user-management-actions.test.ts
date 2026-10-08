import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, createUser, updateUser, deleteUser, refresh } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	createUser: vi.fn(),
	updateUser: vi.fn(),
	deleteUser: vi.fn(),
	refresh: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/data/users', () => ({ createUser, updateUser, deleteUser }))
vi.mock('next/cache', () => ({ refresh }))

import {
	createUserAction,
	deleteUserAction,
	updateUserAction,
} from '@/app/(admin)/user-management/actions'

const admin = { id: 'a1', email: 'admin@example.com', name: 'Admin', role: 'admin' }
const input = { name: 'Jane', email: 'jane@example.com', role: 'user', password: 'password-1' }

beforeEach(() => {
	for (const fn of [getServerSession, createUser, updateUser, deleteUser, refresh]) fn.mockReset()
	getServerSession.mockResolvedValue({ user: admin })
})

describe('user actions', () => {
	it.each([
		['createUserAction', () => createUserAction(input)],
		['updateUserAction', () => updateUserAction('u9', input)],
		['deleteUserAction', () => deleteUserAction('u9')],
	] as const)(
		'%s refuses a user-role session and a missing one before the DAL',
		async (_name, call) => {
			getServerSession.mockResolvedValue({ user: { ...admin, role: 'user' } })
			expect(await call()).toEqual({ ok: false, code: 'forbidden' })
			getServerSession.mockResolvedValue(null)
			expect(await call()).toEqual({ ok: false, code: 'unauthorized' })
			for (const fn of [createUser, updateUser, deleteUser, refresh])
				expect(fn).not.toHaveBeenCalled()
		},
	)

	it('answers invalid_input with the fields for a bad input', async () => {
		const result = await createUserAction({ ...input, email: 'nope', password: 'short' })
		expect(result).toMatchObject({ ok: false, code: 'invalid_input' })
		if (!result.ok)
			expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(['email', 'password'])
	})

	it('creates through the DAL with the verified admin and refreshes', async () => {
		createUser.mockResolvedValue({ ok: true, data: { id: 'u9' } })
		expect(await createUserAction(input)).toEqual({ ok: true, data: { id: 'u9' } })
		expect(createUser).toHaveBeenCalledWith(admin, input)
		expect(refresh).toHaveBeenCalledTimes(1)
	})

	it('passes a DAL refusal through without refreshing', async () => {
		createUser.mockResolvedValue({ ok: false, code: 'email_in_use' })
		expect(await createUserAction(input)).toEqual({ ok: false, code: 'email_in_use' })
		expect(refresh).not.toHaveBeenCalled()
	})

	it('updates with a blank password meaning "keep"', async () => {
		updateUser.mockResolvedValue({ ok: true, data: undefined })
		await updateUserAction('u9', { ...input, password: '' })
		expect(updateUser).toHaveBeenCalledWith(admin, 'u9', { ...input, password: undefined })
		expect(refresh).toHaveBeenCalledTimes(1)
	})

	it('answers not_found for an empty id without asking the DAL', async () => {
		expect(await updateUserAction('', input)).toEqual({ ok: false, code: 'not_found' })
		expect(await deleteUserAction('')).toEqual({ ok: false, code: 'not_found' })
		expect(updateUser).not.toHaveBeenCalled()
		expect(deleteUser).not.toHaveBeenCalled()
	})

	it('deletes and refreshes; a refusal passes through', async () => {
		deleteUser.mockResolvedValue({ ok: true, data: undefined })
		expect(await deleteUserAction('u9')).toEqual({ ok: true, data: undefined })
		deleteUser.mockResolvedValue({ ok: false, code: 'cannot_delete_self' })
		expect(await deleteUserAction('u9')).toEqual({ ok: false, code: 'cannot_delete_self' })
		expect(refresh).toHaveBeenCalledTimes(1)
	})
})
