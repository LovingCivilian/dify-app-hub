import 'server-only'

import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import { authOptions } from './options'
import { hasAdminRights, isRole, type Role } from './roles'

/** The signed-in account as the server code sees it; `id` is the Dify end-user id (ADR-0026). */
export interface SessionUser {
	id: string
	email: string
	name: string | null
	role: Role
}

export type AuthErrorCode = 'unauthorized' | 'forbidden'

/** Thrown by requireActor, requireAdmin and assertAdmin; actions map it to their result code. */
export class AuthError extends Error {
	constructor(public readonly code: AuthErrorCode) {
		super(code)
		this.name = 'AuthError'
	}
}

/**
 * One getServerSession per server render: the root layout (SessionProvider) and a group layout or page share
 * it (React cache dedupes within a render pass; it does not dedupe inside Route Handlers, which call it once).
 */
export const getCachedServerSession = cache(() => getServerSession(authOptions))

/**
 * The signed-in account, or null: no session, or a revoked JWT, which decodes but carries no user.id
 * (lib/auth/options.ts jwt callback; ADR-0018), or a session without a known role (lib/auth/roles.ts isRole).
 */
export async function verifySession(): Promise<SessionUser | null> {
	const session = await getCachedServerSession()
	const user = session?.user
	if (!user?.id || !user.email || !isRole(user.role)) return null
	return { id: user.id, email: user.email, name: user.name ?? null, role: user.role }
}

/**
 * For layouts and pages: the account, or a redirect to /login. The proxy already redirects signed-out page
 * requests with a callbackUrl (a layout cannot read the pathname); this catches revoked JWTs. Call it outside
 * any try/catch, since redirect() works by throwing (ADR-0018).
 */
export async function requireUser(): Promise<SessionUser> {
	const user = await verifySession()
	if (!user) redirect('/login')
	return user
}

/**
 * For the (admin) layout and pages (charter §4.2): an account with admin rights, the owner or an admin; anyone
 * else signed in goes to /apps, a visitor without a live session to /login. Call it outside any try/catch, since
 * redirect() works by throwing.
 */
export async function requireAdminUser(): Promise<SessionUser> {
	const user = await requireUser()
	if (!hasAdminRights(user)) redirect('/apps')
	return user
}

/** For Server Actions and the DAL's callers: the account, or AuthError('unauthorized') (charter §4.2). */
export async function requireActor(): Promise<SessionUser> {
	const user = await verifySession()
	if (!user) throw new AuthError('unauthorized')
	return user
}

/**
 * The DAL's own role check (charter §4.2: the entry point verified the session; an admin-only DAL function
 * still refuses an actor without admin rights, the owner or an admin, whoever called it).
 */
export function assertAdmin(actor: SessionUser): void {
	if (!hasAdminRights(actor)) throw new AuthError('forbidden')
}

/** For admin Server Actions: the owner or an admin, or AuthError('unauthorized' | 'forbidden') (Next authentication guide: session, then role). */
export async function requireAdmin(): Promise<SessionUser> {
	const actor = await requireActor()
	assertAdmin(actor)
	return actor
}

/** For the login-adjacent pages: a visitor with a live session is sent on instead of seeing the form. */
export async function redirectSignedInUser(to = '/apps'): Promise<void> {
	if (await verifySession()) redirect(to)
}
