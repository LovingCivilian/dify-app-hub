import { beforeEach, describe, expect, it, vi } from 'vitest'

const { selectRows, setCalls } = vi.hoisted(() => ({
	selectRows: { value: [] as unknown[] },
	setCalls: [] as Record<string, unknown>[],
}))
vi.mock('@/db', () => ({
	getDb: () => ({
		select: () => ({
			from: () => ({ where: () => ({ limit: () => Promise.resolve(selectRows.value) }) }),
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				setCalls.push(values)
				return { where: () => Promise.resolve([{ affectedRows: 1 }]) }
			},
		}),
	}),
}))
vi.mock('@/lib/auth/password', () => ({
	hashPassword: (password: string) => Promise.resolve(`hash:${password}`),
	verifyPassword: (password: string, hash: string) => Promise.resolve(hash === `hash:${password}`),
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { changeOwnPassword } from '@/lib/data/users'

const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'user' as const }

beforeEach(() => {
	selectRows.value = [{ password: 'hash:old-password-1' }]
	setCalls.length = 0
})

describe('changeOwnPassword (charter §4.2)', () => {
	it('refuses a wrong current password on its field and writes nothing', async () => {
		expect(
			await changeOwnPassword(actor, {
				currentPassword: 'wrong-password',
				newPassword: 'new-password-1',
			}),
		).toEqual({ ok: false, code: 'invalid_input', fieldErrors: { currentPassword: ['incorrect'] } })
		expect(setCalls).toEqual([])
	})

	it('stores the new hash and bumps sessionVersion, which revokes every session', async () => {
		expect(
			await changeOwnPassword(actor, {
				currentPassword: 'old-password-1',
				newPassword: 'new-password-1',
			}),
		).toEqual({ ok: true, data: undefined })
		expect(setCalls).toHaveLength(1)
		expect(setCalls[0].password).toBe('hash:new-password-1')
		expect(setCalls[0].sessionVersion).toBeDefined()
	})

	it('answers unauthorized when the account is gone', async () => {
		selectRows.value = []
		expect(
			await changeOwnPassword(actor, {
				currentPassword: 'old-password-1',
				newPassword: 'new-password-1',
			}),
		).toEqual({ ok: false, code: 'unauthorized' })
	})
})
