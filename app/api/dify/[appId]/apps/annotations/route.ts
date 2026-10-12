import type { NextRequest } from 'next/server'

import { hasAdminRights } from '@/lib/auth/roles'
import {
	jsonNoStore,
	errorResponseFrom,
	forbiddenResponse,
	resolveDifyRoute,
} from '@/lib/providers/dify/route'
import { annotationBody, annotationsQuery } from '@/lib/providers/dify/schemas'
import { parseJsonBody, parseQuery } from '@/lib/http/parse'

/**
 * GET /apps/annotations?page=&limit=&keyword= (endpoint map §1.7). Admin rights only: the owner or an admin
 * (charter §4.1).
 */
export async function GET(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/apps/annotations'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	if (!hasAdminRights(resolved.ctx.actor)) return forbiddenResponse()
	const query = parseQuery(request.nextUrl.searchParams, annotationsQuery)
	if (!query.ok) return query.response
	try {
		return jsonNoStore(await resolved.ctx.dify.listAnnotations(query.data))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/apps/annotations')
	}
}

/**
 * POST /apps/annotations: Dify answers 201. The owner or an admin may always create; a user-role account only
 * where the app enables annotations (the chat's "annotate", charter §4.1).
 */
export async function POST(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/apps/annotations'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	if (!hasAdminRights(resolved.ctx.actor) && !resolved.ctx.annotationEnabled)
		return forbiddenResponse()
	const body = await parseJsonBody(request, annotationBody)
	if (!body.ok) return body.response
	try {
		return jsonNoStore(await resolved.ctx.dify.createAnnotation(body.data), { status: 201 })
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/apps/annotations')
	}
}
