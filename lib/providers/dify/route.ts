import 'server-only'

import { verifySession, type SessionUser } from '@/lib/auth/session'
import { getAppAccess } from '@/lib/data/apps'
import { errorResponse, errorResponseFrom } from '@/lib/http/errors'
import { isId } from '@/lib/ids'

import { difyClient, type DifyClient } from './client'

export { errorResponseFrom }
export { jsonNoStore } from '@/lib/http/response'

export interface DifyRouteContext {
	/** The Dify end user: the account's permanent id, never the email (ADR-0026). */
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
 * about apps; then the app; then its credentials, which never leave the server. An id that is not a UUID is an unknown
 * app, answered before the app read (spec §3.2: PostgreSQL refuses it with 22P02; lib/ids.ts). Each refusal is the
 * envelope, a failure of the session or app read too (a lost database, an EnvError): a logged 500 envelope, not Next's
 * empty one.
 */
export const resolveDifyRoute = async (
	params: Promise<{ appId: string }>,
): Promise<ResolvedDifyRoute> => {
	try {
		const actor = await verifySession()
		if (!actor)
			return { ok: false, response: errorResponse('unauthorized', 'Sign in required.', 401) }
		const { appId } = await params
		const app = isId(appId) ? await getAppAccess(actor, appId) : null
		if (!app) return { ok: false, response: errorResponse('app_not_found', 'No such app.', 404) }
		if (!app.enabled)
			return {
				ok: false,
				response: errorResponse('app_disabled', 'This app is disabled.', 403),
			}
		return {
			ok: true,
			ctx: {
				user: actor.id,
				actor,
				appId,
				apiBase: app.credentials.apiBase,
				dify: difyClient(app.credentials),
			},
		}
	} catch (error) {
		return { ok: false, response: errorResponseFrom(error, 'resolveDifyRoute') }
	}
}
