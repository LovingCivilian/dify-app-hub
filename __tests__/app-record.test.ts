import { describe, expect, it } from 'vitest'

import { isAppInfo, isFailedUpdate } from '@/components/admin/apps/app-record'

describe('isAppInfo', () => {
	it('accepts Dify app info', () => {
		expect(isAppInfo({ name: 'Stub app', description: '', tags: [], mode: 'chat' })).toBe(true)
	})

	it('rejects Dify error bodies and anything else', () => {
		// lib/api parses any JSON answer, so a refused key arrives as a value, not a rejection.
		expect(
			isAppInfo({ code: 'unauthorized', message: 'Access token is invalid', status: 401 }),
		).toBe(false)
		expect(isAppInfo({ name: 3 })).toBe(false)
		expect(isAppInfo(undefined)).toBe(false)
		expect(isAppInfo('<html>')).toBe(false)
	})
})

describe('isFailedUpdate', () => {
	it('spots the { success: false } that actions.ts updateApp resolves on failure', () => {
		expect(isFailedUpdate({ success: false, message: '更新应用配置失败' })).toBe(true)
	})

	it('treats anything else as done', () => {
		expect(isFailedUpdate(undefined)).toBe(false)
		expect(isFailedUpdate(null)).toBe(false)
		expect(isFailedUpdate({ id: 'a1' })).toBe(false)
	})
})
