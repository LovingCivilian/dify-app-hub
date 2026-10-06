import 'server-only'

import { count, desc } from 'drizzle-orm'

import { getDb } from '@/db'
import { users } from '@/db/schema'

/**
 * Reads for the server pages (spec §3.2). Not a 'use server' module, so nothing here is an endpoint; the
 * route handlers keep their own copies of these queries until the backend rework folds them together.
 */
export async function listUsers() {
	return getDb()
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			createdAt: users.createdAt,
			updatedAt: users.updatedAt,
		})
		.from(users)
		.orderBy(desc(users.createdAt))
}

/** Whether the first admin exists (the /init page's check; the same count as /api/init/status). */
export async function hasUsers() {
	const [row] = await getDb().select({ count: count() }).from(users)
	return (row?.count ?? 0) > 0
}
