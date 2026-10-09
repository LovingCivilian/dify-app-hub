import { drizzle } from 'drizzle-orm/mysql2'
import type { SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The fake chain keeps the condition each read passes to where(), so a test can render it on drizzle.mock().
const { where, rows } = vi.hoisted(() => ({
	where: vi.fn(),
	rows: { value: [] as unknown[] },
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => {
	const chain = {
		from: () => chain,
		where: (condition: unknown) => {
			where(condition)
			return chain
		},
		orderBy: () => Promise.resolve(rows.value),
		limit: () => Promise.resolve(rows.value),
	}
	const db = { select: () => chain }
	return { getDb: () => db }
})

import { difyApps } from '@/db/schema'
import { getAppAccess, getAppIcon, getChatApp, listApps, visibleTo } from '@/lib/data/apps'

const user = { id: 'u1', email: 'u@example.com', name: null, role: 'user' as const }
const admin = { id: 'a1', email: 'a@example.com', name: null, role: 'admin' as const }
const owner = { id: 'o1', email: 'o@example.com', name: null, role: 'owner' as const }

/** A condition rendered on a select from dify_apps (no connection). */
const render = (condition: unknown) =>
	drizzle
		.mock()
		.select({ id: difyApps.id })
		.from(difyApps)
		.where(condition as SQL | undefined)
		.toSQL()

beforeEach(() => {
	where.mockClear()
	rows.value = []
})

describe('visibleTo (spec §4.1)', () => {
	it('gives an account with admin rights every app: no condition', () => {
		expect(visibleTo(admin)).toBeUndefined()
		expect(visibleTo(owner)).toBeUndefined()
	})

	it('lets a user see an app open to everyone, granted to it, or granted to one of its groups', () => {
		const { sql, params } = render(visibleTo(user))
		expect(sql).toMatch(/`dify_apps`\.`access_mode` = \?/)
		// Drizzle 1.0.0-rc.3 parenthesises each and()/or() operand.
		expect(sql).toMatch(
			/exists \(select 1 from `app_user_grants` where \(\(`app_user_grants`\.`app_id` = `dify_apps`\.`id`\) and \(`app_user_grants`\.`user_id` = \?\)\)\)/,
		)
		expect(sql).toMatch(
			/exists \(select 1 from `app_group_grants` inner join `user_group_members` on `user_group_members`\.`group_id` = `app_group_grants`\.`group_id` where \(\(`app_group_grants`\.`app_id` = `dify_apps`\.`id`\) and \(`user_group_members`\.`user_id` = \?\)\)\)/,
		)
		// Any membership counts, whatever its source (spec §4.1); the actor's id is the only account parameter.
		expect(sql).not.toMatch(/`source`/)
		expect(params).toEqual(['everyone', 'u1', 'u1'])
	})

	// Review Focus 2: the rule follows the role the session refreshed from the row (ADR-0024 decision a).
	it('follows the role it is given for the same account', () => {
		expect(visibleTo({ id: 'x1', role: 'user' })).toBeDefined()
		expect(visibleTo({ id: 'x1', role: 'admin' })).toBeUndefined()
	})
})

// Review Focus 1: every read applies the same rule, for the list and for each single-app check.
describe('the app reads apply visibleTo', () => {
	it('listApps: the rule alone for a user, nothing for an admin', async () => {
		await listApps(user)
		expect(render(where.mock.calls[0]![0]).sql).toMatch(/exists/)
		await listApps(admin)
		expect(where.mock.calls[1]![0]).toBeUndefined()
	})

	it.each([
		['getChatApp', () => getChatApp(user, 'app-1')],
		['getAppAccess', () => getAppAccess(user, 'app-1')],
		['getAppIcon', () => getAppIcon(user, 'app-1')],
	] as const)('%s: the id and the rule for a user', async (_name, read) => {
		expect(await read()).toBeNull()
		const { sql, params } = render(where.mock.calls[0]![0])
		expect(sql).toMatch(/`dify_apps`\.`id` = \?\) and \(/)
		expect(sql).toMatch(/exists/)
		expect(params[0]).toBe('app-1')
	})

	it.each([
		['getChatApp', () => getChatApp(admin, 'app-1')],
		['getAppAccess', () => getAppAccess(admin, 'app-1')],
		['getAppIcon', () => getAppIcon(admin, 'app-1')],
	] as const)('%s: the id alone for an admin', async (_name, read) => {
		await read()
		const { sql, params } = render(where.mock.calls[0]![0])
		expect(sql).not.toMatch(/exists/)
		expect(params).toEqual(['app-1'])
	})
})
