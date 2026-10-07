import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { resolveRemoteFileUrl } from '@/lib/dify/remote-file'

const BASE = 'https://dify.example/v1'

// Review Focus 5
describe('resolveRemoteFileUrl', () => {
	it('accepts an absolute URL on the Dify origin under /files/', () => {
		expect(
			resolveRemoteFileUrl('https://dify.example/files/tools/x.png?sign=1', BASE)?.toString(),
		).toBe('https://dify.example/files/tools/x.png?sign=1')
		expect(
			resolveRemoteFileUrl('https://dify.example/v1/files/abc/preview', BASE)?.toString(),
		).toBe('https://dify.example/v1/files/abc/preview')
	})
	it('resolves a relative link against the Dify origin', () => {
		expect(resolveRemoteFileUrl('/files/upload/x.png', BASE)?.toString()).toBe(
			'https://dify.example/files/upload/x.png',
		)
	})
	it('refuses other origins, other schemes, other paths and traversal', () => {
		expect(resolveRemoteFileUrl('https://evil.example/files/x', BASE)).toBeNull()
		expect(resolveRemoteFileUrl('http://dify.example/files/x', BASE)).toBeNull()
		expect(resolveRemoteFileUrl('javascript:alert(1)', BASE)).toBeNull()
		expect(resolveRemoteFileUrl('https://dify.example/console/api/x', BASE)).toBeNull()
		expect(resolveRemoteFileUrl('/files/../console/x', BASE)).toBeNull()
		expect(resolveRemoteFileUrl('not a url at all', BASE)).toBeNull()
		expect(resolveRemoteFileUrl('', BASE)).toBeNull()
	})
	it('refuses a protocol-relative link and an encoded traversal (the parser resolves both before the check)', () => {
		expect(resolveRemoteFileUrl('//evil.example/files/x', BASE)).toBeNull()
		expect(resolveRemoteFileUrl('/files/%2e%2e/console/x', BASE)).toBeNull()
	})
})
