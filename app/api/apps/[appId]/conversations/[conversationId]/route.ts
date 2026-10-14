import type { NextRequest } from 'next/server'

import { conversationNotFound, resolveChatRoute, resolveConversation } from '@/lib/chat/route'
import { reconcileStaleRun } from '@/lib/chat/run'
import { threadQuerySchema } from '@/lib/chat/schemas'
import { turnsFromMessages } from '@/lib/chat/turn'
import { readThreadPage, THREAD_PAGE_TURNS } from '@/lib/data/conversations'
import { errorResponseFrom } from '@/lib/http/errors'
import { parseQuery } from '@/lib/http/parse'
import { jsonNoStore } from '@/lib/http/response'

/**
 * GET conversations/[conversationId] (spec §4.2, §3.3): the latest turns, grouped on the server, with a "load earlier"
 * cursor and the state. A run this process lost is truncated first (§3.2 step 5), so a reload after a crash shows it
 * stopped, not running.
 */
export async function GET(
	request: NextRequest,
	ctx: RouteContext<'/api/apps/[appId]/conversations/[conversationId]'>,
) {
	const resolved = await resolveChatRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, threadQuerySchema)
	if (!query.ok) return query.response
	try {
		const { actor, app } = resolved
		const { conversationId } = await ctx.params
		const found = await resolveConversation(actor, app.id, conversationId)
		if (!found.ok) return found.response
		await reconcileStaleRun(found.conversation)
		const page = await readThreadPage(actor, app.id, conversationId, {
			before: query.data.before,
			turns: THREAD_PAGE_TURNS,
		})
		if (!page) return conversationNotFound()
		return jsonNoStore({
			id: page.conversation.id,
			title: page.conversation.title,
			state: page.conversation.state,
			turns: turnsFromMessages(page.rows, page.runs),
			cursor: page.cursor,
		})
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/apps/[appId]/conversations/[conversationId]')
	}
}
