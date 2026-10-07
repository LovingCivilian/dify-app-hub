import 'server-only'

import { verifySession, type SessionUser } from '@/lib/auth/session'
import { getAppAccess } from '@/lib/data/apps'

import { difyClient, type DifyClient } from './client'
import { difyErrorResponse } from './errors'

export { errorResponseFrom } from './errors'

export interface DifyRouteContext {
	/** The Dify end-user id: the signed-in email (ADR-0006). */
	user: string
	actor: SessionUser
	appId: string
	apiBase: string
	dify: DifyClient
}

export type ResolvedDifyRoute =
	| { ok: true; ctx: DifyRouteContext }
	| { ok: false; response: Response }

/**
 * The first three steps of every Dify handler (charter §4.1): the session first, so a revoked token learns nothing
 * about apps; then the app; then its credentials, which never leave the server. Each refusal is the envelope.
 */
export const resolveDifyRoute = async (
	params: Promise<{ appId: string }>,
): Promise<ResolvedDifyRoute> => {
	const actor = await verifySession()
	if (!actor)
		return { ok: false, response: difyErrorResponse('unauthorized', 'Sign in required.', 401) }
	const { appId } = await params
	const app = await getAppAccess(actor, appId)
	if (!app) return { ok: false, response: difyErrorResponse('app_not_found', 'No such app.', 404) }
	if (!app.enabled)
		return { ok: false, response: difyErrorResponse('app_disabled', 'This app is disabled.', 403) }
	return {
		ok: true,
		ctx: {
			user: actor.email,
			actor,
			appId,
			apiBase: app.credentials.apiBase,
			dify: difyClient(app.credentials),
		},
	}
}
