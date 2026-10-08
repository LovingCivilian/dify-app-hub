import type { AppDto } from '@/lib/data/apps'
import type { AppMode } from '@/lib/dify/types'

/** The admin table's row is the DTO itself: it carries no key (charter §4.4), so nothing needs trimming. */
export type AdminAppRow = AppDto

/** Dify documents GET /apps/annotations for chatbot, chatflow and the legacy agent apps. */
export const supportsAnnotations = (mode: AppMode | null) =>
	mode === 'chat' || mode === 'advanced-chat' || mode === 'agent-chat'
