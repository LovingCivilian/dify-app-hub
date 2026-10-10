import 'server-only'

/*
 * The directory sync's reconciliation as pure functions (B3 spec §6.4, decision ab): from the hub's `ldap` accounts and
 * the directory's entries to what changes. The writes live in lib/data/directory.ts; the IO in lib/directory/sync.ts.
 */

/** A hub `ldap` account as the sync reads it. */
export interface SyncAccount {
	id: string
	directoryId: string | null
	directoryIdAttribute: string | null
	email: string
	name: string | null
	directoryUsername: string | null
	directoryDeactivatedAt: Date | null
}

/** A directory entry from the complete, error-free paged search, its key canonical (lib/directory/keys.ts). */
export interface SyncEntry {
	key: string
	username: string | null
	email: string | null
	name: string | null
}

/** One account's refreshed directory fields; `email` null keeps the stored email, `directoryUsername` null the stored name. */
export interface AccountUpdate {
	id: string
	name: string | null
	directoryUsername: string | null
	email: string | null
}

export type AccountPlan =
	| { stop: 'empty' | 'id_attribute_changed' }
	| {
			stop: null
			deactivate: string[]
			reactivate: string[]
			updates: AccountUpdate[]
			/** Every hub `ldap` account by its key, for the group step. */
			accountIdByKey: Map<string, string>
	  }

/**
 * Spec §6.4 steps 2–3. Two safety stops change nothing: zero entries (a filter written for another server matches
 * nothing without an error, RFC 4511 §4.5.1.7) and an account keyed by another attribute than LDAP_ID_ATTRIBUTE (every
 * key would miss; Mattermost documents that a changed ID attribute splits accounts). Otherwise: absent → deactivate
 * (once), present again → reactivate, present → refresh what changed. Entries without a hub account are ignored:
 * accounts are created at first sign-in only (Grafana: "Only users that have logged into Grafana at least once are
 * synchronized").
 */
export function planAccountChanges(
	accounts: readonly SyncAccount[],
	entries: readonly SyncEntry[],
	idAttribute: string,
): AccountPlan {
	if (entries.length === 0) return { stop: 'empty' }
	const wanted = idAttribute.toLowerCase()
	if (accounts.some(account => account.directoryIdAttribute?.toLowerCase() !== wanted))
		return { stop: 'id_attribute_changed' }
	const byKey = new Map(entries.map(entry => [entry.key, entry]))
	const deactivate: string[] = []
	const reactivate: string[] = []
	const updates: AccountUpdate[] = []
	const accountIdByKey = new Map<string, string>()
	for (const account of accounts) {
		if (account.directoryId === null) continue
		accountIdByKey.set(account.directoryId, account.id)
		const entry = byKey.get(account.directoryId)
		if (!entry) {
			if (account.directoryDeactivatedAt === null) deactivate.push(account.id)
			continue
		}
		if (account.directoryDeactivatedAt !== null) reactivate.push(account.id)
		const email = entry.email && entry.email !== account.email ? entry.email : null
		const username = entry.username ?? account.directoryUsername
		if (email !== null || entry.name !== account.name || username !== account.directoryUsername)
			updates.push({ id: account.id, name: entry.name, directoryUsername: username, email })
	}
	return { stop: null, deactivate, reactivate, updates, accountIdByKey }
}

export interface MembershipRow {
	groupId: string
	userId: string
}

export type LinkLookup = {
	groupId: string
	directoryGroupId: string
	result:
		| { status: 'found'; name: string; memberKeys: ReadonlySet<string> }
		| { status: 'missing' }
		| { status: 'error' }
}

/** A link's refreshed name, or null when the sync did not find its directory group. */
export interface LinkRefresh {
	groupId: string
	directoryGroupId: string
	name: string | null
}

export interface MembershipPlan {
	add: MembershipRow[]
	remove: MembershipRow[]
	groupErrors: number
	linkRefreshes: LinkRefresh[]
}

/**
 * Spec §6.4 step 4 and §6.5: each hub group's directory members are the hub `ldap` accounts found in any of its links;
 * a missing directory group counts as empty; a group with a failed lookup is left whole (decision ad); a group with no
 * link left loses its directory members (decision f). Only `directory` rows are planned (spec §2 #8).
 */
export function planDirectoryMemberships(
	lookups: readonly LinkLookup[],
	accountIdByKey: ReadonlyMap<string, string>,
	current: readonly MembershipRow[],
): MembershipPlan {
	const failed = new Set(
		lookups.filter(lookup => lookup.result.status === 'error').map(lookup => lookup.groupId),
	)
	const target = new Map<string, Set<string>>()
	for (const groupId of [
		...lookups.map(lookup => lookup.groupId),
		...current.map(row => row.groupId),
	])
		if (!failed.has(groupId) && !target.has(groupId)) target.set(groupId, new Set())
	const linkRefreshes: LinkRefresh[] = []
	for (const lookup of lookups) {
		if (lookup.result.status === 'error') continue
		const { groupId, directoryGroupId } = lookup
		if (lookup.result.status === 'missing') {
			linkRefreshes.push({ groupId, directoryGroupId, name: null })
			continue
		}
		linkRefreshes.push({ groupId, directoryGroupId, name: lookup.result.name })
		if (failed.has(groupId)) continue
		for (const key of lookup.result.memberKeys) {
			const userId = accountIdByKey.get(key)
			if (userId) target.get(groupId)!.add(userId)
		}
	}
	const have = Map.groupBy(current, row => row.groupId)
	const add: MembershipRow[] = []
	const remove: MembershipRow[] = []
	for (const [groupId, wanted] of target) {
		const now = new Set((have.get(groupId) ?? []).map(row => row.userId))
		for (const userId of wanted) if (!now.has(userId)) add.push({ groupId, userId })
		for (const userId of now) if (!wanted.has(userId)) remove.push({ groupId, userId })
	}
	const groupErrors = lookups.filter(lookup => lookup.result.status === 'error').length
	return { add, remove, groupErrors, linkRefreshes }
}
