import { describe, expect, it } from 'vitest'

import { fileLink, withGivenLinks } from '@/components/chat/message/file-link'

const api = {
	remoteFileUrl: (url: string) => `/api/dify/a1/files/remote?url=${encodeURIComponent(url)}`,
}

describe('fileLink', () => {
	it('routes relative and absolute Dify links through the remote-file route', () => {
		expect(fileLink('/files/tools/x.png?sign=1', api)).toBe(
			'/api/dify/a1/files/remote?url=%2Ffiles%2Ftools%2Fx.png%3Fsign%3D1',
		)
		expect(fileLink('https://dify.example/files/x.png', api)).toBe(
			'/api/dify/a1/files/remote?url=https%3A%2F%2Fdify.example%2Ffiles%2Fx.png',
		)
	})
	it('keeps an empty link empty', () => {
		expect(fileLink('', api)).toBe('')
	})
})

describe('withGivenLinks', () => {
	// antd's Upload reports the list it was given, whose urls are the proxied links the list shows.
	it('puts the link Dify gave back on each held item, and leaves new items alone', () => {
		const held = [{ uid: 'a', url: '/files/a.png' }, { uid: 'b' }]
		const reported = [
			{ uid: 'a', url: fileLink('/files/a.png', api), status: 'done' },
			{ uid: 'b', status: 'done' },
			{ uid: 'c', status: 'uploading' },
		]
		expect(withGivenLinks(reported, held)).toEqual([
			{ uid: 'a', url: '/files/a.png', status: 'done' },
			{ uid: 'b', url: undefined, status: 'done' },
			{ uid: 'c', status: 'uploading' },
		])
	})
})
