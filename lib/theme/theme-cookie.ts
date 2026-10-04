// ADR-0016: theme preference in cookies so the server renders the right scheme — docs/decisions/0016-store-the-theme-preference-in-cookies.md
import { ThemeEnum, ThemeModeEnum } from './constants'

export const THEME_MODE_COOKIE = 'theme-mode'
export const THEME_COOKIE = 'theme'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export interface InitialTheme {
	mode: ThemeModeEnum
	resolved: ThemeEnum
}

export const DEFAULT_INITIAL_THEME: InitialTheme = {
	mode: ThemeModeEnum.SYSTEM,
	resolved: ThemeEnum.LIGHT,
}

const isMode = (value: unknown): value is ThemeModeEnum =>
	value === ThemeModeEnum.SYSTEM || value === ThemeModeEnum.LIGHT || value === ThemeModeEnum.DARK
const isScheme = (value: unknown): value is ThemeEnum =>
	value === ThemeEnum.LIGHT || value === ThemeEnum.DARK

/**
 * The initial theme for a server render, read through any `get(name) => value` accessor
 * (Next's `cookies()` store in app/layout.tsx). Junk or missing values fall back per cookie.
 * An explicit light/dark mode decides the scheme; system mode keeps the last resolved scheme
 * the client stored, because the server cannot see prefers-color-scheme.
 */
export const readThemeCookies = (get: (name: string) => string | undefined): InitialTheme => {
	const mode = get(THEME_MODE_COOKIE)
	const resolved = get(THEME_COOKIE)
	const safeMode = isMode(mode) ? mode : DEFAULT_INITIAL_THEME.mode
	if (safeMode === ThemeModeEnum.DARK) return { mode: safeMode, resolved: ThemeEnum.DARK }
	if (safeMode === ThemeModeEnum.LIGHT) return { mode: safeMode, resolved: ThemeEnum.LIGHT }
	return {
		mode: safeMode,
		resolved: isScheme(resolved) ? resolved : DEFAULT_INITIAL_THEME.resolved,
	}
}

/**
 * The two cookie strings the client assigns to document.cookie whenever the mode or the
 * resolved scheme changes. One year, whole site, Lax; Secure on https.
 */
export const themeCookieStrings = (
	mode: ThemeModeEnum,
	resolved: ThemeEnum,
	secure: boolean,
): string[] => {
	const attributes = `Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure ? '; Secure' : ''}`
	return [
		`${THEME_MODE_COOKIE}=${mode}; ${attributes}`,
		`${THEME_COOKIE}=${resolved}; ${attributes}`,
	]
}
