import * as z from 'zod'

import { emailField, nameField, passwordField } from '@/lib/auth/fields'
import { ROLES } from '@/lib/auth/roles'

/**
 * The users drawer's input (charter §4.5); on update a blank or missing password means "keep the current one". Any
 * of the three roles parses (the owner's own row sends `owner`); which role an actor may give is the DAL's rank.
 */
export const userInputSchema = z.object({
	name: nameField,
	email: emailField,
	role: z.enum(ROLES),
	password: z.union([z.literal(''), passwordField]).optional(),
})

export const createUserInputSchema = userInputSchema.extend({ password: passwordField })

/**
 * Account ids are not checked as UUIDs (decision h): rows older than this line's generator may use another
 * format; the column is varchar(36), and an unknown id answers not_found.
 */
export const userIdSchema = z.string().min(1).max(36)

export type UserFormInput = z.infer<typeof userInputSchema>
