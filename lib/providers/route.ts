import 'server-only'

import { verifySession, type SessionUser } from '@/lib/auth/session'
import { getAppAccess, type AppAccess } from '@/lib/data/apps'
import { errorResponse, errorResponseFrom } from '@/lib/http/errors'
import { isId } from '@/lib/ids'

import type { ProviderId } from './ids'

/** An app's access once the guard has seen that its provider is P. */
export type ProviderAppAccess<P extends ProviderId> = Extract<AppAccess, { provider: P }>

export type ResolvedAppRoute<P extends ProviderId> =
	| { ok: true; actor: SessionUser; app: ProviderAppAccess<P> }
	| { ok: false; response: Response }

const appNotFound = (): Response => errorResponse('app_not_found', 'No such app.', 404)

const isOfProvider = <P extends ProviderId>(
	app: AppAccess,
	provider: P,
): app is ProviderAppAccess<P> => app.provider === provider

/**
 * The shared guard of every provider route (Part 1 spec §3; charter §4.1; ADR-0023): the session first, so a revoked
 * token learns nothing about apps; then the id, which must be a UUID (Part 0 spec §3.2: PostgreSQL refuses a malformed
 * one with 22P02; lib/ids.ts); then the app as the actor may see it (getAppAccess applies visibleTo and reads the
 * documents with their provider's schemas); then whether it is enabled; then whether it is this route's provider. An
 * unknown, invisible or malformed id and another provider's app all answer 404 app_not_found, so nothing can be told
 * apart (B3 spec §4.2); a disabled app answers 403 app_disabled. A failure of the session or the app read (a lost
 * database, an EnvError) answers a logged 500 envelope, not Next's empty one.
 */
export const resolveAppRoute = async <P extends ProviderId>(
	params: Promise<{ appId: string }>,
	provider: P,
): Promise<ResolvedAppRoute<P>> => {
	try {
		const actor = await verifySession()
		if (!actor)
			return { ok: false, response: errorResponse('unauthorized', 'Sign in required.', 401) }
		const { appId } = await params
		const app = isId(appId) ? await getAppAccess(actor, appId) : null
		if (!app) return { ok: false, response: appNotFound() }
		if (!app.enabled)
			return { ok: false, response: errorResponse('app_disabled', 'This app is disabled.', 403) }
		if (!isOfProvider(app, provider)) return { ok: false, response: appNotFound() }
		return { ok: true, actor, app }
	} catch (error) {
		return { ok: false, response: errorResponseFrom(error, 'resolveAppRoute') }
	}
}
