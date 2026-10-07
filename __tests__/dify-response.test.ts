import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { difyErrorResponse } from '@/lib/dify/errors'
import { difyJson } from '@/lib/dify/response'

// Next adds no Cache-Control to a dynamic Route Handler's answer (its app-route handler sends the handler's own
// headers only), so every JSON answer of /api/dify says itself that no cache may store it (ADR-0023).
describe('difyJson', () => {
	it('answers JSON with private, no-store, keeping the status and the other headers', async () => {
		const response = difyJson({ ok: true }, { status: 201, headers: { 'x-extra': '1' } })
		expect(response.status).toBe(201)
		expect(response.headers.get('cache-control')).toBe('private, no-store')
		expect(response.headers.get('content-type')).toBe('application/json')
		expect(response.headers.get('x-extra')).toBe('1')
		await expect(response.json()).resolves.toEqual({ ok: true })
	})
	it('carries no-store on the envelope too', () => {
		const response = difyErrorResponse('app_not_found', 'No such app.', 404)
		expect(response.status).toBe(404)
		expect(response.headers.get('cache-control')).toBe('private, no-store')
	})
})

const routeFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) return routeFiles(full)
		return entry.name === 'route.ts' ? [full] : []
	})

describe('the Dify routes', () => {
	const files = routeFiles(path.resolve(__dirname, '../app/api/dify'))

	it('are found', () => {
		expect(files.length).toBeGreaterThan(20)
	})
	it.each(files.map(file => [path.relative(path.resolve(__dirname, '..'), file), file]))(
		'%s answers JSON through difyJson only',
		(_name, file) => {
			expect(readFileSync(file, 'utf8')).not.toMatch(/\b(Response|NextResponse)\.json\(/)
		},
	)
})
