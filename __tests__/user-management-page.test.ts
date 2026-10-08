import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireUser, listUsers, UserManagement, redirectSignal } = vi.hoisted(() => ({
	requireUser: vi.fn(),
	listUsers: vi.fn(),
	UserManagement: () => null,
	redirectSignal: new Error('NEXT_REDIRECT'),
}))
vi.mock('@/lib/auth/session', () => ({ requireUser }))
vi.mock('@/lib/data/users', () => ({ listUsers }))
vi.mock('@/components/admin/users/user-management', () => ({ default: UserManagement }))

import UserManagementPage from '@/app/(admin)/user-management/page'

describe('/user-management page', () => {
	beforeEach(() => {
		requireUser.mockReset()
		listUsers.mockReset()
	})

	it('checks the session before it lists the users', async () => {
		requireUser.mockRejectedValue(redirectSignal)
		await expect(UserManagementPage()).rejects.toBe(redirectSignal)
		expect(listUsers).not.toHaveBeenCalled()
	})

	it('hands the table the rows and the signed-in user id', async () => {
		requireUser.mockResolvedValue({ id: 'u1', email: 'admin@e2e.local', name: 'Admin' })
		const at = new Date('2026-01-15T09:05:00.000Z')
		listUsers.mockResolvedValue([
			{ id: 'u1', name: 'Admin', email: 'admin@e2e.local', createdAt: at, updatedAt: at },
		])
		expect(await UserManagementPage()).toMatchObject({
			type: UserManagement,
			props: {
				currentUserId: 'u1',
				users: [{ id: 'u1', email: 'admin@e2e.local', createdAt: '2026-01-15T09:05:00.000Z' }],
			},
		})
	})
})
