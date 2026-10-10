import * as z from 'zod'

import { userIdSchema } from '@/app/(admin)/user-management/schemas'

export const GROUP_NAME_MAX = 255
export const GROUP_DESCRIPTION_MAX = 1000

/** The group drawer's input (decision c): the manual members only; the directory's are the sync's (spec §2 #8). */
export const groupInputSchema = z.object({
	name: z.string().trim().min(1).max(GROUP_NAME_MAX),
	description: z.string().trim().max(GROUP_DESCRIPTION_MAX).default(''),
	memberIds: z.array(userIdSchema).max(10_000).default([]),
})

/** Group ids are this line's UUIDs (B1's app-id rule). */
export const groupIdSchema = z.uuid()

export type GroupFormInput = z.input<typeof groupInputSchema>
