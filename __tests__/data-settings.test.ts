import { drizzle } from 'drizzle-orm/node-postgres'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { calls, rows, failures } = vi.hoisted(() => ({
	calls: [] as unknown[][],
	rows: { value: [] as unknown[] },
	failures: { value: [] as unknown[] },
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', async () => {
	const { instanceSettingFiles, instanceSettings } = await import('@/db/schema')
	const nameOf = (table: unknown) =>
		table === instanceSettings
			? 'instance_settings'
			: table === instanceSettingFiles
				? 'instance_setting_files'
				: 'other'
	// The plain reads' chain answers no `.for()`; only the transaction's does, and it records the lock with its table and
	// strength, so a write path that read the row without the lock, or outside the transaction, fails the write tests.
	const chain = {
		leftJoin: () => chain,
		where: () => chain,
		limit: () => Promise.resolve(rows.value),
	}
	const lockableChain = (table: unknown) => {
		const lockable = {
			where: () => lockable,
			limit: () =>
				Object.assign(Promise.resolve(rows.value), {
					for: (strength: string) => {
						calls.push(['lock', nameOf(table), strength])
						return Promise.resolve(rows.value)
					},
				}),
		}
		return lockable
	}
	const outside = () => {
		throw new Error('a write outside the transaction')
	}
	const tx = {
		select: () => ({ from: lockableChain }),
		insert: (table: unknown) => ({
			values: (values: unknown) => ({
				// Drizzle "Upsert": pg-core's insert has `.onConflictDoUpdate({ target, set })`.
				onConflictDoUpdate: (update: unknown) => {
					calls.push(['upsert', nameOf(table), values, update])
					return Promise.resolve()
				},
			}),
		}),
		delete: (table: unknown) => ({
			where: () => {
				calls.push(['delete', nameOf(table)])
				return Promise.resolve()
			},
		}),
	}
	const db = {
		select: () => ({ from: () => chain }),
		insert: outside,
		delete: outside,
		transaction: async (work: (tx: unknown) => unknown) => {
			calls.push(['begin'])
			const failure = failures.value.shift()
			if (failure) {
				calls.push(['rollback'])
				throw failure
			}
			const result = await work(tx)
			calls.push(['commit'])
			return result
		},
	}
	return { getDb: () => db }
})

import { instanceSettingFiles, instanceSettings } from '@/db/schema'
import { AuthError } from '@/lib/auth/session'
import {
	deleteInstanceSettingFile,
	lockInstanceSetting,
	readInstanceSetting,
	readInstanceSettingChange,
	readInstanceSettingFile,
	selectInstanceSetting,
	selectInstanceSettingChange,
	selectInstanceSettingFile,
	writeInstanceSetting,
} from '@/lib/data/settings'

const admin = { id: 'a1', email: 'admin@example.com', name: null, role: 'admin' as const }
const user = { id: 'u1', email: 'user@example.com', name: null, role: 'user' as const }

beforeEach(() => {
	calls.length = 0
	rows.value = []
	failures.value = []
})

describe('the settings queries (SQL and parameters pinned, Drizzle "Goodies": toSQL)', () => {
	it('reads the document of one area, without the author', () => {
		const query = selectInstanceSetting(drizzle.mock(), 'branding').toSQL()
		expect(query.sql).toMatch(
			/^select "data" from "instance_settings" where "instance_settings"\."area" = \$1 limit \$2$/,
		)
		expect(query.params).toEqual(['branding', 1])
	})

	it("reads the author's email through a left join on the saving account", () => {
		const query = selectInstanceSettingChange(drizzle.mock(), 'branding').toSQL()
		expect(query.sql).toMatch(
			/^select .*"updated_at".*"email" from "instance_settings" left join "users" on "users"\."id" = "instance_settings"\."updated_by" where "instance_settings"\."area" = \$1 limit \$2$/,
		)
		expect(query.params).toEqual(['branding', 1])
	})

	it('reads one file by area and name', () => {
		const query = selectInstanceSettingFile(drizzle.mock(), 'branding', 'logo').toSQL()
		expect(query.sql).toMatch(
			/^select "bytes", "mime" from "instance_setting_files" where \(\("instance_setting_files"\."area" = \$1\) and \("instance_setting_files"\."name" = \$2\)\) limit \$3$/,
		)
		expect(query.params).toEqual(['branding', 'logo', 1])
	})

	it('locks the area row with FOR UPDATE', () => {
		const query = lockInstanceSetting(drizzle.mock(), 'branding').toSQL()
		expect(query.sql).toMatch(
			/^select "data" from "instance_settings" where "instance_settings"\."area" = \$1 limit \$2 for update$/,
		)
		expect(query.params).toEqual(['branding', 1])
	})

	it('deletes one file by area and name, never the area', () => {
		const query = deleteInstanceSettingFile(drizzle.mock(), 'branding', 'logo').toSQL()
		expect(query.sql).toMatch(
			/^delete from "instance_setting_files" where \(\("instance_setting_files"\."area" = \$1\) and \("instance_setting_files"\."name" = \$2\)\)$/,
		)
		expect(query.params).toEqual(['branding', 'logo'])
	})
})

describe('readInstanceSetting', () => {
	it('answers null before the first save, and the document afterwards', async () => {
		expect(await readInstanceSetting('branding')).toBeNull()
		rows.value = [{ data: { name: 'Acme' } }]
		expect(await readInstanceSetting('branding')).toEqual({ data: { name: 'Acme' } })
	})
})

describe('readInstanceSettingChange (gated: an admin only)', () => {
	it('refuses a user-role account, answers null before a save, and the change afterwards', async () => {
		await expect(readInstanceSettingChange(user, 'branding')).rejects.toBeInstanceOf(AuthError)
		expect(await readInstanceSettingChange(admin, 'branding')).toBeNull()
		const row = { updatedAt: new Date(), updatedByEmail: 'admin@example.com' }
		rows.value = [row]
		expect(await readInstanceSettingChange(admin, 'branding')).toEqual(row)
	})
})

describe('readInstanceSettingFile', () => {
	it('answers the bytes and type, or null', async () => {
		expect(await readInstanceSettingFile('branding', 'logo')).toBeNull()
		rows.value = [{ bytes: Buffer.from([1]), mime: 'image/png' }]
		expect(await readInstanceSettingFile('branding', 'logo')).toEqual({
			bytes: Buffer.from([1]),
			mime: 'image/png',
		})
	})
})

describe('writeInstanceSetting (spec §4.3: one transaction, the row read under a lock)', () => {
	it('refuses a user-role account before writing anything (ADR-0024: the DAL checks the role again)', async () => {
		const build = vi.fn(() => ({}))
		await expect(writeInstanceSetting(user, 'branding', build, {})).rejects.toBeInstanceOf(
			AuthError,
		)
		await expect(writeInstanceSetting(user, 'branding', build, {})).rejects.toMatchObject({
			code: 'forbidden',
		})
		expect(calls).toEqual([])
		expect(build).not.toHaveBeenCalled()
	})

	it('upserts the document with its author, upserts a new file, deletes a removed one and keeps an absent or undefined one', async () => {
		const logo = { bytes: Buffer.from([1, 2]), mime: 'image/png' }
		const saved = await writeInstanceSetting(admin, 'branding', () => ({ name: 'Acme' }), {
			logo,
			favicon: null,
			other: undefined,
		})
		expect(saved).toBe(true)
		expect(calls[0]).toEqual(['begin'])
		// The area row is read under FOR UPDATE inside the transaction, before any write (MySQL 8.4 "Locking Reads").
		expect(calls[1]).toEqual(['lock', 'instance_settings', 'update'])
		// ON CONFLICT names the key that decides "the same row" (PostgreSQL 18 "INSERT": conflict_target): the area for the
		// document, the area and name for a file, so the upsert updates the row in place and keeps its file rows.
		expect(calls[2]).toEqual([
			'upsert',
			'instance_settings',
			expect.objectContaining({ area: 'branding', data: { name: 'Acme' }, updatedBy: 'a1' }),
			{
				target: instanceSettings.area,
				set: expect.objectContaining({ data: { name: 'Acme' }, updatedBy: 'a1' }),
			},
		])
		expect(calls[3]).toEqual([
			'upsert',
			'instance_setting_files',
			expect.objectContaining({
				area: 'branding',
				name: 'logo',
				bytes: logo.bytes,
				mime: 'image/png',
			}),
			{
				target: [instanceSettingFiles.area, instanceSettingFiles.name],
				set: expect.objectContaining({ bytes: logo.bytes, mime: 'image/png' }),
			},
		])
		expect(calls[4]).toEqual(['delete', 'instance_setting_files'])
		expect(calls[5]).toEqual(['commit'])
		expect(calls).toHaveLength(6)
	})

	it('hands build the locked document, or null before the first save', async () => {
		const build = vi.fn(() => ({}))
		await writeInstanceSetting(admin, 'branding', build, {})
		expect(build).toHaveBeenLastCalledWith(null)
		rows.value = [{ data: { name: 'Old' } }]
		await writeInstanceSetting(admin, 'branding', build, {})
		expect(build).toHaveBeenLastCalledWith({ name: 'Old' })
	})

	it('writes nothing and answers false when build answers undefined', async () => {
		const saved = await writeInstanceSetting(admin, 'branding', () => undefined, {
			logo: { bytes: Buffer.from([1]), mime: 'image/png' },
		})
		expect(saved).toBe(false)
		expect(calls).toEqual([['begin'], ['lock', 'instance_settings', 'update'], ['commit']])
	})

	it('runs the transaction again after a deadlock, and not after another error', async () => {
		failures.value = [Object.assign(new Error('deadlock'), { code: '40P01' })]
		expect(await writeInstanceSetting(admin, 'branding', () => ({}), {})).toBe(true)
		expect(calls.filter(call => call[0] === 'begin')).toHaveLength(2)

		calls.length = 0
		failures.value = [new Error('boom')]
		await expect(writeInstanceSetting(admin, 'branding', () => ({}), {})).rejects.toThrow('boom')
		expect(calls.filter(call => call[0] === 'begin')).toHaveLength(1)

		calls.length = 0
		const deadlock = () => Object.assign(new Error('deadlock'), { code: '40P01' })
		failures.value = [deadlock(), deadlock(), deadlock()]
		await expect(writeInstanceSetting(admin, 'branding', () => ({}), {})).rejects.toThrow(
			'deadlock',
		)
		expect(calls.filter(call => call[0] === 'begin')).toHaveLength(3)
	})
})
