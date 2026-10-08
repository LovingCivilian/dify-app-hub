import type { NextRequest } from 'next/server'

import { difyJson, errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { annotationBody, annotationsQuery, parseJsonBody, parseQuery } from '@/lib/dify/schemas'

/** GET /apps/annotations?page=&limit=&keyword= (endpoint map §1.7). Admin-only from B2 on (charter §4.1). */
export async function GET(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/apps/annotations'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, annotationsQuery)
	if (!query.ok) return query.response
	try {
		return difyJson(await resolved.ctx.dify.listAnnotations(query.data))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/apps/annotations')
	}
}

/**
 * POST /apps/annotations: Dify answers 201. B1 requires a signed-in user only; the role gate and the app's
 * annotation setting are B2's to decide.
 */
export async function POST(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/apps/annotations'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, annotationBody)
	if (!body.ok) return body.response
	try {
		return difyJson(await resolved.ctx.dify.createAnnotation(body.data), { status: 201 })
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/apps/annotations')
	}
}
