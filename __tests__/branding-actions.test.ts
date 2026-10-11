import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, refresh, saveBranding, isBrandingEditable } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	refresh: vi.fn(),
	saveBranding: vi.fn(),
	isBrandingEditable: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ refresh }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/settings/branding', () => ({ saveBranding, isBrandingEditable }))

import { saveBrandingAction } from '@/app/(admin)/settings/branding/actions'

const admin = { id: 'a1', email: 'admin@example.com', name: 'Admin', role: 'admin' }
const form = (entries: Record<string, string | File>) => {
	const data = new FormData()
	for (const [key, value] of Object.entries(entries)) data.set(key, value)
	return data
}
const valid = { name: ' Acme ', showName: 'true', logoIntent: 'keep', faviconIntent: 'keep' }

beforeEach(() => {
	for (const fn of [getServerSession, refresh, saveBranding, isBrandingEditable]) fn.mockReset()
	getServerSession.mockResolvedValue({ user: admin })
	isBrandingEditable.mockReturnValue(true)
	saveBranding.mockResolvedValue({ ok: true, data: undefined })
})

describe('saveBrandingAction (settings spec §5.4)', () => {
	it('refuses a user-role account before anything else', async () => {
		getServerSession.mockResolvedValue({ user: { ...admin, role: 'user' } })
		expect(await saveBrandingAction(form(valid))).toEqual({ ok: false, code: 'forbidden' })
		expect(saveBranding).not.toHaveBeenCalled()
	})

	it('refuses outside database mode before reading the form', async () => {
		isBrandingEditable.mockReturnValue(false)
		expect(await saveBrandingAction(form({}))).toEqual({ ok: false, code: 'settings_not_editable' })
	})

	it('answers invalid_input with the field for a bad name or a replace without its file', async () => {
		const blank = await saveBrandingAction(form({ ...valid, name: '  ' }))
		expect(blank).toMatchObject({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { name: expect.any(Array) },
		})
		const noFile = await saveBrandingAction(form({ ...valid, logoIntent: 'replace' }))
		expect(noFile).toMatchObject({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { logo: expect.any(Array) },
		})
		expect(saveBranding).not.toHaveBeenCalled()
	})

	it('hands the parsed form to saveBranding and refreshes on success', async () => {
		const file = new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' })
		expect(
			await saveBrandingAction(
				form({
					...valid,
					showName: 'false',
					logoIntent: 'replace',
					logo: file,
					faviconIntent: 'remove',
				}),
			),
		).toEqual({
			ok: true,
			data: undefined,
		})
		expect(saveBranding).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), {
			name: 'Acme',
			showName: false,
			images: {
				logo: { intent: 'replace', file: expect.any(File) },
				favicon: { intent: 'remove' },
			},
		})
		expect(refresh).toHaveBeenCalledOnce()
	})

	it('does not refresh after a refusal, and turns a throw into operation_failed', async () => {
		saveBranding.mockResolvedValueOnce({
			ok: false,
			code: 'invalid_image',
			fieldErrors: { logo: ['not_allowed'] },
		})
		expect(await saveBrandingAction(form(valid))).toMatchObject({ code: 'invalid_image' })
		saveBranding.mockRejectedValueOnce(new Error('boom'))
		expect(await saveBrandingAction(form(valid))).toEqual({ ok: false, code: 'operation_failed' })
		expect(refresh).not.toHaveBeenCalled()
	})
})
