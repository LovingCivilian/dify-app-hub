import { describe, expect, it, vi } from 'vitest'

const { redirect, redirectSignal } = vi.hoisted(() => ({
	redirect: vi.fn(),
	redirectSignal: new Error('NEXT_REDIRECT'),
}))
vi.mock('next/navigation', () => ({ redirect }))

import Home from '@/app/page'

describe('/ page', () => {
	it('redirects to /apps on the server (the proxy already sends signed-out visitors to /login)', () => {
		redirect.mockImplementation(() => {
			throw redirectSignal
		})
		expect(() => Home()).toThrow(redirectSignal)
		expect(redirect).toHaveBeenCalledWith('/apps')
	})
})
