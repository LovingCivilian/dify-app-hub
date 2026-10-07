import type { NextRequest } from 'next/server'

import { passthrough } from '@/lib/dify/client'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parsePathParams, parseQuery, workflowEventsQuery } from '@/lib/dify/schemas'

/** GET /workflow/{workflow_run_id}/events (Dify's singular path; endpoint map §1.4): the resumed run's stream. */
export async function GET(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/workflow/[workflowRunId]/events'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const segments = await parsePathParams(ctx.params, 'workflowRunId')
	if (!segments.ok) return segments.response
	const query = parseQuery(request.nextUrl.searchParams, workflowEventsQuery)
	if (!query.ok) return query.response
	try {
		return passthrough(
			await resolved.ctx.dify.workflowEvents(
				segments.data.workflowRunId,
				resolved.ctx.user,
				query.data,
				request.signal,
			),
		)
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/workflow/[workflowRunId]/events')
	}
}
