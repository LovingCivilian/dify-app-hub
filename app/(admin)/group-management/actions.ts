'use server'

import { refresh } from 'next/cache'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import { fail, type ActionResult } from '@/lib/action-result'
import { requireAdmin } from '@/lib/auth/session'
import { createGroup, deleteGroup, updateGroup } from '@/lib/data/groups'

import { groupIdSchema, groupInputSchema } from './schemas'

/*
 * Thin Server Actions (ADR-0024): verify the admin, validate, call the DAL, refresh the route (next/cache `refresh`:
 * the page reads the database directly), answer a plain ActionResult. Every expected failure is a result, never a
 * throw; the DAL checks the role again.
 */

export async function createGroupAction(input: unknown): Promise<ActionResult<{ id: string }>> {
	try {
		const actor = await requireAdmin()
		const parsed = groupInputSchema.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await createGroup(actor, parsed.data)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'createGroupAction')
	}
}

export async function updateGroupAction(id: string, input: unknown): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!groupIdSchema.safeParse(id).success) return fail('not_found')
		const parsed = groupInputSchema.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await updateGroup(actor, id, parsed.data)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'updateGroupAction')
	}
}

export async function deleteGroupAction(id: string): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!groupIdSchema.safeParse(id).success) return fail('not_found')
		const result = await deleteGroup(actor, id)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'deleteGroupAction')
	}
}
