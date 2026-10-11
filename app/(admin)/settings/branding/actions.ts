'use server'

import { refresh } from 'next/cache'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import { fail, type ActionResult } from '@/lib/action-result'
import { requireAdmin } from '@/lib/auth/session'
import { isBrandingEditable, saveBranding } from '@/lib/settings/branding'

import { brandingFormSchema } from './schemas'

/*
 * Thin Server Action (ADR-0024; settings spec §5.4): verify the admin, the mode, the form, then saveBranding (the images,
 * the name rule, one write), and refresh the route (next/cache `refresh`, as the other admin actions; the root layout is
 * dynamic, so the new brand renders at once).
 */
export async function saveBrandingAction(formData: FormData): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!isBrandingEditable()) return fail('settings_not_editable')
		const parsed = brandingFormSchema.safeParse(Object.fromEntries(formData))
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await saveBranding(actor, parsed.data)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'saveBrandingAction')
	}
}
