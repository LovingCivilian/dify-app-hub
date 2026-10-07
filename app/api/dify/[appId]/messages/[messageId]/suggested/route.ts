import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'

/** GET /messages/{message_id}/suggested. */
export async function GET(
	_request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/messages/[messageId]/suggested'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	try {
		const { messageId } = await ctx.params
		return Response.json(await resolved.ctx.dify.getSuggested(messageId, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/messages/[messageId]/suggested')
	}
}
