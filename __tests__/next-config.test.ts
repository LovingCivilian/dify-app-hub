import { describe, expect, it } from 'vitest'

import nextConfig from '@/next.config'

// In development Next logs every Server Function call with its arguments (next.config.js `logging`, "Server
// Functions"). The account forms send passwords and the apps admin sends API keys as action arguments, which must
// not reach the `next dev` terminal (OWASP Logging Cheat Sheet, "Data to exclude").
describe('next.config', () => {
	it('turns off the development log of Server Function calls', () => {
		expect(nextConfig.logging).toMatchObject({ serverFunctions: false })
	})
})
