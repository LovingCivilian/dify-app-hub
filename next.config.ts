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
	// Development only: Next's on-screen indicator floats at the bottom-left by default and covers the sidebar's
	// trigger bar (components/shell/app-sider.tsx) at the same corner (next.config.js `devIndicators`, `position`).
	devIndicators: {
		position: 'bottom-right',
	},
}

export default nextConfig
