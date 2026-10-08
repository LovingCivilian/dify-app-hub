import path from 'path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
	output: 'standalone',
	turbopack: {
		root: path.resolve(__dirname),
	},
	// In development Next logs each Server Function call with its arguments: the account forms' passwords and the
	// apps admin's API keys (next.config.js `logging`, "Server Functions"; OWASP Logging Cheat Sheet, "Data to
	// exclude"; ADR-0024 decision g).
	logging: {
		serverFunctions: false,
	},
}

export default nextConfig
