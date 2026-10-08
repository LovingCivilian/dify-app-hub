import type { NextRequest } from 'next/server'

import { passthrough } from '@/lib/dify/client'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { chatMessagesBody, parseJsonBody } from '@/lib/dify/schemas'

/** POST /chat-messages (endpoint map §1.2): the stream passes through; a blocking answer is JSON and passes through too. */
export async function POST(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/chat-messages'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, chatMessagesBody)
	if (!body.ok) return body.response
	try {
		const { dify, user } = resolved.ctx
		// The client's abort (a stopped reply) cancels the upstream fetch through the request's signal.
		return passthrough(await dify.chatMessages(body.data, user, request.signal))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/chat-messages')
	}
}
