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
const settings = {
	answerForm: { enabled: false, feedbackText: '' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'default',
	annotationEnabled: false,
}
const app = (id: string, enabled: boolean) => ({
	id,
	name: `App ${id}`,
	mode: 'chat',
	description: '',
	tags: [],
	enabled,
	icon: null,
	settings,
	apiBase: 'https://dify.example/v1',
	createdAt: '2026-10-07T00:00:00.000Z',
	updatedAt: '2026-10-07T00:00:00.000Z',
})

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
	it('hands the gallery the enabled apps, trimmed', async () => {
		requireUser.mockResolvedValue(actor)
		listApps.mockResolvedValue([app('a1', true), app('a2', false)])
		const page = await AppListPage()
		expect(listApps).toHaveBeenCalledWith(actor)
		expect(page).toMatchObject({
			type: UserShell,
			props: {
				children: { type: AppGallery, props: { apps: [{ id: 'a1', name: 'App a1', icon: null }] } },
			},
		})
		expect(JSON.stringify(page.props.children.props)).not.toContain('dify.example')
	})
})
