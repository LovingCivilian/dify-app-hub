import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

/*
 * Part 0 spec §3.2 (ADR-0031): ids are PostgreSQL uuids, and the server refuses a malformed one with 22P02 instead of
 * matching nothing. Every id from a URL is checked first (lib/ids.ts), so a malformed id answers exactly as an unknown
 * one: the chat page's "missing" Result and the routes' 404 envelope, never a 500. Signed in as the owner (the
 * project's storage state), who may use every app.
 */
const missing = 'No Dify app configuration found. Contact your administrator.'
const notFound = { code: 'app_not_found', message: 'No such app.', status: 404 }

const cases = [
	['a malformed id', 'abc'],
	['an unknown uuid', randomUUID()],
] as const

for (const [label, id] of cases) {
	test.describe(label, () => {
		test('the chat page shows the missing app', async ({ page }) => {
			const response = await page.goto(`/chat/${id}`)
			// Spec §6: HTTP 200, like any unknown app (the page renders its "missing" state).
			expect(response?.status()).toBe(200)
			await expect(page.getByText(missing)).toBeVisible()
		})

		test('the Dify routes answer the 404 envelope before any request to Dify', async ({ page }) => {
			const parameters = await page.request.get(`/api/dify/${id}/parameters`)
			expect(parameters.status()).toBe(404)
			expect(await parameters.json()).toEqual(notFound)
			// The guard runs before the body is read (session → app → role → input, lib/providers/dify/route.ts).
			const send = await page.request.post(`/api/dify/${id}/chat-messages`, {
				data: { query: 'hello', inputs: {} },
			})
			expect(send.status()).toBe(404)
			expect(await send.json()).toEqual(notFound)
		})

		test('the icon route answers 404', async ({ page }) => {
			const icon = await page.request.get(`/api/apps/${id}/icon`)
			expect(icon.status()).toBe(404)
			expect(await icon.json()).toMatchObject({ code: 'icon_not_found', status: 404 })
		})
	})
}
