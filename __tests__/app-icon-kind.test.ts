import { describe, expect, it } from 'vitest'

import { toAppIconKind } from '@/components/apps/app-icon-kind'

// The proxy answers `{ code, data }`: Dify's site on success, Dify's error body on failure (lib/api-utils.ts).
const site = (data: unknown) => ({ code: 200, data })

describe('toAppIconKind', () => {
	it('reads an emoji icon with its background', () => {
		expect(
			toAppIconKind(site({ icon_type: 'emoji', icon: '🤖', icon_background: '#FFEAD5' })),
		).toEqual({
			kind: 'emoji',
			emoji: '🤖',
			background: '#FFEAD5',
		})
	})

	it('reads an emoji icon without a background', () => {
		expect(toAppIconKind(site({ icon_type: 'emoji', icon: '🧠', icon_background: null }))).toEqual({
			kind: 'emoji',
			emoji: '🧠',
			background: undefined,
		})
	})

	it('reads an image icon from icon_url, and a link icon from icon', () => {
		expect(
			toAppIconKind(site({ icon_type: 'image', icon: 'file-id', icon_url: 'https://x/i.png' })),
		).toEqual({
			kind: 'image',
			src: 'https://x/i.png',
		})
		expect(
			toAppIconKind(site({ icon_type: 'link', icon: 'https://x/l.png', icon_url: null })),
		).toEqual({
			kind: 'image',
			src: 'https://x/l.png',
		})
	})

	it('falls back to the mode icon for anything else', () => {
		// Dify's 403 for an app without a site, passed through by the proxy.
		expect(
			toAppIconKind({ code: 403, data: { code: 'forbidden', message: 'x', status: 403 } }),
		).toEqual({
			kind: 'mode',
		})
		expect(toAppIconKind(site({ icon_type: 'image', icon: 'file-id', icon_url: null }))).toEqual({
			kind: 'mode',
		})
		expect(toAppIconKind(site({ icon_type: 'emoji', icon: '' }))).toEqual({ kind: 'mode' })
		expect(toAppIconKind(site({ icon_type: 'sticker', icon: 'x' }))).toEqual({ kind: 'mode' })
		expect(toAppIconKind({ error: 'fetch failed' })).toEqual({ kind: 'mode' })
		expect(toAppIconKind(null)).toEqual({ kind: 'mode' })
		expect(toAppIconKind('<html>')).toEqual({ kind: 'mode' })
	})
})
