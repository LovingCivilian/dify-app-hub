import type { NextRequest } from 'next/server'
import * as z from 'zod'

import { directoryGroupSearchSchema } from '@/app/(admin)/group-management/schemas'
import { hasAdminRights } from '@/lib/auth/roles'
import { verifySession } from '@/lib/auth/session'
import { difyErrorResponse, forbiddenResponse } from '@/lib/dify/errors'
import { difyJson } from '@/lib/dify/response'
import { parseQuery } from '@/lib/dify/schemas'
import { searchDirectoryGroups } from '@/lib/directory/admin'
import { DirectoryRefusedError, DirectoryUnavailableError } from '@/lib/directory/errors'
import { logActionError } from '@/lib/error-log'

const CONTEXT = 'GET /api/directory/groups'

/** Decision al: `?q=`, the text an admin types, trimmed and 2–64 characters long. */
const searchQuery = z.object({ q: directoryGroupSearchSchema })

/**
 * GET /api/directory/groups?q= (B3 spec §6.5 "Linking", decision al): the directory groups whose name contains the
 * text, for the groups page's search. A read, so a Route Handler and not a Server Action (react.dev `'use server'`:
 * "not recommended for data fetching"; Next `02-guides/backend-for-frontend.md`: Server Actions "are queued. Using them
 * for data fetching introduces sequential execution"). The handler verifies the session and the role itself (the
 * backend-for-frontend guide: "Do not rely on proxy alone"), then the input, in the Dify routes' order; it answers the
 * app's envelope (ADR-0023) with no-store, and only `{ key, name }` per group.
 */
export async function GET(request: NextRequest) {
	try {
		const actor = await verifySession()
		if (!actor) return difyErrorResponse('unauthorized', 'Sign in required.', 401)
		if (!hasAdminRights(actor)) return forbiddenResponse()
		const query = parseQuery(request.nextUrl.searchParams, searchQuery)
		if (!query.ok) return query.response
		const groups = await searchDirectoryGroups(actor, query.data.q)
		if (groups === null)
			return difyErrorResponse('directory_off', 'The directory is not configured.', 409)
		return difyJson(groups.map(({ key, name }) => ({ key, name })))
	} catch (error) {
		// Logged by name and LDAP result code, never the directory's own text (lib/error-log.ts; spec §7.3).
		logActionError(error, CONTEXT)
		// Decision u: a directory that does not answer, or refuses the connection, is unreachable.
		if (error instanceof DirectoryUnavailableError || error instanceof DirectoryRefusedError)
			return difyErrorResponse('directory_unavailable', 'The directory is unreachable.', 503)
		return difyErrorResponse('internal_error', 'Internal Server Error', 500)
	}
}
