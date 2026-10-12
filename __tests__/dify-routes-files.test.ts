import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess, client } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	client: {
		uploadFile: vi.fn(),
		filePreview: vi.fn(),
		fetchRemoteFile: vi.fn(),
		audioToText: vi.fn(),
		textToAudio: vi.fn(),
	},
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))
vi.mock('@/lib/providers/dify/client', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/providers/dify/client')>()),
	difyClient: () => client,
}))

import { POST as audioToText } from '@/app/api/dify/[appId]/audio-to-text/route'
import { GET as preview } from '@/app/api/dify/[appId]/files/[fileId]/preview/route'
import { GET as remote } from '@/app/api/dify/[appId]/files/remote/route'
import { POST as upload } from '@/app/api/dify/[appId]/files/upload/route'
import { POST as textToAudio } from '@/app/api/dify/[appId]/text-to-audio/route'

/** The Dify end user: the account's id, never its email (ADR-0026). */
const USER = 'u1'
const actor = { id: USER, email: 'jane@example.com', name: null, role: 'admin' }
const access = {
	id: '3b241101-e2bb-4255-8caf-4136c566a962',
	enabled: true,
	credentials: { apiBase: 'https://dify.example/v1', apiKey: 'k' },
}
const base = 'http://app/api/dify/3b241101-e2bb-4255-8caf-4136c566a962'
const params = <P extends Record<string, string>>(extra?: P) => ({
	params: Promise.resolve({ appId: '3b241101-e2bb-4255-8caf-4136c566a962', ...extra } as {
		appId: string
	} & P),
})
const multipart = (parts: Array<[string, File | string]>) => {
	const form = new FormData()
	for (const [name, value] of parts) form.append(name, value)
	return new NextRequest(`${base}/x`, { method: 'POST', body: form })
}
const json = (path: string, method: string, body: unknown) =>
	new NextRequest(`${base}${path}`, {
		method,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
const binary = (type: string, extra: Record<string, string> = {}) =>
	new Response(new Uint8Array([1, 2, 3]), {
		status: 200,
		headers: { 'content-type': type, ...extra },
	})

beforeEach(() => {
	verifySession.mockReset()
	verifySession.mockResolvedValue(actor)
	getAppAccess.mockReset()
	getAppAccess.mockResolvedValue(access)
	for (const fn of Object.values(client)) fn.mockReset()
})

describe('files', () => {
	it('upload forwards the one file part with the session user and answers 201', async () => {
		client.uploadFile.mockResolvedValue({ id: 'f1', name: 'a.txt' })
		const response = await upload(
			multipart([
				['file', new File(['x'], 'a.txt', { type: 'text/plain' })],
				['user', 'evil'],
			]),
			params(),
		)
		expect(client.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'a.txt' }), USER)
		expect(response.status).toBe(201)
		await expect(response.json()).resolves.toEqual({ id: 'f1', name: 'a.txt' })
	})
	// Review Focus 2
	it('upload refuses a body without a file part', async () => {
		const response = await upload(multipart([['user', 'x']]), params())
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toMatchObject({ code: 'invalid_param', status: 400 })
		expect(client.uploadFile).not.toHaveBeenCalled()
	})
	it('preview passes the binary through with its disposition', async () => {
		client.filePreview.mockResolvedValue(
			binary('image/png', {
				'content-disposition': 'attachment; filename="a.png"',
				'x-version': '1',
			}),
		)
		const response = await preview(
			new NextRequest(`${base}/files/f1/preview?as_attachment=true`),
			params({ fileId: 'f1' }),
		)
		expect(client.filePreview).toHaveBeenCalledWith('f1', true, USER)
		expect(response.headers.get('content-type')).toBe('image/png')
		expect(response.headers.get('content-disposition')).toBe('attachment; filename="a.png"')
		expect(response.headers.get('x-content-type-options')).toBe('nosniff')
		expect(response.headers.get('x-version')).toBeNull()
	})
	// An uploaded SVG opened top-level on the hub's origin would run its scripts there: it downloads instead.
	it('preview makes an SVG download under its own name, with nosniff', async () => {
		client.filePreview.mockResolvedValue(
			binary('image/svg+xml', { 'content-disposition': 'inline; filename="a.svg"' }),
		)
		const response = await preview(
			new NextRequest(`${base}/files/f1/preview`),
			params({ fileId: 'f1' }),
		)
		expect(response.headers.get('content-type')).toBe('image/svg+xml')
		expect(response.headers.get('content-disposition')).toBe('attachment; filename="a.svg"')
		expect(response.headers.get('x-content-type-options')).toBe('nosniff')
	})
	it('preview accepts a stub-style id that is not a UUID', async () => {
		const fileId = 'file-3b241101-e2bb-4255-8caf-4136c566a962'
		client.filePreview.mockResolvedValue(binary('image/png'))
		const response = await preview(
			new NextRequest(`${base}/files/${fileId}/preview`),
			params({ fileId }),
		)
		expect(response.status).toBe(200)
		expect(client.filePreview).toHaveBeenCalledWith(fileId, false, USER)
	})
	it('remote fetches a link on the Dify origin and refuses any other (Review Focus 5)', async () => {
		client.fetchRemoteFile.mockResolvedValue(binary('image/png'))
		const ok = await remote(
			new NextRequest(
				`${base}/files/remote?url=${encodeURIComponent('https://dify.example/files/tools/x.png?sign=1')}`,
			),
			params(),
		)
		expect(client.fetchRemoteFile).toHaveBeenCalledWith(
			new URL('https://dify.example/files/tools/x.png?sign=1'),
		)
		expect(ok.headers.get('content-type')).toBe('image/png')
		expect(ok.headers.get('x-content-type-options')).toBe('nosniff')
		const bad = await remote(
			new NextRequest(
				`${base}/files/remote?url=${encodeURIComponent('https://evil.example/files/x.png')}`,
			),
			params(),
		)
		expect(bad.status).toBe(400)
		await expect(bad.json()).resolves.toMatchObject({ code: 'invalid_param', status: 400 })
		expect(client.fetchRemoteFile).toHaveBeenCalledTimes(1)
	})
})

describe('audio', () => {
	it('audio-to-text forwards the recording under its own type and name', async () => {
		client.audioToText.mockResolvedValue({ text: 'hello' })
		const file = new File(['x'], 'speech.webm', { type: 'audio/webm;codecs=opus' })
		const response = await audioToText(multipart([['file', file]]), params())
		const sent = client.audioToText.mock.calls[0][0] as File
		expect(sent.name).toBe('speech.webm')
		expect(sent.type).toBe('audio/webm;codecs=opus')
		await expect(response.json()).resolves.toEqual({ text: 'hello' })
	})
	// Review Focus 2
	it('audio-to-text refuses a second file part', async () => {
		const response = await audioToText(
			multipart([
				['file', new File(['x'], 'a.webm', { type: 'audio/webm' })],
				['file', new File(['y'], 'b.webm', { type: 'audio/webm' })],
			]),
			params(),
		)
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toMatchObject({ code: 'invalid_param', status: 400 })
		expect(client.audioToText).not.toHaveBeenCalled()
	})
	it('text-to-audio validates and passes the audio through', async () => {
		client.textToAudio.mockResolvedValue(binary('audio/wav'))
		const response = await textToAudio(
			json('/text-to-audio', 'POST', { text: 'hi', user: 'evil' }),
			params(),
		)
		expect(client.textToAudio).toHaveBeenCalledWith({ text: 'hi' }, USER)
		expect(response.headers.get('content-type')).toBe('audio/wav')
		expect(response.headers.get('x-content-type-options')).toBe('nosniff')
		expect(
			(await textToAudio(json('/text-to-audio', 'POST', { voice: 'x' }), params())).status,
		).toBe(400)
	})
})

describe('path segments', () => {
	// A bare `.` or `..` collapses in fetch's URL parser, so encoding is not enough: every route with a segment
	// refuses it before the query or the body is read or Dify is called (Task 8's `parsePathParams`).
	const dotDot = '..'
	const refusals = [
		[
			'fileId',
			() => preview(new NextRequest(`${base}/files/../preview`), params({ fileId: dotDot })),
		],
	] as const
	it.each(refusals)(
		'answers 400 invalid_param naming %s for ".." without calling Dify',
		async (name, call) => {
			const response = await call()
			expect(response.status).toBe(400)
			const body = await response.json()
			expect(body).toMatchObject({ code: 'invalid_param', status: 400 })
			expect(body.message).toContain(name)
			for (const fn of Object.values(client)) expect(fn).not.toHaveBeenCalled()
		},
	)
	it('validates the segment before the query is read', async () => {
		const badFlag = await preview(
			new NextRequest(`${base}/files/../preview?as_attachment=yes`),
			params({ fileId: dotDot }),
		)
		expect((await badFlag.json()).message).toContain('fileId')
	})
})
