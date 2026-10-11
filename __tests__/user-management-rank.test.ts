import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, target, writes, sets } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	/** The row the locking read finds (lockTarget); the email check always finds the address free. */
	target: {
		value: undefined as { id: string; role: string; adminDeactivatedAt?: Date | null } | undefined,
	},
	writes: { insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
	/** What each update writes, in order. */
	sets: [] as Record<string, unknown>[],
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/password', () => ({
	hashPassword: (password: string) => Promise.resolve(`hash:${password}`),
}))
vi.mock('@/db', () => {
	// select().from().where().limit(1) is awaited for the email check ([]), or ends in .for('update') for the target.
	// Any other lock strength is refused: under FOR SHARE two writers could read the same old role (MySQL "Locking Reads").
	const query = {
		from: () => query,
		where: () => query,
		limit: () =>
			Object.assign(Promise.resolve([]), {
				for: (strength: string) =>
					strength === 'update'
						? Promise.resolve(target.value ? [target.value] : [])
						: Promise.reject(new Error(`lock ${strength}`)),
			}),
	}
	// updateUser's plain read before the hash (`select({ source })` alone) finds the row the locking read finds.
	const sourceRead = {
		from: () => sourceRead,
		where: () => sourceRead,
		limit: () => Promise.resolve(target.value ? [target.value] : []),
	}
	const db = {
		select: (columns: Record<string, unknown>) =>
			Object.keys(columns).join() === 'source' ? sourceRead : query,
		insert: () => ({ values: writes.insert }),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				sets.push(values)
				return { where: writes.update }
			},
		}),
		delete: () => ({ where: writes.delete }),
		transaction: (work: (tx: unknown) => unknown) => work(db),
	}
	return { getDb: () => db }
})

import {
	createUserAction,
	deactivateUserAction,
	deleteUserAction,
	reactivateUserAction,
	updateUserAction,
} from '@/app/(admin)/user-management/actions'

/** Account ids are UUIDs (ADR-0031; lib/ids.ts); each session's id is also its own row's id. */
const OWNER_ID = '0a8f3c1e-5b2d-4e6f-9a7b-1c2d3e4f5a60'
const ADMIN_ID = '1b9e4d2f-6c3e-4f70-8b8c-2d3e4f5a6b71'
const OTHER_ADMIN_ID = '2c0f5e3a-7d4f-4081-9c9d-3e4f5a6b7c82'
const USER_ID = '3d1a6f4b-8e5a-4192-ad0e-4f5a6b7c8d93'

const owner = { id: OWNER_ID, email: 'owner@example.com', name: 'Owner', role: 'owner' }
const admin = { id: ADMIN_ID, email: 'admin@example.com', name: 'Admin', role: 'admin' }
const fields = (role: string) => ({ name: 'N', email: 'n@example.com', role, password: '' })
const forbidden = { ok: false, code: 'forbidden' }
const anyWrite = () =>
	[writes.insert, writes.update, writes.delete].some(fn => fn.mock.calls.length > 0)

beforeEach(() => {
	getServerSession.mockReset()
	for (const fn of Object.values(writes)) {
		fn.mockReset()
		fn.mockResolvedValue({ rowCount: 1 })
	}
	target.value = undefined
	sets.length = 0
})

describe('an admin session (ADR-0024: an admin manages users only)', () => {
	beforeEach(() => {
		getServerSession.mockResolvedValue({ user: admin })
	})

	it('cannot create an admin', async () => {
		expect(await createUserAction({ ...fields('admin'), password: 'password-1' })).toEqual(
			forbidden,
		)
		expect(anyWrite()).toBe(false)
	})

	it('cannot promote a user', async () => {
		target.value = { id: USER_ID, role: 'user' }
		expect(await updateUserAction(USER_ID, fields('admin'))).toEqual(forbidden)
		expect(anyWrite()).toBe(false)
	})

	it.each([
		['another admin', { id: OTHER_ADMIN_ID, role: 'admin' }],
		['the owner', { id: OWNER_ID, role: 'owner' }],
	])('cannot edit, set the password of, or delete %s', async (_name, row) => {
		target.value = row
		expect(await updateUserAction(row.id, fields(row.role))).toEqual(forbidden)
		expect(await updateUserAction(row.id, { ...fields(row.role), password: 'password-1' })).toEqual(
			forbidden,
		)
		expect(await deleteUserAction(row.id)).toEqual(forbidden)
		expect(anyWrite()).toBe(false)
	})

	// The row decides, not the input: the input names a role the admin manages, the locked row does not.
	it.each([
		['another admin', { id: OTHER_ADMIN_ID, role: 'admin' }],
		['the owner', { id: OWNER_ID, role: 'owner' }],
	])('cannot demote %s or set its password by sending the user role', async (_name, row) => {
		target.value = row
		expect(await updateUserAction(row.id, fields('user'))).toEqual(forbidden)
		expect(await updateUserAction(row.id, { ...fields('user'), password: 'password-1' })).toEqual(
			forbidden,
		)
		expect(anyWrite()).toBe(false)
	})

	it('cannot change its own role or set its own password (decisions b, c)', async () => {
		target.value = { id: ADMIN_ID, role: 'admin' }
		expect(await updateUserAction(ADMIN_ID, fields('user'))).toEqual(forbidden)
		expect(
			await updateUserAction(ADMIN_ID, { ...fields('admin'), password: 'password-1' }),
		).toEqual(forbidden)
		expect(anyWrite()).toBe(false)
	})

	it('creates, edits and deletes a user', async () => {
		expect(await createUserAction({ ...fields('user'), password: 'password-1' })).toMatchObject({
			ok: true,
		})
		target.value = { id: USER_ID, role: 'user' }
		expect(await updateUserAction(USER_ID, { ...fields('user'), password: 'password-1' })).toEqual({
			ok: true,
			data: undefined,
		})
		expect(await deleteUserAction(USER_ID)).toEqual({ ok: true, data: undefined })
	})
})

describe('the owner session', () => {
	beforeEach(() => {
		getServerSession.mockResolvedValue({ user: owner })
	})

	it('creates an admin, promotes a user, and edits, demotes and deletes an admin', async () => {
		expect(await createUserAction({ ...fields('admin'), password: 'password-1' })).toMatchObject({
			ok: true,
		})
		target.value = { id: USER_ID, role: 'user' }
		expect(await updateUserAction(USER_ID, fields('admin'))).toEqual({ ok: true, data: undefined })
		target.value = { id: OTHER_ADMIN_ID, role: 'admin' }
		expect(
			await updateUserAction(OTHER_ADMIN_ID, { ...fields('user'), password: 'password-1' }),
		).toEqual({
			ok: true,
			data: undefined,
		})
		expect(await deleteUserAction(OTHER_ADMIN_ID)).toEqual({ ok: true, data: undefined })
	})

	it('cannot give the owner role, change its own role, or delete itself', async () => {
		expect(await createUserAction({ ...fields('owner'), password: 'password-1' })).toEqual(
			forbidden,
		)
		target.value = { id: USER_ID, role: 'user' }
		expect(await updateUserAction(USER_ID, fields('owner'))).toEqual(forbidden)
		target.value = { id: OWNER_ID, role: 'owner' }
		expect(await updateUserAction(OWNER_ID, fields('admin'))).toEqual(forbidden)
		expect(await deleteUserAction(OWNER_ID)).toEqual({ ok: false, code: 'cannot_delete_self' })
		expect(anyWrite()).toBe(false)
	})

	it('edits its own name and email', async () => {
		target.value = { id: OWNER_ID, role: 'owner' }
		expect(await updateUserAction(OWNER_ID, fields('owner'))).toEqual({ ok: true, data: undefined })
		expect(writes.update).toHaveBeenCalledTimes(1)
	})
})

describe('deactivation through the real session chain (Review Focus 4)', () => {
	it('an admin cannot deactivate the owner, another admin or itself', async () => {
		getServerSession.mockResolvedValue({ user: admin })
		target.value = { id: OWNER_ID, role: 'owner', adminDeactivatedAt: null }
		expect(await deactivateUserAction(OWNER_ID)).toEqual(forbidden)
		target.value = { id: OTHER_ADMIN_ID, role: 'admin', adminDeactivatedAt: null }
		expect(await deactivateUserAction(OTHER_ADMIN_ID)).toEqual(forbidden)
		target.value = { id: ADMIN_ID, role: 'admin', adminDeactivatedAt: null }
		expect(await deactivateUserAction(ADMIN_ID)).toEqual({
			ok: false,
			code: 'cannot_deactivate_self',
		})
		expect(anyWrite()).toBe(false)
	})

	it('the owner deactivates an admin: one update that stamps the marker and bumps the session version', async () => {
		getServerSession.mockResolvedValue({ user: owner })
		target.value = { id: OTHER_ADMIN_ID, role: 'admin', adminDeactivatedAt: null }
		expect(await deactivateUserAction(OTHER_ADMIN_ID)).toEqual({ ok: true, data: undefined })
		expect(writes.update).toHaveBeenCalledTimes(1)
		expect(sets[0]).toMatchObject({
			adminDeactivatedAt: expect.any(Date),
			adminDeactivatedBy: OWNER_ID,
		})
		expect(sets[0]).toHaveProperty('sessionVersion')
	})

	it('reactivation clears the admin marker only and leaves the session version alone', async () => {
		getServerSession.mockResolvedValue({ user: owner })
		target.value = { id: USER_ID, role: 'user', adminDeactivatedAt: new Date() }
		expect(await reactivateUserAction(USER_ID)).toEqual({ ok: true, data: undefined })
		expect(sets).toEqual([{ adminDeactivatedAt: null, adminDeactivatedBy: null }])
	})

	// Deviation 6: idempotent, each half on its own (no second sessionVersion bump, no new timestamp).
	it('deactivating an account an admin already deactivated writes nothing', async () => {
		getServerSession.mockResolvedValue({ user: owner })
		target.value = { id: USER_ID, role: 'user', adminDeactivatedAt: new Date() }
		expect(await deactivateUserAction(USER_ID)).toEqual({ ok: true, data: undefined })
		expect(writes.update).not.toHaveBeenCalled()
	})

	it('reactivating an active account writes nothing', async () => {
		getServerSession.mockResolvedValue({ user: owner })
		target.value = { id: USER_ID, role: 'user', adminDeactivatedAt: null }
		expect(await reactivateUserAction(USER_ID)).toEqual({ ok: true, data: undefined })
		expect(writes.update).not.toHaveBeenCalled()
	})
})
