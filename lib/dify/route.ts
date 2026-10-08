import 'server-only'

import { verifySession, type SessionUser } from '@/lib/auth/session'
import { getAppAccess } from '@/lib/data/apps'

import { difyClient, type DifyClient } from './client'
import { difyErrorResponse, errorResponseFrom } from './errors'

export { errorResponseFrom }
export { difyJson } from './response'

export interface DifyRouteContext {
	/** The Dify end-user id: the signed-in email (ADR-0006). */
	user: string
	actor: SessionUser
	appId: string
	apiBase: string
	/** The app's annotation switch (AppAccess). */
	annotationEnabled: boolean
	dify: DifyClient
}

export type ResolvedDifyRoute =
	| { ok: true; ctx: DifyRouteContext }
	| { ok: false; response: Response }

/**
 * The first three steps of every Dify handler (charter §4.1): the session first, so a revoked token learns nothing
 * about apps; then the app; then its credentials, which never leave the server. Each refusal is the envelope, a
 * failure of the session or app read too (a lost database, an EnvError): a logged 500 envelope, not Next's empty one.
 */
export const resolveDifyRoute = async (
	params: Promise<{ appId: string }>,
): Promise<ResolvedDifyRoute> => {
	try {
		const actor = await verifySession()
		if (!actor)
			return { ok: false, response: difyErrorResponse('unauthorized', 'Sign in required.', 401) }
		const { appId } = await params
		const app = await getAppAccess(actor, appId)
		if (!app)
			return { ok: false, response: difyErrorResponse('app_not_found', 'No such app.', 404) }
		if (!app.enabled)
			return {
				ok: false,
				response: difyErrorResponse('app_disabled', 'This app is disabled.', 403),
			}
		return {
			ok: true,
			ctx: {
				user: actor.email,
				actor,
				appId,
				apiBase: app.credentials.apiBase,
				annotationEnabled: app.annotationEnabled,
				dify: difyClient(app.credentials),
			},
		}
	} catch (error) {
		return { ok: false, response: errorResponseFrom(error, 'resolveDifyRoute') }
	}
}

/**
 * The app's refusal of a signed-in caller whose role does not allow the operation (charter §4.2): the body
 * errorResponseFrom gives an AuthError('forbidden'), checked right after the app (session → app → role → input).
 */
export const forbiddenResponse = (): Response => difyErrorResponse('forbidden', 'Not allowed.', 403)
