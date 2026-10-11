import { describe, expect, it, vi } from 'vitest'

const { requireAdminUser, getBrandingSettings, redirect, builtInLogo } = vi.hoisted(() => ({
	requireAdminUser: vi.fn(),
	getBrandingSettings: vi.fn(),
	redirect: vi.fn(),
	builtInLogo: { src: '/_next/static/media/logo.png', width: 256, height: 64 },
}))
vi.mock('@/lib/auth/session', () => ({ requireAdminUser }))
vi.mock('@/lib/settings/branding', () => ({ getBrandingSettings }))
// Vitest serves a `.png` import as its URL string (Vite static assets), so the real BUILT_IN_LOGO has only undefined
// fields here, which `{}` would equal; a distinctive stand-in pins that the page hands over this module's export.
vi.mock('@/lib/settings/built-in-logo', () => ({ BUILT_IN_LOGO: builtInLogo }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/components/admin/settings/branding-settings', () => ({ default: () => null }))

import BrandingPage from '@/app/(admin)/settings/branding/page'
import SettingsPage from '@/app/(admin)/settings/page'

describe('the settings pages (settings spec §5.2, §5.3)', () => {
	it('/settings sends the admin to the first area', () => {
		SettingsPage()
		expect(redirect).toHaveBeenCalledWith('/settings/branding')
	})

	it('Branding checks the admin, then loads the settings for that actor', async () => {
		const actor = { id: 'a1', email: 'a@example.com', name: null, role: 'admin' }
		requireAdminUser.mockResolvedValue(actor)
		getBrandingSettings.mockResolvedValue({ mode: 'disabled' })
		const page = await BrandingPage()
		expect(getBrandingSettings).toHaveBeenCalledWith(actor, builtInLogo)
		expect(getBrandingSettings.mock.calls[0][1]).toBe(builtInLogo)
		expect(page.props.settings).toEqual({ mode: 'disabled' })
	})
})
