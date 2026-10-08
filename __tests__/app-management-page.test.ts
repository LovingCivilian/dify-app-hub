import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAdminUser, listApps, AppManagement, redirectSignal } = vi.hoisted(() => ({
	requireAdminUser: vi.fn(),
	listApps: vi.fn(),
	AppManagement: () => null,
	redirectSignal: new Error('NEXT_REDIRECT'),
}))
vi.mock('@/lib/auth/session', () => ({ requireAdminUser }))
vi.mock('@/lib/data/apps', () => ({ listApps }))
vi.mock('@/components/admin/apps/app-management', () => ({ default: AppManagement }))

import AppManagementPage from '@/app/(admin)/app-management/page'

const actor = { id: 'u1', email: 'jane@example.com', name: null }

describe('/app-management page', () => {
	beforeEach(() => {
		requireAdminUser.mockReset()
		listApps.mockReset()
	})
	it('checks the session before it lists the apps', async () => {
		requireAdminUser.mockRejectedValue(redirectSignal)
		await expect(AppManagementPage()).rejects.toBe(redirectSignal)
		expect(listApps).not.toHaveBeenCalled()
	})
	it('hands the table the DTOs as they come (no key in them by construction)', async () => {
		requireAdminUser.mockResolvedValue(actor)
		const rows = [{ id: 'a1', name: 'Alpha', enabled: false, apiBase: 'https://dify.example/v1' }]
		listApps.mockResolvedValue(rows)
		const page = await AppManagementPage()
		expect(listApps).toHaveBeenCalledWith(actor)
		expect(page).toMatchObject({ type: AppManagement, props: { apps: rows } })
	})
})
