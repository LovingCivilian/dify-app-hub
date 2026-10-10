import * as z from 'zod'

import { userIdSchema } from '@/app/(admin)/user-management/schemas'
import { DIRECTORY_KEY_PATTERN } from '@/lib/directory-status'

export const GROUP_NAME_MAX = 255
export const GROUP_DESCRIPTION_MAX = 1000

export const DIRECTORY_SEARCH_MIN = 2
export const DIRECTORY_SEARCH_MAX = 64
export const DIRECTORY_GROUPS_MAX = 50

/** Decision al: the text an admin types to find a directory group. */
export const directoryGroupSearchSchema = z
	.string()
	.trim()
	.min(DIRECTORY_SEARCH_MIN)
	.max(DIRECTORY_SEARCH_MAX)

/**
 * The group drawer's input (decision c): the manual members and the directory links; the directory members are the
 * sync's (spec §2 #8).
 */
export const groupInputSchema = z.object({
	name: z.string().trim().min(1).max(GROUP_NAME_MAX),
	description: z.string().trim().max(GROUP_DESCRIPTION_MAX).default(''),
	memberIds: z.array(userIdSchema).max(10_000).default([]),
	/** Decision am: the linked directory groups by canonical key, with the name the search showed. */
	directoryGroups: z
		.array(
			z.object({
				id: z.string().regex(DIRECTORY_KEY_PATTERN),
				name: z.string().trim().min(1).max(255),
			}),
		)
		.max(DIRECTORY_GROUPS_MAX)
		.default([]),
})

/** Group ids are this line's UUIDs (B1's app-id rule). */
export const groupIdSchema = z.uuid()

export type GroupFormInput = z.input<typeof groupInputSchema>
