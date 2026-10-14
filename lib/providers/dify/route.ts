import 'server-only'

import type { SessionUser } from '@/lib/auth/session'
import { resolveAppRoute } from '@/lib/providers/route'

import { difyClient, type DifyClient } from './client'

export { errorResponseFrom } from '@/lib/http/errors'
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
 * The first steps of every Dify handler (charter §4.1): the shared guard (lib/providers/route.ts: session → id → app →
 * enabled → provider), then the Dify context from the app's documents. The API base and the key never leave the server.
 */
export const resolveDifyRoute = async (
	params: Promise<{ appId: string }>,
): Promise<ResolvedDifyRoute> => {
	const resolved = await resolveAppRoute(params, 'dify')
	if (!resolved.ok) return resolved
	const { actor, app } = resolved
	return {
		ok: true,
		ctx: {
			user: actor.id,
			actor,
			appId: app.id,
			apiBase: app.settings.apiBase,
			dify: difyClient({ apiBase: app.settings.apiBase, apiKey: app.secrets.apiKey }),
		},
	}
}
