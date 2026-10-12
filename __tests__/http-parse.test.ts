import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { parseFilePart, parsePathParams } from '@/lib/http/parse'

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'

// Review Focus 2
describe('parseFilePart', () => {
	const multipart = (parts: Array<[string, File | string]>) => {
		const form = new FormData()
		for (const [name, value] of parts) form.append(name, value)
		return new Request('http://app/x', { method: 'POST', body: form })
	}
	it('returns the one file part', async () => {
		const parsed = await parseFilePart(
			multipart([
				['file', new File(['x'], 'a.txt', { type: 'text/plain' })],
				['user', 'evil'],
			]),
		)
		expect(parsed.ok).toBe(true)
		if (parsed.ok) expect(parsed.data.name).toBe('a.txt')
	})
	// FormData cannot build these (it names a Blob "blob"), so the body is written out with a fixed boundary.
	const rawMultipart = (disposition: string) =>
		new Request('http://app/x', {
			method: 'POST',
			headers: { 'content-type': 'multipart/form-data; boundary=testboundary' },
			body: [
				'--testboundary',
				`Content-Disposition: ${disposition}`,
				'',
				'content',
				'--testboundary--',
				'',
			].join('\r\n'),
		})
	it.each([
		['a part without a filename attribute', 'form-data; name="file"'],
		['a part with an empty filename', 'form-data; name="file"; filename=""'],
	])('refuses %s with 400 invalid_param naming the file part', async (_label, disposition) => {
		const parsed = await parseFilePart(rawMultipart(disposition))
		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.response.status).toBe(400)
		const body = await parsed.response.json()
		expect(body).toMatchObject({ code: 'invalid_param', status: 400 })
		expect(body.message).toContain('file part named file')
	})
	it('accepts the same raw body when the part carries a filename (the helper builds a valid request)', async () => {
		const parsed = await parseFilePart(rawMultipart('form-data; name="file"; filename="a.txt"'))
		expect(parsed.ok).toBe(true)
		if (parsed.ok) expect(parsed.data.name).toBe('a.txt')
	})
	it('refuses no file part, an empty file, a second file part, or a non-multipart body', async () => {
		for (const request of [
			multipart([['user', 'x']]),
			multipart([['file', new File([], 'empty.txt')]]),
			multipart([
				['file', new File(['a'], 'a.txt')],
				['file', new File(['b'], 'b.txt')],
			]),
			new Request('http://app/x', { method: 'POST', body: 'plain' }),
		]) {
			const parsed = await parseFilePart(request)
			expect(parsed.ok).toBe(false)
			if (!parsed.ok) {
				expect(parsed.response.status).toBe(400)
				await expect(parsed.response.json()).resolves.toMatchObject({ code: 'invalid_param' })
			}
		}
	})
})

describe('parsePathParams', () => {
	const parse = (value: string) =>
		parsePathParams(Promise.resolve({ appId: 'app-1', taskId: value }), 'taskId')
	it.each([
		['a UUID', UUID],
		['a short id', 't1'],
		['a message-file id', `file-${UUID}`],
		['a form token', `ft-${UUID}`],
		['every unreserved character', 'a.b_c~d-E9'],
		['256 characters', 'a'.repeat(256)],
	])('accepts %s and returns only the named params', async (_label, value) => {
		expect(await parse(value)).toEqual({ ok: true, data: { taskId: value } })
	})
	it.each([
		['a single dot', '.'],
		['two dots', '..'],
		['a slash', 'a/b'],
		['an empty segment', ''],
		['257 characters', 'a'.repeat(257)],
		['an encoded dot-dot', '%2E%2E'],
		['a space', 'a b'],
	])('refuses %s with 400 invalid_param naming the param', async (_label, value) => {
		const parsed = await parse(value)
		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.response.status).toBe(400)
		const body = await parsed.response.json()
		expect(body).toMatchObject({ code: 'invalid_param', status: 400 })
		expect(body.message).toContain('taskId')
	})
	it('checks every named param and names each one that fails', async () => {
		const parsed = await parsePathParams(
			Promise.resolve({ appId: 'app-1', messageId: '..', conversationId: '.' }),
			'messageId',
			'conversationId',
		)
		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		const { message } = await parsed.response.json()
		expect(message).toContain('messageId')
		expect(message).toContain('conversationId')
	})
	it('does not check params it was not asked about', async () => {
		const parsed = await parsePathParams(Promise.resolve({ appId: '..', taskId: 't1' }), 'taskId')
		expect(parsed).toEqual({ ok: true, data: { taskId: 't1' } })
	})
})
