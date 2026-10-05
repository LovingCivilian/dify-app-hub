// ADR-0005 (note 2026-10-05): the UI language follows the theme's cookie pattern (ADR-0016) so the server renders it.

/**
 * The cookie the language detector reads first and writes on every language change
 * (`lookupCookie` in libs/i18n.ts; `i18next` is also the detector's default name).
 */
export const LANGUAGE_COOKIE = 'i18next'

/** The UI languages, as `resources` in libs/i18n.ts loads them. */
export const SUPPORTED_LANGUAGES = ['en', 'zh', 'ar'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

const isSupported = (value: string): value is SupportedLanguage =>
	(SUPPORTED_LANGUAGES as readonly string[]).includes(value)

/** A hyphenated tag in its canonical form (`AR-sa` → `ar-SA`), as i18next formats it before resolving. */
const canonical = (tag: string) => {
	if (!tag.includes('-')) return tag
	try {
		return Intl.getCanonicalLocales(tag)[0] ?? tag
	} catch {
		return tag
	}
}

/**
 * The UI language for a server render, read through any `get(name) => value` accessor
 * (Next's `cookies()` store in app/layout.tsx). A regional tag counts as its language (`ar-SA` → `ar`),
 * the way i18next resolves it in the browser; junk or a missing cookie falls back to English.
 */
export const readLanguageCookie = (
	get: (name: string) => string | undefined,
): SupportedLanguage => {
	const language = canonical(get(LANGUAGE_COOKIE) ?? '').split(/[-_]/)[0]
	return isSupported(language) ? language : DEFAULT_LANGUAGE
}
