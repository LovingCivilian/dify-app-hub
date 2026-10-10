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
 * The text the groups drawer asks the search route for (decision al): trimmed and cut to DIRECTORY_SEARCH_MAX code
 * points (MDN `Array.from()`: a string's iterator yields code points, which zod's bounds count, Zod 4.5 "String length
 * counts code points"), so a longer text searches by its start instead of meeting the route's 400. The drawer sends it
 * only when it has DIRECTORY_SEARCH_MIN code points.
 */
export const directorySearchText = (text: string): string =>
	Array.from(text.trim()).slice(0, DIRECTORY_SEARCH_MAX).join('').trimEnd()

/**
 * The group drawer's input (decision c): the manual members and the directory links; the directory members are the
 * sync's (spec §2 #8).
 */
export const groupInputSchema = z.object({
	name: z.string().trim().min(1).max(GROUP_NAME_MAX),
	description: z.string().trim().max(GROUP_DESCRIPTION_MAX).default(''),
	memberIds: z.array(userIdSchema).max(10_000).default([]),
	/**
	 * Decision am: the linked directory groups by canonical key, with the name the search showed. Absent means "leave
	 * the links as they are" (zod `.optional()`; RFC 7386: a member absent from the patch leaves the target as it is),
	 * so a form that does not show the field (the `LDAP_*` block unset) never deletes them; `[]` removes every link.
	 */
	directoryGroups: z
		.array(
			z.object({
				id: z.string().regex(DIRECTORY_KEY_PATTERN),
				name: z.string().trim().min(1).max(255),
			}),
		)
		.max(DIRECTORY_GROUPS_MAX)
		.optional(),
})

/** Group ids are this line's UUIDs (B1's app-id rule). */
export const groupIdSchema = z.uuid()

export type GroupFormInput = z.input<typeof groupInputSchema>
