import type { NextRequest } from 'next/server'

import { filePassthrough } from '@/lib/dify/client'
import { difyErrorResponse } from '@/lib/dify/errors'
import { resolveRemoteFileUrl } from '@/lib/dify/remote-file'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parseQuery, remoteFileQuery } from '@/lib/dify/schemas'

/**
 * GET /files/remote?url= : a link Dify handed out (message files, generated images), fetched on the user's behalf so
 * the Dify host never reaches the browser (charter §4.1). Only the app's Dify origin under /files/ is allowed.
 */
export async function GET(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/files/remote'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, remoteFileQuery)
	if (!query.ok) return query.response
	const target = resolveRemoteFileUrl(query.data.url, resolved.ctx.apiBase)
	if (!target)
		return difyErrorResponse(
			'invalid_param',
			'url must be a file link on the app’s Dify server.',
			400,
		)
	try {
		return filePassthrough(await resolved.ctx.dify.fetchRemoteFile(target))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/files/remote')
	}
}
