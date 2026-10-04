import { expect, test } from '@playwright/test'

import { stubApiBase } from './fixtures/env'

test('the stub Dify API and the app under test answer', async ({ request }) => {
	const stub = await request.get(`${stubApiBase}/parameters`)
	expect(stub.ok()).toBe(true)
	expect(await stub.json()).toMatchObject({ opening_statement: 'Hello from the stub' })

	const health = await request.get('/api/health')
	expect(health.status()).toBe(200)
})
