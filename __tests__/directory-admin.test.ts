import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	directoryConfig: vi.fn(),
	searchGroups: vi.fn(),
	withDirectory: vi.fn(),
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/directory/config', () => ({ directoryConfig: mocks.directoryConfig }))
vi.mock('@/lib/directory/operations', () => ({ searchGroups: mocks.searchGroups }))
vi.mock('@/lib/directory/connection', () => ({ withDirectory: mocks.withDirectory }))

import { searchDirectoryGroups } from '@/lib/directory/admin'

const admin = { id: 'a1', email: 'a@x', name: null, role: 'admin' as const }
const user = { ...admin, role: 'user' as const }

beforeEach(() => {
	for (const fn of Object.values(mocks)) fn.mockReset()
	mocks.withDirectory.mockImplementation((_config: unknown, work: (client: unknown) => unknown) =>
		work('client'),
	)
})

describe('searchDirectoryGroups (spec §6.5)', () => {
	it('refuses a non-admin actor before the directory', async () => {
		await expect(searchDirectoryGroups(user, 'eng')).rejects.toMatchObject({ code: 'forbidden' })
		expect(mocks.withDirectory).not.toHaveBeenCalled()
	})

	it('answers null while LDAP is off', async () => {
		mocks.directoryConfig.mockReturnValue(null)
		expect(await searchDirectoryGroups(admin, 'eng')).toBeNull()
		expect(mocks.withDirectory).not.toHaveBeenCalled()
	})

	it('searches through one service-bound client', async () => {
		mocks.directoryConfig.mockReturnValue({ url: 'ldaps://dc' })
		mocks.searchGroups.mockResolvedValue([{ key: 'k1', name: 'Engineering' }])
		expect(await searchDirectoryGroups(admin, 'eng')).toEqual([{ key: 'k1', name: 'Engineering' }])
		expect(mocks.searchGroups).toHaveBeenCalledWith('client', { url: 'ldaps://dc' }, 'eng')
	})

	// Carry (Task 10 note): searchGroups falls back to the DN for a group without a name, uncut; the link's name column is
	// varchar(255), so the name the admin picks, and the route answers, is cut to 255 code points (MDN `Array.from()`).
	it('cuts a name longer than the link column to 255 code points, surrogate pairs whole', async () => {
		mocks.directoryConfig.mockReturnValue({ url: 'ldaps://dc' })
		const dn = `CN=${'😀'.repeat(300)},OU=Groups,DC=corp,DC=example`
		mocks.searchGroups.mockResolvedValue([{ key: 'k1', name: dn }])
		const [group] = (await searchDirectoryGroups(admin, 'eng'))!
		expect(Array.from(group.name)).toHaveLength(255)
		expect(group.name).toBe(Array.from(dn).slice(0, 255).join(''))
	})
})
