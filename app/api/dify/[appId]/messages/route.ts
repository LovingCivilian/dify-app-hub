import type { NextRequest } from 'next/server'

import { difyJson, errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { messagesQuery, parseQuery } from '@/lib/dify/schemas'

/** GET /messages?conversation_id=&first_id=&limit= (endpoint map §1.2). */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/messages'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, messagesQuery)
	if (!query.ok) return query.response
	try {
		return difyJson(await resolved.ctx.dify.listMessages(query.data, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/messages')
	}
}
