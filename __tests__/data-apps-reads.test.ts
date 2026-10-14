import { afterEach, describe, expect, it, vi } from 'vitest'

// A fake Drizzle chain that records the selection and answers a delete with a chosen rowCount (node-postgres "Result":
// `rowCount` is null for a command it cannot count). vi.mock factories are hoisted, so the fake comes from vi.hoisted.
const { db } = vi.hoisted(() => {
	const db = {
		row: undefined as Record<string, unknown> | undefined,
		fields: undefined as Record<string, unknown> | undefined,
		deleted: 0 as number | null,
		select: (fields?: Record<string, unknown>) => {
			db.fields = fields
			const rows = async () => (db.row ? [db.row] : [])
			return { from: () => ({ where: () => ({ limit: rows, orderBy: rows }) }) }
		},
		delete: () => ({ where: async () => ({ rowCount: db.deleted }) }),
	}
	return { db }
})
vi.mock('@/db', () => ({ getDb: () => db }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { deleteApp, getChatApp, listApps } from '@/lib/data/apps'

const owner = { id: 'o1', email: 'o@example.com', name: null, role: 'owner' as const }
const member = { id: 'u1', email: 'u@example.com', name: null, role: 'user' as const }
const row = {
	id: 'a1',
	name: 'Tea',
	description: '',
	tags: [],
	isEnabled: true,
	hasIcon: true,
	provider: 'dify',
	settings: {
		apiBase: 'https://dify.example/v1',
		appType: 'chat',
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
	},
}

afterEach(() => {
	db.row = undefined
	db.fields = undefined
})

// Plan decision ab: a mapper cannot leak what is never read.
describe('the user reads select neither the secrets nor the icon bytes', () => {
	it.each([
		['listApps', () => listApps(member)],
		['getChatApp', () => getChatApp(member, 'a1')],
	])('%s', async (_name, read) => {
		db.row = row
		const result = await read()
		const fields = Object.keys(db.fields ?? {})
		expect(fields).toEqual(expect.arrayContaining(['provider', 'settings', 'hasIcon']))
		for (const column of ['secrets', 'iconImage', 'iconMime']) expect(fields).not.toContain(column)
		expect(Array.isArray(result) ? result[0] : result).toMatchObject({ id: 'a1', hasIcon: true })
	})
})

// Global Constraints: every rowCount consumer handles null (Part 0's ruling A10).
describe('deleteApp reads the row count', () => {
	it('answers true for a deleted row, and false for none or no row count (rowCount null)', async () => {
		db.deleted = 1
		await expect(deleteApp(owner, 'a1')).resolves.toBe(true)
		db.deleted = 0
		await expect(deleteApp(owner, 'a1')).resolves.toBe(false)
		db.deleted = null
		await expect(deleteApp(owner, 'a1')).resolves.toBe(false)
	})
})
