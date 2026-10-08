'use server'

import * as z from 'zod'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import type { ActionResult } from '@/lib/action-result'
import { emailField, nameField, passwordField } from '@/lib/auth/fields'
import { createOwner } from '@/lib/data/setup'

const ownerInput = z.object({ name: nameField, email: emailField, password: passwordField })

/**
 * First run (charter §4.2, ADR-0024): creates the owner. No session can exist yet; the DAL opens setup only while
 * no account exists. The proxy lets the POST to /init through (a public path); this action is its own guard.
 */
export async function createOwnerAction(input: unknown): Promise<ActionResult> {
	try {
		const parsed = ownerInput.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		return await createOwner(parsed.data)
	} catch (error) {
		return toActionFailure(error, 'createOwnerAction')
	}
}
