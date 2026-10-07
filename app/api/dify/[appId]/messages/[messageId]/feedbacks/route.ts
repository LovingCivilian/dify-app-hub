import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { feedbackBody, parseJsonBody } from '@/lib/dify/schemas'

/** POST /messages/{message_id}/feedbacks: `{ rating, content }`, user set here; answers `{ result: "success" }`. */
export async function POST(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/messages/[messageId]/feedbacks'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, feedbackBody)
	if (!body.ok) return body.response
	try {
		const { messageId } = await ctx.params
		return Response.json(
			await resolved.ctx.dify.createFeedback(messageId, body.data, resolved.ctx.user),
		)
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/messages/[messageId]/feedbacks')
	}
}
