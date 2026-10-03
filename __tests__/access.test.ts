import { describe, expect, it } from 'vitest'

import { getSafeCallbackUrl, isApiPath, isPublicPath, isUngatedPath } from '@/lib/access'

describe('isPublicPath', () => {
	it.each([
		'/login',
		'/forgot-password',
		'/reset-password',
		'/init',
		'/init/anything',
		'/api/auth/signin',
		'/api/auth/callback/credentials',
		'/api/init/status',
		'/api/health',
		'/_next/static/chunk.js',
		'/favicon.ico',
	])('allows %s without a session', pathname => {
		expect(isPublicPath(pathname)).toBe(true)
	})

	it.each([
		'/',
		'/apps',
		'/chat/abc',
		'/app-management',
		'/user-management',
		'/loginx',
		'/api/client/apps',
		'/api/users',
	])('requires a session for %s', pathname => {
		expect(isPublicPath(pathname)).toBe(false)
	})
})

describe('isUngatedPath', () => {
	it.each([
		'/init',
		'/init/anything',
		'/api/auth/session',
		'/api/init/status',
		'/api/health',
		'/_next/data/build/page.json',
		'/favicon.ico',
	])('skips the session and init-status checks for %s', pathname => {
		expect(isUngatedPath(pathname)).toBe(true)
	})

	it.each([
		'/login',
		'/forgot-password',
		'/reset-password',
		'/initx',
		'/_nextx',
		'/apps',
		'/api/client/apps',
		'/api/users',
	])('keeps %s behind the session or init-status check', pathname => {
		expect(isUngatedPath(pathname)).toBe(false)
	})
})

describe('isApiPath', () => {
	it('matches the /api segment only', () => {
		expect(isApiPath('/api')).toBe(true)
		expect(isApiPath('/api/users')).toBe(true)
		expect(isApiPath('/api/client/apps')).toBe(true)
		expect(isApiPath('/apis')).toBe(false)
		expect(isApiPath('/apps')).toBe(false)
		expect(isApiPath('/')).toBe(false)
	})
})

describe('getSafeCallbackUrl', () => {
	it('keeps a same-site path with its query', () => {
		expect(getSafeCallbackUrl('/chat/abc?x=1')).toBe('/chat/abc?x=1')
	})

	it.each([
		null,
		undefined,
		'',
		'https://evil.example/',
		'//evil.example',
		'/\\evil.example',
		'chat',
		'/\t/evil.example',
		'/\n/evil.example',
		'/\r/evil.example',
		'/\t\\evil.example',
	])('falls back to / for %s', value => {
		expect(getSafeCallbackUrl(value)).toBe('/')
	})
})
