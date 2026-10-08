'use server'

import { refresh } from 'next/cache'
import * as z from 'zod'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import { requireAdmin } from '@/lib/auth/session'
import { createApp, deleteApp, syncApp, updateApp, type SyncResult } from '@/lib/data/apps'

import { appInputSchema, createAppInputSchema } from './schemas'

/*
 * Thin Server Actions (charter §4.2): verify the admin, validate, call the DAL, refresh the route
 * (next/cache `refresh`: the page reads the database directly, so the current route's RSC payload is refetched
 * in the same round trip), answer a plain ActionResult. Every expected failure is a result, never a throw.
 */

const isId = (id: string) => z.uuid().safeParse(id).success

export async function createAppAction(input: unknown): Promise<ActionResult<SyncResult>> {
	try {
		const actor = await requireAdmin()
		const parsed = createAppInputSchema.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await createApp(actor, parsed.data)
		refresh()
		return ok(result)
	} catch (error) {
		return toActionFailure(error, 'createAppAction')
	}
}

export async function updateAppAction(
	id: string,
	input: unknown,
): Promise<ActionResult<SyncResult>> {
	try {
		const actor = await requireAdmin()
		if (!isId(id)) return fail('not_found')
		const parsed = appInputSchema.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await updateApp(actor, id, {
			...parsed.data,
			apiKey: parsed.data.apiKey || undefined,
		})
		if (!result) return fail('not_found')
		refresh()
		return ok(result)
	} catch (error) {
		return toActionFailure(error, 'updateAppAction')
	}
}

export async function deleteAppAction(id: string): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!isId(id) || !(await deleteApp(actor, id))) return fail('not_found')
		refresh()
		return ok(undefined)
	} catch (error) {
		return toActionFailure(error, 'deleteAppAction')
	}
}

export async function syncAppAction(id: string): Promise<ActionResult<SyncResult>> {
	try {
		const actor = await requireAdmin()
		if (!isId(id)) return fail('not_found')
		const result = await syncApp(actor, id)
		if (!result) return fail('not_found')
		refresh()
		return ok(result)
	} catch (error) {
		return toActionFailure(error, 'syncAppAction')
	}
}
