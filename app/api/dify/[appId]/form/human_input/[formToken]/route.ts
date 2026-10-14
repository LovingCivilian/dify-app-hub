import type { NextRequest } from 'next/server'

import { jsonNoStore, errorResponseFrom, resolveDifyRoute } from '@/lib/providers/dify/route'
import { humanInputBody } from '@/lib/providers/dify/schemas'
import { parseJsonBody, parsePathParams } from '@/lib/http/parse'

/** GET /form/human_input/{form_token}: the form definition (a recorded follow-up of ADR-0017). */
export async function GET(
	_request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/form/human_input/[formToken]'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const segments = await parsePathParams(ctx.params, 'formToken')
	if (!segments.ok) return segments.response
	try {
		return jsonNoStore(await resolved.ctx.dify.getHumanInputForm(segments.data.formToken))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/form/human_input/[formToken]')
	}
}

/** POST /form/human_input/{form_token}: `{ inputs, action }`, user set here; Dify answers `{}`, or 412 for a used or expired form. */
export async function POST(
	request: NextRequest,
	ctx: RouteContext<'/api/dify/[appId]/form/human_input/[formToken]'>,
) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const segments = await parsePathParams(ctx.params, 'formToken')
	if (!segments.ok) return segments.response
	const body = await parseJsonBody(request, humanInputBody)
	if (!body.ok) return body.response
	try {
		return jsonNoStore(
			await resolved.ctx.dify.submitHumanInput(
				segments.data.formToken,
				body.data,
				resolved.ctx.user,
			),
		)
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/form/human_input/[formToken]')
	}
}
