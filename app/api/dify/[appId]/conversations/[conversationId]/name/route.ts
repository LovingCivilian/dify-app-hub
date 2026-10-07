import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parseJsonBody, renameConversationBody } from '@/lib/dify/schemas'

/** POST /conversations/{conversation_id}/name: `{ name }` or `{ auto_generate: true }`; answers the conversation. */
export async function POST(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/conversations/[conversationId]/name'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, renameConversationBody)
	if (!body.ok) return body.response
	try {
		const { conversationId } = await ctx.params
		return Response.json(
			await resolved.ctx.dify.renameConversation(conversationId, body.data, resolved.ctx.user),
		)
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/conversations/[conversationId]/name')
	}
}
