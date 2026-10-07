import { describe, expect, it } from 'vitest'

import { appErrorKey } from '@/components/admin/apps/app-errors'

describe('appErrorKey', () => {
	it('maps the codes to translation keys, per action for the generic failure', () => {
		expect(appErrorKey('unauthorized', 'save')).toBe('common.session_expired')
		expect(appErrorKey('forbidden', 'sync')).toBe('common.session_expired')
		expect(appErrorKey('not_found', 'delete')).toBe('admin_apps.not_found')
		expect(appErrorKey('dify_unreachable', 'save')).toBe('admin_apps.dify_unreachable')
		expect(appErrorKey('invalid_input', 'save')).toBe('admin_apps.invalid_input')
		expect(appErrorKey('operation_failed', 'save')).toBe('admin_apps.save_failed')
		expect(appErrorKey('operation_failed', 'sync')).toBe('admin_apps.sync_failed')
		expect(appErrorKey('operation_failed', 'delete')).toBe('common.delete_failed')
	})
})
