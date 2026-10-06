import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearProviders, getProvider } from '@/components/chat/provider/provider-cache'

// Review Focus 4: a stream stays bound to the provider (and so the store) of the conversation it started in.
describe('provider cache', () => {
	beforeEach(() => clearProviders())

	it('returns the same instance for the same key and a different one per key', () => {
		const create = vi.fn(() => ({ marker: Math.random() }) as never)
		const a1 = getProvider('app:a', create)
		const a2 = getProvider('app:a', create)
		const b = getProvider('app:b', create)
		expect(a1).toBe(a2)
		expect(a1).not.toBe(b)
		expect(create).toHaveBeenCalledTimes(2)
	})
})
