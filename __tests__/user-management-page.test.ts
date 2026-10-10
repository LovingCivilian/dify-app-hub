import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAdminUser, listUsers, getDirectoryStatus, UserManagement, redirectSignal } =
	vi.hoisted(() => ({
		requireAdminUser: vi.fn(),
		listUsers: vi.fn(),
		getDirectoryStatus: vi.fn<() => Promise<unknown>>(async () => null),
		UserManagement: () => null,
		redirectSignal: new Error('NEXT_REDIRECT'),
	}))
vi.mock('@/lib/auth/session', () => ({ requireAdminUser }))
vi.mock('@/lib/data/users', () => ({ listUsers }))
vi.mock('@/lib/directory/admin', () => ({ getDirectoryStatus }))
vi.mock('@/components/admin/users/user-management', () => ({ default: UserManagement }))

import UserManagementPage from '@/app/(admin)/user-management/page'

describe('/user-management page', () => {
	beforeEach(() => {
		requireAdminUser.mockReset()
		listUsers.mockReset()
		getDirectoryStatus.mockReset()
		getDirectoryStatus.mockResolvedValue(null)
	})

	it('checks the session before it lists the users', async () => {
		requireAdminUser.mockRejectedValue(redirectSignal)
		await expect(UserManagementPage()).rejects.toBe(redirectSignal)
		expect(listUsers).not.toHaveBeenCalled()
	})

	it('lists the users as the signed-in admin and hands the table the DTOs and its id and role', async () => {
		const admin = { id: 'u1', email: 'admin@e2e.local', name: 'Admin', role: 'admin' }
		requireAdminUser.mockResolvedValue(admin)
		const at = '2026-01-15T09:05:00.000Z'
		const users = [
			{
				id: 'u1',
				name: 'Admin',
				email: 'admin@e2e.local',
				role: 'admin',
				active: true,
				adminDeactivation: null,
				groups: [],
				createdAt: at,
				updatedAt: at,
			},
		]
		listUsers.mockResolvedValue(users)
		expect(await UserManagementPage()).toMatchObject({
			type: UserManagement,
			props: { currentUser: { id: 'u1', role: 'admin' }, users, directory: null },
		})
		expect(listUsers).toHaveBeenCalledWith(admin)
		expect(getDirectoryStatus).toHaveBeenCalledWith(admin)
	})

	it('hands the table the directory status when LDAP is on', async () => {
		requireAdminUser.mockResolvedValue({ id: 'u1', email: 'a@x', name: null, role: 'admin' })
		listUsers.mockResolvedValue([])
		const status = { encryption: 'ldaps', nextRun: null, lastRun: null }
		getDirectoryStatus.mockResolvedValue(status)
		expect(await UserManagementPage()).toMatchObject({ props: { directory: status } })
	})
})
