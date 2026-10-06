import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { cache } from 'react'

import { authOptions } from '@/lib/auth'

/**
 * One getServerSession per request: the root layout (SessionProvider) and a group layout
 * (requireSessionUser) both need it. React's cache() dedupes within a server render and never
 * outlives the request.
 */
export const getCachedServerSession = cache(() => getServerSession(authOptions))

/**
 * The signed-in account's email, used as the Dify end-user id. Null without a session.
 * Route handlers must use this, never the browser-supplied `user` value.
 *
 * A revoked JWT (sessionVersion mismatch after a password reset) still decodes,
 * so getServerSession returns a session for it; the session callback in
 * lib/auth.ts only sets user.id for a live token, so a missing id means revoked.
 */
export async function getSessionUserId(): Promise<string | null> {
	const session = await getCachedServerSession()
	if (!session?.user?.id) return null
	return session.user.email ?? null
}

export function unauthorizedResponse() {
	return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

/**
 * For the login-adjacent pages: a visitor with a live session is sent on to
 * the app instead of seeing the form. Call it from the page's server layout,
 * outside any try/catch, since redirect() works by throwing.
 */
export async function redirectSignedInUser(to = '/apps'): Promise<void> {
	const session = await getCachedServerSession()
	if (session?.user?.id) redirect(to)
}

// ADR-0018: route groups gate on the server; the proxy gates navigations — docs/decisions/0018-gate-route-groups-on-the-server.md
/**
 * For the (user) and (admin) group layouts: a visitor without a live session goes to the login
 * page, so the shells render on the server for everyone who stays. The proxy already redirects
 * signed-out page requests with a callbackUrl (a layout cannot read the pathname, Next docs:
 * layout.md "Pathname"); this catches revoked JWTs, which decode but carry no user.id, and
 * replaces the client-side gates. Call it outside any try/catch, since redirect() throws.
 */
export async function requireSessionUser(): Promise<void> {
	const session = await getCachedServerSession()
	if (!session?.user?.id) redirect('/login')
}
