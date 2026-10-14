import type { NextRequest } from 'next/server'

import { activeRuns } from '@/lib/chat/active-runs'
import { resolveChatRoute, resolveConversation } from '@/lib/chat/route'
import { errorResponseFrom } from '@/lib/http/errors'
import { isId } from '@/lib/ids'

/**
 * POST …/runs/[runId]/stop (spec §4.2, §4.5): AG-UI has no stop request, so the hub aborts the upstream request through
 * the run's AbortController and closes the run as cancelled (the session, Task 10), as CopilotKit's runtime stop,
 * LibreChat's `/chat/abort` and Open WebUI's task stop do. 204, also when the run has already ended; activeRuns stops a
 * run only when it belongs to this conversation, and this process holds it (several containers: a follow-up, §3.2).
 */
export async function POST(
	_request: NextRequest,
	ctx: RouteContext<'/api/apps/[appId]/conversations/[conversationId]/runs/[runId]/stop'>,
) {
	const resolved = await resolveChatRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	try {
		const { actor, app } = resolved
		const { conversationId, runId } = await ctx.params
		const found = await resolveConversation(actor, app.id, conversationId)
		if (!found.ok) return found.response
		if (isId(runId)) activeRuns.stop(runId, conversationId, 'stop')
		return new Response(null, { status: 204 })
	} catch (error) {
		return errorResponseFrom(
			error,
			'POST /api/apps/[appId]/conversations/[conversationId]/runs/[runId]/stop',
		)
	}
}
