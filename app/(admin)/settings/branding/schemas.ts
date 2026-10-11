import * as z from 'zod'

import type { BrandingInput, ImageChange } from '@/lib/settings/branding'
import { brandNameSchema } from '@/lib/settings/branding-rules'

export const IMAGE_INTENTS = ['keep', 'replace', 'remove'] as const

const change = (intent: (typeof IMAGE_INTENTS)[number], file: File | undefined): ImageChange =>
	intent === 'replace' && file
		? { intent, file }
		: intent === 'remove'
			? { intent }
			: { intent: 'keep' }

/**
 * The Branding form as FormData sends it (settings spec §5.4 step 3; Server Actions accept FormData with files): the name,
 * the switch, and per image an intent with its file when replaced. The refinements name their message through `error`,
 * zod 4's parameter (`message` is "deprecated. Use `error` instead", zod/v4/core/api.d.ts).
 */
export const brandingFormSchema = z
	.object({
		name: brandNameSchema,
		showName: z.enum(['true', 'false']).transform(value => value === 'true'),
		logoIntent: z.enum(IMAGE_INTENTS),
		faviconIntent: z.enum(IMAGE_INTENTS),
		logo: z.instanceof(File).optional(),
		favicon: z.instanceof(File).optional(),
	})
	.refine(value => value.logoIntent !== 'replace' || value.logo !== undefined, {
		path: ['logo'],
		error: 'file_required',
	})
	.refine(value => value.faviconIntent !== 'replace' || value.favicon !== undefined, {
		path: ['favicon'],
		error: 'file_required',
	})
	.transform(
		(value): BrandingInput => ({
			name: value.name,
			showName: value.showName,
			images: {
				logo: change(value.logoIntent, value.logo),
				favicon: change(value.faviconIntent, value.favicon),
			},
		}),
	)
