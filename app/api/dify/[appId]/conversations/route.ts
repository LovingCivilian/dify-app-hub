import type { NextRequest } from 'next/server'

import { difyJson, errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { conversationsQuery, parseQuery } from '@/lib/dify/schemas'

/** GET /conversations?last_id=&limit=&sort_by= (endpoint map §1.2). */
export async function GET(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/conversations'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, conversationsQuery)
	if (!query.ok) return query.response
	try {
		return difyJson(await resolved.ctx.dify.listConversations(query.data, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/conversations')
	}
}
