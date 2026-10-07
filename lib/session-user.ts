// Temporary: the old app/api/client/** routes use these names until Task 17 deletes both. New code imports lib/auth/session.
import { NextResponse } from 'next/server'

import { requireUser, verifySession } from '@/lib/auth/session'

export { getCachedServerSession, redirectSignedInUser } from '@/lib/auth/session'

export async function getSessionUserId(): Promise<string | null> {
	return (await verifySession())?.email ?? null
}

export function unauthorizedResponse() {
	return NextResponse.json(
		{ code: 'unauthorized', message: 'Sign in required.', status: 401 },
		{ status: 401 },
	)
}

export async function requireSessionUser(): Promise<void> {
	await requireUser()
}
