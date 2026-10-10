import { beforeEach, describe, expect, it, vi } from 'vitest'

const { env } = vi.hoisted(() => ({ env: vi.fn() }))
vi.mock('@/lib/env', () => ({ env }))

import { directoryConfig, isDirectoryConfigured } from '@/lib/directory/config'

beforeEach(() => env.mockReset())

describe('directoryConfig', () => {
	it('answers the parsed block, or null when LDAP is off', () => {
		env.mockReturnValue({ ldap: null })
		expect(directoryConfig()).toBeNull()
		expect(isDirectoryConfigured()).toBe(false)
		env.mockReturnValue({ ldap: { url: 'ldaps://dc' } })
		expect(directoryConfig()).toEqual({ url: 'ldaps://dc' })
		expect(isDirectoryConfigured()).toBe(true)
	})
})
