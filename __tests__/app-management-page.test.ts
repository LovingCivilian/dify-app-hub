import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
	requireAdminUser,
	listAdminApps,
	listGroupOptions,
	listUserOptions,
	AppManagement,
	redirectSignal,
} = vi.hoisted(() => ({
	requireAdminUser: vi.fn(),
	listAdminApps: vi.fn(),
	listGroupOptions: vi.fn(),
	listUserOptions: vi.fn(),
	AppManagement: () => null,
	redirectSignal: new Error('NEXT_REDIRECT'),
}))
vi.mock('@/lib/auth/session', () => ({ requireAdminUser }))
vi.mock('@/lib/data/apps', () => ({ listAdminApps }))
vi.mock('@/lib/data/groups', () => ({ listGroupOptions }))
vi.mock('@/lib/data/users', () => ({ listUserOptions }))
vi.mock('@/components/admin/apps/app-management', () => ({ default: AppManagement }))

import AppManagementPage from '@/app/(admin)/app-management/page'

const actor = { id: 'u1', email: 'jane@example.com', name: null }

describe('/app-management page', () => {
	beforeEach(() => {
		for (const read of [requireAdminUser, listAdminApps, listGroupOptions, listUserOptions])
			read.mockReset()
	})
	it('checks the session before it reads anything', async () => {
		requireAdminUser.mockRejectedValue(redirectSignal)
		await expect(AppManagementPage()).rejects.toBe(redirectSignal)
		expect(listAdminApps).not.toHaveBeenCalled()
		expect(listGroupOptions).not.toHaveBeenCalled()
		expect(listUserOptions).not.toHaveBeenCalled()
	})
	// Plan deviation 1: the admin read carries each app's access; the pickers get the groups and the accounts.
	it('hands the table the admin DTOs and the pickers their options, read as the signed-in admin', async () => {
		requireAdminUser.mockResolvedValue(actor)
		const rows = [
			{
				id: 'a1',
				name: 'Alpha',
				enabled: false,
				apiBase: 'https://dify.example/v1',
				access: { mode: 'restricted', groupIds: [], userIds: [] },
			},
		]
		const groups = [{ id: 'g1', name: 'Sales' }]
		const users = [{ id: 'u2', name: null, email: 'joe@example.com', active: true }]
		listAdminApps.mockResolvedValue(rows)
		listGroupOptions.mockResolvedValue(groups)
		listUserOptions.mockResolvedValue(users)
		const page = await AppManagementPage()
		expect(listAdminApps).toHaveBeenCalledWith(actor)
		expect(listGroupOptions).toHaveBeenCalledWith(actor)
		expect(listUserOptions).toHaveBeenCalledWith(actor)
		expect(page).toMatchObject({ type: AppManagement, props: { apps: rows, groups, users } })
	})
})
