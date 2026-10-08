/**
 * The account roles (charter §4.2 "Roles", ADR-0024): the owner (the account /init creates, exactly one)
 * and an admin run the admin surface, a user chats. Client-safe on purpose: the schema, the zod inputs, the
 * session types and the users table all read it.
 */
export const ROLES = ['owner', 'admin', 'user'] as const

export type Role = (typeof ROLES)[number]

export const isRole = (value: unknown): value is Role =>
	typeof value === 'string' && (ROLES as readonly string[]).includes(value)

/** The admin surface (apps, annotations, the users table): the owner and an admin. */
export const hasAdminRights = (who: { role: Role }): boolean =>
	who.role === 'owner' || who.role === 'admin'

/**
 * Who manages whom: the roles an account of each role may create, edit, delete, give a password to, or give.
 * Strictly below its own rank, and the owner role is in no list, so only /init creates an owner. The shape of
 * documenso's TEAM_MEMBER_ROLE_HIERARCHY (packages/lib/constants/teams.ts), which also lets a role manage its own.
 */
export const MANAGEABLE_ROLES: Readonly<Record<Role, readonly Role[]>> = {
	owner: ['admin', 'user'],
	admin: ['user'],
	user: [],
}

export const canManage = (actor: Role, target: Role): boolean =>
	MANAGEABLE_ROLES[actor].includes(target)
