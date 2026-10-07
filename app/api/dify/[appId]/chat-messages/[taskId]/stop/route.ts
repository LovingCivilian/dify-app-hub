import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parsePathParams } from '@/lib/dify/schemas'

/** POST /chat-messages/{task_id}/stop: the body carries only `user`, which the route sets. */
export async function POST(
	_request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/chat-messages/[taskId]/stop'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const segments = await parsePathParams(ctx.params, 'taskId')
	if (!segments.ok) return segments.response
	try {
		return Response.json(await resolved.ctx.dify.stopChat(segments.data.taskId, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/chat-messages/[taskId]/stop')
	}
}
