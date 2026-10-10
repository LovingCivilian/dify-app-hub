import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, createApp, updateApp, deleteApp, syncApp, refresh } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	createApp: vi.fn(),
	updateApp: vi.fn(),
	deleteApp: vi.fn(),
	syncApp: vi.fn(),
	refresh: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/data/apps', () => ({ createApp, updateApp, deleteApp, syncApp }))
vi.mock('next/cache', () => ({ refresh }))

import {
	createAppAction,
	deleteAppAction,
	syncAppAction,
	updateAppAction,
} from '@/app/(admin)/app-management/actions'
import { DifyError } from '@/lib/dify/errors'

const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'admin' }
const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const input = {
	apiBase: 'https://dify.example/v1',
	apiKey: 'app-abc',
	mode: 'chat',
	enabled: true,
	settings: {
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
		annotationEnabled: false,
	},
	access: { mode: 'restricted', groupIds: [], userIds: [] },
}

beforeEach(() => {
	for (const fn of [getServerSession, createApp, updateApp, deleteApp, syncApp, refresh])
		fn.mockReset()
	getServerSession.mockResolvedValue({ user: actor })
})
// toActionFailure logs a DifyError or an unexpected throw (lib/action-failure.ts); the spy keeps the output clean.
afterEach(() => {
	vi.restoreAllMocks()
})

describe('app actions', () => {
	it('answers unauthorized without a live session and touches nothing', async () => {
		getServerSession.mockResolvedValue(null)
		expect(await createAppAction(input)).toEqual({ ok: false, code: 'unauthorized' })
		expect(createApp).not.toHaveBeenCalled()
	})
	it('answers invalid_input with field errors for a bad input', async () => {
		const result = await createAppAction({ ...input, apiBase: 'nope', apiKey: '' })
		expect(result).toMatchObject({ ok: false, code: 'invalid_input' })
		if (!result.ok)
			expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(['apiBase', 'apiKey'])
	})
	it('creates through the DAL, refreshes the route and answers the result', async () => {
		createApp.mockResolvedValue({ id: UUID, partial: false })
		expect(await createAppAction(input)).toEqual({ ok: true, data: { id: UUID, partial: false } })
		expect(createApp).toHaveBeenCalledWith(actor, input)
		expect(refresh).toHaveBeenCalled()
	})
	it("maps Dify's refusal of the credentials to dify_unreachable", async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		createApp.mockRejectedValue(new DifyError(401, 'unauthorized', 'bad key'))
		expect(await createAppAction(input)).toEqual({ ok: false, code: 'dify_unreachable' })
		expect(refresh).not.toHaveBeenCalled()
		expect(errorSpy).toHaveBeenCalledWith('createAppAction:', {
			status: 401,
			code: 'unauthorized',
			message: 'bad key',
		})
	})
	it('updates with a blank key meaning "keep", and answers not_found for a gone app', async () => {
		updateApp.mockResolvedValue({ id: UUID, partial: true })
		expect(await updateAppAction(UUID, { ...input, apiKey: '' })).toEqual({
			ok: true,
			data: { id: UUID, partial: true },
		})
		expect(updateApp).toHaveBeenCalledWith(actor, UUID, { ...input, apiKey: undefined })
		updateApp.mockResolvedValue(null)
		expect(await updateAppAction(UUID, input)).toEqual({ ok: false, code: 'not_found' })
		expect(await updateAppAction('not-a-uuid', input)).toEqual({ ok: false, code: 'not_found' })
	})
	it('deletes and syncs, answering not_found when the row is gone', async () => {
		deleteApp.mockResolvedValue(true)
		expect(await deleteAppAction(UUID)).toEqual({ ok: true, data: undefined })
		deleteApp.mockResolvedValue(false)
		expect(await deleteAppAction(UUID)).toEqual({ ok: false, code: 'not_found' })
		syncApp.mockResolvedValue({ id: UUID, partial: false })
		expect(await syncAppAction(UUID)).toEqual({ ok: true, data: { id: UUID, partial: false } })
		expect(refresh).toHaveBeenCalledTimes(2)
	})

	// Review Focus 3 and deviation 3: a group or account picked in the drawer was deleted before the save.
	it.each([
		['createAppAction', () => createAppAction(input), createApp],
		['updateAppAction', () => updateAppAction(UUID, input), updateApp],
	] as const)(
		'%s answers invalid_input on the access field when a granted id is gone',
		async (_name, call, dal) => {
			dal.mockRejectedValue(
				new Error('Failed query', {
					cause: Object.assign(new Error('ER_NO_REFERENCED_ROW_2'), {
						code: 'ER_NO_REFERENCED_ROW_2',
						errno: 1452,
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
		createApp.mockResolvedValue({ id: UUID, partial: false })
		const groupId = '6f1c2a9e-1b2c-4d3e-8f40-5a6b7c8d9e0f'
		const granted = {
			...input,
			access: { mode: 'restricted', groupIds: [groupId], userIds: ['u7'] },
		}
		await createAppAction(granted)
		expect(createApp).toHaveBeenCalledWith(actor, granted)
	})

	// Review Focus 1 and deviation 3: every admin action refuses a user-role session before touching the DAL.
	it.each([
		['createAppAction', () => createAppAction(input)],
		['updateAppAction', () => updateAppAction(UUID, input)],
		['deleteAppAction', () => deleteAppAction(UUID)],
		['syncAppAction', () => syncAppAction(UUID)],
	] as const)('%s answers forbidden to a user-role account', async (_name, call) => {
		getServerSession.mockResolvedValue({ user: { ...actor, role: 'user' } })
		expect(await call()).toEqual({ ok: false, code: 'forbidden' })
		for (const fn of [createApp, updateApp, deleteApp, syncApp, refresh])
			expect(fn).not.toHaveBeenCalled()
	})

	// ADR-0024: the owner has the admin surface too (hasAdminRights).
	it('lets the owner through as well', async () => {
		const owner = { ...actor, role: 'owner' }
		getServerSession.mockResolvedValue({ user: owner })
		deleteApp.mockResolvedValue(true)
		expect(await deleteAppAction(UUID)).toEqual({ ok: true, data: undefined })
		expect(deleteApp).toHaveBeenCalledWith(owner, UUID)
	})
})
