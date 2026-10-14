import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireUser, listApps, UserShell, AppGallery, redirectSignal } = vi.hoisted(() => ({
	requireUser: vi.fn(),
	listApps: vi.fn(),
	UserShell: () => null,
	AppGallery: () => null,
	redirectSignal: new Error('NEXT_REDIRECT'),
}))
vi.mock('@/lib/auth/session', () => ({ requireUser }))
vi.mock('@/lib/data/apps', () => ({ listApps }))
vi.mock('@/components/shell/user-shell', () => ({ default: UserShell }))
vi.mock('@/components/apps/app-gallery', () => ({ default: AppGallery }))

import AppListPage from '@/app/(user)/apps/page'

const actor = { id: 'u1', email: 'jane@example.com', name: null }
const summary = {
	id: 'a1',
	provider: 'dify',
	name: 'App a1',
	description: '',
	tags: [],
	hasIcon: false,
	appType: 'chat',
}

describe('/apps page', () => {
	beforeEach(() => {
		requireUser.mockReset()
		listApps.mockReset()
	})
	it('checks the session before it reads the apps', async () => {
		requireUser.mockRejectedValue(redirectSignal)
		await expect(AppListPage()).rejects.toBe(redirectSignal)
		expect(listApps).not.toHaveBeenCalled()
	})
	// The DAL trims and filters (listApps answers AppSummary for the enabled apps the actor may use); the page passes them on.
	it('hands the gallery the summaries the DAL read', async () => {
		requireUser.mockResolvedValue(actor)
		listApps.mockResolvedValue([summary])
		const page = await AppListPage()
		expect(listApps).toHaveBeenCalledWith(actor)
		expect(page).toMatchObject({
			type: UserShell,
			props: { children: { type: AppGallery, props: { apps: [summary] } } },
		})
	})
})
