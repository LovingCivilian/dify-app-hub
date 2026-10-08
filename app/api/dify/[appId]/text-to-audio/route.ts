import type { NextRequest } from 'next/server'

import { filePassthrough } from '@/lib/dify/client'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parseJsonBody, textToAudioBody } from '@/lib/dify/schemas'

/** POST /text-to-audio: `{ message_id | text, voice }`, user set here; the audio passes through. */
export async function POST(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/text-to-audio'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, textToAudioBody)
	if (!body.ok) return body.response
	try {
		return filePassthrough(await resolved.ctx.dify.textToAudio(body.data, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/text-to-audio')
	}
}
