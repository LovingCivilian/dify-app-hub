import type { NextRequest } from 'next/server'

import { resolveChatRoute } from '@/lib/chat/route'
import { runTurn } from '@/lib/chat/run'
import { runBodySchema } from '@/lib/chat/schemas'
import { errorResponseFrom } from '@/lib/http/errors'
import { parseJsonBody } from '@/lib/http/parse'

/**
 * POST runs (Part 2 spec §4.2, §4.3): one turn of the app's agent, answered as the hub's AG-UI event stream (§4.4), or as
 * the hub's envelope when it is refused before any stream.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/apps/[appId]/runs'>) {
	const resolved = await resolveChatRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, runBodySchema)
	if (!body.ok) return body.response
	try {
		const { actor, app, chat } = resolved
		return await runTurn({ request, actor, app, chat, body: body.data })
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/apps/[appId]/runs')
	}
}
