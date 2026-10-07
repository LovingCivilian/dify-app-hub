import { describe, expect, it } from 'vitest'

import {
	answerLink,
	fileLink,
	isDifyFileLink,
	withGivenLinks,
} from '@/components/chat/message/file-link'

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

// The links Dify writes into an answer's text (graphon File.markdown: `![name](url)` / `[name](url)`, the url from
// api/core/tools/signature.py): `/files/tools/<id><ext>?timestamp=&nonce=&sign=` on FILES_URL, or the upload preview
// `<FILES_URL>/files/<id>/image-preview?timestamp=&nonce=&sign=`.
describe('isDifyFileLink', () => {
	it.each([
		['a relative /files/ link', '/files/tools/x.png?timestamp=1&nonce=a&sign=b'],
		['a relative /files/ link without a signature', '/files/stub-image.png'],
		[
			'an absolute signed link',
			'https://dify.example/files/abc/image-preview?timestamp=1&nonce=a&sign=b',
		],
		[
			'an absolute signed link under a base path',
			'http://dify.example:8080/dify/files/tools/x.png?timestamp=1&nonce=a&sign=b%3D',
		],
	])('takes %s', (_name, url) => {
		expect(isDifyFileLink(url)).toBe(true)
	})
	it.each([
		['an absolute /files/ link without a signature', 'https://example.com/files/cat.png'],
		[
			'an absolute link with part of the signature',
			'https://example.com/files/x?timestamp=1&sign=b',
		],
		[
			'an absolute link with an empty signature',
			'https://example.com/files/x?timestamp=1&nonce=&sign=',
		],
		['a signed link outside /files/', 'https://example.com/img.png?timestamp=1&nonce=a&sign=b'],
		['an external image', 'https://example.com/img.png'],
		['a relative path outside /files/', '/images/x.png'],
		['a relative path without the leading slash', 'files/x.png'],
		['a protocol-relative link', '//example.com/files/x.png?timestamp=1&nonce=a&sign=b'],
		['a data URL', 'data:image/png;base64,iVBORw0KGgo='],
		['an anchor', '#anchor'],
		['a mailto link', 'mailto:a@example.com'],
		['a javascript URL', 'javascript:alert(1)'],
		['an empty string', ''],
	])('leaves %s alone', (_name, url) => {
		expect(isDifyFileLink(url)).toBe(false)
	})
})

describe('answerLink', () => {
	it('routes a Dify file link through the remote-file route and keeps every other link as written', () => {
		expect(answerLink('/files/stub-image.png', api)).toBe(
			'/api/dify/a1/files/remote?url=%2Ffiles%2Fstub-image.png',
		)
		expect(answerLink('https://example.com/cat.png', api)).toBe('https://example.com/cat.png')
		expect(answerLink('#anchor', api)).toBe('#anchor')
		expect(answerLink(undefined, api)).toBeUndefined()
	})
})
