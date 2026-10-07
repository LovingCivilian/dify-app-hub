import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => ({
	getDb: () => {
		throw new Error('not used by the pure tests')
	},
}))

import {
	ICON_MAX_BYTES,
	iconColumnsFrom,
	iconOf,
	parseTags,
	readIconBytes,
	settingsOf,
	toAppDto,
	toChatAppDto,
} from '@/lib/data/apps'

const row = {
	id: 'a1',
	createdAt: new Date('2026-10-07T10:00:00Z'),
	updatedAt: new Date('2026-10-07T11:00:00Z'),
	name: 'Tea',
	mode: 'advanced-chat',
	description: 'desc',
	tags: '["a","b"]',
	isEnabled: true,
	apiBase: 'https://dify.example/v1',
	apiKey: 'app-secret',
	enableAnswerForm: true,
	answerFormFeedbackText: 'Thanks',
	enableUpdateInputAfterStarts: false,
	openingStatementDisplayMode: 'always',
	enableAnnotation: true,
	iconType: 'emoji',
	icon: '🍵',
	iconBackground: '#FFEAD5',
	iconImage: null,
	iconMime: null,
}

describe('parseTags', () => {
	it('reads a JSON array of strings and tolerates anything else', () => {
		expect(parseTags('["a","b"]')).toEqual(['a', 'b'])
		expect(parseTags('["a",1]')).toEqual(['a'])
		expect(parseTags('nope')).toEqual([])
		expect(parseTags(null)).toEqual([])
	})
})

describe('iconOf and settingsOf', () => {
	it('maps an emoji icon, an image icon and no icon', () => {
		expect(iconOf(row)).toEqual({ kind: 'emoji', emoji: '🍵', background: '#FFEAD5' })
		expect(iconOf({ ...row, iconType: 'image', iconImage: Buffer.from([1]) })).toEqual({
			kind: 'image',
		})
		expect(iconOf({ ...row, iconType: 'image', iconImage: null })).toBeNull()
		expect(iconOf({ ...row, iconType: null, icon: null })).toBeNull()
	})
	it('maps the settings with defaults for missing values', () => {
		expect(settingsOf(row)).toEqual({
			answerForm: { enabled: true, feedbackText: 'Thanks' },
			enableUpdateAfterConversationStarts: false,
			openingStatementDisplayMode: 'always',
			annotationEnabled: true,
		})
		expect(
			settingsOf({ ...row, answerFormFeedbackText: null, openingStatementDisplayMode: null }),
		).toMatchObject({
			answerForm: { enabled: true, feedbackText: '' },
			openingStatementDisplayMode: 'default',
		})
	})
})

describe('DTOs', () => {
	it('the admin DTO carries the base but never the key; an unknown mode becomes null', () => {
		const dto = toAppDto(row)
		expect(dto).toEqual({
			id: 'a1',
			name: 'Tea',
			mode: 'advanced-chat',
			description: 'desc',
			tags: ['a', 'b'],
			enabled: true,
			icon: { kind: 'emoji', emoji: '🍵', background: '#FFEAD5' },
			settings: settingsOf(row),
			apiBase: 'https://dify.example/v1',
			createdAt: '2026-10-07T10:00:00.000Z',
			updatedAt: '2026-10-07T11:00:00.000Z',
		})
		expect(JSON.stringify(dto)).not.toContain('app-secret')
		expect(toAppDto({ ...row, mode: 'rag-pipeline' }).mode).toBeNull()
	})
	it('the chat DTO carries neither the key nor the base', () => {
		const dto = toChatAppDto(row)
		expect(dto).toEqual({
			id: 'a1',
			name: 'Tea',
			mode: 'advanced-chat',
			description: 'desc',
			enabled: true,
			icon: { kind: 'emoji', emoji: '🍵', background: '#FFEAD5' },
			settings: settingsOf(row),
		})
		expect(JSON.stringify(dto)).not.toContain('dify.example')
	})
})

// Review Focus 4
describe('readIconBytes', () => {
	const image = (bytes: number, type = 'image/png', length?: string) =>
		new Response(new Uint8Array(bytes), {
			status: 200,
			headers: { 'content-type': type, ...(length !== undefined && { 'content-length': length }) },
		})
	it('reads an image within the cap', async () => {
		const result = await readIconBytes(image(10, 'image/png; charset=binary'), 100)
		expect(result).toEqual({ bytes: Buffer.alloc(10), mime: 'image/png' })
	})
	it('refuses a non-image, a declared size over the cap, and an actual size over the cap', async () => {
		expect(await readIconBytes(image(10, 'text/html'), 100)).toBeNull()
		expect(await readIconBytes(image(10, 'image/png', '200'), 100)).toBeNull()
		expect(await readIconBytes(image(150, 'image/png'), 100)).toBeNull()
		expect(ICON_MAX_BYTES).toBe(1024 * 1024)
	})
})

describe('iconColumnsFrom', () => {
	const site = {
		title: 'T',
		icon_type: 'image' as const,
		icon: 'file-id',
		icon_background: null,
		icon_url: 'https://dify.example/files/x?sign=1',
	}
	it('stores an emoji icon without fetching', async () => {
		const fetchImage = vi.fn()
		await expect(
			iconColumnsFrom(
				{ title: 'T', icon_type: 'emoji', icon: '🍵', icon_background: '#FFF' },
				fetchImage,
			),
		).resolves.toEqual({
			columns: {
				iconType: 'emoji',
				icon: '🍵',
				iconBackground: '#FFF',
				iconImage: null,
				iconMime: null,
			},
			partial: false,
		})
		expect(fetchImage).not.toHaveBeenCalled()
	})
	it('stores the fetched bytes of an image icon', async () => {
		const fetchImage = vi.fn().mockResolvedValue({ bytes: Buffer.from([1, 2]), mime: 'image/png' })
		await expect(iconColumnsFrom(site, fetchImage)).resolves.toEqual({
			columns: {
				iconType: 'image',
				icon: 'file-id',
				iconBackground: null,
				iconImage: Buffer.from([1, 2]),
				iconMime: 'image/png',
			},
			partial: false,
		})
		expect(fetchImage).toHaveBeenCalledWith('https://dify.example/files/x?sign=1')
	})
	it('keeps the previous icon (no columns) and reports partial when the image cannot be stored', async () => {
		await expect(iconColumnsFrom(site, vi.fn().mockResolvedValue(null))).resolves.toEqual({
			columns: undefined,
			partial: true,
		})
		await expect(
			iconColumnsFrom(site, vi.fn().mockRejectedValue(new Error('net'))),
		).resolves.toEqual({ columns: undefined, partial: true })
	})
	it('clears the icon when the site has none', async () => {
		await expect(iconColumnsFrom(null, vi.fn())).resolves.toEqual({
			columns: {
				iconType: null,
				icon: null,
				iconBackground: null,
				iconImage: null,
				iconMime: null,
			},
			partial: false,
		})
	})
})
