import * as z from 'zod'

import { emailField, nameField, passwordField } from '@/lib/auth/fields'
import { ROLES } from '@/lib/auth/roles'
import { idSchema } from '@/lib/ids'

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

/** A directory account's edit (decision an): the role alone. */
export const userRoleInputSchema = z.object({ role: z.enum(ROLES) })

/**
 * Account ids are the hub's UUIDs (ADR-0031: the fresh PostgreSQL start retired decision h's older formats, and the
 * `uuid` column refuses anything else with 22P02). An id that is not one answers not_found before any query, and a
 * member or grant list that holds one is invalid input (spec §3.2; lib/ids.ts).
 */
export const userIdSchema = idSchema

export type UserFormInput = z.infer<typeof userInputSchema>
