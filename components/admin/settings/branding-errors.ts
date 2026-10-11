import type { ActionErrorCode } from '@/lib/action-result'
import type { BrandImageKind } from '@/lib/settings/branding-rules'

/** The save action's failure code as the message the admin reads (charter §4.5: codes, never a server message). */
export const brandingErrorKey = (code: ActionErrorCode) => {
	switch (code) {
		case 'unauthorized':
			return 'common.session_expired' as const
		case 'forbidden':
			return 'common.forbidden' as const
		case 'settings_not_editable':
			return 'admin_settings.not_editable' as const
		case 'invalid_image':
			return 'admin_settings.invalid_image' as const
		case 'invalid_input':
			return 'admin_settings.invalid_input' as const
		default:
			return 'common.operation_failed' as const
	}
}

/** An image refusal (spec §4.4) as its field message. */
export const imageErrorKey = (kind: BrandImageKind, code: string) => {
	if (code !== 'too_large') return 'admin_settings.image_not_allowed' as const
	return kind === 'logo'
		? ('admin_settings.logo_too_large' as const)
		: ('admin_settings.favicon_too_large' as const)
}
