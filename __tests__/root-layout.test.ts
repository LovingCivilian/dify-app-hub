import { beforeEach, describe, expect, it, vi } from 'vitest'

const { connection, getBranding, brandingView, order } = vi.hoisted(() => ({
	connection: vi.fn(),
	getBranding: vi.fn(),
	brandingView: vi.fn(),
	order: [] as string[],
}))
vi.mock('next/server', () => ({ connection }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@ant-design/nextjs-registry', () => ({ AntdRegistry: () => null }))
vi.mock('@/components/providers/app-providers', () => ({ default: () => null }))
vi.mock('@/lib/auth/session', () => ({ getCachedServerSession: vi.fn() }))
vi.mock('@/lib/settings/branding', () => ({ getBranding, brandingView }))

import { generateMetadata } from '@/app/layout'

beforeEach(() => {
	order.length = 0
	vi.clearAllMocks()
	connection.mockImplementation(async () => {
		order.push('connection')
	})
	getBranding.mockImplementation(async () => {
		order.push('getBranding')
		return { name: 'Acme' }
	})
	brandingView.mockReturnValue({
		name: 'Acme',
		faviconSrc: '/api/branding/favicon?v=0123456789abcdef',
	})
})

describe('the root metadata (settings spec §4.6)', () => {
	it('waits for a request before it reads the brand (Next `connection()`), then names the tab and its icon', async () => {
		const metadata = await generateMetadata()
		expect(order).toEqual(['connection', 'getBranding'])
		expect(metadata).toMatchObject({
			title: 'Acme',
			icons: { icon: '/api/branding/favicon?v=0123456789abcdef' },
		})
	})

	it('reads no brand when the render does not answer a request (connection() stops a prerender)', async () => {
		connection.mockRejectedValue(new Error('prerendering stops here'))
		await expect(generateMetadata()).rejects.toThrow('prerendering stops here')
		expect(getBranding).not.toHaveBeenCalled()
	})
})
