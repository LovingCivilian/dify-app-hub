import { describe, expect, it } from 'vitest'

import {
	acceptRecord,
	dropRecord,
	isAnnotationPage,
	isAppInfo,
	isFailedUpdate,
} from '@/components/admin/apps/app-record'

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

describe('acceptRecord and dropRecord', () => {
	const record = { id: 'a1' } as never

	it('fills the drawer that is still open for the app', () => {
		expect(acceptRecord({ appId: 'a1' }, 'a1', record)).toEqual({ appId: 'a1', record })
	})

	it('ignores an answer after the drawer closed or another app was opened', () => {
		expect(acceptRecord(null, 'a1', record)).toBeNull()
		expect(acceptRecord({ appId: 'a2' }, 'a1', record)).toEqual({ appId: 'a2' })
	})

	it('closes only the drawer that waited for the failed app', () => {
		expect(dropRecord({ appId: 'a1' }, 'a1')).toBeNull()
		expect(dropRecord({ appId: 'a2' }, 'a1')).toEqual({ appId: 'a2' })
	})
})

describe('isAnnotationPage', () => {
	it('accepts a Dify annotation page', () => {
		expect(isAnnotationPage({ data: [], has_more: false, limit: 10, total: 0, page: 1 })).toBe(true)
	})

	it('rejects Dify error bodies, which lib/api resolves as values', () => {
		expect(isAnnotationPage({ code: 'unauthorized', message: 'x', status: 401 })).toBe(false)
		expect(isAnnotationPage({ data: 'nope', total: 0 })).toBe(false)
		expect(isAnnotationPage(undefined)).toBe(false)
	})
})
