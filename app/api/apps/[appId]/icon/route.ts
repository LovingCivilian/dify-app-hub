import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'

import { verifySession } from '@/lib/auth/session'
import { getAppIcon } from '@/lib/data/apps'
import { difyErrorResponse, errorResponseFrom } from '@/lib/dify/errors'

/**
 * The app's stored Dify icon image (charter §4.4): signed-in callers only (an <img> on a gated page sends the
 * cookie), an ETag from the bytes so a reload costs 304, cached privately for a day.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/apps/[appId]/icon'>) {
	const actor = await verifySession()
	if (!actor) return difyErrorResponse('unauthorized', 'Sign in required.', 401)
	try {
		const { appId } = await ctx.params
		const icon = await getAppIcon(actor, appId)
		if (!icon) return difyErrorResponse('icon_not_found', 'This app has no stored icon image.', 404)
		const etag = `"${createHash('sha256').update(icon.bytes).digest('hex').slice(0, 32)}"`
		const headers = { etag, 'cache-control': 'private, max-age=86400' }
		if (request.headers.get('if-none-match') === etag)
			return new Response(null, { status: 304, headers })
		return new Response(new Uint8Array(icon.bytes), {
			headers: {
				...headers,
				'content-type': icon.mime,
				'content-length': String(icon.bytes.length),
			},
		})
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/apps/[appId]/icon')
	}
}
