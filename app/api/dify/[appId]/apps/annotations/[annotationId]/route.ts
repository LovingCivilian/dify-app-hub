import type { NextRequest } from 'next/server'

import { difyJson, errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { annotationBody, parseJsonBody, parsePathParams } from '@/lib/dify/schemas'

/** PUT /apps/annotations/{annotation_id}. Admin-only from B2 on. */
export async function PUT(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/apps/annotations/[annotationId]'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const segments = await parsePathParams(ctx.params, 'annotationId')
	if (!segments.ok) return segments.response
	const body = await parseJsonBody(request, annotationBody)
	if (!body.ok) return body.response
	try {
		return difyJson(await resolved.ctx.dify.updateAnnotation(segments.data.annotationId, body.data))
	} catch (error) {
		return errorResponseFrom(error, 'PUT /api/dify/[appId]/apps/annotations/[annotationId]')
	}
}

/** DELETE /apps/annotations/{annotation_id}: 204. Admin-only from B2 on. */
export async function DELETE(
	_request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/apps/annotations/[annotationId]'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const segments = await parsePathParams(ctx.params, 'annotationId')
	if (!segments.ok) return segments.response
	try {
		await resolved.ctx.dify.deleteAnnotation(segments.data.annotationId)
		return new Response(null, { status: 204 })
	} catch (error) {
		return errorResponseFrom(error, 'DELETE /api/dify/[appId]/apps/annotations/[annotationId]')
	}
}
