import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { feedbackBody, parseJsonBody, parsePathParams } from '@/lib/dify/schemas'

/** POST /messages/{message_id}/feedbacks: `{ rating, content }`, user set here; answers `{ result: "success" }`. */
export async function POST(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/messages/[messageId]/feedbacks'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const segments = await parsePathParams(ctx.params, 'messageId')
	if (!segments.ok) return segments.response
	const body = await parseJsonBody(request, feedbackBody)
	if (!body.ok) return body.response
	try {
		return Response.json(
			await resolved.ctx.dify.createFeedback(segments.data.messageId, body.data, resolved.ctx.user),
		)
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/messages/[messageId]/feedbacks')
	}
}
