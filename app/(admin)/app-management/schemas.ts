import * as z from 'zod'

import { APP_MODES } from '@/lib/dify/types'

const appSettingsSchema = z.object({
	answerForm: z.object({ enabled: z.boolean(), feedbackText: z.string().max(255).default('') }),
	enableUpdateAfterConversationStarts: z.boolean(),
	openingStatementDisplayMode: z.enum(['default', 'always']),
	annotationEnabled: z.boolean(),
})

/** The admin form's input (charter §4.5): on update a blank key means "keep the stored one". */
export const appInputSchema = z.object({
	apiBase: z.url({ protocol: /^https?$/ }).max(500),
	apiKey: z.string().trim().max(255).optional(),
	mode: z.enum(APP_MODES),
	enabled: z.boolean(),
	settings: appSettingsSchema,
})

export const createAppInputSchema = appInputSchema.extend({
	apiKey: z.string().trim().min(1).max(255),
})

export type AppFormInput = z.infer<typeof appInputSchema>
