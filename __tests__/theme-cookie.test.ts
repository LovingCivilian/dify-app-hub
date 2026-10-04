import { describe, expect, it } from 'vitest'

import { ThemeEnum, ThemeModeEnum } from '@/lib/theme/constants'
import {
	DEFAULT_INITIAL_THEME,
	readThemeCookies,
	THEME_COOKIE,
	THEME_MODE_COOKIE,
	themeCookieStrings,
} from '@/lib/theme/theme-cookie'

const store = (values: Record<string, string>) => (name: string) => values[name]

describe('readThemeCookies', () => {
	it('defaults to system mode and the light scheme without cookies', () => {
		expect(readThemeCookies(store({}))).toEqual(DEFAULT_INITIAL_THEME)
		expect(DEFAULT_INITIAL_THEME).toEqual({ mode: ThemeModeEnum.SYSTEM, resolved: ThemeEnum.LIGHT })
	})

	it('reads an explicit dark mode and resolves it to dark whatever the resolved cookie says', () => {
		expect(
			readThemeCookies(store({ [THEME_MODE_COOKIE]: 'dark', [THEME_COOKIE]: 'light' })),
		).toEqual({
			mode: ThemeModeEnum.DARK,
			resolved: ThemeEnum.DARK,
		})
	})

	it('keeps the last resolved scheme for system mode', () => {
		expect(
			readThemeCookies(store({ [THEME_MODE_COOKIE]: 'system', [THEME_COOKIE]: 'dark' })),
		).toEqual({
			mode: ThemeModeEnum.SYSTEM,
			resolved: ThemeEnum.DARK,
		})
	})

	// Review Focus 2: junk or partial cookies never break the server render.
	it('falls back per cookie on junk values', () => {
		expect(
			readThemeCookies(store({ [THEME_MODE_COOKIE]: 'purple', [THEME_COOKIE]: 'dark' })),
		).toEqual({
			mode: ThemeModeEnum.SYSTEM,
			resolved: ThemeEnum.DARK,
		})
		expect(readThemeCookies(store({ [THEME_MODE_COOKIE]: 'light' }))).toEqual({
			mode: ThemeModeEnum.LIGHT,
			resolved: ThemeEnum.LIGHT,
		})
		expect(readThemeCookies(store({ [THEME_COOKIE]: 'neon' }))).toEqual(DEFAULT_INITIAL_THEME)
	})
})

describe('themeCookieStrings', () => {
	it('produces two one-year, lax, path-wide cookies', () => {
		expect(themeCookieStrings(ThemeModeEnum.DARK, ThemeEnum.DARK, false)).toEqual([
			'theme-mode=dark; Path=/; Max-Age=31536000; SameSite=Lax',
			'theme=dark; Path=/; Max-Age=31536000; SameSite=Lax',
		])
	})

	it('adds Secure when the page is served over https', () => {
		const cookies = themeCookieStrings(ThemeModeEnum.SYSTEM, ThemeEnum.LIGHT, true)
		expect(cookies).toHaveLength(2)
		for (const cookie of cookies) {
			expect(cookie.endsWith('; Secure')).toBe(true)
		}
	})
})
