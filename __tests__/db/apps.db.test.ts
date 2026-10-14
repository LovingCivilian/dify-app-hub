import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', async () => {
	const { testDb } = await import('./database')
	return { getDb: () => testDb }
})
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { apps, userGroups } from '@/db/schema'
import {
	createApp,
	getAppAccess,
	getChatApp,
	getStoredSecrets,
	listAdminApps,
	listApps,
	updateApp,
} from '@/lib/data/apps'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterEach(() => {
	vi.restoreAllMocks()
})
afterAll(() => pool.end())

const owner = {
	id: crypto.randomUUID(),
	email: 'owner@example.com',
	name: null,
	role: 'owner' as const,
	source: 'local' as const,
}
const member = {
	id: crypto.randomUUID(),
	email: 'member@example.com',
	name: null,
	role: 'user' as const,
	source: 'local' as const,
}
const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'advanced-chat',
	answerForm: { enabled: true, feedbackText: 'Thanks' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'always',
}
const common = { name: 'Tea', description: 'Brews tea', tags: ['a', 'b'], enabled: true }
const everyone = { mode: 'everyone' as const, groupIds: [], userIds: [] }
const create = (over: Record<string, unknown> = {}) =>
	createApp(owner, {
		provider: 'dify',
		common,
		access: everyone,
		settings,
		secrets: { apiKey: 'app-secret' },
		icon: { intent: 'keep' },
		...over,
	})
const createdId = async (over: Record<string, unknown> = {}) => {
	const result = await create(over)
	if (!result.ok) throw new Error(`createApp refused: ${result.code}`)
	return result.data.id
}
const stored = async (id: string) => (await testDb.select().from(apps).where(eq(apps.id, id)))[0]
const png = async (width: number, height: number) =>
	sharp({ create: { width, height, channels: 4, background: '#1677ff' } })
		.png()
		.toBuffer()

describe('createApp (spec §2.3)', () => {
	it('stores the provider and both documents as their schemas read them', async () => {
		const id = await createdId({ secrets: { apiKey: '  app-secret  ' } })
		expect(await stored(id)).toMatchObject({
			provider: 'dify',
			name: 'Tea',
			description: 'Brews tea',
			tags: ['a', 'b'],
			isEnabled: true,
			accessMode: 'everyone',
			settings,
			secrets: { apiKey: 'app-secret' },
			iconImage: null,
			iconMime: null,
		})
	})
	it('refuses settings its provider’s schema refuses, by field, and writes nothing', async () => {
		expect(await create({ settings: { ...settings, apiBase: 'ftp://x/v1' } })).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { 'settings.apiBase': ['invalid_format'] },
		})
		expect(await create({ secrets: { apiKey: '' } })).toMatchObject({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { 'secrets.apiKey': ['too_small'] },
		})
		expect(await testDb.select().from(apps)).toEqual([])
	})
	// Spec §4.4: the image through the pipeline, as a PNG of at most 256 × 256.
	it('stores an uploaded icon as a PNG inside 256 × 256', async () => {
		const file = new File([await png(1024, 512)], 'icon.png', { type: 'image/png' })
		const id = await createdId({ icon: { intent: 'replace', file } })
		const row = await stored(id)
		expect(row?.iconMime).toBe('image/png')
		const meta = await sharp(row!.iconImage!).metadata()
		expect([meta.format, meta.width, meta.height]).toEqual(['png', 256, 128])
	})
	it('refuses an icon that is not a PNG, JPEG or WebP, and writes nothing', async () => {
		const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'icon.svg', {
			type: 'image/svg+xml',
		})
		expect(await create({ icon: { intent: 'replace', file } })).toEqual({
			ok: false,
			code: 'invalid_image',
			fieldErrors: { icon: ['not_allowed'] },
		})
		expect(await testDb.select().from(apps)).toEqual([])
	})
	// One transaction: a group deleted before the save rejects the grant insert (23503) and leaves no app behind.
	it('writes no app when a granted group no longer exists', async () => {
		await expect(
			create({
				access: { mode: 'restricted', groupIds: [crypto.randomUUID()], userIds: [] },
			}),
		).rejects.toMatchObject({ cause: { code: '23503' } })
		expect(await testDb.select().from(apps)).toEqual([])
	})
})

describe('updateApp (spec §2.3)', () => {
	const update = (id: string, over: Record<string, unknown> = {}) =>
		updateApp(owner, id, {
			common: { ...common, name: 'Tea 2' },
			access: everyone,
			settings,
			secrets: { apiKey: undefined },
			icon: { intent: 'keep' },
			...over,
		})

	it('keeps the stored key when the field is blank, and replaces it when one is typed', async () => {
		const id = await createdId()
		expect(await update(id)).toEqual({ ok: true, data: undefined })
		expect(await stored(id)).toMatchObject({ name: 'Tea 2', secrets: { apiKey: 'app-secret' } })
		expect(await update(id, { secrets: { apiKey: 'app-new' } })).toEqual({
			ok: true,
			data: undefined,
		})
		expect((await stored(id))?.secrets).toEqual({ apiKey: 'app-new' })
	})
	// Review Focus 1: a row whose stored key is broken is repaired by typing one; a blank key cannot repair it.
	it('refuses a blank key over broken stored secrets, by field, and writes nothing', async () => {
		const id = await createdId()
		await testDb
			.update(apps)
			.set({ secrets: { apiKey: '' } })
			.where(eq(apps.id, id))
		expect(await update(id)).toMatchObject({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { 'secrets.apiKey': ['too_small'] },
		})
		expect((await stored(id))?.name).toBe('Tea')
		expect(await update(id, { secrets: { apiKey: 'app-fixed' } })).toEqual({
			ok: true,
			data: undefined,
		})
	})
	it('replaces and removes the icon', async () => {
		const id = await createdId()
		const file = new File([await png(64, 64)], 'icon.png', { type: 'image/png' })
		await update(id, { icon: { intent: 'replace', file } })
		expect((await stored(id))?.iconMime).toBe('image/png')
		await update(id, { icon: { intent: 'remove' } })
		expect(await stored(id)).toMatchObject({ iconImage: null, iconMime: null })
	})
	it('answers not_found for an app that is gone', async () => {
		expect(await update(crypto.randomUUID())).toEqual({ ok: false, code: 'not_found' })
	})
	// Spec §2.3: the provider is fixed; an input that names another is never read (the CHECK would refuse 'agui').
	it('keeps the stored provider whatever the input says', async () => {
		const id = await createdId()
		expect(await update(id, { provider: 'agui' })).toEqual({ ok: true, data: undefined })
		expect((await stored(id))?.provider).toBe('dify')
	})
	// Decision 18: saving never calls a provider, so a create and an update reach no fetch at all.
	it('never calls the provider, on a create or an update', async () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal('fetch', fetchSpy)
		try {
			const id = await createdId()
			expect(await update(id)).toEqual({ ok: true, data: undefined })
		} finally {
			vi.unstubAllGlobals()
		}
		expect(fetchSpy).not.toHaveBeenCalled()
	})
})

describe('the reads (spec §2.3)', () => {
	it('give the admin which secrets are set, never their values', async () => {
		const id = await createdId()
		const [dto] = await listAdminApps(owner)
		expect(dto).toMatchObject({
			id,
			provider: 'dify',
			invalid: false,
			settings,
			secretsSet: { apiKey: true },
			hasIcon: false,
		})
		expect(JSON.stringify(dto)).not.toContain('app-secret')
	})
	// Spec §2.3: a row whose documents fail is never returned half-typed.
	it('mark a broken row invalid for the admin, with no settings, and hide it from users', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const id = await createdId()
		await testDb
			.update(apps)
			.set({ settings: { ...settings, appType: null } })
			.where(eq(apps.id, id))
		const [dto] = await listAdminApps(owner)
		expect(dto).toMatchObject({ id, invalid: true, name: 'Tea' })
		expect(dto).not.toHaveProperty('settings')
		expect(dto).not.toHaveProperty('secretsSet')
		expect(await listApps(member)).toEqual([])
		expect(await getChatApp(member, id)).toBeNull()
		expect(await getAppAccess(member, id)).toBeNull()
		expect(spy).toHaveBeenCalledWith('Stored app documents refused:', {
			appId: id,
			code: 'invalid_settings',
		})
	})
	it('give users their DTOs without the secrets or the API base', async () => {
		const id = await createdId()
		const [summary] = await listApps(member)
		expect(summary).toMatchObject({ id, provider: 'dify', appType: 'advanced-chat' })
		const chat = await getChatApp(member, id)
		expect(chat).toMatchObject({ id, appType: 'advanced-chat' })
		for (const dto of [summary, chat]) {
			expect(JSON.stringify(dto)).not.toContain('app-secret')
			expect(JSON.stringify(dto)).not.toContain('dify.example')
		}
	})
	it('give a provider route the checked documents', async () => {
		const id = await createdId()
		expect(await getAppAccess(member, id)).toEqual({
			id,
			enabled: true,
			provider: 'dify',
			settings,
			secrets: { apiKey: 'app-secret' },
		})
	})
	// Spec §4.2: the stored secrets for a test that leaves a field blank; only an app of that provider.
	it('read the stored secrets for the connection test', async () => {
		const id = await createdId()
		expect(await getStoredSecrets(owner, id, 'dify')).toEqual({ secrets: { apiKey: 'app-secret' } })
		expect(await getStoredSecrets(owner, crypto.randomUUID(), 'dify')).toBeNull()
		await expect(getStoredSecrets(member, id, 'dify')).rejects.toMatchObject({ code: 'forbidden' })
	})
	it('keep a group grant: a restricted app is listed to a member of a granted group', async () => {
		const groupId = crypto.randomUUID()
		await testDb.insert(userGroups).values({ id: groupId, name: 'G' })
		const id = await createdId({ access: { mode: 'restricted', groupIds: [groupId], userIds: [] } })
		expect(await listApps(member)).toEqual([])
		await pool.query(
			"INSERT INTO users (id, email, password) VALUES ($1, 'member@example.com', 'hash')",
			[member.id],
		)
		await pool.query(
			"INSERT INTO user_group_members (group_id, user_id, source) VALUES ($1, $2, 'manual')",
			[groupId, member.id],
		)
		expect((await listApps(member)).map(app => app.id)).toEqual([id])
	})
})
