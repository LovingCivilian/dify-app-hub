import { describe, expect, it } from 'vitest'

import { getSafeCallbackUrl, isApiPath, isPublicPath } from '@/lib/access'

describe('isPublicPath', () => {
	it.each([
		'/login',
		'/forgot-password',
		'/reset-password',
		'/init',
		'/init/anything',
		'/api/auth/signin',
		'/api/auth/callback/credentials',
		'/api/health',
		'/_next/static/chunk.js',
		'/_next/data/build/page.json',
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
		'/initx',
		'/_nextx',
		'/api/dify/app-1/parameters',
		'/api/users',
		'/api/init',
		'/api/init/status',
	])('requires a session for %s', pathname => {
		expect(isPublicPath(pathname)).toBe(false)
	})
})

describe('isApiPath', () => {
	it('matches the /api segment only', () => {
		expect(isApiPath('/api')).toBe(true)
		expect(isApiPath('/api/users')).toBe(true)
		expect(isApiPath('/api/dify/app-1/parameters')).toBe(true)
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
