import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// Charter §5, B2 "done when": no Route Handler remains under app/api except auth, health, dify and the icon route.
// The forgot and reset password handlers stay as inherited (plan deviation 6, ADR-0024); they are named here so a
// new handler under auth/ still fails the test.
describe('app/api', () => {
	it('holds only the auth, health, Dify and icon Route Handlers', () => {
		const routes = (readdirSync('app/api', { recursive: true }) as string[])
			.map(file => file.replaceAll('\\', '/'))
			.filter(file => /(^|\/)route\.ts$/.test(file))
		expect(routes.length).toBeGreaterThan(0)
		const stray = routes.filter(
			file =>
				!/^(auth\/(\[\.\.\.nextauth\]|forgot-password|reset-password)|health|dify\/\[appId\]\/.+|apps\/\[appId\]\/icon)\/route\.ts$/.test(
					file,
				),
		)
		expect(stray).toEqual([])
	})
})
