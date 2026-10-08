import type { NextRequest } from 'next/server'

import { filePassthrough } from '@/lib/dify/client'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { filePreviewQuery, parsePathParams, parseQuery } from '@/lib/dify/schemas'

/** GET /files/{file_id}/preview?as_attachment= : the binary with its type and disposition (endpoint map §1.6). */
export async function GET(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/files/[fileId]/preview'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const segments = await parsePathParams(ctx.params, 'fileId')
	if (!segments.ok) return segments.response
	const query = parseQuery(request.nextUrl.searchParams, filePreviewQuery)
	if (!query.ok) return query.response
	try {
		return filePassthrough(
			await resolved.ctx.dify.filePreview(
				segments.data.fileId,
				query.data.as_attachment ?? false,
				resolved.ctx.user,
			),
		)
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/files/[fileId]/preview')
	}
}
