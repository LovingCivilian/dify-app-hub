import type { NextRequest } from 'next/server'

import { difyJson, errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'

/** GET /info (docs/dify-service-api-1.17.1.md §1.1). */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/info'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	try {
		return difyJson(await resolved.ctx.dify.getInfo())
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/info')
	}
}
