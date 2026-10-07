import type { NextRequest } from 'next/server'

import { difyJson, errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parseFilePart } from '@/lib/dify/schemas'

/** POST /files/upload (endpoint map §1.6): one file part, user set here; Dify answers 201 with the file. */
export async function POST(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/files/upload'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const part = await parseFilePart(request)
	if (!part.ok) return part.response
	try {
		return difyJson(await resolved.ctx.dify.uploadFile(part.data, resolved.ctx.user), {
			status: 201,
		})
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/files/upload')
	}
}
