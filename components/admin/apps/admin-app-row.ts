import type { AppAccessSettings } from '@/lib/app-access'
import type { AdminAppDto } from '@/lib/data/apps'
import type { AppMode } from '@/lib/dify/types'

/** The admin table's row is the admin DTO: no key (charter §4.4), and the app's access (B3 spec §4.4). */
export type AdminAppRow = AdminAppDto

/** Dify documents GET /apps/annotations for chatbot, chatflow and the legacy agent apps. */
export const supportsAnnotations = (mode: AppMode | null) =>
	mode === 'chat' || mode === 'advanced-chat' || mode === 'agent-chat'

export type AccessSummary =
	| { kind: 'everyone' }
	| { kind: 'admins_only' }
	| { kind: 'restricted'; groups: number; people: number }

/** The table's access tag (spec §4.4): restricted with no grant means only the owner and admins can use the app. */
export const accessSummary = (access: AppAccessSettings): AccessSummary => {
	if (access.mode === 'everyone') return { kind: 'everyone' }
	if (access.groupIds.length + access.userIds.length === 0) return { kind: 'admins_only' }
	return { kind: 'restricted', groups: access.groupIds.length, people: access.userIds.length }
}
