import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess, client } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	client: { getInfo: vi.fn(), getParameters: vi.fn(), getSite: vi.fn(), getMeta: vi.fn() },
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))
vi.mock('@/lib/dify/client', () => ({ difyClient: () => client, passthrough: (r: Response) => r }))

import { DifyError } from '@/lib/dify/errors'
import { GET as info } from '@/app/api/dify/[appId]/info/route'
import { GET as meta } from '@/app/api/dify/[appId]/meta/route'
import { GET as parameters } from '@/app/api/dify/[appId]/parameters/route'
import { GET as site } from '@/app/api/dify/[appId]/site/route'

const actor = { id: 'u1', email: 'jane@example.com', name: null }
const access = { id: 'app-1', enabled: true, credentials: { apiBase: 'http://d/v1', apiKey: 'k' } }
const ctx = { params: Promise.resolve({ appId: 'app-1' }) }
const get = (path: string) => new NextRequest(`http://app/api/dify/app-1/${path}`)

const routes = [
	['info', info, client.getInfo, { name: 'A', mode: 'chat', description: '', tags: [] }],
	['parameters', parameters, client.getParameters, { user_input_form: [] }],
	['site', site, client.getSite, { title: 'A' }],
	['meta', meta, client.getMeta, { tool_icons: {} }],
] as const

beforeEach(() => {
	verifySession.mockReset()
	getAppAccess.mockReset()
	for (const fn of Object.values(client)) fn.mockReset()
})

describe.each(routes)('GET /api/dify/[appId]/%s', (path, handler, method, answer) => {
	it('refuses without a session, for an unknown app and for a disabled app, in the envelope', async () => {
		verifySession.mockResolvedValue(null)
		expect((await handler(get(path), ctx)).status).toBe(401)
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(null)
		expect((await handler(get(path), ctx)).status).toBe(404)
		getAppAccess.mockResolvedValue({ ...access, enabled: false })
		expect((await handler(get(path), ctx)).status).toBe(403)
		expect(method).not.toHaveBeenCalled()
	})
	it("answers Dify's JSON", async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(access)
		method.mockResolvedValue(answer)
		const response = await handler(get(path), ctx)
		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual(answer)
	})
	it("answers Dify's error envelope with its status", async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(access)
		method.mockRejectedValue(new DifyError(403, 'forbidden', 'Site not found.'))
		const response = await handler(get(path), ctx)
		expect(response.status).toBe(403)
		await expect(response.json()).resolves.toEqual({
			code: 'forbidden',
			message: 'Site not found.',
			status: 403,
		})
	})
})
