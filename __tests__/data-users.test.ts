import { drizzle } from 'drizzle-orm/mysql2'
import { DrizzleQueryError } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => ({
	getDb: () => {
		throw new Error('not used by the pure tests')
	},
}))

import {
	createRefusal,
	createUser,
	deleteRefusal,
	deleteUser,
	isDuplicateEntry,
	listUserOptions,
	listUsers,
	lockTarget,
	toUserDto,
	updateRefusal,
	updateUser,
} from '@/lib/data/users'

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
				createdAt: at,
				updatedAt: at,
			}),
		).toEqual({
			id: 'u1',
			name: null,
			email: 'a@b.c',
			role: 'admin',
			createdAt: '2026-01-15T09:05:00.000Z',
			updatedAt: '2026-01-15T09:05:00.000Z',
		})
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
		expect(query.params).toEqual(['u9', 1])
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
	] as const)('%s', async (_name, call) => {
		await expect(call()).rejects.toMatchObject({ name: 'AuthError', code: 'forbidden' })
	})
})
