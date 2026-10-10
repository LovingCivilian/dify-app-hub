import { drizzle } from 'drizzle-orm/mysql2'
import { DrizzleQueryError, type SQL } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { database, hashPassword } = vi.hoisted(() => ({
	/** The database a write test hands the DAL; the pure tests leave it unset, so any query throws. */
	database: { value: undefined as unknown },
	/** bcrypt's work, watched so a refusal can be shown to come before it. */
	hashPassword: vi.fn((password: string) => Promise.resolve(`hash:${password}`)),
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
// Vitest "Mocking Specific Exports of a Module": the rest of the module keeps its own behaviour.
vi.mock(import('@/lib/auth/password'), async importOriginal => ({
	...(await importOriginal()),
	hashPassword,
}))
vi.mock('@/db', () => ({
	getDb: () => {
		if (!database.value) throw new Error('not used by the pure tests')
		return database.value
	},
}))

import {
	createRefusal,
	createUser,
	deactivateRefusal,
	deleteRefusal,
	deleteUser,
	isDuplicateEntry,
	listUserOptions,
	listUsers,
	lockTarget,
	setUserActive,
	toUserDto,
	toUserDtos,
	updateRefusal,
	updateUser,
	updateUserRole,
} from '@/lib/data/users'
import { passwordResetTokens, users } from '@/db/schema'

const member = { id: 'u2', email: 'joe@example.com', name: null, role: 'user' as const }
const owner = { id: 'o1', role: 'owner' as const }
const admin = { id: 'a1', role: 'admin' as const }
const otherAdmin = { id: 'a2', role: 'admin' as const }
const user = { id: 'u9', role: 'user' as const }

describe('toUserDto', () => {
	it('passes dates as ISO strings and nothing but the DTO fields', () => {
		const at = new Date('2026-01-15T09:05:00.000Z')
		expect(
			toUserDto({
				id: 'u1',
				name: null,
				email: 'a@b.c',
				role: 'admin',
				source: 'local' as const,
				directoryUsername: null,
				adminDeactivatedAt: null,
				adminDeactivatedBy: null,
				directoryDeactivatedAt: null,
				createdAt: at,
				updatedAt: at,
			}),
		).toEqual({
			id: 'u1',
			name: null,
			email: 'a@b.c',
			role: 'admin',
			source: 'local',
			directoryUsername: null,
			active: true,
			adminDeactivation: null,
			directoryDeactivation: null,
			groups: [],
			createdAt: '2026-01-15T09:05:00.000Z',
			updatedAt: '2026-01-15T09:05:00.000Z',
		})
	})
})

describe('toUserDto with markers and groups', () => {
	it('reports an admin deactivation with when and by whom, and the groups it was given', () => {
		const at = new Date('2026-10-09T09:05:00.000Z')
		expect(
			toUserDto(
				{
					id: 'u1',
					name: null,
					email: 'a@b.c',
					role: 'user',
					source: 'local' as const,
					directoryUsername: null,
					adminDeactivatedAt: at,
					adminDeactivatedBy: 'o1',
					directoryDeactivatedAt: null,
					createdAt: at,
					updatedAt: at,
				},
				[{ id: 'g1', name: 'Finance' }],
			),
		).toMatchObject({
			active: false,
			adminDeactivation: { at: '2026-10-09T09:05:00.000Z', by: 'o1' },
			groups: [{ id: 'g1', name: 'Finance' }],
		})
	})

	it('reads a directory deactivation as inactive without an admin record', () => {
		const at = new Date()
		expect(
			toUserDto({
				id: 'u1',
				name: null,
				email: 'a@b.c',
				role: 'user',
				source: 'local' as const,
				directoryUsername: null,
				adminDeactivatedAt: null,
				adminDeactivatedBy: null,
				directoryDeactivatedAt: at,
				createdAt: at,
				updatedAt: at,
			}),
		).toMatchObject({ active: false, adminDeactivation: null })
	})
})

describe('toUserDtos (listUsers)', () => {
	it('gives each account only its own groups, grouped once, and keeps both orders', () => {
		const at = new Date('2026-10-09T09:05:00.000Z')
		const row = (id: string) => ({
			id,
			name: null,
			email: `${id}@b.c`,
			role: 'user' as const,
			source: 'local' as const,
			directoryUsername: null,
			adminDeactivatedAt: null,
			adminDeactivatedBy: null,
			directoryDeactivatedAt: null,
			createdAt: at,
			updatedAt: at,
		})
		const dtos = toUserDtos(
			[row('u1'), row('u2'), row('u3')],
			[
				{ userId: 'u2', id: 'g1', name: 'Finance' },
				{ userId: 'u1', id: 'g2', name: 'Legal' },
				{ userId: 'u2', id: 'g3', name: 'Sales' },
			],
		)
		expect(dtos.map(({ id, groups }) => [id, groups])).toEqual([
			['u1', [{ id: 'g2', name: 'Legal' }]],
			[
				'u2',
				[
					{ id: 'g1', name: 'Finance' },
					{ id: 'g3', name: 'Sales' },
				],
			],
			['u3', []],
		])
	})
})

// ADR-0024: the owner manages admins and users, an admin manages users; nobody gives the owner role.
describe('createRefusal', () => {
	it.each([
		['owner', 'admin', null],
		['owner', 'user', null],
		['owner', 'owner', 'forbidden'],
		['admin', 'user', null],
		['admin', 'admin', 'forbidden'],
		['admin', 'owner', 'forbidden'],
	] as const)('%s giving %s: %s', (actorRole, role, expected) => {
		expect(createRefusal({ actorRole, role })).toBe(expected)
	})
})

describe('updateRefusal (charter §4.2, ADR-0024)', () => {
	it("lets you edit your own name and email only: your role is fixed, your password is the account menu's (decisions b, c)", () => {
		expect(updateRefusal({ actor: owner, target: owner, input: { role: 'owner' } })).toBeNull()
		expect(updateRefusal({ actor: admin, target: admin, input: { role: 'admin' } })).toBeNull()
		expect(updateRefusal({ actor: owner, target: owner, input: { role: 'admin' } })).toBe(
			'forbidden',
		)
		expect(updateRefusal({ actor: admin, target: admin, input: { role: 'user' } })).toBe(
			'forbidden',
		)
		expect(
			updateRefusal({
				actor: owner,
				target: owner,
				input: { role: 'owner', password: 'new-password-1' },
			}),
		).toBe('forbidden')
	})

	it.each([
		[owner, otherAdmin, 'admin', null],
		[owner, otherAdmin, 'user', null],
		[owner, user, 'admin', null],
		[owner, user, 'user', null],
		[owner, user, 'owner', 'forbidden'],
		[admin, user, 'user', null],
		[admin, user, 'admin', 'forbidden'],
		[admin, otherAdmin, 'admin', 'forbidden'],
		[admin, otherAdmin, 'user', 'forbidden'],
		[admin, owner, 'owner', 'forbidden'],
		[admin, owner, 'user', 'forbidden'],
		[admin, owner, 'admin', 'forbidden'],
	] as const)('%j editing %j to %s: %s', (actor, target, role, expected) => {
		expect(updateRefusal({ actor, target, input: { role } })).toBe(expected)
	})

	it('lets a password be set only where the actor manages the account (decision b)', () => {
		const password = 'new-password-1'
		expect(
			updateRefusal({ actor: owner, target: otherAdmin, input: { role: 'admin', password } }),
		).toBeNull()
		expect(
			updateRefusal({ actor: admin, target: user, input: { role: 'user', password } }),
		).toBeNull()
		expect(
			updateRefusal({ actor: admin, target: otherAdmin, input: { role: 'admin', password } }),
		).toBe('forbidden')
		expect(updateRefusal({ actor: admin, target: owner, input: { role: 'owner', password } })).toBe(
			'forbidden',
		)
	})
})

describe('deleteRefusal (charter §4.2: nobody deletes themselves; ADR-0024: the owner stays)', () => {
	it('refuses a self-delete first, and the owner to everyone', () => {
		expect(deleteRefusal({ actor: owner, target: owner })).toBe('cannot_delete_self')
		expect(deleteRefusal({ actor: admin, target: admin })).toBe('cannot_delete_self')
		expect(deleteRefusal({ actor: admin, target: owner })).toBe('forbidden')
	})

	it.each([
		[owner, otherAdmin, null],
		[owner, user, null],
		[admin, user, null],
		[admin, otherAdmin, 'forbidden'],
	] as const)('%j deleting %j: %s', (actor, target, expected) => {
		expect(deleteRefusal({ actor, target })).toBe(expected)
	})
})

// Review Focus 4: ADR-0024's rank applies to deactivation; nobody deactivates themselves or the owner.
describe('deactivateRefusal', () => {
	it.each([
		[owner, admin, null],
		[owner, user, null],
		[admin, user, null],
		[admin, otherAdmin, 'forbidden'],
		[admin, owner, 'forbidden'],
		[{ id: 'u8', role: 'user' }, user, 'forbidden'],
		[owner, owner, 'cannot_deactivate_self'],
		[admin, admin, 'cannot_deactivate_self'],
	] as const)('%o deactivating %o → %s', (actor, target, expected) => {
		expect(deactivateRefusal({ actor, target })).toBe(expected)
	})
})

describe('isDuplicateEntry (MySQL 1062 ER_DUP_ENTRY)', () => {
	const dup = Object.assign(new Error("Duplicate entry 'a@b.c' for key 'users_email_key'"), {
		code: 'ER_DUP_ENTRY',
		errno: 1062,
	})
	it('recognises the driver error bare and inside DrizzleQueryError', () => {
		expect(isDuplicateEntry(dup)).toBe(true)
		expect(isDuplicateEntry(new DrizzleQueryError('insert …', [], dup))).toBe(true)
	})
	it('ignores anything else', () => {
		expect(isDuplicateEntry(new Error('boom'))).toBe(false)
		expect(isDuplicateEntry(Object.assign(new Error('x'), { code: 'ER_LOCK_DEADLOCK' }))).toBe(
			false,
		)
		expect(isDuplicateEntry(null)).toBe(false)
	})
})

describe('lockTarget (decision d, Review Focus 2)', () => {
	it('is a locking read of one account by its primary key', () => {
		const query = lockTarget(drizzle.mock(), 'u9').toSQL()
		expect(query.sql).toMatch(
			/^select .* from `users` where `users`\.`id` = \? limit \? for update$/,
		)
		// setUserActive's no-op branch reads the admin marker from this row.
		expect(query.sql).toMatch(/^select [^]*`admin_deactivated_at`[^]* from `users` /)
		expect(query.params).toEqual(['u9', 1])
	})
})

describe('setUserActive and pending reset links (controller ruling on C2)', () => {
	type Write = { op: 'update' | 'delete'; table: unknown; condition: SQL }

	/** A database that runs everything in its transaction: the target comes from the locking read, writes are recorded. */
	const recordWrites = (target: { id: string; role: 'user'; adminDeactivatedAt: Date | null }) => {
		const writes: Write[] = []
		const tx = {
			select: () => ({
				from: () => ({
					where: () => ({
						limit: () => ({
							for: (strength: string) =>
								strength === 'update'
									? Promise.resolve([target])
									: Promise.reject(new Error(strength)),
						}),
					}),
				}),
			}),
			update: (table: unknown) => ({
				set: () => ({
					where: (condition: SQL) => {
						writes.push({ op: 'update', table, condition })
						return Promise.resolve([{ affectedRows: 1 }])
					},
				}),
			}),
			delete: (table: unknown) => ({
				where: (condition: SQL) => {
					writes.push({ op: 'delete', table, condition })
					return Promise.resolve([{ affectedRows: 1 }])
				},
			}),
		}
		// No update or delete outside the transaction: a write there would throw.
		database.value = { transaction: (work: (t: typeof tx) => unknown) => work(tx) }
		return writes
	}
	const ownerSession = { id: 'o1', email: 'owner@example.com', name: null, role: 'owner' as const }

	afterEach(() => {
		database.value = undefined
	})

	it("deactivation deletes the account's reset tokens in the same transaction as the marker", async () => {
		const writes = recordWrites({ id: 'u9', role: 'user', adminDeactivatedAt: null })
		expect(await setUserActive(ownerSession, 'u9', false)).toEqual({ ok: true, data: undefined })
		expect(writes.map(write => [write.op, write.table])).toEqual([
			['update', users],
			['delete', passwordResetTokens],
		])
		const deleted = drizzle.mock().delete(passwordResetTokens).where(writes[1]!.condition).toSQL()
		expect(deleted.sql).toBe(
			'delete from `password_reset_tokens` where `password_reset_tokens`.`user_id` = ?',
		)
		expect(deleted.params).toEqual(['u9'])
	})

	it('deactivating an account an admin already deactivated deletes nothing', async () => {
		const writes = recordWrites({ id: 'u9', role: 'user', adminDeactivatedAt: new Date() })
		expect(await setUserActive(ownerSession, 'u9', false)).toEqual({ ok: true, data: undefined })
		expect(writes).toEqual([])
	})

	it('reactivation clears the marker only: it deletes and restores no reset token', async () => {
		const writes = recordWrites({ id: 'u9', role: 'user', adminDeactivatedAt: new Date() })
		expect(await setUserActive(ownerSession, 'u9', true)).toEqual({ ok: true, data: undefined })
		expect(writes.map(write => [write.op, write.table])).toEqual([['update', users]])
	})
})

describe('the users DAL refuses a non-admin actor before any query (Review Focus 1)', () => {
	it.each([
		['listUsers', () => listUsers(member)],
		['listUserOptions', () => listUserOptions(member)],
		[
			'createUser',
			() =>
				createUser(member, { name: 'N', email: 'n@e.com', role: 'user', password: 'password-1' }),
		],
		['updateUser', () => updateUser(member, 'u9', { name: 'N', email: 'n@e.com', role: 'user' })],
		['deleteUser', () => deleteUser(member, 'u9')],
		['setUserActive', () => setUserActive(member, 'u9', false)],
		['updateUserRole', () => updateUserRole(member, 'u9', 'user')],
	] as const)('%s', async (_name, call) => {
		await expect(call()).rejects.toMatchObject({ name: 'AuthError', code: 'forbidden' })
	})
})

describe('directory accounts (spec §6.3, decision an)', () => {
	it('shows a directory account with its source, username and the directory marker', () => {
		const at = new Date('2026-10-10T08:00:00.000Z')
		expect(
			toUserDto({
				id: 'd1',
				name: 'Bob',
				email: 'bob@example.com',
				role: 'user',
				source: 'ldap',
				directoryUsername: 'bob',
				adminDeactivatedAt: null,
				adminDeactivatedBy: null,
				directoryDeactivatedAt: at,
				createdAt: at,
				updatedAt: at,
			}),
		).toMatchObject({
			source: 'ldap',
			directoryUsername: 'bob',
			active: false,
			adminDeactivation: null,
			directoryDeactivation: { at: '2026-10-10T08:00:00.000Z' },
		})
	})

	it('reads the source under the lock', () => {
		expect(lockTarget(drizzle.mock(), 'u9').toSQL().sql).toMatch(
			/^select [^]*`source`[^]* from `users` /,
		)
	})

	/** A database whose transaction answers the locking read with `target` and records updates. */
	const withTarget = (target: {
		id: string
		role: 'user' | 'admin' | 'owner'
		adminDeactivatedAt: null
		source: 'local' | 'ldap'
	}) => {
		const updates: { values: unknown; condition: SQL }[] = []
		const tx = {
			select: () => ({
				from: () => ({
					where: () => ({
						// The locking read (lockTarget) ends in .for('update'); a plain read (the email check) awaits
						// .limit() itself and finds the email free, so a refusal that came too late would reach the write.
						limit: () =>
							Object.assign(Promise.resolve([]), {
								for: (strength: string) =>
									strength === 'update'
										? Promise.resolve([target])
										: Promise.reject(new Error(strength)),
							}),
					}),
				}),
			}),
			update: () => ({
				set: (values: unknown) => ({
					where: (condition: SQL) => {
						updates.push({ values, condition })
						return Promise.resolve([{ affectedRows: 1 }])
					},
				}),
			}),
		}
		database.value = {
			// The plain read before the hash finds the same account; nothing outside the transaction writes.
			select: () => ({
				from: () => ({ where: () => ({ limit: () => Promise.resolve([target]) }) }),
			}),
			transaction: (work: (t: typeof tx) => unknown) => work(tx),
		}
		return updates
	}

	afterEach(() => {
		database.value = undefined
		hashPassword.mockClear()
	})

	it('refuses the full edit of a directory account, before any hash work or write', async () => {
		const updates = withTarget({ id: 'd1', role: 'user', adminDeactivatedAt: null, source: 'ldap' })
		expect(
			await updateUser({ id: 'o1', email: 'o@e.com', name: null, role: 'owner' }, 'd1', {
				name: 'N',
				email: 'n@e.com',
				role: 'user',
				password: 'password-1',
			}),
		).toEqual({ ok: false, code: 'forbidden' })
		expect(hashPassword).not.toHaveBeenCalled()
		expect(updates).toEqual([])
		// Without a password, the locked row refuses it as well.
		expect(
			await updateUser({ id: 'o1', email: 'o@e.com', name: null, role: 'owner' }, 'd1', {
				name: 'N',
				email: 'n@e.com',
				role: 'user',
			}),
		).toEqual({ ok: false, code: 'forbidden' })
		expect(updates).toEqual([])
	})

	it('changes only the role, under the rank map', async () => {
		const owner = { id: 'o1', email: 'o@e.com', name: null, role: 'owner' as const }
		let updates = withTarget({ id: 'd1', role: 'user', adminDeactivatedAt: null, source: 'ldap' })
		expect(await updateUserRole(owner, 'd1', 'admin')).toEqual({ ok: true, data: undefined })
		expect(updates.map(update => update.values)).toEqual([{ role: 'admin' }])

		// An admin cannot promote (ADR-0024's rank map) and cannot change its own role.
		const anAdmin = { id: 'a1', email: 'a@e.com', name: null, role: 'admin' as const }
		updates = withTarget({ id: 'd1', role: 'user', adminDeactivatedAt: null, source: 'ldap' })
		expect(await updateUserRole(anAdmin, 'd1', 'admin')).toEqual({ ok: false, code: 'forbidden' })
		expect(updates).toEqual([])
		updates = withTarget({ id: 'a1', role: 'admin', adminDeactivatedAt: null, source: 'ldap' })
		expect(await updateUserRole(anAdmin, 'a1', 'user')).toEqual({ ok: false, code: 'forbidden' })
		expect(updates).toEqual([])
	})

	it('refuses your own row outright, even with the role it has (ADR-0024 decision c)', async () => {
		const owner = { id: 'o1', email: 'o@e.com', name: null, role: 'owner' as const }
		const anAdmin = { id: 'a1', email: 'a@e.com', name: null, role: 'admin' as const }
		// Same-role inputs, which updateRefusal lets through for updateUser's own-name edit: here nothing is written.
		let updates = withTarget({ id: 'a1', role: 'admin', adminDeactivatedAt: null, source: 'ldap' })
		expect(await updateUserRole(anAdmin, 'a1', 'admin')).toEqual({ ok: false, code: 'forbidden' })
		expect(updates).toEqual([])
		updates = withTarget({ id: 'o1', role: 'owner', adminDeactivatedAt: null, source: 'local' })
		expect(await updateUserRole(owner, 'o1', 'owner')).toEqual({ ok: false, code: 'forbidden' })
		expect(updates).toEqual([])
	})

	it('answers not_found for an unknown id before the hash', async () => {
		database.value = {
			// The plain read before the hash finds no account; the transaction is never reached.
			select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
			transaction: () => Promise.reject(new Error('no transaction for an unknown id')),
		}
		expect(
			await updateUser({ id: 'o1', email: 'o@e.com', name: null, role: 'owner' }, 'gone', {
				name: 'N',
				email: 'n@e.com',
				role: 'user',
				password: 'password-1',
			}),
		).toEqual({ ok: false, code: 'not_found' })
		expect(hashPassword).not.toHaveBeenCalled()
	})
})
