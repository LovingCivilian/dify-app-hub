import 'server-only'

import { count, desc, eq, sql } from 'drizzle-orm'

import { getDb, type Db } from '@/db'
import { passwordResetTokens, users } from '@/db/schema'
import { fail, ok, type ActionErrorCode, type ActionResult } from '@/lib/action-result'
import { hashPassword } from '@/lib/auth/password'
import { canManage, type Role } from '@/lib/auth/roles'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'

/*
 * The users Data Access Layer (charter §4.2). Every function takes the verified actor first and checks its role
 * itself, applies the rank (ADR-0024: the owner manages admins and users, an admin manages users),
 * answers the app's own result codes for expected refusals, and returns DTOs, never the password hash. The rules
 * are pure functions below with their own tests; the SQL runs in the e2e suite.
 */

type UserRow = typeof users.$inferSelect
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export interface UserDto {
	id: string
	name: string | null
	email: string
	role: Role
	createdAt: string
	updatedAt: string
}

/** What the users drawer sends (validated by the action's schema); no password means "keep the current one". */
export interface UserInput {
	name: string
	email: string
	role: Role
	password?: string
}

/** The columns the DTO reads: never the hash or the session version. */
const dtoColumns = {
	id: users.id,
	name: users.name,
	email: users.email,
	role: users.role,
	createdAt: users.createdAt,
	updatedAt: users.updatedAt,
}

export const toUserDto = (
	row: Pick<UserRow, 'id' | 'name' | 'email' | 'role' | 'createdAt' | 'updatedAt'>,
): UserDto => ({
	id: row.id,
	name: row.name,
	email: row.email,
	role: row.role,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
})

/** Who may create which role (ADR-0024): only a role the actor's rank manages; nobody creates an owner. */
export const createRefusal = ({
	actorRole,
	role,
}: {
	actorRole: Role
	role: Role
}): ActionErrorCode | null => (canManage(actorRole, role) ? null : 'forbidden')

/**
 * Who may change what (charter §4.2, ADR-0024). Your own row: name and email only; the role is fixed and the
 * password changes through the account menu with the current one (decisions b, c). Another account: only one
 * whose role the actor's rank manages, and only to a role it manages.
 */
export const updateRefusal = ({
	actor,
	target,
	input,
}: {
	actor: { id: string; role: Role }
	target: { id: string; role: Role }
	input: Pick<UserInput, 'role' | 'password'>
}): ActionErrorCode | null => {
	if (target.id === actor.id)
		return input.password || input.role !== target.role ? 'forbidden' : null
	if (!canManage(actor.role, target.role)) return 'forbidden'
	if (!canManage(actor.role, input.role)) return 'forbidden'
	return null
}

/** Nobody deletes themselves (charter §4.2), and only an account whose role the actor's rank manages: never the owner. */
export const deleteRefusal = ({
	actor,
	target,
}: {
	actor: { id: string; role: Role }
	target: { id: string; role: Role }
}): ActionErrorCode | null => {
	if (target.id === actor.id) return 'cannot_delete_self'
	return canManage(actor.role, target.role) ? null : 'forbidden'
}

const codeOf = (value: unknown) =>
	typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined

/**
 * MySQL's duplicate-key error (1062 ER_DUP_ENTRY) as mysql2 reports it, bare or as the cause of Drizzle's
 * DrizzleQueryError: the unique email index refused a write that raced the check before it.
 */
export const isDuplicateEntry = (error: unknown): boolean =>
	codeOf(error) === 'ER_DUP_ENTRY' ||
	(error instanceof Error && codeOf(error.cause) === 'ER_DUP_ENTRY')

/**
 * A locking read of one account by its primary key (decision d; MySQL "Locking Reads": SELECT … FOR UPDATE). A
 * concurrent change to the same account, such as the owner promoting a user an admin is editing, waits and is then
 * read, so the rank is never checked against a stale role. One row, for the few milliseconds the transaction lasts;
 * consistent reads such as sign-in do not wait.
 */
export const lockTarget = (tx: Pick<Tx, 'select'>, id: string) =>
	tx
		.select({ id: users.id, role: users.role })
		.from(users)
		.where(eq(users.id, id))
		.limit(1)
		.for('update')

const emailTakenBy = (tx: Pick<Tx, 'select'>, email: string) =>
	tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)

export async function listUsers(actor: SessionUser): Promise<UserDto[]> {
	assertAdmin(actor)
	const rows = await getDb().select(dtoColumns).from(users).orderBy(desc(users.createdAt))
	return rows.map(toUserDto)
}

export async function createUser(
	actor: SessionUser,
	input: UserInput & { password: string },
): Promise<ActionResult<{ id: string }>> {
	assertAdmin(actor)
	const refusal = createRefusal({ actorRole: actor.role, role: input.role })
	if (refusal) return fail(refusal)
	const db = getDb()
	const [taken] = await emailTakenBy(db, input.email)
	if (taken) return fail('email_in_use')
	const id = crypto.randomUUID()
	try {
		await db.insert(users).values({
			id,
			name: input.name,
			email: input.email,
			password: await hashPassword(input.password),
			role: input.role,
		})
	} catch (error) {
		if (isDuplicateEntry(error)) return fail('email_in_use')
		throw error
	}
	return ok({ id })
}

/**
 * Updates name, email and, for an account the actor's rank manages, the role and the password: a password set here
 * revokes that account's sessions (sessionVersion + 1; charter §4.2 "a password change revokes every session").
 */
export async function updateUser(
	actor: SessionUser,
	id: string,
	input: UserInput,
): Promise<ActionResult> {
	assertAdmin(actor)
	// Hashed before the transaction so the row lock is held for the queries only.
	const passwordHash = input.password ? await hashPassword(input.password) : undefined
	try {
		return await getDb().transaction(async tx => {
			const [target] = await lockTarget(tx, id)
			if (!target) return fail('not_found')
			const refusal = updateRefusal({ actor, target, input })
			if (refusal) return fail(refusal)
			const [taken] = await emailTakenBy(tx, input.email)
			if (taken && taken.id !== id) return fail('email_in_use')
			await tx
				.update(users)
				.set({
					name: input.name,
					email: input.email,
					role: input.role,
					...(passwordHash
						? { password: passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` }
						: {}),
				})
				.where(eq(users.id, id))
			return ok(undefined)
		})
	} catch (error) {
		if (isDuplicateEntry(error)) return fail('email_in_use')
		throw error
	}
}

/** Deletes an account the actor's rank manages, and its reset tokens (decision e). */
export async function deleteUser(actor: SessionUser, id: string): Promise<ActionResult> {
	assertAdmin(actor)
	return getDb().transaction(async tx => {
		const [target] = await lockTarget(tx, id)
		if (!target) return fail('not_found')
		const refusal = deleteRefusal({ actor, target })
		if (refusal) return fail(refusal)
		await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, id))
		await tx.delete(users).where(eq(users.id, id))
		return ok(undefined)
	})
}

/** Whether any account exists (the /init page's check). Replaced by lib/data/setup.ts hasAccounts in Task 6. */
export async function hasUsers() {
	const [row] = await getDb().select({ count: count() }).from(users)
	return (row?.count ?? 0) > 0
}
