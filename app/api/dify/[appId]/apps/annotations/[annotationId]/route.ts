import type { NextRequest } from 'next/server'

import { hasAdminRights } from '@/lib/auth/roles'
import {
	jsonNoStore,
	errorResponseFrom,
	forbiddenResponse,
	resolveDifyRoute,
} from '@/lib/providers/dify/route'
import { annotationBody } from '@/lib/providers/dify/schemas'
import { parseJsonBody, parsePathParams } from '@/lib/http/parse'

/** PUT /apps/annotations/{annotation_id}. Admin rights only: the owner or an admin (charter §4.1). */
export async function PUT(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/apps/annotations/[annotationId]'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	if (!hasAdminRights(resolved.ctx.actor)) return forbiddenResponse()
	const segments = await parsePathParams(ctx.params, 'annotationId')
	if (!segments.ok) return segments.response
	const body = await parseJsonBody(request, annotationBody)
	if (!body.ok) return body.response
	try {
		return jsonNoStore(
			await resolved.ctx.dify.updateAnnotation(segments.data.annotationId, body.data),
		)
	} catch (error) {
		return errorResponseFrom(error, 'PUT /api/dify/[appId]/apps/annotations/[annotationId]')
	}
}

/** DELETE /apps/annotations/{annotation_id}: 204. Admin rights only: the owner or an admin (charter §4.1). */
export async function DELETE(
	_request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/apps/annotations/[annotationId]'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	if (!hasAdminRights(resolved.ctx.actor)) return forbiddenResponse()
	const segments = await parsePathParams(ctx.params, 'annotationId')
	if (!segments.ok) return segments.response
	try {
		await resolved.ctx.dify.deleteAnnotation(segments.data.annotationId)
		return new Response(null, { status: 204 })
	} catch (error) {
		return errorResponseFrom(error, 'DELETE /api/dify/[appId]/apps/annotations/[annotationId]')
	}
}
