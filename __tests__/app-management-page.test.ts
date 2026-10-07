import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppModeEnums, EIsEnabled } from '@/lib/core'

const { requireUser, listApp, AppManagement, redirectSignal } = vi.hoisted(() => ({
	requireUser: vi.fn(),
	listApp: vi.fn(),
	AppManagement: () => null,
	redirectSignal: new Error('NEXT_REDIRECT'),
}))
vi.mock('@/lib/auth/session', () => ({ requireUser }))
vi.mock('@/app/(admin)/app-management/actions', () => ({ listApp }))
vi.mock('@/components/admin/apps/app-management', () => ({ default: AppManagement }))

import AppManagementPage from '@/app/(admin)/app-management/page'

describe('/app-management page', () => {
	beforeEach(() => {
		requireUser.mockReset()
		listApp.mockReset()
	})

	it('checks the session before it lists the apps', async () => {
		requireUser.mockRejectedValue(redirectSignal)
		await expect(AppManagementPage()).rejects.toBe(redirectSignal)
		expect(listApp).not.toHaveBeenCalled()
	})

	it('lists with masked keys and hands the table rows without requestConfig', async () => {
		requireUser.mockResolvedValue(undefined)
		listApp.mockResolvedValue([
			{
				id: 'a1',
				info: { name: 'Alpha', mode: AppModeEnums.CHATBOT, description: '', tags: [] },
				isEnabled: EIsEnabled.disabled,
				requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-***' },
			},
		])
		const page = await AppManagementPage()
		expect(listApp).toHaveBeenCalledWith({ isMask: true })
		expect(page).toMatchObject({
			type: AppManagement,
			props: { apps: [{ id: 'a1', name: 'Alpha', isEnabled: EIsEnabled.disabled }] },
		})
		expect(JSON.stringify(page.props)).not.toMatch(/app-\*\*\*|dify\.example/)
	})
})
