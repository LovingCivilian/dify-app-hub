import type { NextRequest } from 'next/server'

import { passthrough } from '@/lib/providers/dify/client'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/providers/dify/route'
import { workflowRunBody } from '@/lib/providers/dify/schemas'
import { parseJsonBody } from '@/lib/http/parse'

/** POST /workflows/run (endpoint map §1.4). */
export async function POST(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/workflows/run'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, workflowRunBody)
	if (!body.ok) return body.response
	try {
		return passthrough(
			await resolved.ctx.dify.runWorkflow(body.data, resolved.ctx.user, request.signal),
		)
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/workflows/run')
	}
}
