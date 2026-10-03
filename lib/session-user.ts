import { getServerSession } from 'next-auth/next'
import { NextResponse } from 'next/server'

import { authOptions } from '@/lib/auth'

/**
 * The signed-in account's email, used as the Dify end-user id. Null without a session.
 * Route handlers must use this, never the browser-supplied `user` value.
 *
 * A revoked JWT (sessionVersion mismatch after a password reset) still decodes,
 * so getServerSession returns a session for it; the session callback in
 * lib/auth.ts only sets user.id for a live token, so a missing id means revoked.
 */
export async function getSessionUserId(): Promise<string | null> {
	const session = await getServerSession(authOptions)
	if (!session?.user?.id) return null
	return session.user.email ?? null
}

export function unauthorizedResponse() {
	return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
