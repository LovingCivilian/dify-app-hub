import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parseFilePart } from '@/lib/dify/schemas'

/**
 * POST /audio-to-text: the recording goes to Dify under its real type and name (charter §4.1 "Audio": no
 * relabelling; whether the owner's Dify accepts WebM is verified against it, and recorded in the task report).
 */
export async function POST(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/audio-to-text'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const part = await parseFilePart(request)
	if (!part.ok) return part.response
	try {
		return Response.json(await resolved.ctx.dify.audioToText(part.data, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/audio-to-text')
	}
}
