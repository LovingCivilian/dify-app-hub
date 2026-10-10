import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
	getServerSession,
	createUser,
	updateUser,
	updateUserRole,
	deleteUser,
	setUserActive,
	refresh,
	syncDirectoryNow,
} = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	createUser: vi.fn(),
	updateUser: vi.fn(),
	updateUserRole: vi.fn(),
	deleteUser: vi.fn(),
	setUserActive: vi.fn(),
	refresh: vi.fn(),
	syncDirectoryNow: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/data/users', () => ({
	createUser,
	updateUser,
	updateUserRole,
	deleteUser,
	setUserActive,
}))
vi.mock('@/lib/directory/admin', () => ({ syncDirectoryNow }))
vi.mock('next/cache', () => ({ refresh }))

import {
	createUserAction,
	deactivateUserAction,
	deleteUserAction,
	reactivateUserAction,
	syncDirectoryAction,
	updateUserAction,
	updateUserRoleAction,
} from '@/app/(admin)/user-management/actions'

const admin = { id: 'a1', email: 'admin@example.com', name: 'Admin', role: 'admin' }
const input = { name: 'Jane', email: 'jane@example.com', role: 'user', password: 'password-1' }

beforeEach(() => {
	for (const fn of [
		getServerSession,
		createUser,
		updateUser,
		updateUserRole,
		deleteUser,
		setUserActive,
		refresh,
		syncDirectoryNow,
	])
		fn.mockReset()
	getServerSession.mockResolvedValue({ user: admin })
})

describe('user actions', () => {
	it.each([
		['createUserAction', () => createUserAction(input)],
		['updateUserAction', () => updateUserAction('u9', input)],
		['updateUserRoleAction', () => updateUserRoleAction('u9', { role: 'user' })],
		['deleteUserAction', () => deleteUserAction('u9')],
		['deactivateUserAction', () => deactivateUserAction('u9')],
		['reactivateUserAction', () => reactivateUserAction('u9')],
		['syncDirectoryAction', () => syncDirectoryAction()],
	] as const)(
		'%s refuses a user-role session and a missing one before the DAL',
		async (_name, call) => {
			getServerSession.mockResolvedValue({ user: { ...admin, role: 'user' } })
			expect(await call()).toEqual({ ok: false, code: 'forbidden' })
			getServerSession.mockResolvedValue(null)
			expect(await call()).toEqual({ ok: false, code: 'unauthorized' })
			for (const fn of [
				createUser,
				updateUser,
				updateUserRole,
				deleteUser,
				setUserActive,
				syncDirectoryNow,
				refresh,
			])
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

	it('deactivates and reactivates through the DAL, and answers not_found for an id that cannot be one', async () => {
		setUserActive.mockResolvedValue({ ok: true, data: undefined })
		expect(await deactivateUserAction('u9')).toEqual({ ok: true, data: undefined })
		expect(setUserActive).toHaveBeenLastCalledWith(admin, 'u9', false)
		expect(await reactivateUserAction('u9')).toEqual({ ok: true, data: undefined })
		expect(setUserActive).toHaveBeenLastCalledWith(admin, 'u9', true)
		expect(refresh).toHaveBeenCalledTimes(2)
		expect(await deactivateUserAction('x'.repeat(37))).toEqual({ ok: false, code: 'not_found' })
	})

	it('changes a role through the DAL with the verified admin, and refuses anything but a role', async () => {
		updateUserRole.mockResolvedValue({ ok: true, data: undefined })
		expect(await updateUserRoleAction('u9', { role: 'admin', password: 'sneaky-1' })).toEqual({
			ok: true,
			data: undefined,
		})
		// zod's object strips unknown keys (zod 4 "Objects"): only the role reaches the DAL.
		expect(updateUserRole).toHaveBeenCalledWith(admin, 'u9', 'admin')
		expect(refresh).toHaveBeenCalledTimes(1)
		expect(await updateUserRoleAction('u9', { role: 'superuser' })).toMatchObject({
			ok: false,
			code: 'invalid_input',
		})
		expect(await updateUserRoleAction('', { role: 'user' })).toEqual({
			ok: false,
			code: 'not_found',
		})
	})

	it('runs Sync now and answers the outcome, sync_running while one is going, not_found while LDAP is off', async () => {
		const counts = {
			entriesSeen: 3,
			deactivated: 1,
			reactivated: 0,
			updated: 0,
			conflicts: 0,
			groupErrors: 0,
			membershipsAdded: 0,
			membershipsRemoved: 0,
		}
		syncDirectoryNow.mockResolvedValue({
			status: 'finished',
			outcome: 'succeeded',
			counts,
			errorCode: null,
		})
		expect(await syncDirectoryAction()).toEqual({
			ok: true,
			data: { outcome: 'succeeded', counts, errorCode: null },
		})
		expect(syncDirectoryNow).toHaveBeenCalledWith(admin)
		expect(refresh).toHaveBeenCalledTimes(1)
		syncDirectoryNow.mockResolvedValue({ status: 'running' })
		expect(await syncDirectoryAction()).toEqual({ ok: false, code: 'sync_running' })
		// The panel shows the run that is going: the route refreshes on sync_running too.
		expect(refresh).toHaveBeenCalledTimes(2)
		syncDirectoryNow.mockResolvedValue(null)
		expect(await syncDirectoryAction()).toEqual({ ok: false, code: 'not_found' })
		// A database failure out of the run is an operation_failed result, never a throw (carry, Task 10 note).
		syncDirectoryNow.mockRejectedValue(new Error('db down'))
		expect(await syncDirectoryAction()).toEqual({ ok: false, code: 'operation_failed' })
	})
})
