import { describe, expect, it } from 'vitest'

import {
	OUTCOME_LABEL_KEYS,
	syncErrorKey,
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
		for (const code of SYNC_ERROR_CODES) expect(has(syncErrorKey(code))).toBe(true)
		expect(syncErrorKey('something_new')).toBe('admin_users.sync_error_internal_error')
	})
})
