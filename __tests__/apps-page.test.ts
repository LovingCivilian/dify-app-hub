import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppModeEnums, EIsEnabled } from '@/lib/core'

// vi.mock factories are hoisted above imports, so the mocks must be created with vi.hoisted.
const { requireSessionUser, getAppList, UserShell, AppGallery, redirectSignal } = vi.hoisted(
	() => ({
		requireSessionUser: vi.fn(),
		getAppList: vi.fn(),
		// Client component trees; the page test only checks the props it hands them.
		UserShell: () => null,
		AppGallery: () => null,
		redirectSignal: new Error('NEXT_REDIRECT'),
	}),
)
vi.mock('@/lib/session-user', () => ({ requireSessionUser }))
vi.mock('@/repository/app', () => ({ getAppList }))
vi.mock('@/components/shell/user-shell', () => ({ default: UserShell }))
vi.mock('@/components/apps/app-gallery', () => ({ default: AppGallery }))

import AppListPage from '@/app/(user)/apps/page'

const app = (id: string, isEnabled: EIsEnabled) => ({
	id,
	info: { name: `App ${id}`, mode: AppModeEnums.CHATBOT, description: '', tags: [] },
	isEnabled,
	requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-secret' },
})

describe('/apps page', () => {
	beforeEach(() => {
		requireSessionUser.mockReset()
		getAppList.mockReset()
	})

	it('checks the session before it reads the apps', async () => {
		requireSessionUser.mockRejectedValue(redirectSignal)
		await expect(AppListPage()).rejects.toBe(redirectSignal)
		expect(getAppList).not.toHaveBeenCalled()
	})

	it('hands the gallery the enabled apps, without their request config', async () => {
		requireSessionUser.mockResolvedValue(undefined)
		getAppList.mockResolvedValue([app('a1', EIsEnabled.enabled), app('a2', EIsEnabled.disabled)])
		const page = await AppListPage()
		expect(page).toMatchObject({
			type: UserShell,
			props: { children: { type: AppGallery, props: { apps: [{ id: 'a1', name: 'App a1' }] } } },
		})
		expect(page.props.children.props.apps).toHaveLength(1)
		expect(JSON.stringify(page.props.children.props)).not.toContain('app-secret')
	})
})
