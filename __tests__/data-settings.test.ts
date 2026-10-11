import { beforeEach, describe, expect, it, vi } from 'vitest'

const { calls, rows } = vi.hoisted(() => ({
	calls: [] as unknown[][],
	rows: { value: [] as unknown[] },
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
	const chain = {
		leftJoin: () => chain,
		where: () => chain,
		limit: () => Promise.resolve(rows.value),
	}
	const db = {
		select: () => ({ from: () => chain }),
		insert: (table: unknown) => ({
			values: (values: unknown) => ({
				onDuplicateKeyUpdate: (update: unknown) => {
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
		transaction: async (work: (tx: unknown) => unknown) => {
			calls.push(['begin'])
			await work(db)
			calls.push(['commit'])
		},
	}
	return { getDb: () => db }
})

import { AuthError } from '@/lib/auth/session'
import {
	readInstanceSetting,
	readInstanceSettingFile,
	writeInstanceSetting,
} from '@/lib/data/settings'

const admin = { id: 'a1', email: 'admin@example.com', name: null, role: 'admin' as const }
const user = { id: 'u1', email: 'user@example.com', name: null, role: 'user' as const }

beforeEach(() => {
	calls.length = 0
	rows.value = []
})

describe('readInstanceSetting', () => {
	it('answers null before the first save, and the row with its author afterwards', async () => {
		expect(await readInstanceSetting('branding')).toBeNull()
		const row = {
			data: { name: 'Acme' },
			updatedAt: new Date(),
			updatedBy: 'a1',
			updatedByEmail: 'admin@example.com',
		}
		rows.value = [row]
		expect(await readInstanceSetting('branding')).toEqual(row)
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

describe('writeInstanceSetting (spec §4.3: one transaction)', () => {
	it('refuses a user-role account before writing anything (ADR-0024: the DAL checks the role again)', async () => {
		await expect(writeInstanceSetting(user, 'branding', {}, {})).rejects.toBeInstanceOf(AuthError)
		await expect(writeInstanceSetting(user, 'branding', {}, {})).rejects.toMatchObject({
			code: 'forbidden',
		})
		expect(calls).toEqual([])
	})

	it('upserts the document with its author, upserts a new file, deletes a removed one and keeps an absent one', async () => {
		const logo = { bytes: Buffer.from([1, 2]), mime: 'image/png' }
		await writeInstanceSetting(admin, 'branding', { name: 'Acme' }, { logo, favicon: null })
		expect(calls[0]).toEqual(['begin'])
		expect(calls[1]).toEqual([
			'upsert',
			'instance_settings',
			expect.objectContaining({ area: 'branding', data: { name: 'Acme' }, updatedBy: 'a1' }),
			{ set: expect.objectContaining({ data: { name: 'Acme' }, updatedBy: 'a1' }) },
		])
		expect(calls[2]).toEqual([
			'upsert',
			'instance_setting_files',
			expect.objectContaining({
				area: 'branding',
				name: 'logo',
				bytes: logo.bytes,
				mime: 'image/png',
			}),
			{ set: expect.objectContaining({ bytes: logo.bytes, mime: 'image/png' }) },
		])
		expect(calls[3]).toEqual(['delete', 'instance_setting_files'])
		expect(calls[4]).toEqual(['commit'])
		expect(calls).toHaveLength(5)
	})
})
