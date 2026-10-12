import type { NextRequest } from 'next/server'

import { passthrough } from '@/lib/providers/dify/client'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/providers/dify/route'
import { completionBody } from '@/lib/providers/dify/schemas'
import { parseJsonBody } from '@/lib/http/parse'

/** POST /completion-messages (endpoint map §1.3). */
export async function POST(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/completion-messages'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, completionBody)
	if (!body.ok) return body.response
	try {
		return passthrough(
			await resolved.ctx.dify.completionMessages(body.data, resolved.ctx.user, request.signal),
		)
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/completion-messages')
	}
}
