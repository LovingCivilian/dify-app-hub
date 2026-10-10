import { describe, expect, it } from 'vitest'

import {
	OUTCOME_LABEL_KEYS,
	SYNC_ERROR_LABEL_KEYS,
	syncErrorKey,
	syncFailedKey,
	TRIGGER_LABEL_KEYS,
} from '@/components/admin/users/directory-labels'
import { SYNC_ERROR_CODES, SYNC_OUTCOMES, SYNC_TRIGGERS } from '@/lib/directory-status'
import en from '@/locales/en/translation.json'

const has = (key: string) =>
	key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en) !==
	undefined

// Every outcome, trigger and error code a run can record has a text (spec §7.3: codes, never a server message).
describe('the directory labels', () => {
	it('name every outcome, trigger and error code', () => {
		for (const outcome of [...SYNC_OUTCOMES, 'interrupted' as const])
			expect(has(OUTCOME_LABEL_KEYS[outcome])).toBe(true)
		for (const trigger of SYNC_TRIGGERS) expect(has(TRIGGER_LABEL_KEYS[trigger])).toBe(true)
		for (const code of SYNC_ERROR_CODES) {
			expect(has(SYNC_ERROR_LABEL_KEYS[code])).toBe(true)
			// No listed code reaches the fallback by accident.
			expect(syncErrorKey(code)).toBe(SYNC_ERROR_LABEL_KEYS[code])
		}
		expect(syncErrorKey('something_new')).toBe('admin_users.sync_error_internal_error')
	})
	it('say "nothing was changed" only for the codes that fail before the first write', () => {
		for (const code of ['directory_unreachable', 'bind_refused', 'search_failed'])
			expect(syncFailedKey(code)).toBe('admin_users.sync_failed')
		for (const code of ['internal_error', null, 'something_new'])
			expect(syncFailedKey(code)).toBe('admin_users.sync_failed_partial')
		expect(has('admin_users.sync_failed')).toBe(true)
		expect(has('admin_users.sync_failed_partial')).toBe(true)
		expect(en.admin_users.sync_failed).toContain('Nothing was changed')
		expect(en.admin_users.sync_failed_partial).not.toContain('Nothing was changed')
	})
})
