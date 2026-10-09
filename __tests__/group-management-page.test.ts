import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAdminUser, listGroups, listUserOptions, GroupManagement, redirectSignal } =
	vi.hoisted(() => ({
		requireAdminUser: vi.fn(),
		listGroups: vi.fn(),
		listUserOptions: vi.fn(),
		GroupManagement: () => null,
		redirectSignal: new Error('NEXT_REDIRECT'),
	}))
vi.mock('@/lib/auth/session', () => ({ requireAdminUser }))
vi.mock('@/lib/data/groups', () => ({ listGroups }))
vi.mock('@/lib/data/users', () => ({ listUserOptions }))
vi.mock('@/components/admin/groups/group-management', () => ({ default: GroupManagement }))

import GroupManagementPage from '@/app/(admin)/group-management/page'

describe('/group-management page', () => {
	beforeEach(() => {
		requireAdminUser.mockReset()
		listGroups.mockReset()
		listUserOptions.mockReset()
	})

	it('checks the session before it reads anything', async () => {
		requireAdminUser.mockRejectedValue(redirectSignal)
		await expect(GroupManagementPage()).rejects.toBe(redirectSignal)
		expect(listGroups).not.toHaveBeenCalled()
		expect(listUserOptions).not.toHaveBeenCalled()
	})

	it('hands the table the groups and the accounts the picker offers, read as the signed-in admin', async () => {
		const admin = { id: 'a1', email: 'a@e2e.local', name: 'Admin', role: 'admin' }
		requireAdminUser.mockResolvedValue(admin)
		listGroups.mockResolvedValue([{ id: 'g1' }])
		listUserOptions.mockResolvedValue([{ id: 'u1' }])
		expect(await GroupManagementPage()).toMatchObject({
			type: GroupManagement,
			props: { groups: [{ id: 'g1' }], users: [{ id: 'u1' }] },
		})
		expect(listGroups).toHaveBeenCalledWith(admin)
		expect(listUserOptions).toHaveBeenCalledWith(admin)
	})
})
