import type { NextRequest } from 'next/server'

import { resolveChatRoute } from '@/lib/chat/route'
import { conversationsQuerySchema } from '@/lib/chat/schemas'
import { decodeListCursor, LIST_PAGE_MAX, listConversations } from '@/lib/data/conversations'
import { errorResponse, errorResponseFrom } from '@/lib/http/errors'
import { parseQuery } from '@/lib/http/parse'
import { jsonNoStore } from '@/lib/http/response'

/**
 * GET conversations (spec §4.2): the actor's conversations of this app, newest first, keyset-paged on (updated_at, id),
 * not deleted; the newest LIST_PAGE_MAX (plan call P8). A cursor the DAL cannot read answers 400, as any refused query.
 */
export async function GET(
	request: NextRequest,
	ctx: RouteContext<'/api/apps/[appId]/conversations'>,
) {
	const resolved = await resolveChatRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, conversationsQuerySchema)
	if (!query.ok) return query.response
	const { cursor } = query.data
	if (cursor !== undefined && !decodeListCursor(cursor))
		return errorResponse('invalid_param', 'Invalid request: cursor', 400)
	try {
		const { actor, app } = resolved
		return jsonNoStore(await listConversations(actor, app.id, { cursor, limit: LIST_PAGE_MAX }))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/apps/[appId]/conversations')
	}
}
