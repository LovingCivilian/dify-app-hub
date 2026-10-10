import * as z from 'zod'

import { userIdSchema } from '@/app/(admin)/user-management/schemas'
import { ACCESS_MODES } from '@/lib/app-access'
import { APP_MODES } from '@/lib/dify/types'

const appSettingsSchema = z.object({
	answerForm: z.object({ enabled: z.boolean(), feedbackText: z.string().max(255).default('') }),
	enableUpdateAfterConversationStarts: z.boolean(),
	openingStatementDisplayMode: z.enum(['default', 'always']),
	annotationEnabled: z.boolean(),
})

/** Who may use the app (B3 spec §4.4): the grants count while restricted; group ids are UUIDs, account ids follow B2 decision h. */
export const accessSchema = z.object({
	mode: z.enum(ACCESS_MODES),
	groupIds: z.array(z.uuid()).max(1000).default([]),
	userIds: z.array(userIdSchema).max(10_000).default([]),
})

/** The admin form's input (charter §4.5): on update a blank key means "keep the stored one". */
export const appInputSchema = z.object({
	apiBase: z.url({ protocol: /^https?$/ }).max(500),
	apiKey: z.string().trim().max(255).optional(),
	mode: z.enum(APP_MODES),
	enabled: z.boolean(),
	settings: appSettingsSchema,
	access: accessSchema,
})

export const createAppInputSchema = appInputSchema.extend({
	apiKey: z.string().trim().min(1).max(255),
})

export type AppFormInput = z.infer<typeof appInputSchema>
