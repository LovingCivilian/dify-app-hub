import 'server-only'

import { verifySession, type SessionUser } from '@/lib/auth/session'
import { getAppAccess } from '@/lib/data/apps'
import { findConversation, type ConversationRecord } from '@/lib/data/conversations'
import { errorResponse, errorResponseFrom } from '@/lib/http/errors'
import { isId } from '@/lib/ids'
import type { ProviderId } from '@/lib/providers/ids'
import { chatAdapterOf } from '@/lib/providers/registry'
import type { ProviderAppAccess } from '@/lib/providers/route'

import type { ChatAdapter } from './adapter'

export type ResolvedChatRoute =
	| {
			ok: true
			actor: SessionUser
			app: ProviderAppAccess<ProviderId>
			chat: ChatAdapter<ProviderId>
	  }
	| { ok: false; response: Response }

const appNotFound = (): Response => errorResponse('app_not_found', 'No such app.', 404)

/** Spec §4.1, §8: a conversation that is not the actor's, of another app, or deleted answers as one that does not exist. */
export const conversationNotFound = (): Response =>
	errorResponse('conversation_not_found', 'No such conversation.', 404)

/**
 * The guard of every shared chat route (spec §4.1), in resolveAppRoute's order (lib/providers/route.ts): the session first,
 * so a revoked token learns nothing about apps; the id, a UUID (lib/ids.ts); the app as the actor may see it (getAppAccess
 * applies visibleTo and reads the documents with their provider's schemas); whether it is enabled; whether its provider has
 * a chat adapter. An unknown, invisible or malformed id and an app of a provider without the shared chat all answer 404
 * app_not_found; a disabled app answers 403 app_disabled; a failing read a logged 500 envelope, not Next's empty one.
 */
export const resolveChatRoute = async (
	params: Promise<{ appId: string }>,
): Promise<ResolvedChatRoute> => {
	try {
		const actor = await verifySession()
		if (!actor)
			return { ok: false, response: errorResponse('unauthorized', 'Sign in required.', 401) }
		const { appId } = await params
		const app = isId(appId) ? await getAppAccess(actor, appId) : null
		if (!app) return { ok: false, response: appNotFound() }
		if (!app.enabled)
			return { ok: false, response: errorResponse('app_disabled', 'This app is disabled.', 403) }
		const chat = chatAdapterOf(app.provider)
		if (!chat) return { ok: false, response: appNotFound() }
		return { ok: true, actor, app, chat }
	} catch (error) {
		return { ok: false, response: errorResponseFrom(error, 'resolveChatRoute') }
	}
}

/** The actor's conversation of this app, not deleted (spec §4.1); a malformed id is never read (lib/ids.ts). */
export const resolveConversation = async (
	actor: SessionUser,
	appId: string,
	conversationId: string,
): Promise<{ ok: true; conversation: ConversationRecord } | { ok: false; response: Response }> => {
	const conversation = isId(conversationId)
		? await findConversation(actor, appId, conversationId)
		: null
	return conversation ? { ok: true, conversation } : { ok: false, response: conversationNotFound() }
}
