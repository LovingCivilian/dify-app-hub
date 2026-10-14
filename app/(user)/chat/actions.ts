'use server'

import * as z from 'zod'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import { requireActor, type SessionUser } from '@/lib/auth/session'
import { activeRuns } from '@/lib/chat/active-runs'
import { TITLE_MAX_LENGTH } from '@/lib/chat/statuses'
import { getAppAccess } from '@/lib/data/apps'
import {
	findConversation,
	renameConversation,
	softDeleteConversation,
} from '@/lib/data/conversations'
import { isId } from '@/lib/ids'
import { PROVIDERS } from '@/lib/providers/registry'

/*
 * The shared chat's writes to the hub's own data (Part 2 spec §4.2: rename and delete are Server Actions returning
 * ActionResult, ADR-0024). Thin, as every action of the hub (Next "Server Actions", Security: authenticate and authorize,
 * validate inputs, constrain return values): verify the account, check the input, call the DAL, answer a plain result.
 * No refresh(): the conversation list is the chat's client state, which updates itself from the result, and the page's
 * server render holds none of it (the same guide: "An action that does none of the above carries only its return value,
 * and the current route is not re-rendered").
 */

/**
 * A title is 1–TITLE_MAX_LENGTH code points after trimming (spec §3.1's bound). zod's `.max()` counts UTF-16 code units
 * (MDN "String: length"), so the code points are counted with `Array.from()`, after `.max()` has bounded the input (a
 * code point is at most two code units). zod 4 runs `.trim()` before the checks that follow it.
 */
const renameSchema = z.object({
	title: z
		.string()
		.trim()
		.max(TITLE_MAX_LENGTH * 2)
		.refine(title => {
			const length = Array.from(title).length
			return length >= 1 && length <= TITLE_MAX_LENGTH
		}),
})

/**
 * The app must be one the actor may use (getAppAccess applies visibleTo), enabled, and of a provider whose conversations
 * the hub keeps (spec §4.1 `hubHistory`); anything else answers not_found, as a missing one does (B3 spec §4.2).
 */
const usableApp = async (actor: SessionUser, appId: string): Promise<boolean> => {
	const app = await getAppAccess(actor, appId)
	return Boolean(app?.enabled && PROVIDERS[app.provider].hubHistory)
}

export async function renameConversationAction(
	appId: string,
	conversationId: string,
	title: unknown,
): Promise<ActionResult> {
	try {
		const actor = await requireActor()
		if (!isId(appId) || !isId(conversationId)) return fail('not_found')
		const parsed = renameSchema.safeParse({ title })
		if (!parsed.success) return invalidInput(parsed.error)
		if (!(await usableApp(actor, appId))) return fail('not_found')
		return (await renameConversation(actor, appId, conversationId, parsed.data.title))
			? ok(undefined)
			: fail('not_found')
	} catch (error) {
		return toActionFailure(error, 'renameConversationAction')
	}
}

/**
 * The user's delete (spec §3.4): the conversation leaves their list at once (soft delete, decision 49) and the daily
 * purge removes it after 30 days. A run still going is stopped first, by the stop route's path (spec §4.5): the soft
 * delete leaves runs alone, and its session then stores the run cancelled.
 */
export async function deleteConversationAction(
	appId: string,
	conversationId: string,
): Promise<ActionResult> {
	try {
		const actor = await requireActor()
		if (!isId(appId) || !isId(conversationId)) return fail('not_found')
		if (!(await usableApp(actor, appId))) return fail('not_found')
		const conversation = await findConversation(actor, appId, conversationId)
		if (!conversation) return fail('not_found')
		if (conversation.activeRunId) activeRuns.stop(conversation.activeRunId, conversationId, 'stop')
		return (await softDeleteConversation(actor, appId, conversationId))
			? ok(undefined)
			: fail('not_found')
	} catch (error) {
		return toActionFailure(error, 'deleteConversationAction')
	}
}
