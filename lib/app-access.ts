/**
 * The vocabulary of per-app access (B3 spec §3.1, §4; ADR-0027): an app is open to everyone or restricted to its
 * grants, and a group membership was added by an admin or by the directory sync (B3b). Client-safe on purpose: the
 * schema, the zod inputs, the DTOs and the admin forms all read it.
 */
export const ACCESS_MODES = ['everyone', 'restricted'] as const

export type AccessMode = (typeof ACCESS_MODES)[number]

export const MEMBERSHIP_SOURCES = ['manual', 'directory'] as const

export type MembershipSource = (typeof MEMBERSHIP_SOURCES)[number]

/** An app's access as the admin edits it; the grants count only while the mode is `restricted` (spec §4.1). */
export interface AppAccessSettings {
	mode: AccessMode
	groupIds: string[]
	userIds: string[]
}
