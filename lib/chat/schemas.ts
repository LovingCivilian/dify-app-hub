import * as z from 'zod'

import { idSchema } from '@/lib/ids'

/*
 * The shared chat's request schemas (Part 2 spec §4.2; ADR-0025). Client-safe: the browser's own checks may reuse the
 * limits. zod 4 "Objects": unknown keys are stripped by default, so a field a later slice adds (2c's attachmentIds) is
 * dropped here until that slice reads it.
 */

/** Spec §4.2: a message's text, and a tool result's content, are at most 32,000 characters. */
export const MESSAGE_TEXT_MAX = 32_000
/** The hub's own bound on one body's answers (docs silent; OWASP Input Validation Cheat Sheet: minimum and maximum length). */
const ANSWERS_MAX = 50

/**
 * An answer to one open interrupt (AG-UI 1.0 interrupt-resume: `{ interruptId, status, payload? }`). The payload is an
 * object, or a bare boolean for a `confirmation` without a `responseSchema` (plan call P6; AG-UI Concepts › Interrupts,
 * reason taxonomy: "`responseSchema` optional; boolean default"); zod 4 "Unions" checks the options in order. Which
 * payload an interrupt accepts is checked against the interrupt itself (lib/chat/answers.ts).
 */
const resumeEntrySchema = z.object({
	interruptId: z.string().min(1).max(256),
	status: z.enum(['resolved', 'cancelled']),
	payload: z.union([z.record(z.string(), z.unknown()), z.boolean()]).optional(),
})

const toolResultSchema = z.object({
	toolCallId: z.string().min(1).max(256),
	content: z.string().max(MESSAGE_TEXT_MAX),
})

/**
 * POST runs (spec §4.2): exactly one of `message` and `answers`, and `answers` only in a conversation. A text must hold a
 * non-blank character and is stored as typed (zod 4 "Refinements": `.refine` with a `path`, so parseJsonBody names the
 * field). 2a has no `attachmentIds` (2c adds them).
 */
export const runBodySchema = z
	.object({
		conversationId: idSchema.optional(),
		message: z
			.object({
				text: z
					.string()
					.max(MESSAGE_TEXT_MAX)
					.refine(text => text.trim() !== ''),
			})
			.optional(),
		answers: z
			.object({
				resume: z.array(resumeEntrySchema).max(ANSWERS_MAX).optional(),
				toolResults: z.array(toolResultSchema).max(ANSWERS_MAX).optional(),
			})
			.optional(),
	})
	.refine(body => (body.message === undefined) !== (body.answers === undefined), {
		path: ['message'],
		message: 'exactly one of message and answers',
	})
	.refine(body => body.answers === undefined || body.conversationId !== undefined, {
		path: ['conversationId'],
		message: 'answers continue a conversation',
	})

export type RunBody = z.infer<typeof runBodySchema>

/**
 * GET conversations: the opaque keyset cursor the previous page answered. Its content is the DAL's to read (Task 7's
 * `decodeListCursor`, server-only), so the route checks it; this schema bounds its length only.
 */
export const conversationsQuerySchema = z.object({ cursor: z.string().min(1).max(200).optional() })

/**
 * GET conversations/[conversationId]: `before`, the seq of the oldest user message the browser shows (plan call P8), a
 * positive safe integer (`seq` is a bigint read in Drizzle's `number` mode, Task 5). The digits are bounded first, then
 * the value must be a safe integer, so 16 digits above 2^53 - 1 are refused.
 */
export const threadQuerySchema = z.object({
	before: z
		.string()
		.regex(/^[1-9]\d{0,15}$/)
		.transform(Number)
		.refine(Number.isSafeInteger)
		.optional(),
})
