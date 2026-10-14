import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, createApp, updateApp, deleteApp, getStoredSecrets, refresh } = vi.hoisted(
	() => ({
		getServerSession: vi.fn(),
		createApp: vi.fn(),
		updateApp: vi.fn(),
		deleteApp: vi.fn(),
		getStoredSecrets: vi.fn(),
		refresh: vi.fn(),
	}),
)
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/data/apps', () => ({ createApp, updateApp, deleteApp, getStoredSecrets }))
vi.mock('next/cache', () => ({ refresh }))

import {
	createAppAction,
	deleteAppAction,
	testAppConnectionAction,
	updateAppAction,
} from '@/app/(admin)/app-management/actions'

const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'admin' }
const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const ACCOUNT_ID = '3d1a6f4b-8e5a-4192-ad0e-4f5a6b7c8d93'
const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'chat',
	answerForm: { enabled: false, feedbackText: '' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'default',
}
const values = {
	provider: 'dify',
	name: 'Tea',
	description: '',
	tags: [],
	enabled: true,
	access: { mode: 'restricted', groupIds: [], userIds: [] },
	settings,
	secrets: { apiKey: 'app-abc' },
}
const formData = (over: Record<string, unknown> = {}, file?: File) => {
	const data = new FormData()
	data.set('values', JSON.stringify({ ...values, ...over }))
	data.set('iconIntent', file ? 'replace' : 'keep')
	if (file) data.set('icon', file)
	return data
}
const common = { name: 'Tea', description: '', tags: [], enabled: true }
const access = { mode: 'restricted', groupIds: [], userIds: [] }

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
	for (const fn of [getServerSession, createApp, updateApp, deleteApp, getStoredSecrets, refresh])
		fn.mockReset()
	getServerSession.mockResolvedValue({ user: actor })
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('createAppAction and updateAppAction (spec §4.3)', () => {
	it('answers unauthorized without a live session and touches nothing', async () => {
		getServerSession.mockResolvedValue(null)
		expect(await createAppAction(formData())).toEqual({ ok: false, code: 'unauthorized' })
		expect(createApp).not.toHaveBeenCalled()
	})
	it('creates through the DAL with the parsed input, refreshes the route and answers its result', async () => {
		createApp.mockResolvedValue({ ok: true, data: { id: UUID } })
		expect(await createAppAction(formData())).toEqual({ ok: true, data: { id: UUID } })
		expect(createApp).toHaveBeenCalledWith(actor, {
			provider: 'dify',
			common,
			access,
			settings,
			secrets: { apiKey: 'app-abc' },
			icon: { intent: 'keep' },
		})
		expect(refresh).toHaveBeenCalledTimes(1)
	})
	it('hands the DAL a replacement icon’s file', async () => {
		createApp.mockResolvedValue({ ok: true, data: { id: UUID } })
		const file = new File([new Uint8Array([1])], 'icon.png', { type: 'image/png' })
		await createAppAction(formData({}, file))
		expect(createApp.mock.calls[0]![1].icon).toMatchObject({
			intent: 'replace',
			file: { name: 'icon.png' },
		})
	})
	it('answers invalid_input for values the schema refuses, by field, before the DAL', async () => {
		expect(await createAppAction(formData({ name: '' }))).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { name: ['too_small'] },
		})
		expect(createApp).not.toHaveBeenCalled()
	})
	it('passes a refusal of the DAL on, without a refresh', async () => {
		createApp.mockResolvedValue({
			ok: false,
			code: 'invalid_image',
			fieldErrors: { icon: ['too_large'] },
		})
		expect(await createAppAction(formData())).toEqual({
			ok: false,
			code: 'invalid_image',
			fieldErrors: { icon: ['too_large'] },
		})
		expect(refresh).not.toHaveBeenCalled()
	})
	// Spec §2.3: the edit takes no provider, and a blank key keeps the stored one.
	it('updates with no provider and a blank key read as not given', async () => {
		updateApp.mockResolvedValue({ ok: true, data: undefined })
		expect(await updateAppAction(UUID, formData({ secrets: { apiKey: '' } }))).toEqual({
			ok: true,
			data: undefined,
		})
		expect(updateApp).toHaveBeenCalledWith(actor, UUID, {
			common,
			access,
			settings,
			secrets: { apiKey: undefined },
			icon: { intent: 'keep' },
		})
		updateApp.mockResolvedValue({ ok: false, code: 'not_found' })
		expect(await updateAppAction(UUID, formData())).toEqual({ ok: false, code: 'not_found' })
	})

	// Part 0 spec §3.2: an id that is not a UUID would raise 22P02 in PostgreSQL; it is answered as an unknown app.
	it.each([
		['updateAppAction', () => updateAppAction('not-a-uuid', formData())],
		['deleteAppAction', () => deleteAppAction('not-a-uuid')],
	] as const)(
		'%s answers not_found for an id that is not a UUID, without asking the DAL',
		async (_name, call) => {
			expect(await call()).toEqual({ ok: false, code: 'not_found' })
			for (const fn of [updateApp, deleteApp, refresh]) expect(fn).not.toHaveBeenCalled()
		},
	)
	it('deletes, answering not_found when the row is gone', async () => {
		deleteApp.mockResolvedValue(true)
		expect(await deleteAppAction(UUID)).toEqual({ ok: true, data: undefined })
		deleteApp.mockResolvedValue(false)
		expect(await deleteAppAction(UUID)).toEqual({ ok: false, code: 'not_found' })
		expect(refresh).toHaveBeenCalledTimes(1)
	})
	// B3a deviation 3: a group or account picked in the drawer was deleted before the save.
	it.each([
		['createAppAction', () => createAppAction(formData()), createApp],
		['updateAppAction', () => updateAppAction(UUID, formData()), updateApp],
	] as const)(
		'%s answers invalid_input on the access field when a granted id is gone',
		async (_name, call, dal) => {
			dal.mockRejectedValue(
				new Error('Failed query', {
					cause: Object.assign(new Error('violates foreign key constraint'), {
						code: '23503',
						constraint: 'app_user_grants_user_id_users_id_fkey',
					}),
				}),
			)
			expect(await call()).toEqual({
				ok: false,
				code: 'invalid_input',
				fieldErrors: { access: ['unknown'] },
			})
			expect(refresh).not.toHaveBeenCalled()
		},
	)
	it('passes the access settings to the DAL as parsed', async () => {
		createApp.mockResolvedValue({ ok: true, data: { id: UUID } })
		const groupId = '6f1c2a9e-1b2c-4d3e-8f40-5a6b7c8d9e0f'
		const granted = { mode: 'restricted', groupIds: [groupId], userIds: [ACCOUNT_ID] }
		await createAppAction(formData({ access: granted }))
		expect(createApp.mock.calls[0]![1].access).toEqual(granted)
	})
	it.each([
		['createAppAction', () => createAppAction(formData())],
		['updateAppAction', () => updateAppAction(UUID, formData())],
		['deleteAppAction', () => deleteAppAction(UUID)],
		[
			'testAppConnectionAction',
			() => testAppConnectionAction({ provider: 'dify', settings, secrets: values.secrets }),
		],
	] as const)('%s answers forbidden to a user-role account', async (_name, call) => {
		getServerSession.mockResolvedValue({ user: { ...actor, role: 'user' } })
		expect(await call()).toEqual({ ok: false, code: 'forbidden' })
		for (const fn of [createApp, updateApp, deleteApp, getStoredSecrets, refresh])
			expect(fn).not.toHaveBeenCalled()
		expect(fetchMock).not.toHaveBeenCalled()
	})
	it('lets the owner through as well', async () => {
		const owner = { ...actor, role: 'owner' }
		getServerSession.mockResolvedValue({ user: owner })
		deleteApp.mockResolvedValue(true)
		expect(await deleteAppAction(UUID)).toEqual({ ok: true, data: undefined })
		expect(deleteApp).toHaveBeenCalledWith(owner, UUID)
	})
})

// Spec §4.2 and §9: against a mocked /info, with a typed key and with the stored one. The action saves nothing.
describe('testAppConnectionAction', () => {
	const json = (status: number, body: unknown) =>
		new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
	const sentKey = () =>
		new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers).get('authorization')

	it('tests with the typed key and answers reachable', async () => {
		fetchMock.mockResolvedValue(json(200, { name: 'Tea', mode: 'chat' }))
		expect(
			await testAppConnectionAction({
				provider: 'dify',
				settings,
				secrets: { apiKey: 'app-typed' },
			}),
		).toEqual({ ok: true, data: { outcome: 'reachable' } })
		expect(fetchMock.mock.calls[0]![0]).toBe('https://dify.example/v1/info')
		expect(sentKey()).toBe('Bearer app-typed')
		expect(getStoredSecrets).not.toHaveBeenCalled()
	})
	it('reads the stored key on the server when the field is blank and the app exists', async () => {
		getStoredSecrets.mockResolvedValue({ secrets: { apiKey: 'app-stored' } })
		fetchMock.mockResolvedValue(json(200, { name: 'Tea', mode: 'chat' }))
		expect(
			await testAppConnectionAction({
				appId: UUID,
				provider: 'dify',
				settings,
				secrets: { apiKey: '' },
			}),
		).toEqual({ ok: true, data: { outcome: 'reachable' } })
		expect(getStoredSecrets).toHaveBeenCalledWith(actor, UUID, 'dify')
		expect(sentKey()).toBe('Bearer app-stored')
	})
	it('leaves the stored secrets alone when every secret is typed, on a saved app too', async () => {
		fetchMock.mockResolvedValue(json(200, { name: 'Tea', mode: 'chat' }))
		expect(
			await testAppConnectionAction({
				appId: UUID,
				provider: 'dify',
				settings,
				secrets: { apiKey: 'app-typed' },
			}),
		).toEqual({ ok: true, data: { outcome: 'reachable' } })
		expect(getStoredSecrets).not.toHaveBeenCalled()
		expect(sentKey()).toBe('Bearer app-typed')
	})
	it('answers the type Dify reports when it differs, as a success', async () => {
		fetchMock.mockResolvedValue(json(200, { name: 'Tea', mode: 'workflow' }))
		expect(
			await testAppConnectionAction({ provider: 'dify', settings, secrets: { apiKey: 'app-k' } }),
		).toEqual({ ok: true, data: { outcome: 'type_mismatch', reported: 'workflow' } })
	})
	it.each([
		[
			'a refused key',
			() => json(401, { code: 'unauthorized', message: 'x', status: 401 }),
			'provider_key_refused',
		],
		['an unreachable provider', () => new Response(null, { status: 503 }), 'provider_unreachable'],
		[
			'any other answer',
			() => json(403, { code: 'forbidden', message: 'x', status: 403 }),
			'provider_error',
		],
	])('answers %s with its own code', async (_label, answer, code) => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		fetchMock.mockImplementation(async () => answer())
		expect(
			await testAppConnectionAction({ provider: 'dify', settings, secrets: { apiKey: 'app-k' } }),
		).toEqual({ ok: false, code })
	})
	it('answers not_found for an app that is not there, and calls nothing', async () => {
		getStoredSecrets.mockResolvedValue(null)
		expect(
			await testAppConnectionAction({
				appId: UUID,
				provider: 'dify',
				settings,
				secrets: { apiKey: '' },
			}),
		).toEqual({ ok: false, code: 'not_found' })
		expect(fetchMock).not.toHaveBeenCalled()
	})
	it('answers invalid_input on the key when a new app’s key is blank', async () => {
		expect(
			await testAppConnectionAction({ provider: 'dify', settings, secrets: { apiKey: '' } }),
		).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { 'secrets.apiKey': ['invalid_type'] },
		})
		expect(fetchMock).not.toHaveBeenCalled()
	})
	// Ruling R4 (review B7): a refused input answers by field with codes only, as the save actions do; no zod message,
	// which can echo the input (a typed key included), reaches the browser.
	it('answers invalid_input for an input the schema refuses, by field with codes only, and calls nothing', async () => {
		const result = await testAppConnectionAction({
			appId: 'not-a-uuid',
			provider: 'dify',
			settings: { ...settings, apiBase: 'ftp://dify.example/v1' },
			secrets: { apiKey: 'app-typed-secret' },
		})
		expect(result).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { appId: ['invalid_format'], 'settings.apiBase': ['invalid_format'] },
		})
		expect(JSON.stringify(result)).not.toContain('app-typed-secret')
		expect(getStoredSecrets).not.toHaveBeenCalled()
		expect(fetchMock).not.toHaveBeenCalled()
	})
})
