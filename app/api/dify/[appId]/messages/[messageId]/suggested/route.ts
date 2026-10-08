import type { NextRequest } from 'next/server'

import { difyJson, errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parsePathParams } from '@/lib/dify/schemas'

/** GET /messages/{message_id}/suggested. */
export async function GET(
	_request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/messages/[messageId]/suggested'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const segments = await parsePathParams(ctx.params, 'messageId')
	if (!segments.ok) return segments.response
	try {
		return difyJson(
			await resolved.ctx.dify.getSuggested(segments.data.messageId, resolved.ctx.user),
		)
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/messages/[messageId]/suggested')
	}
}
