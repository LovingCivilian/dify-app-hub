import { describe, expect, it } from 'vitest'

import { getSafeCallbackUrl, isClientApiPath, isPublicPath } from '@/lib/access'

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

describe('isClientApiPath', () => {
	it('matches the chat-side proxy routes only', () => {
		expect(isClientApiPath('/api/client/apps')).toBe(true)
		expect(isClientApiPath('/api/client/dify/abc/chat-messages')).toBe(true)
		expect(isClientApiPath('/api/users')).toBe(false)
		expect(isClientApiPath('/api/clientele')).toBe(false)
		expect(isClientApiPath('/apps')).toBe(false)
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
	])('falls back to / for %s', value => {
		expect(getSafeCallbackUrl(value)).toBe('/')
	})
})
