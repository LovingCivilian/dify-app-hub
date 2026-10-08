import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parsePathParams } from '@/lib/dify/schemas'

/** DELETE /conversations/{conversation_id}: Dify answers 204, and so does this route. */
export async function DELETE(
	_request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/conversations/[conversationId]'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const segments = await parsePathParams(ctx.params, 'conversationId')
	if (!segments.ok) return segments.response
	try {
		await resolved.ctx.dify.deleteConversation(segments.data.conversationId, resolved.ctx.user)
		return new Response(null, { status: 204 })
	} catch (error) {
		return errorResponseFrom(error, 'DELETE /api/dify/[appId]/conversations/[conversationId]')
	}
}
