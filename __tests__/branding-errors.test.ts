import { describe, expect, it } from 'vitest'

import { brandingErrorKey, imageErrorKey } from '@/components/admin/settings/branding-errors'

describe('the Branding page messages (charter §4.5: codes, never a server message)', () => {
	it('maps each action code to a key', () => {
		expect(brandingErrorKey('unauthorized')).toBe('common.session_expired')
		expect(brandingErrorKey('forbidden')).toBe('common.forbidden')
		expect(brandingErrorKey('settings_not_editable')).toBe('admin_settings.not_editable')
		expect(brandingErrorKey('invalid_image')).toBe('admin_settings.invalid_image')
		expect(brandingErrorKey('invalid_input')).toBe('admin_settings.invalid_input')
		expect(brandingErrorKey('operation_failed')).toBe('common.operation_failed')
	})

	it('maps an image refusal to its field message', () => {
		expect(imageErrorKey('logo', 'too_large')).toBe('admin_settings.logo_too_large')
		expect(imageErrorKey('favicon', 'too_large')).toBe('admin_settings.favicon_too_large')
		expect(imageErrorKey('logo', 'not_allowed')).toBe('admin_settings.image_not_allowed')
	})
})
