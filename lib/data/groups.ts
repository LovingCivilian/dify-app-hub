import 'server-only'

import { and, asc, count, eq, inArray } from 'drizzle-orm'

import { getDb, type Db } from '@/db'
import { appGroupGrants, userGroupDirectoryLinks, userGroupMembers, userGroups } from '@/db/schema'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import type { MembershipSource } from '@/lib/app-access'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'

import { isDuplicateEntry, isMissingReference } from './db-errors'

/*
 * The groups Data Access Layer (B3 spec §4.3, ADR-0027). Every function takes the verified actor first and checks
 * admin rights itself (ADR-0024's pattern); membership grants no right, so the rank map does not apply. An admin
 * edits manual memberships only; the directory sync (B3b) owns the `directory` rows. DTOs carry ISO dates.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type GroupRow = typeof userGroups.$inferSelect
type GroupDtoRow = Pick<GroupRow, 'id' | 'name' | 'description' | 'createdAt' | 'updatedAt'>

export interface GroupMemberDto {
	userId: string
	source: MembershipSource
}

/** A linked directory group as the groups page shows it (spec §4.3): its key, its name, since when it is missing. */
export interface DirectoryLinkDto {
	id: string
	name: string
	missingSince: string | null
}

export interface GroupDto {
	id: string
	name: string
	description: string | null
	members: GroupMemberDto[]
	appCount: number
	directoryLinks: DirectoryLinkDto[]
	createdAt: string
	updatedAt: string
}

/** A group as the app drawer's picker shows it. */
export interface GroupOption {
	id: string
	name: string
}

/**
 * What the group drawer sends (validated by the action's schema); `memberIds` are the manual members,
 * `directoryGroups` the linked directory groups by key, with the name the search showed (decision am).
 */
export interface GroupInput {
	name: string
	description: string
	memberIds: string[]
	directoryGroups: { id: string; name: string }[]
}

export const toGroupDto = (
	row: GroupDtoRow,
	members: GroupMemberDto[],
	appCount: number,
	links: DirectoryLinkDto[] = [],
): GroupDto => ({
	id: row.id,
	name: row.name,
	description: row.description,
	members,
	appCount,
	directoryLinks: links,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
})

/**
 * The groups with their members, app counts and directory links, each list grouped once (MDN `Map.groupBy`); the
 * groups' order stays.
 */
export const toGroupDtos = (
	groups: readonly GroupDtoRow[],
	members: readonly (GroupMemberDto & { groupId: string })[],
	grants: readonly { groupId: string; apps: number }[],
	links: readonly {
		groupId: string
		directoryGroupId: string
		directoryGroupName: string
		missingSince: Date | null
	}[] = [],
): GroupDto[] => {
	const membersOf = Map.groupBy(members, member => member.groupId)
	const appCounts = new Map(grants.map(grant => [grant.groupId, grant.apps]))
	const linksByGroup = Map.groupBy(links, link => link.groupId)
	return groups.map(group =>
		toGroupDto(
			group,
			(membersOf.get(group.id) ?? []).map(member => ({
				userId: member.userId,
				source: member.source,
			})),
			appCounts.get(group.id) ?? 0,
			(linksByGroup.get(group.id) ?? []).map(link => ({
				id: link.directoryGroupId,
				name: link.directoryGroupName,
				missingSince: link.missingSince?.toISOString() ?? null,
			})),
		),
	)
}

/** What a save changes in the manual memberships (spec §2 #8): the ids to add and to remove, each once. */
export const manualMemberChanges = (
	current: readonly string[],
	next: readonly string[],
): { add: string[]; remove: string[] } => {
	const now = new Set(current)
	const wanted = new Set(next)
	return {
		add: [...wanted].filter(id => !now.has(id)),
		remove: [...now].filter(id => !wanted.has(id)),
	}
}

/** A locking read of one group by its primary key (ADR-0024 decision d; MySQL 8.4 "Locking Reads"). */
export const lockGroup = (tx: Pick<Tx, 'select'>, id: string) =>
	tx
		.select({ id: userGroups.id })
		.from(userGroups)
		.where(eq(userGroups.id, id))
		.limit(1)
		.for('update')

/**
 * The group's manual members, the rows an admin's save diffs and changes (spec §2 #8). A locking read (MySQL 8.4
 * "Locking Reads": before writes to related data in the same transaction, "the regular SELECT statement does not give
 * enough protection"): it reads the latest committed rows whatever the transaction read before, and holds them until
 * the commit.
 */
export const manualMembersOf = (tx: Pick<Tx, 'select'>, groupId: string) =>
	tx
		.select({ userId: userGroupMembers.userId })
		.from(userGroupMembers)
		.where(and(eq(userGroupMembers.groupId, groupId), eq(userGroupMembers.source, 'manual')))
		.for('update')

/** Deletes the named manual memberships of the group; its directory rows stay (spec §2 #8). */
export const removeManualMembers = (
	tx: Pick<Tx, 'delete'>,
	groupId: string,
	userIds: readonly string[],
) =>
	tx
		.delete(userGroupMembers)
		.where(
			and(
				eq(userGroupMembers.groupId, groupId),
				eq(userGroupMembers.source, 'manual'),
				inArray(userGroupMembers.userId, userIds),
			),
		)

const manualRows = (groupId: string, userIds: readonly string[]) =>
	userIds.map(userId => ({ groupId, userId, source: 'manual' as const }))

/** The group's links, with a locking read (MySQL 8.4 "Locking Reads"), before the save changes them. */
export const linksOf = (tx: Pick<Tx, 'select'>, groupId: string) =>
	tx
		.select({
			directoryGroupId: userGroupDirectoryLinks.directoryGroupId,
			directoryGroupName: userGroupDirectoryLinks.directoryGroupName,
		})
		.from(userGroupDirectoryLinks)
		.where(eq(userGroupDirectoryLinks.groupId, groupId))
		.for('update')

export const removeLinks = (tx: Pick<Tx, 'delete'>, groupId: string, keys: readonly string[]) =>
	tx
		.delete(userGroupDirectoryLinks)
		.where(
			and(
				eq(userGroupDirectoryLinks.groupId, groupId),
				inArray(userGroupDirectoryLinks.directoryGroupId, keys),
			),
		)

/** Decision am: every directory membership of the group, when its last link goes; its manual rows stay (spec §2 #8). */
export const removeDirectoryMembers = (tx: Pick<Tx, 'delete'>, groupId: string) =>
	tx
		.delete(userGroupMembers)
		.where(and(eq(userGroupMembers.groupId, groupId), eq(userGroupMembers.source, 'directory')))

/** Decision am: what a save changes in the links, by key; a kept link takes the picked name. */
export const directoryLinkChanges = (
	current: readonly { directoryGroupId: string; directoryGroupName: string }[],
	next: readonly { id: string; name: string }[],
): {
	add: { id: string; name: string }[]
	remove: string[]
	rename: { id: string; name: string }[]
} => {
	const now = new Map(current.map(link => [link.directoryGroupId, link.directoryGroupName]))
	const wanted = new Map(next.map(link => [link.id, link.name]))
	return {
		add: [...wanted].filter(([id]) => !now.has(id)).map(([id, name]) => ({ id, name })),
		remove: [...now.keys()].filter(id => !wanted.has(id)),
		rename: [...wanted]
			.filter(([id, name]) => now.has(id) && now.get(id) !== name)
			.map(([id, name]) => ({ id, name })),
	}
}

const linkRows = (groupId: string, links: readonly { id: string; name: string }[]) =>
	links.map(link => ({ groupId, directoryGroupId: link.id, directoryGroupName: link.name }))

/** A write's expected refusals as results; anything else propagates to the action (toActionFailure). */
const refusalOf = (error: unknown) => {
	if (isDuplicateEntry(error)) return fail('name_in_use')
	if (isMissingReference(error)) return fail('invalid_input', { memberIds: ['unknown'] })
	return null
}

export async function listGroups(actor: SessionUser): Promise<GroupDto[]> {
	assertAdmin(actor)
	const db = getDb()
	const [groups, members, grants, links] = await Promise.all([
		db
			.select({
				id: userGroups.id,
				name: userGroups.name,
				description: userGroups.description,
				createdAt: userGroups.createdAt,
				updatedAt: userGroups.updatedAt,
			})
			.from(userGroups)
			.orderBy(asc(userGroups.name)),
		db
			.select({
				groupId: userGroupMembers.groupId,
				userId: userGroupMembers.userId,
				source: userGroupMembers.source,
			})
			.from(userGroupMembers),
		db
			.select({ groupId: appGroupGrants.groupId, apps: count() })
			.from(appGroupGrants)
			.groupBy(appGroupGrants.groupId),
		db
			.select({
				groupId: userGroupDirectoryLinks.groupId,
				directoryGroupId: userGroupDirectoryLinks.directoryGroupId,
				directoryGroupName: userGroupDirectoryLinks.directoryGroupName,
				missingSince: userGroupDirectoryLinks.missingSince,
			})
			.from(userGroupDirectoryLinks),
	])
	return toGroupDtos(groups, members, grants, links)
}

export async function listGroupOptions(actor: SessionUser): Promise<GroupOption[]> {
	assertAdmin(actor)
	return getDb()
		.select({ id: userGroups.id, name: userGroups.name })
		.from(userGroups)
		.orderBy(asc(userGroups.name))
}

export async function createGroup(
	actor: SessionUser,
	input: GroupInput,
): Promise<ActionResult<{ id: string }>> {
	assertAdmin(actor)
	const id = crypto.randomUUID()
	const memberIds = [...new Set(input.memberIds)]
	// Decision am: each directory group once per key, the last name kept (MDN `Map`: a repeated key replaces the value).
	const unique = [...new Map(input.directoryGroups.map(link => [link.id, link.name]))].map(
		([key, name]) => ({ id: key, name }),
	)
	try {
		await getDb().transaction(async tx => {
			await tx
				.insert(userGroups)
				.values({ id, name: input.name, description: input.description || null })
			if (memberIds.length) await tx.insert(userGroupMembers).values(manualRows(id, memberIds))
			if (unique.length) await tx.insert(userGroupDirectoryLinks).values(linkRows(id, unique))
		})
	} catch (error) {
		const refusal = refusalOf(error)
		if (refusal) return refusal
		throw error
	}
	return ok({ id })
}

/**
 * Renames and re-describes the group, replaces its manual members and its directory links (decision am); its directory
 * members stay while a link is left, for the next sync or sign-in to recompute (spec §2 #8, §6.4 step 4).
 */
export async function updateGroup(
	actor: SessionUser,
	id: string,
	input: GroupInput,
): Promise<ActionResult> {
	assertAdmin(actor)
	try {
		return await getDb().transaction(async tx => {
			const [group] = await lockGroup(tx, id)
			if (!group) return fail('not_found')
			await tx
				.update(userGroups)
				.set({ name: input.name, description: input.description || null })
				.where(eq(userGroups.id, id))
			const current = await manualMembersOf(tx, id)
			const { add, remove } = manualMemberChanges(
				current.map(row => row.userId),
				input.memberIds,
			)
			if (remove.length) await removeManualMembers(tx, id, remove)
			if (add.length) await tx.insert(userGroupMembers).values(manualRows(id, add))
			const currentLinks = await linksOf(tx, id)
			const links = directoryLinkChanges(currentLinks, input.directoryGroups)
			if (links.remove.length) await removeLinks(tx, id, links.remove)
			if (links.add.length) await tx.insert(userGroupDirectoryLinks).values(linkRows(id, links.add))
			for (const link of links.rename)
				await tx
					.update(userGroupDirectoryLinks)
					.set({ directoryGroupName: link.name })
					.where(
						and(
							eq(userGroupDirectoryLinks.groupId, id),
							eq(userGroupDirectoryLinks.directoryGroupId, link.id),
						),
					)
			// Decision am: with no link left, nothing would refresh the group's directory members, so they go now.
			if (currentLinks.length > 0 && input.directoryGroups.length === 0)
				await removeDirectoryMembers(tx, id)
			return ok(undefined)
		})
	} catch (error) {
		const refusal = refusalOf(error)
		if (refusal) return refusal
		throw error
	}
}

/** Deletes the group; its memberships, grants and (B3b) directory links go with it (ON DELETE CASCADE). */
export async function deleteGroup(actor: SessionUser, id: string): Promise<ActionResult> {
	assertAdmin(actor)
	const [result] = await getDb().delete(userGroups).where(eq(userGroups.id, id))
	return result.affectedRows > 0 ? ok(undefined) : fail('not_found')
}
